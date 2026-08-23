import { describe, expect, it } from 'vitest'
import { requestTrace, type BackendSettings } from '../src/client.js'

const settings: BackendSettings = {
  backendUrl: 'http://localhost:3000',
  serviceToken: 't',
  userId: 'u',
  rulesetId: 'default',
}

describe('requestTrace', () => {
  it('추적성 리포트를 받아온다', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      return new Response(JSON.stringify({ reportId: 'r1', findings: [] }), { status: 200 })
    }) as unknown as typeof fetch

    const report = await requestTrace({ useLlm: false }, settings, fetchImpl)

    expect(report.reportId).toBe('r1')
    expect(calls[0]?.[0]).toBe('http://localhost:3000/v1/trace/analyze')
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({ useLlm: false })
  })

  it('설정이 비면 부르지 않는다', async () => {
    await expect(
      requestTrace({}, { ...settings, serviceToken: '' }, (() => {
        throw new Error('불려서는 안 된다')
      }) as unknown as typeof fetch),
    ).rejects.toMatchObject({ kind: 'unconfigured' })
  })
})
