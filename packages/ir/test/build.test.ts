import { describe, expect, it } from 'vitest'
import { BlockList, fileNameOf, makeDocument, titleFrom } from '../src/build.js'
import type { SourceAnchor } from '../src/index.js'

const anchor: SourceAnchor = { kind: 'docx', paragraphIndex: 0 }

describe('BlockList', () => {
  it('아이디를 b1부터 차례로 매긴다', () => {
    const list = new BlockList()
    list.add({ kind: 'paragraph', text: '가' }, anchor)
    list.add({ kind: 'paragraph', text: '나' }, anchor)
    expect(list.all().map((block) => block.id)).toEqual(['b1', 'b2'])
  })

  it('제목을 만나면 그 아래 블록의 path가 깊어진다', () => {
    const list = new BlockList()
    list.add({ kind: 'heading', level: 1, text: '개요' }, anchor)
    list.add({ kind: 'paragraph', text: '본문' }, anchor)
    list.add({ kind: 'heading', level: 2, text: '배경' }, anchor)
    list.add({ kind: 'paragraph', text: '본문' }, anchor)
    expect(list.all().map((block) => block.path)).toEqual([[1], [1], [1, 1], [1, 1]])
  })

  it('같은 수준의 제목이 이어지면 번호가 올라간다', () => {
    const list = new BlockList()
    list.add({ kind: 'heading', level: 1, text: '하나' }, anchor)
    list.add({ kind: 'heading', level: 1, text: '둘' }, anchor)
    expect(list.all().map((block) => block.path)).toEqual([[1], [2]])
  })

  it('상위 제목으로 돌아가면 하위 번호를 버린다', () => {
    const list = new BlockList()
    list.add({ kind: 'heading', level: 1, text: '하나' }, anchor)
    list.add({ kind: 'heading', level: 2, text: '하나-1' }, anchor)
    list.add({ kind: 'heading', level: 1, text: '둘' }, anchor)
    expect(list.all().map((block) => block.path)).toEqual([[1], [1, 1], [2]])
  })

  it('제목 없이 시작하면 path가 비어 있다', () => {
    const list = new BlockList()
    list.add({ kind: 'paragraph', text: '본문' }, anchor)
    expect(list.all()[0]?.path).toEqual([])
  })

  it('h1을 건너뛰고 h3부터 시작해도 깊이를 맞춘다', () => {
    const list = new BlockList()
    list.add({ kind: 'heading', level: 3, text: '깊은 제목' }, anchor)
    expect(list.all()[0]?.path).toEqual([0, 0, 1])
  })

  it('추가한 블록을 그대로 돌려준다', () => {
    const list = new BlockList()
    const block = list.add({ kind: 'paragraph', text: '본문' }, anchor)
    expect(block).toEqual({ id: 'b1', path: [], anchor, kind: 'paragraph', text: '본문' })
  })
})

describe('fileNameOf', () => {
  it('Windows 경로에서 파일 이름만 뽑는다', () => {
    expect(fileNameOf('C:\\문서\\보고서.docx')).toBe('보고서.docx')
  })

  it('슬래시 경로도 처리한다', () => {
    expect(fileNameOf('/home/a/b.pdf')).toBe('b.pdf')
  })

  it('경로 구분자가 없으면 그대로 준다', () => {
    expect(fileNameOf('b.pdf')).toBe('b.pdf')
  })
})

describe('titleFrom', () => {
  const ctx = { uri: 'C:\\문서\\보고서.docx' }

  it('후보가 있으면 다듬어 쓴다', () => {
    expect(titleFrom('  결제 모듈 개편  ', ctx)).toBe('결제 모듈 개편')
  })

  it('후보가 비었으면 확장자를 뗀 파일 이름을 쓴다', () => {
    expect(titleFrom('   ', ctx)).toBe('보고서')
    expect(titleFrom(undefined, ctx)).toBe('보고서')
  })
})

describe('makeDocument', () => {
  it('문서 유형은 백엔드가 분류하도록 llm으로 넘긴다', () => {
    const doc = makeDocument('docx', { uri: 'C:\\a.docx' }, '제목', [])
    expect(doc.docType).toEqual({ value: 'unknown', confidence: 0, origin: 'llm' })
  })

  it('수정 시각과 작성자가 있으면 담고 없으면 키를 빼둔다', () => {
    const withMeta = makeDocument(
      'pptx',
      { uri: 'C:\\a.pptx', modifiedAt: '2026-01-01T00:00:00.000Z', author: '홍길동' },
      '제목',
      [],
    )
    expect(withMeta.source).toEqual({
      kind: 'pptx',
      uri: 'C:\\a.pptx',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      author: '홍길동',
    })
    expect(makeDocument('pptx', { uri: 'C:\\a.pptx' }, '제목', []).source).toEqual({
      kind: 'pptx',
      uri: 'C:\\a.pptx',
    })
  })

  it('스키마를 통과한다', () => {
    const list = new BlockList()
    list.add({ kind: 'heading', level: 1, text: '개요' }, anchor)
    expect(() => makeDocument('docx', { uri: 'C:\\a.docx' }, '제목', list.all())).not.toThrow()
  })
})
