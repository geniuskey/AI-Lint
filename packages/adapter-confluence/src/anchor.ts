import type { Block, TextQuote } from '@ai-lint/ir'
import { tagOf } from './dom.js'

const QUOTE_MAX = 120
const CONTEXT_MAX = 30

/**
 * 렌더된 DOM에서 되찾기 위한 상대 xpath.
 * 네임스페이스 접두사가 붙은 스텝은 xpath 평가에서 접두사 미해석으로 예외가 나므로 아예 만들지 않는다.
 * 그런 블록은 textQuote 검색으로만 찾는다.
 */
export function xpathOf(el: Element, root: Element): string {
  const steps: string[] = []
  let current: Element | null = el

  while (current !== null && current !== root) {
    const parent: Element | null = current.parentElement
    if (parent === null) break
    const tag = tagOf(current)
    if (tag.includes(':')) return ''
    const siblings = Array.from(parent.children).filter((child) => tagOf(child) === tag)
    const index = siblings.indexOf(current) + 1
    steps.unshift(siblings.length > 1 ? `${tag}[${index}]` : tag)
    current = parent
  }

  return steps.length > 0 ? `./${steps.join('/')}` : ''
}

/**
 * 블록에서 인용할 텍스트. 본문이 없는 블록도 빈 문자열을 내면 안 된다 (스키마가 1자 이상을 요구한다).
 * `@ai-lint/ir`의 blockText를 쓰지 않는다 — 값 import는 zod를 확장 번들로 끌고 들어온다.
 */
export function quoteTextFor(block: Block): string {
  const raw = ((): string => {
    switch (block.kind) {
      case 'heading':
      case 'paragraph':
      case 'code':
      case 'callout':
        return block.text
      case 'list':
        return block.items.join(' ')
      case 'table':
        return [...block.headers, ...block.rows.flat()].join(' ')
      case 'image':
        return block.alt ?? block.caption ?? block.assetRef
      case 'macro':
        return block.renderedText ?? block.name
      default:
        return block.kind
    }
  })()

  return raw.replace(/\s+/g, ' ').trim() || block.kind
}

const quoteOf = (block: Block | undefined): string => (block ? quoteTextFor(block) : '')

function textQuoteFor(blocks: Block[], index: number): TextQuote {
  const exact = quoteTextFor(blocks[index]!).slice(0, QUOTE_MAX)
  const prefix = quoteOf(blocks[index - 1]).slice(-CONTEXT_MAX)
  const suffix = quoteOf(blocks[index + 1]).slice(0, CONTEXT_MAX)
  return {
    exact,
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  }
}

export function attachAnchors(blocks: Block[], elements: Element[], root: Element): void {
  blocks.forEach((block, index) => {
    const el = elements[index]
    block.anchor = {
      kind: 'confluence',
      xpath: el ? xpathOf(el, root) : '',
      textQuote: textQuoteFor(blocks, index),
    }
  })
}
