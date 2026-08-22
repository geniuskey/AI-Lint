import type { Block, DocType, Document, Link, SourceAnchor } from '@ai-lint/ir'

let anchorSeq = 0
const anchorFor = (exact: string): SourceAnchor => ({
  kind: 'confluence',
  xpath: `//div[@id='main']/*[${++anchorSeq}]`,
  textQuote: { exact: exact.slice(0, 40) || 'empty' },
})

const base = (id: string, text: string) => ({ id, path: [1], anchor: anchorFor(text) })

export const heading = (id: string, level: 1 | 2 | 3 | 4 | 5 | 6, text: string): Block => ({
  ...base(id, text),
  kind: 'heading',
  level,
  text,
})

export const para = (id: string, text: string): Block => ({ ...base(id, text), kind: 'paragraph', text })

export const code = (id: string, text: string, lang?: string): Block => ({
  ...base(id, text),
  kind: 'code',
  text,
  ...(lang !== undefined ? { lang } : {}),
})

export const table = (id: string, headers: string[], rows: string[][]): Block => ({
  ...base(id, headers.join(' ')),
  kind: 'table',
  headers,
  rows,
  isLayoutTable: false,
})

export interface MakeDocOptions {
  docType?: DocType
  links?: Link[]
  title?: string
  labels?: string[]
}

export function makeDoc(blocks: Block[], opts: MakeDocOptions = {}): Document {
  return {
    schemaVersion: 1,
    source: { kind: 'confluence', uri: 'https://wiki.example.com/pages/1' },
    title: opts.title ?? '결제 모듈 개편 설계',
    docType: { value: opts.docType ?? 'design', confidence: 0.9, origin: 'llm' },
    blocks,
    links: opts.links ?? [],
    metadata: { labels: opts.labels ?? ['payment'] },
  }
}
