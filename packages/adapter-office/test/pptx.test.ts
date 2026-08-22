// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BlockOfKind, Document } from '@ai-lint/ir'
import { beforeAll, describe, expect, it } from 'vitest'
import { pptxToDocument } from '../src/pptx.js'

// vite가 `new URL(<변수>, import.meta.url)`을 에셋 참조로 고쳐 쓰므로 경로를 직접 조립한다.
const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(here, 'fixtures', name)))

describe('pptxToDocument', () => {
  let doc: Document

  beforeAll(() => {
    doc = pptxToDocument(fixture('deck.pptx'), { uri: 'C:\\docs\\deck.pptx' })
  })

  it('제목 자리표시자를 1단계 제목으로 만든다', () => {
    const headings = doc.blocks.filter((b): b is BlockOfKind<'heading'> => b.kind === 'heading')
    expect(headings.map((h) => h.text)).toEqual(['분기 리뷰', '지표 요약'])
    expect(headings.every((h) => h.level === 1)).toBe(true)
  })

  it('제목 없는 슬라이드에 제목을 지어내지 않는다', () => {
    const slides = doc.blocks.filter((b): b is BlockOfKind<'slide'> => b.kind === 'slide')
    expect(slides.map((s) => s.index)).toEqual([1, 2, 3])
  })

  it('발표자 노트를 슬라이드 블록에 담는다', () => {
    const slides = doc.blocks.filter((b): b is BlockOfKind<'slide'> => b.kind === 'slide')
    expect(slides[0]?.notes).toBe('수치는 8월 1일 기준입니다.')
    expect(slides[1]?.notes).toBeUndefined()
  })

  it('본문 자리표시자의 여러 문단을 목록으로 묶는다', () => {
    const list = doc.blocks.find((b): b is BlockOfKind<'list'> => b.kind === 'list')
    expect(list?.items).toEqual(['매출 12% 증가', '월간 활성 사용자 3만명', '이탈률 4%p 감소'])
    expect(list?.depth).toBe(0)
    expect(list?.ordered).toBe(false)
  })

  it('그룹 도형 안의 텍스트도 꺼낸다', () => {
    const texts = doc.blocks
      .filter((b): b is BlockOfKind<'paragraph'> => b.kind === 'paragraph')
      .map((b) => b.text)
    expect(texts).toContain('왼쪽 상자 내용')
    expect(texts).toContain('오른쪽 상자 내용')
  })

  it('표를 표 블록으로 만든다', () => {
    const table = doc.blocks.find((b): b is BlockOfKind<'table'> => b.kind === 'table')
    expect(table?.headers).toEqual(['지표', '값'])
    expect(table?.rows).toEqual([
      ['매출', '12억'],
      ['MAU', '3만'],
    ])
  })

  it('앵커에 슬라이드 번호와 도형 id를 담는다', () => {
    const heading = doc.blocks.find((b) => b.kind === 'heading')!
    if (heading.anchor.kind !== 'pptx') throw new Error('앵커 종류가 다릅니다')
    expect(heading.anchor.slide).toBe(1)
    expect(heading.anchor.shapeId).toBeTypeOf('string')

    const table = doc.blocks.find((b) => b.kind === 'table')!
    if (table.anchor.kind !== 'pptx') throw new Error('앵커 종류가 다릅니다')
    expect(table.anchor.slide).toBe(3)
  })

  it('문서 속성에서 제목과 작성자를 읽는다', () => {
    expect(doc.title).toBe('분기 리뷰')
    expect(doc.source.author).toBe('테스터')
    expect(doc.source.kind).toBe('pptx')
  })
})
