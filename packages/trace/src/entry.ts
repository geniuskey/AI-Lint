import type { DocType, Document } from '@ai-lint/ir'
import type { TraceConfig } from './config.js'
import { extractIds, type IdMention } from './ids.js'

export interface DocIndexEntry {
  uri: string
  title: string
  docType: DocType
  documentHash: string
  modifiedAt: string | null
  mentions: IdMention[]
  linksTo: string[]
}

/** 같은 페이지를 가리키는 링크가 서로 다른 문자열로 갈라지지 않게 한다. */
export function normalizeUri(href: string): string {
  const base = href.split('#')[0]!.split('?')[0]!
  return base.length > 1 ? base.replace(/\/+$/, '') : base
}

const unique = (values: readonly string[]): string[] => [...new Set(values)]

export const definedIds = (entry: DocIndexEntry): string[] =>
  unique(entry.mentions.filter((m) => m.defining).map((m) => m.id))

/** 정의한 ID는 참조로 세지 않는다. 자기가 정의한 것을 자기가 참조한 것으로 잡히면 안 된다. */
export function referencedIds(entry: DocIndexEntry): string[] {
  const defined = new Set(definedIds(entry))
  return unique(entry.mentions.map((m) => m.id)).filter((id) => !defined.has(id))
}

/** 해시는 lint 리포트가 이미 계산해 두었다. 다시 재지 않는다. */
export function toIndexEntry(doc: Document, documentHash: string, config: TraceConfig): DocIndexEntry {
  return {
    uri: doc.source.uri,
    title: doc.title,
    docType: doc.docType.value,
    documentHash,
    modifiedAt: doc.source.modifiedAt ?? null,
    mentions: extractIds(doc, config),
    linksTo: unique(doc.links.filter((l) => l.target === 'internal').map((l) => normalizeUri(l.href))),
  }
}
