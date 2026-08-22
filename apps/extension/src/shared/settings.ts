export interface Settings {
  backendUrl: string
  serviceToken: string
  /** 백엔드 쿼터 집계 단위. 비우면 anonymous로 집계된다. */
  userId: string
  useLlm: boolean
  rulesetId: string
  autoRun: boolean
}

/** chrome.storage.sync에서 필요한 부분만 추린 인터페이스. 테스트에서 가짜를 넣기 위한 것이다. */
export interface SettingsArea {
  get(keys: null): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

export const DEFAULT_SETTINGS: Settings = {
  backendUrl: '',
  serviceToken: '',
  userId: '',
  useLlm: true,
  rulesetId: 'default',
  autoRun: false,
}

const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
const trimUrl = (url: string): string => url.trim().replace(/\/+$/, '')

export async function loadSettings(area: SettingsArea): Promise<Settings> {
  const stored = await area.get(null)
  return {
    backendUrl: trimUrl(str(stored['backendUrl'], DEFAULT_SETTINGS.backendUrl)),
    serviceToken: str(stored['serviceToken'], DEFAULT_SETTINGS.serviceToken),
    userId: str(stored['userId'], DEFAULT_SETTINGS.userId),
    useLlm: bool(stored['useLlm'], DEFAULT_SETTINGS.useLlm),
    rulesetId: str(stored['rulesetId'], DEFAULT_SETTINGS.rulesetId),
    autoRun: bool(stored['autoRun'], DEFAULT_SETTINGS.autoRun),
  }
}

export async function saveSettings(area: SettingsArea, patch: Partial<Settings>): Promise<void> {
  const next = { ...patch }
  if (next.backendUrl !== undefined) next.backendUrl = trimUrl(next.backendUrl)
  await area.set(next)
}

export { isConfigured } from '@ai-lint/backend-client'
