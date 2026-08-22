// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { findBaseUrl, findPageId, PageReadError, readPage } from '../src/content/page-reader.js'

const setup = (html: string, href = 'https://wiki.test/pages/viewpage.action?pageId=789'): globalThis.Document => {
  const dom = document.implementation.createHTMLDocument('t')
  dom.head.innerHTML = html
  Object.defineProperty(dom, 'location', { value: new URL(href), configurable: true })
  return dom
}

const content = {
  id: '789',
  title: '결제 설계',
  space: { key: 'ENG' },
  metadata: { labels: { results: [{ name: '설계' }] } },
  body: { storage: { value: '<h1>배경</h1>' } },
}

describe('findPageId', () => {
  it('meta 태그에서 페이지 ID를 읽는다', () => {
    expect(findPageId(setup('<meta name="ajs-page-id" content="789">'))).toBe('789')
  })

  it('meta가 없으면 주소의 pageId를 쓴다', () => {
    expect(findPageId(setup(''))).toBe('789')
  })

  it('페이지가 아니면 null을 준다', () => {
    expect(findPageId(setup('', 'https://wiki.test/dashboard.action'))).toBeNull()
  })
})

describe('findBaseUrl', () => {
  it('meta의 base URL을 쓰고 끝 슬래시를 뗀다', () => {
    expect(findBaseUrl(setup('<meta name="ajs-base-url" content="https://wiki.test/confluence/">'))).toBe(
      'https://wiki.test/confluence',
    )
  })

  it('meta가 없으면 현재 origin을 쓴다', () => {
    expect(findBaseUrl(setup(''))).toBe('https://wiki.test')
  })
})

describe('readPage', () => {
  it('세션 쿠키로 REST를 부르고 IR을 만든다', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(content), { status: 200, headers: { 'content-type': 'application/json' } }),
      )
    const doc = await readPage(setup('<meta name="ajs-page-id" content="789">'), fetchImpl as unknown as typeof fetch)

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rest/api/content/789?expand=body.storage')
    expect(init.credentials).toBe('include')
    expect(doc.title).toBe('결제 설계')
    expect(doc.source.uri).toBe('https://wiki.test/pages/viewpage.action?pageId=789')
  })

  it('페이지가 아니면 not-a-page로 알린다', async () => {
    await expect(readPage(setup('', 'https://wiki.test/dashboard.action'))).rejects.toMatchObject({
      kind: 'not-a-page',
    })
  })

  it('403이면 권한 없음으로 알린다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 403 }))
    const error = await readPage(setup(''), fetchImpl as unknown as typeof fetch).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PageReadError)
    expect(error).toMatchObject({ kind: 'forbidden', message: '이 페이지를 볼 권한이 없습니다.' })
  })

  it('그 밖의 실패는 상태코드를 알려준다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 500 }))
    await expect(readPage(setup(''), fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      kind: 'failed',
      message: '페이지를 읽지 못했습니다 (HTTP 500).',
    })
  })
})
