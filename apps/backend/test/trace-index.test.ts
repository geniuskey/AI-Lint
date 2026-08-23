import type { DocIndexEntry } from '@ai-lint/trace'
import { describe, expect, it } from 'vitest'
import { createMemoryTraceIndex } from '../src/services/trace-index.js'

const entryOf = (uri: string, over: Partial<DocIndexEntry> = {}): DocIndexEntry => ({
  uri,
  title: uri,
  docType: 'design',
  documentHash: 'h1',
  modifiedAt: null,
  mentions: [],
  linksTo: [],
  ...over,
})

describe('createMemoryTraceIndex', () => {
  it('넣은 엔트리를 그대로 돌려준다', async () => {
    const index = createMemoryTraceIndex()
    await index.upsert(entryOf('doc-a'))

    expect(await index.all()).toEqual([entryOf('doc-a')])
    expect(await index.count()).toBe(1)
  })

  it('같은 uri는 덮어쓴다', async () => {
    const index = createMemoryTraceIndex()
    await index.upsert(entryOf('doc-a', { title: '옛 제목' }))
    await index.upsert(entryOf('doc-a', { title: '새 제목' }))

    const all = await index.all()
    expect(all).toHaveLength(1)
    expect(all[0]?.title).toBe('새 제목')
  })

  it('최근 갱신한 것부터 돌려준다', async () => {
    const index = createMemoryTraceIndex()
    await index.upsert(entryOf('doc-a'))
    await index.upsert(entryOf('doc-b'))
    await index.upsert(entryOf('doc-a'))

    expect((await index.all()).map((e) => e.uri)).toEqual(['doc-a', 'doc-b'])
  })

  it('빈 인덱스는 빈 목록이다', async () => {
    const index = createMemoryTraceIndex()
    expect(await index.all()).toEqual([])
    expect(await index.count()).toBe(0)
  })
})
