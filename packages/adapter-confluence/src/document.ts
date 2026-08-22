import type { Document } from '@ai-lint/ir'
import { attachAnchors } from './anchor.js'
import { extractBlocks } from './blocks.js'
import { parseStorage } from './dom.js'
import { detectDocType } from './doctype.js'
import { extractLinks } from './links.js'
import type { ConfluenceContent } from './rest.js'

export type { ConfluenceContent }

export interface DocumentContext {
  /** Confluence 기본 주소. 링크 분류에 쓴다. */
  baseUrl: string
  /** 사용자가 보고 있는 페이지 주소. 리포트 식별자가 된다. */
  pageUrl: string
}

const compact = (values: Array<string | undefined>): string[] => values.filter((v): v is string => Boolean(v))

export function contentToDocument(content: ConfluenceContent, ctx: DocumentContext): Document {
  const root = parseStorage(content.body?.storage?.value ?? '')
  const { blocks, elements } = extractBlocks(root)
  attachAnchors(blocks, elements, root)

  const spaceKey = content.space?.key
  const links = extractLinks(blocks, elements, {
    baseUrl: ctx.baseUrl,
    pageId: content.id,
    ...(spaceKey ? { spaceKey } : {}),
  })

  const labels = compact((content.metadata?.labels?.results ?? []).map((label) => label.name))
  const ancestors = compact((content.ancestors ?? []).map((ancestor) => ancestor.title))
  const version = content.version?.number
  const modifiedAt = content.version?.when
  // 마지막 편집자가 아니라 최초 작성자를 남긴다. 오타 수정 한 번으로 담당자가 바뀌면 안 된다.
  const author = content.history?.createdBy?.displayName

  return {
    schemaVersion: 1,
    source: {
      kind: 'confluence',
      uri: ctx.pageUrl,
      ...(version !== undefined ? { version: String(version) } : {}),
      ...(modifiedAt ? { modifiedAt } : {}),
      ...(author ? { author } : {}),
      ...(spaceKey ? { space: spaceKey } : {}),
    },
    title: content.title,
    docType: detectDocType(labels, content.metadata?.properties ?? {}),
    blocks,
    links,
    metadata: {
      labels,
      ...(ancestors.length > 0 ? { ancestors } : {}),
    },
  }
}
