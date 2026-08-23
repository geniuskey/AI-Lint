import type { LintReport, TraceReport } from '@ai-lint/contract'
import type { Document, SourceAnchor } from '@ai-lint/ir'
import type { LlmProvider } from '@ai-lint/llm'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp, type AppDeps } from '../src/app.js'
import { createFixedQuota } from '../src/services/quota.js'
import { createMemoryTraceIndex } from '../src/services/trace-index.js'

const TOKEN = 'test-service-token-0123456789'
const ANCHOR: SourceAnchor = { kind: 'confluence', xpath: "//div[@id='main']/*[1]", textQuote: { exact: 'b1' } }

const silentProvider: LlmProvider = {
  name: 'silent',
  async complete() {
    return { contradictions: [] }
  },
}

const docOf = (
  uri: string,
  title: string,
  text: string,
  docType: Document['docType']['value'] = 'design',
): Document => ({
  schemaVersion: 1,
  source: { kind: 'confluence', uri },
  title,
  docType: { value: docType, confidence: 1, origin: 'label' },
  blocks: [{ id: 'b1', path: [0], anchor: ANCHOR, kind: 'paragraph', text }],
  links: [],
  metadata: { labels: [] },
})

const apps: FastifyInstance[] = []

const appWith = (over: Partial<AppDeps> = {}): FastifyInstance => {
  const app = buildApp({ provider: silentProvider, serviceToken: TOKEN, ...over })
  apps.push(app)
  return app
}

const lint = (app: FastifyInstance, document: Document) =>
  app.inject({
    method: 'POST',
    url: '/v1/lint',
    headers: { 'x-ai-lint-token': TOKEN },
    payload: { document, options: { useLlm: false } } as never,
  })

const analyze = (app: FastifyInstance, body: unknown = { useLlm: false }) =>
  app.inject({
    method: 'POST',
    url: '/v1/trace/analyze',
    headers: { 'x-ai-lint-token': TOKEN },
    payload: body as never,
  })

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('POST /v1/lint 부수 적재', () => {
  it('검사한 문서가 인덱스에 쌓인다', async () => {
    const index = createMemoryTraceIndex()
    const app = appWith({ traceIndex: index })

    const response = await lint(app, docOf('https://wiki/a', 'REQ-1 결제', 'REQ-1 한도'))
    expect(response.statusCode).toBe(200)

    const entries = await index.all()
    expect(entries.map((e) => e.uri)).toEqual(['https://wiki/a'])
    expect(entries[0]?.documentHash).toBe((response.json() as LintReport).documentHash)
  })

  it('인덱스가 실패해도 검사 결과는 나간다', async () => {
    const index = createMemoryTraceIndex()
    index.upsert = async () => {
      throw new Error('디스크가 꽉 찼습니다')
    }

    const response = await lint(appWith({ traceIndex: index }), docOf('https://wiki/a', 'A', 'REQ-1'))
    expect(response.statusCode).toBe(200)
  })
})

describe('POST /v1/trace/analyze', () => {
  it('인덱스가 비면 빈 리포트를 준다', async () => {
    const report = (await analyze(appWith())).json() as TraceReport
    expect(report.documentCount).toBe(0)
    expect(report.findings).toEqual([])
    expect(report.llmStatus).toBe('skipped')
  })

  it('쌓인 문서에서 결정적 지적을 낸다', async () => {
    const app = appWith()
    await lint(app, docOf('https://wiki/a', '결제 설계', 'REQ-9를 따른다'))

    const report = (await analyze(app)).json() as TraceReport

    expect(report.documentCount).toBe(1)
    expect(report.idCount).toBe(1)
    expect(report.findings.map((f) => f.ruleId)).toContain('TRC001')
  })

  it('useLlm이 false면 disabled로 알린다', async () => {
    const report = (await analyze(appWith())).json() as TraceReport
    expect(report.llmSkipReason).toBe('disabled')
  })

  it('쿼터가 막히면 결정적 결과만 낸다', async () => {
    const app = appWith({ quota: createFixedQuota({ allowed: false, reason: 'daily-limit' }) })
    await lint(app, docOf('https://wiki/a', 'A', 'REQ-9'))

    const report = (await analyze(app, { useLlm: true })).json() as TraceReport

    expect(report.llmStatus).toBe('skipped')
    expect(report.llmSkipReason).toBe('quota')
    expect(report.stats.pairsAnalyzed).toBe(0)
  })

  it('LLM을 쓰면 호출 수를 쿼터에 기록한다', async () => {
    const quota = createFixedQuota({ allowed: true })
    const app = appWith({ quota })
    await lint(app, docOf('https://wiki/a', 'A', 'REQ-1 한도는 100이다'))
    await lint(app, docOf('https://wiki/b', 'B', 'REQ-1 한도는 200이다'))

    const report = (await analyze(app, { useLlm: true })).json() as TraceReport

    expect(report.stats.pairsAnalyzed).toBe(1)
    expect(quota.recorded).toEqual([['anonymous', 1]])
  })

  it('토큰이 없으면 막는다', async () => {
    const response = await appWith().inject({ method: 'POST', url: '/v1/trace/analyze', payload: {} })
    expect(response.statusCode).toBe(401)
  })
})
