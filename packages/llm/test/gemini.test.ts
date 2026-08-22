import { describe, it, expect, vi } from 'vitest'
import { createGeminiProvider, DEFAULT_GEMINI_MODEL, LlmError } from '../src/index.js'

const fakeClient = (impl: () => unknown) => ({ models: { generateContent: vi.fn(impl) } }) as never

const provider = (impl: () => unknown, model?: string) =>
  createGeminiProvider({ apiKey: 'k', client: fakeClient(impl), ...(model ? { model } : {}) })

const req = {
  system: '너는 문서 검사기다',
  user: '<!--b:p1-->지난번 논의대로',
  schema: { type: 'object' },
  maxTokens: 2048,
}

describe('createGeminiProvider', () => {
  it('기본 모델 이름을 provider name에 담는다', () => {
    expect(provider(() => ({ text: '{}' })).name).toBe(`gemini:${DEFAULT_GEMINI_MODEL}`)
  })

  it('모델을 지정하면 그 이름을 쓴다', () => {
    expect(provider(() => ({ text: '{}' }), 'gemini-2.5-pro').name).toBe('gemini:gemini-2.5-pro')
  })

  it('시스템 지시·스키마·토큰 상한을 config로 넘긴다', async () => {
    const client = fakeClient(() => ({ text: '{"findings":[]}' }))
    const p = createGeminiProvider({ apiKey: 'k', client })
    await p.complete(req)

    const arg = (client as any).models.generateContent.mock.calls[0][0]
    expect(arg.model).toBe(DEFAULT_GEMINI_MODEL)
    expect(arg.contents).toEqual([{ role: 'user', parts: [{ text: req.user }] }])
    expect(arg.config.systemInstruction).toBe(req.system)
    expect(arg.config.responseMimeType).toBe('application/json')
    expect(arg.config.responseSchema).toBe(req.schema)
    expect(arg.config.maxOutputTokens).toBe(2048)
    expect(arg.config.temperature).toBe(0.2)
  })

  it('temperature를 지정하면 그 값을 쓴다', async () => {
    const client = fakeClient(() => ({ text: '{}' }))
    await createGeminiProvider({ apiKey: 'k', client }).complete({ ...req, temperature: 0.7 })
    expect((client as any).models.generateContent.mock.calls[0][0].config.temperature).toBe(0.7)
  })

  it('JSON 응답을 파싱해 돌려준다', async () => {
    const result = await provider(() => ({ text: '{"findings":[{"ruleId":"CTX001"}]}' })).complete(req)
    expect(result).toEqual({ findings: [{ ruleId: 'CTX001' }] })
  })

  it('빈 응답을 invalid-response로 분류한다', async () => {
    await expect(provider(() => ({ text: '' })).complete(req)).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('깨진 JSON을 invalid-response로 분류한다', async () => {
    await expect(provider(() => ({ text: '{findings:' })).complete(req)).rejects.toMatchObject({
      kind: 'invalid-response',
    })
  })

  it('인증 실패를 auth로 분류한다', async () => {
    const boom = Object.assign(new Error('permission denied'), { status: 403 })
    await expect(
      provider(() => {
        throw boom
      }).complete(req),
    ).rejects.toMatchObject({ kind: 'auth' })
  })

  it('한도 초과를 rate-limit으로 분류한다', async () => {
    const boom = Object.assign(new Error('quota exceeded'), { status: 429 })
    await expect(
      provider(() => {
        throw boom
      }).complete(req),
    ).rejects.toMatchObject({ kind: 'rate-limit' })
  })

  it('모든 실패를 LlmError로 감싼다', async () => {
    await expect(
      provider(() => {
        throw new Error('알 수 없는 실패')
      }).complete(req),
    ).rejects.toBeInstanceOf(LlmError)
  })
})
