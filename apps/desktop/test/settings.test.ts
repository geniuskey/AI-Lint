import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESKTOP_SETTINGS, loadSettings, saveSettings, toBackendSettings, type JsonStore,
} from '../src/core/settings.js'

const store = (initial: string | null = null): JsonStore & { value: string | null } => ({
  value: initial,
  async read() {
    return this.value
  },
  async write(json: string) {
    this.value = json
  },
})

describe('loadSettings', () => {
  it('파일이 없으면 기본값을 준다', async () => {
    expect(await loadSettings(store())).toEqual(DEFAULT_DESKTOP_SETTINGS)
  })

  it('망가진 JSON이면 기본값으로 돌아간다', async () => {
    expect(await loadSettings(store('{ 이건 JSON이 아님'))).toEqual(DEFAULT_DESKTOP_SETTINGS)
  })

  it('알 수 없는 타입의 값은 기본값으로 채운다', async () => {
    const loaded = await loadSettings(store('{"backendUrl": 3, "concurrency": "많이"}'))
    expect(loaded.backendUrl).toBe(DEFAULT_DESKTOP_SETTINGS.backendUrl)
    expect(loaded.concurrency).toBe(DEFAULT_DESKTOP_SETTINGS.concurrency)
  })

  it('주소 끝의 슬래시를 떼어낸다', async () => {
    const loaded = await loadSettings(store('{"backendUrl": "http://localhost:3000///"}'))
    expect(loaded.backendUrl).toBe('http://localhost:3000')
  })
})

describe('saveSettings', () => {
  it('일부만 바꿔도 나머지를 유지한다', async () => {
    const s = store('{"userId": "hong"}')
    const saved = await saveSettings(s, { rulesetId: 'team-a' })
    expect(saved.userId).toBe('hong')
    expect(saved.rulesetId).toBe('team-a')
    expect(JSON.parse(s.value!).userId).toBe('hong')
  })
})

describe('toBackendSettings', () => {
  it('토큰을 합쳐 호출용 설정을 만든다', () => {
    const backend = toBackendSettings(
      { ...DEFAULT_DESKTOP_SETTINGS, backendUrl: 'http://localhost:3000', userId: 'hong' },
      'tok',
    )
    expect(backend).toEqual({
      backendUrl: 'http://localhost:3000',
      serviceToken: 'tok',
      userId: 'hong',
      rulesetId: 'default',
    })
  })
})
