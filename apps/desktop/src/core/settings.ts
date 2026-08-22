import type { BackendSettings } from '@ai-lint/backend-client'

export interface DesktopSettings {
  backendUrl: string
  /** 백엔드 쿼터 집계 단위. 비우면 anonymous로 집계된다. */
  userId: string
  rulesetId: string
  /** 동시에 검사할 파일 수 */
  concurrency: number
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  backendUrl: '',
  userId: '',
  rulesetId: 'default',
  concurrency: 3,
}

export interface JsonStore {
  read(): Promise<string | null>
  write(json: string): Promise<void>
}

export interface TokenStore {
  read(): Promise<string | null>
  write(token: string): Promise<void>
}

const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)
const int = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
const trimUrl = (url: string): string => url.trim().replace(/\/+$/, '')

function parse(raw: string | null): DesktopSettings {
  let stored: Record<string, unknown> = {}
  if (raw !== null) {
    try {
      const value: unknown = JSON.parse(raw)
      if (typeof value === 'object' && value !== null) stored = value as Record<string, unknown>
    } catch {
      stored = {}
    }
  }
  return {
    backendUrl: trimUrl(str(stored['backendUrl'], DEFAULT_DESKTOP_SETTINGS.backendUrl)),
    userId: str(stored['userId'], DEFAULT_DESKTOP_SETTINGS.userId),
    rulesetId: str(stored['rulesetId'], DEFAULT_DESKTOP_SETTINGS.rulesetId),
    concurrency: int(stored['concurrency'], DEFAULT_DESKTOP_SETTINGS.concurrency),
  }
}

export async function loadSettings(store: JsonStore): Promise<DesktopSettings> {
  return parse(await store.read())
}

export async function saveSettings(
  store: JsonStore,
  patch: Partial<DesktopSettings>,
): Promise<DesktopSettings> {
  const next = parse(JSON.stringify({ ...(await loadSettings(store)), ...patch }))
  await store.write(JSON.stringify(next, null, 2))
  return next
}

export const toBackendSettings = (settings: DesktopSettings, token: string): BackendSettings => ({
  backendUrl: settings.backendUrl,
  serviceToken: token,
  userId: settings.userId,
  rulesetId: settings.rulesetId,
})
