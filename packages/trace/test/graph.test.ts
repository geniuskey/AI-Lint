import type { Block, Document } from '@ai-lint/ir'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TRACE_CONFIG } from '../src/config.js'
import { definedIds, normalizeUri, referencedIds, toIndexEntry, type DocIndexEntry } from '../src/entry.js'
import { allIds, buildGraph } from '../src/graph.js'
import type { IdKind } from '../src/ids.js'

const ANCHOR = { kind: 'pdf', page: 1 } as const

const para = (id: string, text: string): Block => ({
  id, path: [0], anchor: ANCHOR, kind: 'paragraph', text,
})

const docOf = (over: Partial<Document> = {}): Document => ({
  schemaVersion: 1,
  source: { kind: 'confluence', uri: 'https://wiki/a' },
  title: '결제 설계',
  docType: { value: 'design', confidence: 1, origin: 'label' },
  blocks: [],
  links: [],
  metadata: { labels: [] },
  ...over,
})

describe('normalizeUri', () => {
  it('프래그먼트와 쿼리와 끝 슬래시를 떼낸다', () => {
    expect(normalizeUri('https://wiki/pages/12/?a=1#sec')).toBe('https://wiki/pages/12')
  })

  it('경로 없는 루트는 그대로 둔다', () => {
    expect(normalizeUri('/')).toBe('/')
  })
})

describe('toIndexEntry', () => {
  it('문서를 엔트리로 옮긴다', () => {
    const doc = docOf({
      source: { kind: 'confluence', uri: 'https://wiki/a', modifiedAt: '2026-08-01T00:00:00.000Z' },
      title: 'REQ-1 결제',
      blocks: [para('b1', 'TC-9로 검증한다')],
      links: [
        { blockId: 'b1', text: '요구사항', href: 'https://wiki/req#top', target: 'internal' },
        { blockId: 'b1', text: '구글', href: 'https://google.com', target: 'external' },
      ],
    })

    expect(toIndexEntry(doc, 'h1', DEFAULT_TRACE_CONFIG)).toMatchObject({
      uri: 'https://wiki/a',
      title: 'REQ-1 결제',
      docType: 'design',
      documentHash: 'h1',
      modifiedAt: '2026-08-01T00:00:00.000Z',
      linksTo: ['https://wiki/req'],
    })
  })

  it('modifiedAt이 없으면 null로 둔다', () => {
    expect(toIndexEntry(docOf(), 'h1', DEFAULT_TRACE_CONFIG).modifiedAt).toBeNull()
  })

  it('같은 대상을 여러 번 링크해도 한 번만 센다', () => {
    const doc = docOf({
      links: [
        { blockId: 'b1', text: 'a', href: 'https://wiki/req', target: 'internal' },
        { blockId: 'b2', text: 'b', href: 'https://wiki/req/', target: 'internal' },
      ],
    })
    expect(toIndexEntry(doc, 'h1', DEFAULT_TRACE_CONFIG).linksTo).toEqual(['https://wiki/req'])
  })

  it('정의한 ID는 참조 목록에 넣지 않는다', () => {
    const doc = docOf({ title: 'REQ-1', blocks: [para('b1', 'REQ-1과 REQ-2')] })
    const entry = toIndexEntry(doc, 'h1', DEFAULT_TRACE_CONFIG)

    expect(definedIds(entry)).toEqual(['REQ-1'])
    expect(referencedIds(entry)).toEqual(['REQ-2'])
  })
})

const entryOf = (uri: string, over: Partial<DocIndexEntry> = {}): DocIndexEntry => ({
  uri,
  title: uri,
  docType: 'design',
  documentHash: 'h',
  modifiedAt: null,
  mentions: [],
  linksTo: [],
  ...over,
})

const mention = (id: string, defining: boolean, kind: IdKind = 'requirement') => ({
  id, kind, blockId: 'b1', defining, snippet: id,
})

describe('buildGraph', () => {
  it('정의와 참조를 ID별로 모은다', () => {
    const graph = buildGraph([
      entryOf('doc-a', { mentions: [mention('REQ-1', true)] }),
      entryOf('doc-b', { mentions: [mention('REQ-1', false)] }),
      entryOf('doc-c', { mentions: [mention('REQ-1', false)] }),
    ])

    expect(graph.definedBy.get('REQ-1')).toEqual(['doc-a'])
    expect(graph.referencedBy.get('REQ-1')).toEqual(['doc-b', 'doc-c'])
    expect(graph.byUri.get('doc-b')?.uri).toBe('doc-b')
  })

  it('ID 종류를 기억한다', () => {
    const graph = buildGraph([entryOf('doc-a', { mentions: [mention('TC-1', false, 'test')] })])
    expect(graph.kinds.get('TC-1')).toBe('test')
    expect(allIds(graph)).toEqual(['TC-1'])
  })

  it('uri 목록을 정렬해 결정적으로 만든다', () => {
    const graph = buildGraph([
      entryOf('doc-z', { mentions: [mention('REQ-1', false)] }),
      entryOf('doc-a', { mentions: [mention('REQ-1', false)] }),
    ])

    expect(graph.referencedBy.get('REQ-1')).toEqual(['doc-a', 'doc-z'])
    expect(graph.entries.map((e) => e.uri)).toEqual(['doc-a', 'doc-z'])
  })

  it('빈 코퍼스도 다룬다', () => {
    const graph = buildGraph([])
    expect(graph.entries).toEqual([])
    expect(graph.kinds.size).toBe(0)
  })
})
