// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { parseFragment } from '../src/parse.js'
import {
  attr,
  childOf,
  childrenOf,
  findDescendant,
  findDescendants,
  localOf,
  matches,
  tagOf,
  textOf,
} from '../src/traverse.js'

const root = (xml: string): Element => parseFragment(xml).firstElementChild!

describe('tagOf / localOf', () => {
  it('HTML 파서가 남긴 접두사를 그대로 읽는다', () => {
    expect(tagOf(root('<p:sld/>'))).toBe('p:sld')
    expect(localOf(root('<p:sld/>'))).toBe('sld')
  })

  it('접두사가 없으면 이름을 그대로 준다', () => {
    expect(localOf(root('<div/>'))).toBe('div')
  })
})

describe('matches', () => {
  const el = root('<w:tbl/>')

  it('접두사를 뺀 이름으로 찾는다', () => {
    expect(matches(el, 'tbl')).toBe(true)
  })

  it('접두사까지 적으면 정확히 맞아야 한다', () => {
    expect(matches(el, 'w:tbl')).toBe(true)
    expect(matches(el, 'a:tbl')).toBe(false)
  })

  it('다른 이름은 걸러낸다', () => {
    expect(matches(el, 'tr')).toBe(false)
  })
})

describe('childrenOf / childOf', () => {
  const el = root('<w:tbl><w:tr>1</w:tr><w:tr>2</w:tr><w:tblPr/></w:tbl>')

  it('직계 자식만 모은다', () => {
    expect(childrenOf(el, 'tr')).toHaveLength(2)
  })

  it('첫 자식을 준다', () => {
    expect(textOf(childOf(el, 'tr')!)).toBe('1')
  })

  it('없으면 null을 준다', () => {
    expect(childOf(el, 'nope')).toBeNull()
  })
})

describe('findDescendants', () => {
  const el = root('<w:body><w:p><w:r><w:t>가</w:t></w:r></w:p><w:p><w:r><w:t>나</w:t></w:r></w:p></w:body>')

  it('깊이에 상관없이 모두 찾는다', () => {
    expect(findDescendants(el, 't').map(textOf)).toEqual(['가', '나'])
  })

  it('첫 번째만 필요하면 findDescendant를 쓴다', () => {
    expect(textOf(findDescendant(el, 't')!)).toBe('가')
    expect(findDescendant(el, 'nope')).toBeNull()
  })
})

describe('textOf', () => {
  it('공백을 하나로 줄이고 양끝을 자른다', () => {
    expect(textOf(root('<w:t>  가   나  </w:t>'))).toBe('가 나')
  })

  it('내용이 없으면 빈 문자열을 준다', () => {
    expect(textOf(root('<w:t/>'))).toBe('')
  })
})

describe('attr', () => {
  it('접두사가 붙은 속성을 읽는다', () => {
    expect(attr(root('<w:t w:val="42"/>'), 'w:val')).toBe('42')
  })

  it('대소문자가 섞인 속성도 읽는다', () => {
    expect(attr(root('<Relationship Id="rId1"/>'), 'Id')).toBe('rId1')
  })

  it('없으면 null을 준다', () => {
    expect(attr(root('<w:t/>'), 'w:val')).toBeNull()
  })
})
