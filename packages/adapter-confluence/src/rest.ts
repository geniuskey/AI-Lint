/** 스펙 9.2절. 이 확장 문자열이 있어야 아래 타입의 필드가 채워져 온다. */
export const CONTENT_EXPAND = 'body.storage,version,metadata.labels,metadata.properties,ancestors,history,space'

export interface ConfluenceUser {
  displayName?: string
}

export interface ConfluenceContent {
  id: string
  title: string
  space?: { key?: string }
  version?: { number?: number; when?: string; by?: ConfluenceUser }
  history?: { createdBy?: ConfluenceUser }
  metadata?: {
    labels?: { results?: Array<{ name?: string }> }
    properties?: Record<string, unknown>
  }
  ancestors?: Array<{ title?: string }>
  body?: { storage?: { value?: string } }
}

export const contentPath = (pageId: string): string =>
  `/rest/api/content/${encodeURIComponent(pageId)}?expand=${CONTENT_EXPAND}`
