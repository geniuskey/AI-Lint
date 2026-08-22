// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { expandSelfClosing, parseFragment } from '../src/parse.js'

describe('expandSelfClosing', () => {
  it('접두사가 붙은 태그를 열고 닫는 형태로 편다', () => {
    expect(expandSelfClosing('<a:buNone/>')).toBe('<a:buNone></a:buNone>')
  })

  it('속성을 그대로 옮긴다', () => {
    expect(expandSelfClosing('<c:v r="A1" t="s"/>')).toBe('<c:v r="A1" t="s"></c:v>')
  })

  it('속성값 안의 꺾쇠에 속지 않는다', () => {
    expect(expandSelfClosing('<w:t w:val="a/>b"/>')).toBe('<w:t w:val="a/>b"></w:t>')
  })

  it('HTML void 요소는 건드리지 않는다', () => {
    expect(expandSelfClosing('<br/><img src="a.png"/>')).toBe('<br/><img src="a.png"/>')
  })

  it('이미 닫힌 태그는 그대로 둔다', () => {
    expect(expandSelfClosing('<w:t>가</w:t>')).toBe('<w:t>가</w:t>')
  })
})

describe('parseFragment', () => {
  it('접두사가 선언되지 않아도 읽어낸다', () => {
    const root = parseFragment('<p:sld><p:cSld>내용</p:cSld></p:sld>')
    expect(root.textContent).toBe('내용')
  })

  it('self-closing 태그가 뒤 형제를 삼키지 않는다', () => {
    const root = parseFragment('<a:p><a:buNone/><a:t>본문</a:t></a:p>')
    const para = root.firstElementChild!
    expect(para.children).toHaveLength(2)
  })
})
