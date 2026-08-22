import { describe, it, expect } from 'vitest'
import { blockText, headings, outline, totalTextLength, walkSections } from '../src/index.js'
import { designDoc } from './fixtures/design-doc.js'

describe('blockText', () => {
  it('표는 헤더와 셀을 모두 포함한다', () => {
    const table = designDoc.blocks.find((b) => b.id === 't1')!
    const text = blockText(table)
    expect(text).toContain('단계')
    expect(text).toContain('1차')
    expect(text).toContain('이')
  })

  it('alt 없는 이미지는 빈 문자열이다', () => {
    expect(blockText(designDoc.blocks.find((b) => b.id === 'i1')!)).toBe('')
  })

  it('renderedText 없는 매크로는 빈 문자열이다', () => {
    expect(
      blockText({
        id: 'm1',
        path: [1],
        anchor: { kind: 'confluence', xpath: '//x', textQuote: { exact: 'x' } },
        kind: 'macro',
        name: 'include',
        params: {},
      }),
    ).toBe('')
  })
})

describe('walkSections', () => {
  it('제목을 경계로 섹션을 나눈다', () => {
    expect(walkSections(designDoc).map((s) => s.heading?.text ?? null)).toEqual([
      '결제 모듈 개편',
      '개요',
      '아키텍처',
    ])
  })

  it('제목 자체는 섹션 본문에 포함하지 않는다', () => {
    for (const section of walkSections(designDoc)) {
      expect(section.blocks.some((b) => b.kind === 'heading')).toBe(false)
    }
  })

  it('제목 앞 블록은 heading이 null인 선행 섹션에 담는다', () => {
    const doc = { ...designDoc, blocks: designDoc.blocks.slice(1) }
    const [leading] = walkSections(doc)
    expect(leading!.heading).toBeNull()
    expect(leading!.blocks.map((b) => b.id)).toEqual(['p1'])
  })

  it('섹션 charCount가 본문 길이 합과 같다', () => {
    for (const section of walkSections(designDoc)) {
      expect(section.charCount).toBe(section.blocks.reduce((n, b) => n + blockText(b).length, 0))
    }
  })

  it('모든 비제목 블록이 정확히 한 섹션에 속한다', () => {
    const ids = walkSections(designDoc).flatMap((s) => s.blocks.map((b) => b.id))
    const expected = designDoc.blocks.filter((b) => b.kind !== 'heading').map((b) => b.id)
    expect(ids.sort()).toEqual(expected.sort())
  })

  it('빈 문서는 빈 배열을 반환한다', () => {
    expect(walkSections({ ...designDoc, blocks: [] })).toEqual([])
  })
})

describe('totalTextLength', () => {
  it('코드블록은 세지 않는다', () => {
    const code = designDoc.blocks.find((b) => b.id === 'c1')!
    const withoutCode = { ...designDoc, blocks: designDoc.blocks.filter((b) => b.id !== 'c1') }
    expect(totalTextLength(designDoc)).toBe(totalTextLength(withoutCode))
    expect(blockText(code).length).toBeGreaterThan(0)
  })
})

describe('outline', () => {
  it('제목 레벨만큼 들여쓴 목차를 만든다', () => {
    expect(outline(designDoc)).toBe('- 결제 모듈 개편\n  - 개요\n  - 아키텍처')
  })

  it('headings는 제목 블록만 반환한다', () => {
    expect(headings(designDoc).map((h) => h.id)).toEqual(['h1', 'h2', 'h3'])
  })
})
