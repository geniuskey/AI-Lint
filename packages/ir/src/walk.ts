import type { Block, Document, HeadingBlock } from './schema.js'

/**
 * 제목을 경계로 나눈 문서 구간.
 * `blocks`에는 제목 자체가 포함되지 않는다 — 섹션 "본문"의 길이를 재는 게 목적이기 때문이다 (STR003).
 */
export interface Section {
  heading: HeadingBlock | null
  blocks: Block[]
  charCount: number
}

/** 블록에서 검사 대상이 되는 텍스트를 뽑는다. */
export function blockText(block: Block): string {
  switch (block.kind) {
    case 'heading':
      return block.text
    case 'paragraph':
      return block.text
    case 'list':
      return block.items.join(' ')
    case 'table':
      return [...block.headers, ...block.rows.flat()].join(' ')
    case 'code':
      return block.text
    case 'image':
      return block.alt ?? block.caption ?? ''
    case 'callout':
      return block.text
    case 'macro':
      return block.renderedText ?? ''
    case 'slide':
      return block.notes ?? ''
  }
}

export function walkSections(doc: Document): Section[] {
  const sections: Section[] = []
  let current: Section = { heading: null, blocks: [], charCount: 0 }

  for (const block of doc.blocks) {
    if (block.kind === 'heading') {
      if (current.heading !== null || current.blocks.length > 0) sections.push(current)
      current = { heading: block, blocks: [], charCount: 0 }
      continue
    }
    current.blocks.push(block)
    current.charCount += blockText(block).length
  }

  if (current.heading !== null || current.blocks.length > 0) sections.push(current)
  return sections
}

export function headings(doc: Document): HeadingBlock[] {
  return doc.blocks.filter((b): b is HeadingBlock => b.kind === 'heading')
}

/** 코드블록을 제외한 본문 텍스트 총량. 문서 규모 판정에 쓴다. */
export function totalTextLength(doc: Document): number {
  return doc.blocks.reduce((n, b) => (b.kind === 'code' ? n : n + blockText(b).length), 0)
}

export function findBlock(doc: Document, blockId: string): Block | undefined {
  return doc.blocks.find((b) => b.id === blockId)
}

/** 문서 목차를 들여쓴 텍스트로. LLM 프롬프트의 전역 맥락에 쓴다. */
export function outline(doc: Document): string {
  return headings(doc)
    .map((h) => `${'  '.repeat(h.level - 1)}- ${h.text}`)
    .join('\n')
}
