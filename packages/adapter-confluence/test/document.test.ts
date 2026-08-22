// @vitest-environment happy-dom
import { DocumentSchema } from '@ai-lint/ir'
import { describe, expect, it } from 'vitest'
import { contentToDocument, type ConfluenceContent } from '../src/document.js'
import fixture from './fixtures/design-page.json' with { type: 'json' }

const content = fixture as ConfluenceContent
const ctx = { baseUrl: 'https://wiki.test', pageUrl: 'https://wiki.test/pages/viewpage.action?pageId=789' }
const doc = contentToDocument(content, ctx)

describe('contentToDocument', () => {
  it('IR 스키마를 통과한다', () => {
    expect(() => DocumentSchema.parse(doc)).not.toThrow()
  })

  it('출처와 버전 정보를 옮긴다', () => {
    expect(doc.source).toEqual({
      kind: 'confluence',
      uri: ctx.pageUrl,
      version: '7',
      modifiedAt: '2026-07-15T02:00:00.000Z',
      author: '박작성',
      space: 'ENG',
    })
  })

  it('라벨과 상위 페이지 경로를 메타데이터에 담는다', () => {
    expect(doc.metadata.labels).toEqual(['설계', 'payment'])
    expect(doc.metadata.ancestors).toEqual(['엔지니어링', '결제'])
  })

  it('라벨로 문서 유형을 판정한다', () => {
    expect(doc.docType).toEqual({ value: 'design', confidence: 0.9, origin: 'label' })
  })

  it('본문 블록을 순서대로 만든다', () => {
    expect(doc.blocks.map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'callout',
      'heading',
      'table',
      'paragraph',
      'image',
      'code',
    ])
  })

  it('모든 블록에 confluence 앵커가 붙는다', () => {
    expect(doc.blocks.every((b) => b.anchor.kind === 'confluence')).toBe(true)
  })

  it('링크를 뽑아 블록에 묶는다', () => {
    expect(doc.links).toEqual([
      { blockId: 'b6', text: '결제 홈', href: '/display/ENG/Payment', target: 'internal', status: 'unchecked' },
    ])
  })

  it('CDATA 코드 본문을 보존한다', () => {
    const code = doc.blocks.find((b) => b.kind === 'code')
    expect(code).toMatchObject({ lang: 'json', text: '{"a": 1}' })
  })

  it('본문이 비어도 문서를 만든다', () => {
    const empty = contentToDocument({ ...content, body: { storage: { value: '' } } }, ctx)
    expect(empty.blocks).toEqual([])
    expect(empty.links).toEqual([])
  })
})
