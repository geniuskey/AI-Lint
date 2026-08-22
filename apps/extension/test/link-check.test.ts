import type { Document, Link } from '@ai-lint/ir'
import { describe, expect, it, vi } from 'vitest'
import { checkLinks } from '../src/content/link-check.js'

const link = (href: string, target: Link['target']): Link => ({
  blockId: 'b1',
  text: href,
  href,
  target,
  status: 'unchecked',
})

const docWith = (links: Link[]): Document => ({ links, blocks: [] }) as unknown as Document

describe('checkLinks', () => {
  it('내부 링크와 첨부만 HEAD로 확인한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    const doc = await checkLinks(
      docWith([
        link('/display/ENG/Home', 'internal'),
        link('/download/attachments/1/a.pptx', 'attachment'),
        link('https://external.test/a', 'external'),
        link('#top', 'anchor'),
      ]),
      { baseUrl: 'https://wiki.test', fetchImpl: fetchImpl as unknown as typeof fetch },
    )

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(doc.links.map((l) => l.status)).toEqual(['ok', 'ok', 'unchecked', 'unchecked'])
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('HEAD')
    expect(init.credentials).toBe('include')
  })

  it('상대 경로를 base URL 기준으로 절대화한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    await checkLinks(docWith([link('/display/ENG/Home', 'internal')]), {
      baseUrl: 'https://wiki.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://wiki.test/display/ENG/Home')
  })

  it('404와 410만 깨진 링크로 본다', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 403 }))
    const doc = await checkLinks(docWith([link('/a', 'internal'), link('/b', 'internal')]), {
      baseUrl: 'https://wiki.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    // 403은 권한 문제지 문서가 없는 것은 아니다. 깨졌다고 하면 거짓 지적이 된다.
    expect(doc.links.map((l) => l.status)).toEqual(['broken', 'ok'])
  })

  it('요청이 실패하면 unchecked로 남긴다', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const doc = await checkLinks(docWith([link('/a', 'internal')]), {
      baseUrl: 'https://wiki.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(doc.links[0]?.status).toBe('unchecked')
  })

  it('같은 주소는 한 번만 확인한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
    const doc = await checkLinks(docWith([link('/a', 'internal'), link('/a', 'internal')]), {
      baseUrl: 'https://wiki.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(doc.links.map((l) => l.status)).toEqual(['broken', 'broken'])
  })

  it('상한을 넘는 링크는 건드리지 않는다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    const links = Array.from({ length: 5 }, (_, i) => link(`/a${i}`, 'internal'))
    const doc = await checkLinks(docWith(links), {
      baseUrl: 'https://wiki.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxLinks: 2,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(doc.links.map((l) => l.status)).toEqual(['ok', 'ok', 'unchecked', 'unchecked', 'unchecked'])
  })
})
