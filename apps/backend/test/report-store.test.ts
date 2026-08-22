import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createPool, type Pool } from '../src/db/client.js'
import { migrate } from '../src/db/migrate.js'
import type { LintReport } from '../src/services/lint-service.js'
import { createMemoryStore, createPgStore, type CacheKey, type ReportStore } from '../src/services/report-store.js'

let seq = 0
const makeReport = (over: Partial<LintReport> = {}): LintReport => ({
  reportId: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  documentUri: 'https://wiki.example.com/pages/1',
  documentHash: 'a'.repeat(64),
  docType: 'design',
  rulesetId: 'default',
  rulesetVersion: 1,
  score: { total: 82, grade: 'B', axes: { structure: 85, context: 80, metadata: 80 } },
  findings: [],
  stats: { rulesEvaluated: 20, llmFindingsRejected: 0, durationMs: 12 },
  llmStatus: 'ok',
  truncated: false,
  cached: false,
  createdAt: '2026-08-22T00:00:00.000Z',
  ...over,
})

const keyOf = (report: LintReport, promptVersion = 1): CacheKey => ({
  documentHash: report.documentHash,
  rulesetId: report.rulesetId,
  rulesetVersion: report.rulesetVersion,
  promptVersion,
})

/** 인메모리 구현과 Postgres 구현이 같은 계약을 만족해야 한다. 테스트는 하나만 쓴다. */
function contractSuite(name: string, setup: () => Promise<ReportStore>): void {
  describe(name, () => {
    let store: ReportStore

    beforeEach(async () => {
      store = await setup()
    })

    it('저장한 리포트를 캐시 키로 찾는다', async () => {
      const report = makeReport()
      await store.save(report, { promptVersion: 1, userId: 'kim' })

      expect(await store.findByKey(keyOf(report))).toMatchObject({ reportId: report.reportId })
    })

    it('없는 키는 null', async () => {
      expect(await store.findByKey(keyOf(makeReport({ documentHash: 'b'.repeat(64) })))).toBeNull()
    })

    it('프롬프트 버전이 다르면 캐시가 무효다', async () => {
      const report = makeReport({ documentHash: 'c'.repeat(64) })
      await store.save(report, { promptVersion: 1, userId: 'kim' })

      expect(await store.findByKey(keyOf(report, 2))).toBeNull()
    })

    it('규칙셋 버전이 다르면 캐시가 무효다', async () => {
      const report = makeReport({ documentHash: 'd'.repeat(64) })
      await store.save(report, { promptVersion: 1, userId: 'kim' })

      expect(await store.findByKey({ ...keyOf(report), rulesetVersion: 2 })).toBeNull()
    })

    it('같은 키로 다시 저장하면 덮어쓴다', async () => {
      const hash = 'e'.repeat(64)
      await store.save(makeReport({ documentHash: hash }), { promptVersion: 1, userId: 'kim' })
      const second = makeReport({ documentHash: hash, score: { total: 40, grade: 'D', axes: { structure: 40, context: 40, metadata: 40 } } })
      await store.save(second, { promptVersion: 1, userId: 'kim' })

      const found = await store.findByKey(keyOf(second))
      expect(found?.reportId).toBe(second.reportId)
      expect(found?.score.total).toBe(40)
    })

    it('URI별 이력을 최신순으로 돌려준다', async () => {
      const uri = 'https://wiki.example.com/pages/history'
      const older = makeReport({ documentHash: '1'.repeat(64), documentUri: uri, createdAt: '2026-08-20T00:00:00.000Z' })
      const newer = makeReport({ documentHash: '2'.repeat(64), documentUri: uri, createdAt: '2026-08-21T00:00:00.000Z' })
      await store.save(older, { promptVersion: 1, userId: 'kim' })
      await store.save(newer, { promptVersion: 1, userId: 'kim' })

      const list = await store.listByUri(uri, 10)
      expect(list.map((r) => r.reportId)).toEqual([newer.reportId, older.reportId])
    })

    it('이력 개수를 제한한다', async () => {
      const uri = 'https://wiki.example.com/pages/limited'
      for (let i = 0; i < 3; i++) {
        await store.save(makeReport({ documentUri: uri, documentHash: String(i).repeat(64) }), {
          promptVersion: 1,
          userId: 'kim',
        })
      }

      expect(await store.listByUri(uri, 2)).toHaveLength(2)
    })

    it('다른 URI의 리포트는 섞이지 않는다', async () => {
      await store.save(makeReport({ documentHash: '9'.repeat(64) }), { promptVersion: 1, userId: 'kim' })

      expect(await store.listByUri('https://wiki.example.com/pages/other', 10)).toEqual([])
    })

    it('문서 유형 오버라이드를 저장하고 읽는다', async () => {
      await store.setDocTypeOverride('https://wiki.example.com/pages/1', 'guide', 'kim')

      expect(await store.getDocTypeOverride('https://wiki.example.com/pages/1')).toBe('guide')
    })

    it('오버라이드가 없으면 null', async () => {
      expect(await store.getDocTypeOverride('https://wiki.example.com/pages/none')).toBeNull()
    })

    it('오버라이드는 덮어쓸 수 있다', async () => {
      const uri = 'https://wiki.example.com/pages/over'
      await store.setDocTypeOverride(uri, 'guide', 'kim')
      await store.setDocTypeOverride(uri, 'api-doc', 'lee')

      expect(await store.getDocTypeOverride(uri)).toBe('api-doc')
    })
  })
}

contractSuite('createMemoryStore', async () => createMemoryStore())

// Postgres 구현은 DATABASE_URL이 있을 때만 검증한다. CI는 인메모리로 빠르게 돈다.
const databaseUrl = process.env.TEST_DATABASE_URL
let pool: Pool | undefined

if (databaseUrl) {
  contractSuite('createPgStore', async () => {
    pool ??= createPool(databaseUrl)
    await migrate(pool)
    await pool.query('TRUNCATE reports, doctype_overrides')
    return createPgStore(pool)
  })
} else {
  describe.skip('createPgStore', () => {
    it('TEST_DATABASE_URL이 없어 건너뜀', () => {})
  })
}

afterAll(async () => {
  await pool?.end()
})
