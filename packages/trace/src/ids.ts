import { blockText, type Document } from '@ai-lint/ir'
import type { TraceConfig } from './config.js'

export type IdKind = 'requirement' | 'test' | 'ticket'

export interface IdPattern {
  kind: IdKind
  /** 문자열로 둔다. 설정이 JSON 직렬화를 통과해야 한다. */
  regex: string
}

export interface IdMention {
  id: string
  kind: IdKind
  /** null이면 문서 제목에서 나왔다는 뜻 */
  blockId: string | null
  defining: boolean
  snippet: string
}

/** 앞선 패턴이 이긴다. REQ-1은 ticket 패턴에도 걸리지만 requirement로 남아야 한다. */
function matchIds(text: string, patterns: readonly IdPattern[]): Map<string, IdKind> {
  const found = new Map<string, IdKind>()
  for (const pattern of patterns) {
    for (const match of text.matchAll(new RegExp(pattern.regex, 'g'))) {
      if (!found.has(match[0])) found.set(match[0], pattern.kind)
    }
  }
  return found
}

const snippetOf = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit)}…`

export function extractIds(doc: Document, config: TraceConfig): IdMention[] {
  const mentions: IdMention[] = []
  const definesInBody = doc.docType.value === 'requirement'

  const titleSnippet = snippetOf(doc.title, config.snippetChars)
  for (const [id, kind] of matchIds(doc.title, config.patterns)) {
    mentions.push({ id, kind, blockId: null, defining: true, snippet: titleSnippet })
  }

  for (const block of doc.blocks) {
    const text = blockText(block)
    if (text.length === 0) continue

    const snippet = snippetOf(text, config.snippetChars)
    for (const [id, kind] of matchIds(text, config.patterns)) {
      const defining = block.kind === 'heading' || (definesInBody && kind === 'requirement')
      mentions.push({ id, kind, blockId: block.id, defining, snippet })
    }
  }

  return mentions
}
