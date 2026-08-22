import type { Grade } from '@ai-lint/contract'

export interface CachedReport {
  grade: Grade
  total: number
  createdAt: string
}

export interface CacheArea {
  get(keys: null): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

const KEY = 'lastReports'
/** 배지 하나 띄우자고 저장소를 무한히 늘릴 이유가 없다. */
const MAX_ENTRIES = 50

const isEntry = (value: unknown): value is CachedReport =>
  typeof value === 'object' && value !== null && 'grade' in value && 'createdAt' in value

async function readAll(area: CacheArea): Promise<Record<string, CachedReport>> {
  const stored = (await area.get(null))[KEY]
  if (typeof stored !== 'object' || stored === null) return {}
  return Object.fromEntries(Object.entries(stored as Record<string, unknown>).filter(([, v]) => isEntry(v))) as Record<
    string,
    CachedReport
  >
}

export async function readCached(area: CacheArea, uri: string): Promise<CachedReport | null> {
  return (await readAll(area))[uri] ?? null
}

export async function writeCached(area: CacheArea, uri: string, entry: CachedReport): Promise<void> {
  const all = { ...(await readAll(area)), [uri]: entry }
  const kept = Object.entries(all)
    .sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_ENTRIES)
  await area.set({ [KEY]: Object.fromEntries(kept) })
}

export function daysAgo(createdAt: string, now: Date): number {
  const elapsed = now.getTime() - new Date(createdAt).getTime()
  return Math.max(0, Math.floor(elapsed / 86_400_000))
}
