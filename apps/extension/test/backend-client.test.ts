import type { Document } from '@ai-lint/ir'
import { describe, expect, it, vi } from 'vitest'
import { BackendError, kindOfStatus, requestLint, saveDocTypeOverride } from '../src/background/backend-client.js'
import { DEFAULT_SETTINGS } from '../src/shared/settings.js'

const settings = { ...DEFAULT_SETTINGS, backendUrl: 'https://api.test', serviceToken: 'tok', userId: 'kim' }
const doc = { title: '테스트' } as unknown as Document

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('kindOfStatus', () => {
  it('상태코드를 오류 종류로 옮긴다', () => {
    expect(kindOfStatus(401)).toBe('unauthorized')
    expect(kindOfStatus(403)).toBe('forbidden')
    expect(kindOfStatus(429)).toBe('quota')
    expect(kindOfStatus(500)).toBe('server')
  })
})

describe('requestLint', () => {
  it('설정이 비어 있으면 부르지 않고 안내한다', async () => {
    const fetchImpl = vi.fn()
    await expect(requestLint(doc, {}, DEFAULT_SETTINGS, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      kind: 'unconfigured',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('토큰과 사용자 헤더를 붙여 문서를 보낸다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ reportId: 'r1' }))
    const report = await requestLint(doc, { useLlm: false, save: false }, settings, fetchImpl as unknown as typeof fetch)

    expect(report).toEqual({ reportId: 'r1' })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.test/v1/lint')
    expect(init.headers).toMatchObject({ 'X-AI-Lint-Token': 'tok', 'X-AI-Lint-User': 'kim' })
    expect(JSON.parse(init.body as string)).toEqual({
      document: doc,
      options: { useLlm: false, save: false, rulesetId: 'default' },
    })
  })

  it('사용자 ID가 비면 헤더를 붙이지 않는다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}))
    await requestLint(doc, {}, { ...settings, userId: '' }, fetchImpl as unknown as typeof fetch)
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.headers).not.toHaveProperty('X-AI-Lint-User')
  })

  it('네트워크가 끊기면 offline으로 알린다', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(requestLint(doc, {}, settings, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      kind: 'offline',
    })
  })

  it('백엔드가 준 오류 메시지를 그대로 보여준다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: '알 수 없는 규칙셋입니다: x' }, 404))
    await expect(requestLint(doc, {}, settings, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      kind: 'server',
      message: '알 수 없는 규칙셋입니다: x',
    })
  })

  it('본문이 없는 오류에는 기본 안내를 쓴다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 429 }))
    const error = await requestLint(doc, {}, settings, fetchImpl as unknown as typeof fetch).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BackendError)
    expect((error as BackendError).message).toContain('한도')
  })
})

describe('saveDocTypeOverride', () => {
  it('문서 유형 재지정을 저장한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 201))
    await saveDocTypeOverride('https://wiki.test/x', 'design', settings, fetchImpl as unknown as typeof fetch)

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.test/v1/doctype-overrides')
    expect(JSON.parse(init.body as string)).toEqual({ uri: 'https://wiki.test/x', docType: 'design' })
  })
})
