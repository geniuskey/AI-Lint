// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { attachAnchors, xpathOf } from '../src/anchor.js'
import { extractBlocks } from '../src/blocks.js'
import { parseStorage } from '../src/dom.js'

const anchored = (xhtml: string) => {
  const root = parseStorage(xhtml)
  const { blocks, elements } = extractBlocks(root)
  attachAnchors(blocks, elements, root)
  return blocks
}

describe('xpathOf', () => {
  it('같은 태그가 하나뿐이면 인덱스를 붙이지 않는다', () => {
    const root = parseStorage('<h1>가</h1><p>나</p>')
    expect(xpathOf(root.children[0]!, root)).toBe('./h1')
  })

  it('같은 태그가 여럿이면 1부터 세는 인덱스를 붙인다', () => {
    const root = parseStorage('<p>가</p><p>나</p>')
    expect(xpathOf(root.children[1]!, root)).toBe('./p[2]')
  })

  it('중첩 경로를 이어 붙인다', () => {
    const root = parseStorage('<div><p>가</p><p>나</p></div>')
    const target = root.children[0]!.children[1]!
    expect(xpathOf(target, root)).toBe('./div/p[2]')
  })

  it('네임스페이스 태그가 끼면 xpath를 포기한다', () => {
    const root = parseStorage(
      '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>가</p></ac:rich-text-body></ac:structured-macro>',
    )
    const target = root.children[0]!.children[0]!.children[0]!
    expect(xpathOf(target, root)).toBe('')
  })
})

describe('attachAnchors', () => {
  it('블록 텍스트를 exact로 쓰고 앞뒤 블록을 문맥으로 붙인다', () => {
    const blocks = anchored('<h1>배경</h1><p>본문입니다</p><h2>결정</h2>')
    const anchor = blocks[1]!.anchor
    expect(anchor.kind).toBe('confluence')
    if (anchor.kind !== 'confluence') throw new Error('unreachable')
    expect(anchor.textQuote.exact).toBe('본문입니다')
    expect(anchor.textQuote.prefix).toBe('배경')
    expect(anchor.textQuote.suffix).toBe('결정')
    expect(anchor.xpath).toBe('./p')
  })

  it('긴 문단은 exact를 잘라 담는다', () => {
    const long = '가'.repeat(300)
    const blocks = anchored(`<p>${long}</p>`)
    const anchor = blocks[0]!.anchor
    if (anchor.kind !== 'confluence') throw new Error('unreachable')
    expect(anchor.textQuote.exact).toHaveLength(120)
  })

  it('텍스트가 없는 블록도 exact를 비우지 않는다', () => {
    const blocks = anchored('<p><ac:image><ri:attachment ri:filename="arch.png"/></ac:image></p>')
    const anchor = blocks[0]!.anchor
    if (anchor.kind !== 'confluence') throw new Error('unreachable')
    expect(anchor.textQuote.exact).toBe('arch.png')
  })

  it('첫 블록에는 prefix가 없다', () => {
    const blocks = anchored('<p>처음</p><p>다음</p>')
    const anchor = blocks[0]!.anchor
    if (anchor.kind !== 'confluence') throw new Error('unreachable')
    expect(anchor.textQuote.prefix).toBeUndefined()
    expect(anchor.textQuote.suffix).toBe('다음')
  })
})
