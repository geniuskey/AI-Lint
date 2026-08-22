import type { Block, Document } from './schema.js'

const idComment = (id: string) => `<!--b:${id}-->`

function renderBlock(block: Block): string {
  switch (block.kind) {
    case 'heading':
      return `${'#'.repeat(block.level)} ${block.text}`

    case 'paragraph':
      return block.text

    case 'list':
      return block.items
        .map((item, i) => `${'  '.repeat(block.depth)}${block.ordered ? `${i + 1}.` : '-'} ${item}`)
        .join('\n')

    case 'table': {
      const lines: string[] = []
      if (block.caption) lines.push(`표: ${block.caption}`)
      const headers = block.headers.length > 0 ? block.headers : block.rows[0]?.map(() => '') ?? []
      if (headers.length > 0) {
        lines.push(`| ${headers.join(' | ')} |`)
        lines.push(`| ${headers.map(() => '---').join(' | ')} |`)
      }
      for (const row of block.rows) lines.push(`| ${row.join(' | ')} |`)
      return lines.join('\n')
    }

    case 'code':
      return `\`\`\`${block.lang ?? ''}\n${block.text}\n\`\`\``

    case 'image': {
      const label = block.alt ?? block.caption
      const head = label ? `[이미지: ${label}]` : '[이미지: alt 없음]'
      return block.ocrText ? `${head}\n${block.ocrText}` : head
    }

    case 'callout':
      return `> [${block.variant}] ${block.text}`

    case 'macro':
      return block.renderedText ?? `[매크로: ${block.name} — 내용 추출 불가]`

    case 'slide': {
      const head = `## 슬라이드 ${block.index}`
      return block.notes ? `${head}\n발표자 노트: ${block.notes}` : head
    }
  }
}

/**
 * IR을 마크다운으로 직렬화한다. LLM에게 JSON 대신 이걸 준다 — 훨씬 잘 읽히고 토큰도 적다.
 * 각 블록 앞의 ID 주석은 LLM이 위치를 지목하는 유일한 수단이므로 절대 생략하지 않는다.
 */
export function serializeToMarkdown(doc: Document): string {
  return doc.blocks.map((b) => `${idComment(b.id)} ${renderBlock(b)}`).join('\n\n')
}

export function serializeBlocks(blocks: Block[]): string {
  return blocks.map((b) => `${idComment(b.id)} ${renderBlock(b)}`).join('\n\n')
}
