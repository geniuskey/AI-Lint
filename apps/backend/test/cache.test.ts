import { describe, it, expect } from 'vitest'
import { createMockProvider } from '@ai-lint/llm'
import { resolveRuleset } from '@ai-lint/rules'
import type { FastifyInstance } from 'fastify'
import { buildApp, type AppDeps } from '../src/app.js'
import { createMemoryStore, type ReportStore } from '../src/services/report-store.js'
import { createMemoryRulesetSource } from '../src/services/ruleset-source.js'
import { designDoc, para } from './fixtures.js'

const TOKEN = 'test-service-token-0123456789'

const makeApp = (deps: Omit<AppDeps, 'serviceToken'>): FastifyInstance =>
  buildApp({ serviceToken: TOKEN, ...deps })

const lint = (app: FastifyInstance, payload: unknown) =>
  app.inject({
    method: 'POST',
    url: '/v1/lint',
    payload: payload as never,
    headers: { 'x-ai-lint-token': TOKEN, 'x-ai-lint-user': 'kim@example.com' },
  })

/** 응답 하나만 준비하고 두 번 호출한다. 캐시가 안 먹으면 두 번째 호출에서 목이 소진돼 llmStatus가 failed가 된다. */
const singleUseProvider = () => createMockProvider([{ findings: [] }])

describe('리포트 캐시', () => {
  it('같은 문서를 다시 검사하면 LLM을 호출하지 않는다', async () => {
    const provider = singleUseProvider()
    const app = makeApp({ provider, store: createMemoryStore() })

    await lint(app, { document: designDoc })
    const second = (await lint(app, { document: designDoc })).json()

    expect(provider.calls).toHaveLength(1)
    expect(second.cached).toBe(true)
    expect(second.llmStatus).toBe('ok')
  })

  it('캐시 히트는 처음 리포트의 reportId를 그대로 돌려준다', async () => {
    const app = makeApp({ provider: singleUseProvider(), store: createMemoryStore() })

    const first = (await lint(app, { document: designDoc })).json()
    const second = (await lint(app, { document: designDoc })).json()

    expect(second.reportId).toBe(first.reportId)
    expect(second.documentHash).toBe(first.documentHash)
  })

  it('문서 내용이 바뀌면 다시 호출한다', async () => {
    const provider = createMockProvider([{ findings: [] }, { findings: [] }])
    const app = makeApp({ provider, store: createMemoryStore() })

    await lint(app, { document: designDoc })
    const changed = { ...designDoc, blocks: [...designDoc.blocks, para('p3', '추가된 문단입니다.')] }
    const second = (await lint(app, { document: changed })).json()

    expect(provider.calls).toHaveLength(2)
    expect(second.cached).toBe(false)
  })

  it('규칙셋 버전이 바뀌면 캐시를 무시한다', async () => {
    const store = createMemoryStore()
    const v1 = createMemoryRulesetSource([resolveRuleset({ id: 'default', version: 1, name: '기본 규칙셋' })])
    const v2 = createMemoryRulesetSource([resolveRuleset({ id: 'default', version: 2, name: '기본 규칙셋' })])

    await lint(makeApp({ provider: singleUseProvider(), store, rulesets: v1 }), { document: designDoc })
    const provider = singleUseProvider()
    const second = (await lint(makeApp({ provider, store, rulesets: v2 }), { document: designDoc })).json()

    expect(provider.calls).toHaveLength(1)
    expect(second.cached).toBe(false)
    expect(second.rulesetVersion).toBe(2)
  })

  it('프롬프트 버전이 바뀌면 캐시를 무시한다', async () => {
    const store = createMemoryStore()

    await lint(makeApp({ provider: singleUseProvider(), store, promptVersion: 1 }), { document: designDoc })
    const provider = singleUseProvider()
    const second = (await lint(makeApp({ provider, store, promptVersion: 2 }), { document: designDoc })).json()

    expect(provider.calls).toHaveLength(1)
    expect(second.cached).toBe(false)
  })

  it('save=false면 저장하지 않는다', async () => {
    const store: ReportStore = createMemoryStore()
    const app = makeApp({ provider: createMockProvider([{ findings: [] }, { findings: [] }]), store })

    await lint(app, { document: designDoc, options: { save: false } })
    const second = (await lint(app, { document: designDoc, options: { save: false } })).json()

    expect(second.cached).toBe(false)
    expect(await store.listByUri(designDoc.source.uri, 10)).toEqual([])
  })

  it('LLM을 건너뛴 리포트도 캐시된다', async () => {
    const provider = createMockProvider([])
    const app = makeApp({ provider, store: createMemoryStore() })

    await lint(app, { document: designDoc, options: { useLlm: false } })
    const second = (await lint(app, { document: designDoc, options: { useLlm: false } })).json()

    expect(second.cached).toBe(true)
    expect(second.llmStatus).toBe('skipped')
  })
})

describe('GET /v1/reports', () => {
  it('URI의 최근 리포트를 돌려준다', async () => {
    const app = makeApp({ provider: singleUseProvider(), store: createMemoryStore() })
    await lint(app, { document: designDoc })

    const res = await app.inject({
      method: 'GET',
      url: `/v1/reports?uri=${encodeURIComponent(designDoc.source.uri)}`,
      headers: { 'x-ai-lint-token': TOKEN },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().reports).toHaveLength(1)
  })

  it('uri가 없으면 400', async () => {
    const res = await makeApp({ provider: createMockProvider([]) }).inject({
      method: 'GET',
      url: '/v1/reports',
      headers: { 'x-ai-lint-token': TOKEN },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('uri')
  })
})

describe('POST /v1/doctype-overrides', () => {
  it('지정한 유형으로 검사하고 LLM 추론을 생략한다', async () => {
    const provider = createMockProvider([{ findings: [] }])
    const app = makeApp({ provider, store: createMemoryStore() })

    await app.inject({
      method: 'POST',
      url: '/v1/doctype-overrides',
      payload: { uri: designDoc.source.uri, docType: 'guide' },
      headers: { 'x-ai-lint-token': TOKEN, 'x-ai-lint-user': 'kim@example.com' },
    })
    const body = (
      await lint(app, { document: { ...designDoc, docType: { value: 'unknown', confidence: 0, origin: 'llm' } } })
    ).json()

    expect(provider.calls).toHaveLength(1)
    expect(body.docType).toBe('guide')
  })

  it('알 수 없는 유형은 400', async () => {
    const res = await makeApp({ provider: createMockProvider([]) }).inject({
      method: 'POST',
      url: '/v1/doctype-overrides',
      payload: { uri: designDoc.source.uri, docType: 'blog-post' },
      headers: { 'x-ai-lint-token': TOKEN },
    })

    expect(res.statusCode).toBe(400)
  })
})
