// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { childOf, childrenOf, findDescendant, parseStorage, tagOf, textOf } from '../src/dom.js'

describe('parseStorage', () => {
  it('네임스페이스 태그 이름을 소문자 콜론 형태로 유지한다', () => {
    const root = parseStorage('<ac:structured-macro ac:name="info"></ac:structured-macro>')
    const first = root.children[0]!
    expect(tagOf(first)).toBe('ac:structured-macro')
    expect(first.getAttribute('ac:name')).toBe('info')
  })

  it('self-closing 태그가 형제를 삼키지 않는다', () => {
    const root = parseStorage('<ac:link><ri:page ri:content-title="대상"/><ac:link-body>본문</ac:link-body></ac:link>')
    const link = root.children[0]!
    expect(childrenOf(link, 'ri:page')).toHaveLength(1)
    expect(childOf(link, 'ac:link-body')?.textContent).toBe('본문')
  })

  it('findDescendant는 중첩된 요소를 찾는다', () => {
    const root = parseStorage('<div><section><table><tr><td>값</td></tr></table></section></div>')
    expect(findDescendant(root, 'td')?.textContent).toBe('값')
  })

  it('textOf는 공백을 접고 다듬는다', () => {
    const root = parseStorage('<p>  여러   줄\n  텍스트 </p>')
    expect(textOf(root.children[0]!)).toBe('여러 줄 텍스트')
  })
})
