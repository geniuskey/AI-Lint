import { describe, it, expect, vi } from 'vitest'
import { createOpenAiCompatibleProvider, LlmError, normalizeJsonSchema, type FetchLike } from '../src/index.js'

const ok = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const provider = (fetchImpl: FetchLike, opts: Record<string, unknown> = {}) =>
  createOpenAiCompatibleProvider({
    baseUrl: 'https://llm.mycorp.com/v1',
    model: 'internal-gpt',
    fetch: fetchImpl,
    ...opts,
  })

const req = {
  system: '너는 문서 검사기다',
  user: '<!--b:p1-->지난번 논의대로',
  schema: { type: 'object', properties: { findings: { type: 'array' } } },
  maxTokens: 2048,
}

const spyFetch = (impl: FetchLike) => vi.fn(impl)
type FetchSpy = ReturnType<typeof spyFetch>

const initOf = (spy: FetchSpy) => spy.mock.calls[0]![1]
const urlOf = (spy: FetchSpy) => spy.mock.calls[0]![0]
const bodyOf = (spy: FetchSpy) => JSON.parse(String(initOf(spy).body))
const headersOf = (spy: FetchSpy) => initOf(spy).headers as Record<string, string>

describe('createOpenAiCompatibleProvider', () => {
  it('모델 이름을 provider name에 담는다', () => {
    expect(provider(async () => ok('{}')).name).toBe('openai:internal-gpt')
  })

  it('baseUrl 끝의 슬래시와 무관하게 같은 경로로 보낸다', async () => {
    const spy = spyFetch(async () => ok('{}'))
    await provider(spy, { baseUrl: 'https://llm.mycorp.com/v1/' }).complete(req)
    expect(urlOf(spy)).toBe('https://llm.mycorp.com/v1/chat/completions')
  })

  it('필수 커스텀 헤더를 그대로 실어 보낸다', async () => {
    const spy = spyFetch(async () => ok('{}'))
    await provider(spy, {
      headers: { 'x-dept-code': 'AI-PLATFORM', 'x-request-source': 'ai-lint' },
    }).complete(req)

    const headers = headersOf(spy)
    expect(headers['x-dept-code']).toBe('AI-PLATFORM')
    expect(headers['x-request-source']).toBe('ai-lint')
    expect(headers['content-type']).toBe('application/json')
  })

  it('토큰을 지정한 커스텀 헤더에 스킴 없이 담는다', async () => {
    const spy = spyFetch(async () => ok('{}'))
    await provider(spy, { apiKey: 'secret', authHeader: 'x-llm-token' }).complete(req)
    expect(headersOf(spy)['x-llm-token']).toBe('secret')
    expect(headersOf(spy).Authorization).toBeUndefined()
  })

  it('Authorization 헤더일 때만 Bearer를 붙인다', async () => {
    const spy = spyFetch(async () => ok('{}'))
    await provider(spy, { apiKey: 'secret' }).complete(req)
    expect(headersOf(spy).Authorization).toBe('Bearer secret')
  })

  it('authScheme을 지정하면 그 스킴을 쓴다', async () => {
    const spy = spyFetch(async () => ok('{}'))
    await provider(spy, { apiKey: 'secret', authHeader: 'x-llm-token', authScheme: 'Token' }).complete(req)
    expect(headersOf(spy)['x-llm-token']).toBe('Token secret')
  })

  it('토큰이 없으면 인증 헤더를 아예 넣지 않는다', async () => {
    const spy = spyFetch(async () => ok('{}'))
    await provider(spy).complete(req)
    expect(headersOf(spy).Authorization).toBeUndefined()
  })

  it('커스텀 헤더가 인증 헤더를 덮어쓰지 못한다', async () => {
    const spy = spyFetch(async () => ok('{}'))
    await provider(spy, { apiKey: 'secret', authHeader: 'x-llm-token', headers: { 'x-llm-token': '남의값' } }).complete(req)
    expect(headersOf(spy)['x-llm-token']).toBe('secret')
  })

  it('chat/completions 본문을 OpenAI 형식으로 만든다', async () => {
    const spy = spyFetch(async () => ok('{"findings":[]}'))
    await provider(spy).complete(req)

    const body = bodyOf(spy)
    expect(body.model).toBe('internal-gpt')
    expect(body.messages).toEqual([
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ])
    expect(body.max_tokens).toBe(2048)
    expect(body.temperature).toBe(0.2)
    expect(body.response_format.type).toBe('json_schema')
    expect(body.response_format.json_schema.schema).toEqual(req.schema)
  })

  it('temperature를 지정하면 그 값을 쓴다', async () => {
    const spy = spyFetch(async () => ok('{}'))
    await provider(spy).complete({ ...req, temperature: 0.7 })
    expect(bodyOf(spy).temperature).toBe(0.7)
  })

  it('json_object 모드에서는 스키마를 시스템 지시에 싣는다', async () => {
    const spy = spyFetch(async () => ok('{}'))
    await provider(spy, { responseFormat: 'json_object' }).complete(req)

    const body = bodyOf(spy)
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].content).toContain(req.system)
    expect(body.messages[0].content).toContain('"findings"')
  })

  it('JSON 응답을 파싱해 돌려준다', async () => {
    const result = await provider(async () => ok('{"findings":[{"ruleId":"CTX001"}]}')).complete(req)
    expect(result).toEqual({ findings: [{ ruleId: 'CTX001' }] })
  })

  it('코드 펜스로 감싼 JSON도 읽는다', async () => {
    const result = await provider(async () => ok('```json\n{"findings":[]}\n```')).complete(req)
    expect(result).toEqual({ findings: [] })
  })

  it('파트 배열로 온 content도 읽는다', async () => {
    const result = await provider(async () => ok([{ type: 'text', text: '{"findings":' }, { type: 'text', text: '[]}' }])).complete(req)
    expect(result).toEqual({ findings: [] })
  })

  it('빈 응답을 invalid-response로 분류한다', async () => {
    await expect(provider(async () => ok('')).complete(req)).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('깨진 JSON을 invalid-response로 분류한다', async () => {
    await expect(provider(async () => ok('{findings:')).complete(req)).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('401을 auth로 분류한다', async () => {
    const res = async () => new Response('bad token', { status: 401 })
    await expect(provider(res).complete(req)).rejects.toMatchObject({ kind: 'auth' })
  })

  it('429를 rate-limit으로 분류한다', async () => {
    const res = async () => new Response('slow down', { status: 429 })
    await expect(provider(res).complete(req)).rejects.toMatchObject({ kind: 'rate-limit' })
  })

  it('오류 본문을 메시지에 담되 잘라서 담는다', async () => {
    const res = async () => new Response('x'.repeat(900), { status: 500 })
    await expect(provider(res).complete(req)).rejects.toThrow(/x{500}(?!x)/)
  })

  it('시간이 지나면 timeout으로 분류한다', async () => {
    const hang: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })

    await expect(provider(hang, { timeoutMs: 10 }).complete(req)).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('모든 실패를 LlmError로 감싼다', async () => {
    const boom = async () => {
      throw new Error('ECONNREFUSED')
    }
    await expect(provider(boom).complete(req)).rejects.toBeInstanceOf(LlmError)
  })
})

describe('normalizeJsonSchema', () => {
  it('nullable을 union 타입으로 바꾼다', () => {
    const result = normalizeJsonSchema({
      type: 'object',
      properties: { suggestion: { type: 'object', nullable: true, properties: { before: { type: 'string' } } } },
    })

    expect(result).toEqual({
      type: 'object',
      properties: { suggestion: { type: ['object', 'null'], properties: { before: { type: 'string' } } } },
    })
  })

  it('배열 안쪽까지 훑는다', () => {
    const result = normalizeJsonSchema({ anyOf: [{ type: 'string', nullable: true }] })
    expect(result).toEqual({ anyOf: [{ type: ['string', 'null'] }] })
  })

  it('enum 값은 건드리지 않는다', () => {
    const result = normalizeJsonSchema({ type: 'string', enum: ['CTX001', 'CTX002'] })
    expect(result).toEqual({ type: 'string', enum: ['CTX001', 'CTX002'] })
  })
})
