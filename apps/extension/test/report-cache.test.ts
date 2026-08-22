import { describe, expect, it } from 'vitest'
import { daysAgo, readCached, writeCached, type CacheArea } from '../src/shared/report-cache.js'

const fakeArea = (initial: Record<string, unknown> = {}): CacheArea & { data: Record<string, unknown> } => ({
  data: { ...initial },
  async get() {
    return { ...this.data }
  },
  async set(items) {
    Object.assign(this.data, items)
  },
})

const entry = (createdAt: string) => ({ grade: 'B' as const, total: 78, createdAt })

describe('report cache', () => {
  it('저장한 적 없는 주소는 null을 준다', async () => {
    expect(await readCached(fakeArea(), 'https://wiki.test/a')).toBeNull()
  })

  it('주소별로 마지막 결과를 되돌려준다', async () => {
    const area = fakeArea()
    await writeCached(area, 'https://wiki.test/a', entry('2026-08-20T00:00:00.000Z'))
    expect(await readCached(area, 'https://wiki.test/a')).toEqual(entry('2026-08-20T00:00:00.000Z'))
    expect(await readCached(area, 'https://wiki.test/b')).toBeNull()
  })

  it('오래된 항목부터 버려 50개를 유지한다', async () => {
    const area = fakeArea()
    for (let i = 0; i < 55; i++) {
      await writeCached(
        area,
        `https://wiki.test/${i}`,
        entry(`2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`),
      )
    }
    const stored = area.data['lastReports'] as Record<string, unknown>
    expect(Object.keys(stored)).toHaveLength(50)
    expect(await readCached(area, 'https://wiki.test/54')).not.toBeNull()
  })

  it('망가진 저장값은 무시한다', async () => {
    expect(await readCached(fakeArea({ lastReports: 'garbage' }), 'https://wiki.test/a')).toBeNull()
  })

  it('며칠 전인지 센다', () => {
    expect(daysAgo('2026-08-20T00:00:00.000Z', new Date('2026-08-22T06:00:00.000Z'))).toBe(2)
    expect(daysAgo('2026-08-22T01:00:00.000Z', new Date('2026-08-22T06:00:00.000Z'))).toBe(0)
  })
})
