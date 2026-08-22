import { createHash } from 'node:crypto'
import type { Document } from './schema.js'

/**
 * 캐시 키용 내용 해시.
 * 앵커와 source의 휘발성 필드는 제외한다 — 페이지 DOM 구조가 바뀌어도 내용이 같으면 캐시가 살아야 한다.
 */
export function hashDocument(doc: Document): string {
  const normalized = {
    title: doc.title.trim(),
    docType: doc.docType.value,
    labels: [...doc.metadata.labels].sort(),
    owner: doc.metadata.owner ?? null,
    blocks: doc.blocks.map(({ anchor: _anchor, ...rest }) => rest),
    links: doc.links.map((l) => ({ text: l.text, href: l.href, target: l.target, status: l.status ?? null })),
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}
