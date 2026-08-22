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

export const para = (
  id: string,
  text: string,
  opts: { emphasizedAsHeading?: boolean } = {},
): Block => ({
  ...base(id, text),
  kind: 'paragraph',
  text,
  ...(opts.emphasizedAsHeading ? { emphasizedAsHeading: true } : {}),
})

export const list = (
  id: string,
  items: string[],
  opts: { ordered?: boolean; depth?: number } = {},
): Block => ({
  ...base(id, items.join(' ')),
  kind: 'list',
  ordered: opts.ordered ?? false,
  items,
  depth: opts.depth ?? 0,
})

export const table = (
  id: string,
  headers: string[],
  rows: string[][],
  opts: { caption?: string; isLayoutTable?: boolean } = {},
): Block => ({
  ...base(id, headers.join(' ')),
  kind: 'table',
  headers,
  rows,
  isLayoutTable: opts.isLayoutTable ?? false,
  ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
})

export const code = (id: string, text: string, lang?: string): Block => ({
  ...base(id, text),
  kind: 'code',
  text,
  ...(lang !== undefined ? { lang } : {}),
})

export const image = (
  id: string,
  opts: { alt?: string; caption?: string; ocrText?: string; assetRef?: string } = {},
): Block => ({
  ...base(id, opts.alt ?? 'image'),
  kind: 'image',
  assetRef: opts.assetRef ?? `att-${id}`,
  ...(opts.alt !== undefined ? { alt: opts.alt } : {}),
  ...(opts.caption !== undefined ? { caption: opts.caption } : {}),
  ...(opts.ocrText !== undefined ? { ocrText: opts.ocrText } : {}),
})

export const callout = (id: string, variant: string, text: string): Block => ({
  ...base(id, text),
  kind: 'callout',
  variant,
  text,
})

export const macro = (
  id: string,
  name: string,
  opts: { params?: Record<string, string>; renderedText?: string } = {},
): Block => ({
  ...base(id, name),
  kind: 'macro',
  name,
  params: opts.params ?? {},
  ...(opts.renderedText !== undefined ? { renderedText: opts.renderedText } : {}),
})

export const link = (
  blockId: string,
  text: string,
  href: string,
  opts: { target?: Link['target']; status?: Link['status'] } = {},
): Link => ({
  blockId,
  text,
  href,
  target: opts.target ?? 'external',
  ...(opts.status !== undefined ? { status: opts.status } : {}),
})

export interface MakeDocOptions {
  docType?: DocType
  links?: Link[]
  title?: string
  modifiedAt?: string
  labels?: string[]
  owner?: string
}

export function makeDoc(blocks: Block[], opts: MakeDocOptions = {}): Document {
  return {
    schemaVersion: 1,
    source: {
      kind: 'confluence',
      uri: 'https://wiki.example.com/pages/1',
      ...(opts.modifiedAt !== undefined ? { modifiedAt: opts.modifiedAt } : {}),
    },
    title: opts.title ?? '결제 모듈 개편 설계',
    docType: { value: opts.docType ?? 'design', confidence: 0.9, origin: 'llm' },
    blocks,
    links: opts.links ?? [],
    metadata: {
      labels: opts.labels ?? ['payment'],
      ...(opts.owner !== undefined ? { owner: opts.owner } : {}),
    },
  }
}

/** 지정한 길이의 한글 더미 본문. 길이 임계값 테스트용. */
export const filler = (chars: number): string => '가'.repeat(chars)
