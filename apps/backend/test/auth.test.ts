import { describe, it, expect } from 'vitest'
import { createMockProvider } from '@ai-lint/llm'
import type { FastifyInstance } from 'fastify'
import { buildApp } from '../src/app.js'
import { safeEqual } from '../src/auth.js'

const TOKEN = 'test-service-token-0123456789'

const app = (): FastifyInstance => buildApp({ serviceToken: TOKEN, provider: createMockProvider([]) })

const get = (headers: Record<string, string>) =>
  app().inject({ method: 'GET', url: '/v1/rules', headers })

describe('safeEqual', () => {
  it('같은 문자열이면 참', () => {
    expect(safeEqual(TOKEN, TOKEN)).toBe(true)
  })

  it('길이가 달라도 예외 없이 거짓을 반환한다', () => {
    expect(safeEqual('short', TOKEN)).toBe(false)
  })

  it('한 글자만 달라도 거짓', () => {
    expect(safeEqual(`${TOKEN.slice(0, -1)}X`, TOKEN)).toBe(false)
  })
})

describe('서비스 토큰 인증', () => {
  it('토큰이 없으면 401', async () => {
    expect((await get({})).statusCode).toBe(401)
  })

  it('토큰이 틀리면 401', async () => {
    expect((await get({ 'x-ai-lint-token': 'wrong-token-value-000000' })).statusCode).toBe(401)
  })

  it('토큰이 맞으면 통과한다', async () => {
    expect((await get({ 'x-ai-lint-token': TOKEN })).statusCode).toBe(200)
  })

  it('401 응답에 토큰 값을 되비추지 않는다', async () => {
    const res = await get({ 'x-ai-lint-token': 'wrong-token-value-000000' })

    expect(res.body).not.toContain('wrong-token-value')
    expect(res.body).not.toContain(TOKEN)
  })

  it('/v1/health는 인증에서 제외한다', async () => {
    expect((await app().inject({ method: 'GET', url: '/v1/health' })).statusCode).toBe(200)
  })

  it('쿼리스트링이 붙어도 health 예외가 유지된다', async () => {
    expect((await app().inject({ method: 'GET', url: '/v1/health?verbose=1' })).statusCode).toBe(200)
  })
})

describe('요청 사용자 식별', () => {
  it('x-ai-lint-user를 요청에 실어 준다', async () => {
    const instance = app()
    let seen: string | undefined
    instance.get('/probe', async (request) => {
      seen = request.userId
      return { ok: true }
    })

    await instance.inject({
      method: 'GET',
      url: '/probe',
      headers: { 'x-ai-lint-token': TOKEN, 'x-ai-lint-user': 'kim@example.com' },
    })

    expect(seen).toBe('kim@example.com')
  })

  it('헤더가 없으면 anonymous로 둔다', async () => {
    const instance = app()
    let seen: string | undefined
    instance.get('/probe', async (request) => {
      seen = request.userId
      return { ok: true }
    })

    await instance.inject({ method: 'GET', url: '/probe', headers: { 'x-ai-lint-token': TOKEN } })

    expect(seen).toBe('anonymous')
  })
})
