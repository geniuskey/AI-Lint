import type { Block, Document } from '@ai-lint/ir'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TRACE_CONFIG } from '../src/config.js'
import { extractIds } from '../src/ids.js'

const ANCHOR = { kind: 'pdf', page: 1 } as const

const heading = (id: string, text: string): Block => ({
  id, path: [0], anchor: ANCHOR, kind: 'heading', level: 1, text,
})

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

describe('extractIds', () => {
  it('제목에 있는 ID는 그 문서가 정의한 것으로 본다', () => {
    const mentions = extractIds(docOf({ title: 'REQ-101 결제 한도' }), DEFAULT_TRACE_CONFIG)
    expect(mentions).toEqual([
      { id: 'REQ-101', kind: 'requirement', blockId: null, defining: true, snippet: 'REQ-101 결제 한도' },
    ])
  })

  it('본문 문단의 ID는 참조로 본다', () => {
    const mentions = extractIds(docOf({ blocks: [para('b1', 'REQ-101을 따른다')] }), DEFAULT_TRACE_CONFIG)
    expect(mentions[0]).toMatchObject({ id: 'REQ-101', blockId: 'b1', defining: false })
  })

  it('제목 블록의 ID는 정의로 본다', () => {
    const mentions = extractIds(docOf({ blocks: [heading('b1', 'REQ-101 한도')] }), DEFAULT_TRACE_CONFIG)
    expect(mentions[0]).toMatchObject({ defining: true })
  })

  it('요구사항 문서에서는 본문 요구사항 ID도 정의로 본다', () => {
    const doc = docOf({
      docType: { value: 'requirement', confidence: 1, origin: 'label' },
      blocks: [para('b1', 'REQ-101 결제는 5초 안에 끝난다'), para('b2', 'PROJ-7 참고')],
    })
    const mentions = extractIds(doc, DEFAULT_TRACE_CONFIG)
    expect(mentions.find((m) => m.id === 'REQ-101')?.defining).toBe(true)
    expect(mentions.find((m) => m.id === 'PROJ-7')?.defining).toBe(false)
  })

  it('앞선 패턴이 이긴다', () => {
    const doc = docOf({ blocks: [para('b1', 'REQ-1 TC-2 PROJ-3')] })
    const kinds = Object.fromEntries(extractIds(doc, DEFAULT_TRACE_CONFIG).map((m) => [m.id, m.kind]))
    expect(kinds).toEqual({ 'REQ-1': 'requirement', 'TC-2': 'test', 'PROJ-3': 'ticket' })
  })

  it('발췌는 상한을 넘지 않는다', () => {
    const doc = docOf({ blocks: [para('b1', `REQ-1 ${'가'.repeat(1000)}`)] })
    const [mention] = extractIds(doc, { ...DEFAULT_TRACE_CONFIG, snippetChars: 20 })
    expect(mention?.snippet).toHaveLength(21)
  })

  it('같은 ID가 여러 블록에 있으면 블록마다 남긴다', () => {
    const doc = docOf({ blocks: [para('b1', 'REQ-1'), para('b2', 'REQ-1')] })
    expect(extractIds(doc, DEFAULT_TRACE_CONFIG).map((m) => m.blockId)).toEqual(['b1', 'b2'])
  })

  it('빈 블록은 건너뛴다', () => {
    const doc = docOf({ blocks: [para('b1', ''), para('b2', 'REQ-1')] })
    expect(extractIds(doc, DEFAULT_TRACE_CONFIG)).toHaveLength(1)
  })

  it('표와 목록에 적힌 ID도 잡는다', () => {
    const doc = docOf({
      blocks: [
        { id: 'b1', path: [0], anchor: ANCHOR, kind: 'list', ordered: false, items: ['REQ-1 확인'], depth: 0 },
        {
          id: 'b2', path: [0], anchor: ANCHOR, kind: 'table',
          headers: ['항목'], rows: [['TC-5']], isLayoutTable: false,
        },
      ],
    })
    expect(extractIds(doc, DEFAULT_TRACE_CONFIG).map((m) => m.id)).toEqual(['REQ-1', 'TC-5'])
  })
})
