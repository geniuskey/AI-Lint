import type { Document, Link } from '@ai-lint/ir'

/** 외부 링크는 CORS 때문에 브라우저에서 상태를 알 수 없다. 확인하지 않은 채로 둔다. */
const CHECKABLE: ReadonlyArray<Link['target']> = ['internal', 'attachment']
const MAX_LINKS = 40
const CONCURRENCY = 4

export interface LinkCheckDeps {
  baseUrl: string
  fetchImpl?: typeof fetch
  maxLinks?: number
}

async function statusOf(href: string, baseUrl: string, fetchImpl: typeof fetch): Promise<Link['status']> {
  try {
    const response = await fetchImpl(new URL(href, baseUrl).toString(), {
      method: 'HEAD',
      credentials: 'include',
      redirect: 'follow',
    })
    // 403은 볼 권한이 없는 것이지 문서가 사라진 것이 아니다.
    return response.status === 404 || response.status === 410 ? 'broken' : 'ok'
  } catch {
    return 'unchecked'
  }
}

export async function checkLinks(doc: Document, deps: LinkCheckDeps): Promise<Document> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const hrefs = [...new Set(doc.links.filter((l) => CHECKABLE.includes(l.target)).map((l) => l.href))].slice(
    0,
    deps.maxLinks ?? MAX_LINKS,
  )

  const statuses = new Map<string, Link['status']>()
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (let href = hrefs[cursor++]; href !== undefined; href = hrefs[cursor++]) {
      statuses.set(href, await statusOf(href, deps.baseUrl, fetchImpl))
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, hrefs.length) }, worker))

  return { ...doc, links: doc.links.map((l) => ({ ...l, status: statuses.get(l.href) ?? l.status })) }
}
