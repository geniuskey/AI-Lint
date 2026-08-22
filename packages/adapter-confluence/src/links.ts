import type { Block, Link } from '@ai-lint/ir'
import { childOf, findDescendants, textOf } from './dom.js'

export interface LinkContext {
  baseUrl: string
  pageId: string
  spaceKey?: string
}

const ATTACHMENT_PATH = /\/download\/(attachments|thumbnails)\//

function classify(href: string, baseUrl: string): Link['target'] {
  if (href.startsWith('#')) return 'anchor'
  if (ATTACHMENT_PATH.test(href)) return 'attachment'
  if (href.startsWith('/')) return 'internal'
  if (baseUrl && href.startsWith(baseUrl)) return 'internal'
  return 'external'
}

const attachmentHref = (ctx: LinkContext, filename: string): string =>
  `/download/attachments/${ctx.pageId}/${encodeURIComponent(filename)}`

const pageHref = (ctx: LinkContext, space: string, title: string): string =>
  `/display/${space}/${encodeURIComponent(title)}`

function fromAnchorTag(el: Element, blockId: string, ctx: LinkContext): Link | null {
  const href = el.getAttribute('href')
  if (!href) return null
  return {
    blockId,
    text: textOf(el),
    href,
    target: classify(href, ctx.baseUrl),
    status: 'unchecked',
  }
}

/** ac:link는 href가 없다. 참조 대상(ri:page·ri:attachment)에서 주소를 만들어 낸다. */
function fromAcLink(el: Element, blockId: string, ctx: LinkContext): Link | null {
  const body = childOf(el, 'ac:plain-text-link-body') ?? childOf(el, 'ac:link-body')
  const bodyText = body ? textOf(body) : ''

  const page = childOf(el, 'ri:page')
  if (page) {
    const title = page.getAttribute('ri:content-title') ?? ''
    const space = page.getAttribute('ri:space-key') ?? ctx.spaceKey ?? ''
    return {
      blockId,
      text: bodyText || title,
      href: pageHref(ctx, space, title),
      target: 'internal',
      ...(title ? { resolvedTitle: title } : {}),
      status: 'unchecked',
    }
  }

  const attachment = childOf(el, 'ri:attachment')
  if (attachment) {
    const filename = attachment.getAttribute('ri:filename') ?? ''
    return {
      blockId,
      text: bodyText || filename,
      href: attachmentHref(ctx, filename),
      target: 'attachment',
      status: 'unchecked',
    }
  }

  return null
}

export function extractLinks(blocks: Block[], elements: Element[], ctx: LinkContext): Link[] {
  const links: Link[] = []

  blocks.forEach((block, index) => {
    const el = elements[index]
    if (!el) return
    for (const tag of findDescendants(el, 'a')) {
      const link = fromAnchorTag(tag, block.id, ctx)
      if (link) links.push(link)
    }
    for (const tag of findDescendants(el, 'ac:link')) {
      const link = fromAcLink(tag, block.id, ctx)
      if (link) links.push(link)
    }
  })

  return links
}
