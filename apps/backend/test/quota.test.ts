import { describe, it, expect } from 'vitest'
import { createMockProvider } from '@ai-lint/llm'
import type { FastifyInstance } from 'fastify'
import { buildApp, type AppDeps } from '../src/app.js'
import { createFixedQuota, createMemoryQuota } from '../src/services/quota.js'
import { designDoc } from './fixtures.js'

const TOKEN = 'test-service-token-0123456789'

const makeApp = (deps: Omit<AppDeps, 'serviceToken'>): FastifyInstance =>
  buildApp({ serviceToken: TOKEN, ...deps })

const lint = (app: FastifyInstance, payload: unknown, user = 'kim@example.com') =>
  app.inject({
    method: 'POST',
    url: '/v1/lint',
    payload: payload as never,
    headers: { 'x-ai-lint-token': TOKEN, 'x-ai-lint-user': user },
  })

describe('createMemoryQuota', () => {
  it('상한 미만이면 허용한다', async () => {
    const quota = createMemoryQuota(2)
    await quota.record('kim', 1)

    expect(await quota.check('kim')).toEqual({ allowed: true })
  })

  it('상한에 도달하면 거부한다', async () => {
    const quota = createMemoryQuota(2)
    await quota.record('kim', 2)

    expect(await quota.check('kim')).toEqual({ allowed: false, reason: 'daily-limit' })
  })

  it('사용자별로 따로 센다', async () => {
    const quota = createMemoryQuota(1)
    await quota.record('kim', 1)

    expect((await quota.check('lee')).allowed).toBe(true)
  })

  it('날짜가 바뀌면 초기화된다', async () => {
    let today = new Date('2026-08-22T10:00:00Z')
    const quota = createMemoryQuota(1, () => today)
    await quota.record('kim', 1)
    expect((await quota.check('kim')).allowed).toBe(false)

    today = new Date('2026-08-23T10:00:00Z')
    expect((await quota.check('kim')).allowed).toBe(true)
  })
})

describe('쿼터가 적용된 /v1/lint', () => {
  it('일일 상한을 넘으면 룰 검사만 수행한다', async () => {
    const provider = createMockProvider([])
    const app = makeApp({ provider, quota: createFixedQuota({ allowed: false, reason: 'daily-limit' }) })

    const body = (await lint(app, { document: designDoc })).json()

    expect(provider.calls).toHaveLength(0)
    expect(body.llmStatus).toBe('skipped')
    expect(body.llmSkipReason).toBe('quota')
    expect(body.findings.length).toBeGreaterThan(0)
  })

  it('LLM을 부른 만큼 사용량을 기록한다', async () => {
    const quota = createFixedQuota({ allowed: true })
    const app = makeApp({ provider: createMockProvider([{ findings: [] }]), quota })

    await lint(app, { document: designDoc })

    expect(quota.recorded).toEqual([['kim@example.com', 1]])
  })

  it('유형 추론까지 호출 수에 포함한다', async () => {
    const quota = createFixedQuota({ allowed: true })
    const app = makeApp({
      provider: createMockProvider([{ value: 'design', confidence: 0.9 }, { findings: [] }]),
      quota,
    })

    await lint(app, { document: { ...designDoc, docType: { value: 'unknown', confidence: 0, origin: 'llm' } } })

    expect(quota.recorded).toEqual([['kim@example.com', 2]])
  })

  it('LLM을 건너뛰면 기록하지 않는다', async () => {
    const quota = createFixedQuota({ allowed: true })
    const app = makeApp({ provider: createMockProvider([]), quota })

    await lint(app, { document: designDoc, options: { useLlm: false } })

    expect(quota.recorded).toEqual([])
  })

  it('사용자를 구분해 기록한다', async () => {
    const quota = createMemoryQuota(1)
    const app = makeApp({ provider: createMockProvider([{ findings: [] }, { findings: [] }]), quota })

    await lint(app, { document: designDoc, options: { save: false } }, 'kim@example.com')
    const second = (await lint(app, { document: designDoc, options: { save: false } }, 'lee@example.com')).json()

    expect(second.llmStatus).toBe('ok')
    const third = (await lint(app, { document: designDoc, options: { save: false } }, 'kim@example.com')).json()
    expect(third.llmSkipReason).toBe('quota')
  })
})
