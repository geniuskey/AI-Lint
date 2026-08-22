import { describe, it, expect } from 'vitest'
import { LlmError, createMockProvider, type LlmProvider } from '@ai-lint/llm'
import type { FastifyInstance } from 'fastify'
import { buildApp, type AppDeps } from '../src/app.js'
import { DEFAULT_LIMITS } from '../src/services/lint-service.js'
import { ctxFinding, designDoc, para } from './fixtures.js'

const TOKEN = 'test-service-token-0123456789'

const makeApp = (deps: Omit<AppDeps, 'serviceToken'>): FastifyInstance =>
  buildApp({ serviceToken: TOKEN, ...deps })

const inject = (app: FastifyInstance, payload: unknown, headers: Record<string, string> = { 'x-ai-lint-token': TOKEN }) =>
  app.inject({ method: 'POST', url: '/v1/lint', payload: payload as never, headers })

const failingProvider: LlmProvider = {
  name: 'always-fail',
  async complete() {
    throw new LlmError('게이트웨이 오류', 'unknown')
  },
}

describe('POST /v1/lint', () => {
  it('룰과 LLM finding을 합친 리포트를 반환한다', async () => {
    const app = makeApp({ provider: createMockProvider([{ findings: [ctxFinding('p1', '지난번 논의대로')] }]) })

    const res = await inject(app, { document: designDoc })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.findings.some((f: { source: string }) => f.source === 'rule')).toBe(true)
    expect(body.findings.some((f: { source: string }) => f.source === 'llm')).toBe(true)
    expect(body.score.grade).toMatch(/^[ABCD]$/)
    expect(body.llmStatus).toBe('ok')
    expect(body.cached).toBe(false)
    expect(body.truncated).toBe(false)
  })

  it('리포트에 문서 식별 정보와 규칙셋 버전을 담는다', async () => {
    const app = makeApp({ provider: createMockProvider([{ findings: [] }]) })

    const body = (await inject(app, { document: designDoc })).json()

    expect(body.reportId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.documentUri).toBe(designDoc.source.uri)
    expect(body.documentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(body.docType).toBe('design')
    expect(body.rulesetId).toBe('default')
    expect(body.rulesetVersion).toBe(1)
    expect(Date.parse(body.createdAt)).not.toBeNaN()
  })

  it('useLlm=false면 룰 검사만 하고 provider를 호출하지 않는다', async () => {
    const provider = createMockProvider([])
    const app = makeApp({ provider })

    const body = (await inject(app, { document: designDoc, options: { useLlm: false } })).json()

    expect(provider.calls).toHaveLength(0)
    expect(body.llmStatus).toBe('skipped')
    expect(body.llmSkipReason).toBe('disabled')
    expect(body.findings.every((f: { source: string }) => f.source === 'rule')).toBe(true)
    expect(body.findings.length).toBeGreaterThan(0)
  })

  it('LLM이 실패해도 200과 룰 결과를 반환한다', async () => {
    const app = makeApp({ provider: failingProvider })

    const res = await inject(app, { document: designDoc })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.llmStatus).toBe('failed')
    expect(body.findings.length).toBeGreaterThan(0)
  })

  it('검증에서 걸러낸 LLM finding 수를 통계에 남긴다', async () => {
    const app = makeApp({
      provider: createMockProvider([
        { findings: [ctxFinding('p1', '지난번 논의대로'), ctxFinding('p2', '문서에 없는 인용문')] },
      ]),
    })

    const body = (await inject(app, { document: designDoc })).json()

    expect(body.stats.llmFindingsRejected).toBe(1)
    expect(body.stats.rulesEvaluated).toBeGreaterThan(0)
    expect(body.stats.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('IR 스키마 위반은 400과 필드 경로를 반환한다', async () => {
    const res = await inject(makeApp({ provider: createMockProvider([]) }), { document: { title: 'x' } })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('document')
  })

  it('토큰이 없으면 401', async () => {
    const res = await inject(makeApp({ provider: createMockProvider([]) }), { document: designDoc }, {})

    expect(res.statusCode).toBe(401)
  })

  it('블록 수 상한을 넘으면 잘라서 검사하고 truncated를 표시한다', async () => {
    const huge = {
      ...designDoc,
      blocks: Array.from({ length: 20 }, (_, i) => para(`x${i}`, `${i}번째 문단입니다.`)),
      links: [{ blockId: 'x19', text: '여기', href: '/x', target: 'internal' as const }],
    }
    const app = makeApp({ provider: createMockProvider([{ findings: [] }]), limits: { maxBlocks: 5 } })

    const body = (await inject(app, { document: huge })).json()

    expect(body.truncated).toBe(true)
    // 잘려나간 블록을 가리키는 링크는 함께 버린다 — 없는 블록을 지적하면 앵커가 깨진다.
    expect(body.findings.every((f: { ruleId: string }) => f.ruleId !== 'STR007')).toBe(true)
  })

  it('기본 블록 상한은 2000이다', () => {
    expect(DEFAULT_LIMITS.maxBlocks).toBe(2000)
  })

  it('docType.origin이 llm이 아니면 유형 추론을 호출하지 않는다', async () => {
    const provider = createMockProvider([{ findings: [] }])
    const app = makeApp({ provider })

    await inject(app, { document: designDoc })

    expect(provider.calls).toHaveLength(1)
  })

  it('docType.origin이 llm이면 유형을 추론해 리포트에 반영한다', async () => {
    const provider = createMockProvider([{ value: 'meeting-notes', confidence: 0.8 }, { findings: [] }])
    const app = makeApp({ provider })

    const body = (
      await inject(app, {
        document: { ...designDoc, docType: { value: 'unknown', confidence: 0, origin: 'llm' } },
      })
    ).json()

    expect(provider.calls).toHaveLength(2)
    expect(body.docType).toBe('meeting-notes')
  })

  it('useLlm=false면 origin이 llm이어도 추론하지 않는다', async () => {
    const provider = createMockProvider([])
    const app = makeApp({ provider })

    const body = (
      await inject(app, {
        document: { ...designDoc, docType: { value: 'unknown', confidence: 0, origin: 'llm' } },
        options: { useLlm: false },
      })
    ).json()

    expect(provider.calls).toHaveLength(0)
    expect(body.docType).toBe('unknown')
  })

  it('문서가 LLM 입력 상한을 넘으면 룰 검사만 수행한다', async () => {
    const provider = createMockProvider([])
    const app = makeApp({ provider, limits: { llmMaxDocChars: 10 } })

    const body = (await inject(app, { document: designDoc })).json()

    expect(provider.calls).toHaveLength(0)
    expect(body.llmStatus).toBe('skipped')
    expect(body.llmSkipReason).toBe('too-large')
    expect(body.findings.length).toBeGreaterThan(0)
  })

  it('알 수 없는 규칙셋을 지정하면 404', async () => {
    const res = await inject(makeApp({ provider: createMockProvider([]) }), {
      document: designDoc,
      options: { rulesetId: 'nope' },
    })

    expect(res.statusCode).toBe(404)
    expect(res.json().error).toContain('nope')
  })

  it('finding을 본문 순서대로 정렬해 돌려준다', async () => {
    const app = makeApp({ provider: createMockProvider([{ findings: [ctxFinding('p1', '지난번 논의대로')] }]) })

    const body = (await inject(app, { document: designDoc })).json()

    const order = designDoc.blocks.map((b) => b.id)
    const positions = body.findings.map((f: { blockId: string | null }) =>
      f.blockId === null ? -1 : order.indexOf(f.blockId),
    )
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })
})
