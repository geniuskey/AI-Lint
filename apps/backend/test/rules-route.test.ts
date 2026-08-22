import { describe, it, expect } from 'vitest'
import { createMockProvider } from '@ai-lint/llm'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'

const TOKEN = 'test-service-token-0123456789'

const app = (): FastifyInstance => buildApp({ serviceToken: TOKEN, provider: createMockProvider([]) })

const get = (url: string) => app().inject({ method: 'GET', url, headers: { 'x-ai-lint-token': TOKEN } })

interface RuleRow {
  id: string
  axis: string
  defaultSeverity: string
  llm: boolean
  docsUrl: string
}

describe('GET /v1/rules', () => {
  it('전체 카탈로그를 축·심각도와 함께 반환한다', async () => {
    const body = (await get('/v1/rules')).json()

    expect(body.rules).toHaveLength(30)
    const ctx001 = body.rules.find((r: RuleRow) => r.id === 'CTX001')
    expect(ctx001.axis).toBe('context')
    expect(ctx001.llm).toBe(true)
    expect(ctx001.docsUrl).toContain('ctx001')
  })

  it('결정적 룰과 LLM 룰을 구분해 표시한다', async () => {
    const body = (await get('/v1/rules')).json()

    expect(body.rules.filter((r: RuleRow) => r.llm)).toHaveLength(11)
    expect(body.rules.find((r: RuleRow) => r.id === 'STR001').llm).toBe(false)
  })
})

describe('GET /v1/rulesets', () => {
  it('사용 가능한 규칙셋 목록을 반환한다', async () => {
    const body = (await get('/v1/rulesets')).json()

    expect(body.rulesets).toEqual([{ id: 'default', version: 1, name: '기본 규칙셋' }])
  })

  it('규칙셋 상세는 축 가중치와 룰별 설정을 담는다', async () => {
    const body = (await get('/v1/rulesets/default')).json()

    expect(body.axisWeights).toEqual({ structure: 0.35, context: 0.45, metadata: 0.2 })
    expect(Object.keys(body.rules)).toHaveLength(30)
    expect(body.rules.STR001.enabled).toBe(true)
  })

  it('없는 규칙셋은 404', async () => {
    const res = await get('/v1/rulesets/nope')

    expect(res.statusCode).toBe(404)
  })
})

describe('GET /v1/health', () => {
  it('인증 없이 상태를 반환한다', async () => {
    const res = await app().inject({ method: 'GET', url: '/v1/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ok')
  })
})
