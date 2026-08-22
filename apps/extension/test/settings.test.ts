import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, isConfigured, loadSettings, saveSettings, type SettingsArea } from '../src/shared/settings.js'

const fakeArea = (initial: Record<string, unknown> = {}): SettingsArea & { data: Record<string, unknown> } => ({
  data: { ...initial },
  async get() {
    return { ...this.data }
  },
  async set(items) {
    Object.assign(this.data, items)
  },
})

describe('settings', () => {
  it('저장된 값이 없으면 기본값을 준다', async () => {
    expect(await loadSettings(fakeArea())).toEqual(DEFAULT_SETTINGS)
  })

  it('저장된 값으로 기본값을 덮어쓴다', async () => {
    const area = fakeArea({ backendUrl: 'https://api.test', useLlm: false })
    const settings = await loadSettings(area)
    expect(settings.backendUrl).toBe('https://api.test')
    expect(settings.useLlm).toBe(false)
    expect(settings.rulesetId).toBe('default')
  })

  it('타입이 다른 저장값은 무시한다', async () => {
    const settings = await loadSettings(fakeArea({ useLlm: 'yes', backendUrl: 42 }))
    expect(settings.useLlm).toBe(true)
    expect(settings.backendUrl).toBe('')
  })

  it('백엔드 주소 끝의 슬래시를 떼고 저장한다', async () => {
    const area = fakeArea()
    await saveSettings(area, { backendUrl: 'https://api.test/' })
    expect(area.data['backendUrl']).toBe('https://api.test')
  })

  it('주소와 토큰이 모두 있어야 설정 완료로 본다', () => {
    expect(isConfigured(DEFAULT_SETTINGS)).toBe(false)
    expect(isConfigured({ ...DEFAULT_SETTINGS, backendUrl: 'https://api.test' })).toBe(false)
    expect(isConfigured({ ...DEFAULT_SETTINGS, backendUrl: 'https://api.test', serviceToken: 't' })).toBe(true)
  })
})
