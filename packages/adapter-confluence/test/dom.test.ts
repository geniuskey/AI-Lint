// @vitest-environment happy-dom
import { childOf, childrenOf, tagOf } from '@ai-lint/xml'
import { describe, expect, it } from 'vitest'
import { parseStorage } from '../src/dom.js'

describe('parseStorage', () => {
  it('네임스페이스 태그 이름과 속성을 유지한다', () => {
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

  it('CDATA 본문을 텍스트로 살려낸다', () => {
    const root = parseStorage('<ac:plain-text-body><![CDATA[const a = 1 < 2]]></ac:plain-text-body>')
    expect(root.children[0]?.textContent).toBe('const a = 1 < 2')
  })
})
