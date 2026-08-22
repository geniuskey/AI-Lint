import { contentPath, contentToDocument, type ConfluenceContent } from '@ai-lint/adapter-confluence'
import type { Document } from '@ai-lint/ir'

export type PageReadErrorKind = 'not-a-page' | 'forbidden' | 'failed'

export class PageReadError extends Error {
  readonly kind: PageReadErrorKind

  constructor(kind: PageReadErrorKind, message: string) {
    super(message)
    this.name = 'PageReadError'
    this.kind = kind
  }
}

const metaContent = (dom: globalThis.Document, name: string): string | null =>
  dom.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() || null

/**
 * content script는 isolated world라 페이지의 AJS 전역을 볼 수 없다.
 * Confluence가 심어 두는 meta 태그와 주소만으로 판단한다.
 */
export function findPageId(dom: globalThis.Document): string | null {
  return metaContent(dom, 'ajs-page-id') ?? new URL(dom.location.href).searchParams.get('pageId')
}

export function findBaseUrl(dom: globalThis.Document): string {
  const base = metaContent(dom, 'ajs-base-url') ?? new URL(dom.location.href).origin
  return base.replace(/\/+$/, '')
}

export async function readPage(dom: globalThis.Document, fetchImpl: typeof fetch = fetch): Promise<Document> {
  const pageId = findPageId(dom)
  if (!pageId) throw new PageReadError('not-a-page', '이 화면은 Confluence 페이지가 아닙니다.')

  const baseUrl = findBaseUrl(dom)
  // 사용자 세션 쿠키를 그대로 쓴다. 백엔드는 Confluence 자격증명을 갖지 않는다.
  const response = await fetchImpl(`${baseUrl}${contentPath(pageId)}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })

  if (response.status === 401 || response.status === 403) {
    throw new PageReadError('forbidden', '이 페이지를 볼 권한이 없습니다.')
  }
  if (!response.ok) {
    throw new PageReadError('failed', `페이지를 읽지 못했습니다 (HTTP ${response.status}).`)
  }

  const content = (await response.json()) as ConfluenceContent
  return contentToDocument(content, { baseUrl, pageUrl: dom.location.href })
}
