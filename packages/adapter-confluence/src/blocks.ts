import type { Block, SourceAnchor } from '@ai-lint/ir'
import { childOf, childrenOf, findDescendants, tagOf, textOf } from './dom.js'

export interface Extracted {
  blocks: Block[]
  /** blocks[i]를 만들어낸 요소. 앵커 계산에 쓴다. */
  elements: Element[]
}

/** Omit을 그냥 쓰면 판별 유니온이 공통 필드만 남기고 뭉개진다. 각 갈래에 따로 적용한다. */
type BlockBody = Block extends infer B ? (B extends Block ? Omit<B, 'id' | 'path' | 'anchor'> : never) : never

/** 앵커는 앞뒤 블록 텍스트가 있어야 만들 수 있어서 두 번째 패스에서 채운다. */
const PLACEHOLDER: SourceAnchor = { kind: 'confluence', xpath: '', textQuote: { exact: '?' } }

const HEADINGS: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 }
const CALLOUT_MACROS = new Set(['info', 'note', 'warning', 'tip', 'panel'])
/** 내용을 감싸기만 하는 매크로. 껍데기를 벗기고 안쪽을 문서 본문으로 취급한다. */
const CONTAINER_MACROS = new Set(['expand', 'section', 'column', 'div', 'align'])

interface Walker {
  blocks: Block[]
  elements: Element[]
  /** 제목 레벨별 등장 순번. path 계산용 */
  counters: number[]
}

export function extractBlocks(root: Element): Extracted {
  const walker: Walker = { blocks: [], elements: [], counters: [] }
  walkChildren(root, walker, 1)
  return { blocks: walker.blocks, elements: walker.elements }
}

function add(walker: Walker, el: Element, body: BlockBody): void {
  walker.blocks.push({
    ...body,
    id: `b${walker.blocks.length + 1}`,
    path: [...walker.counters],
    anchor: PLACEHOLDER,
  } as Block)
  walker.elements.push(el)
}

function walkChildren(parent: Element, walker: Walker, listDepth: number): void {
  for (const el of Array.from(parent.children)) visit(el, walker, listDepth)
}

function visit(el: Element, walker: Walker, listDepth: number): void {
  const tag = tagOf(el)
  const level = HEADINGS[tag]
  if (level !== undefined) {
    addHeading(walker, el, level)
    return
  }

  switch (tag) {
    case 'p':
      addParagraph(walker, el)
      return
    case 'ul':
    case 'ol':
      addList(walker, el, tag === 'ol', listDepth)
      return
    case 'table':
      addTable(walker, el)
      return
    case 'pre': {
      const text = el.textContent ?? ''
      if (text.trim()) add(walker, el, { kind: 'code', text })
      return
    }
    case 'blockquote': {
      const text = textOf(el)
      if (text) add(walker, el, { kind: 'callout', variant: 'quote', text })
      return
    }
    case 'ac:structured-macro':
      addMacro(walker, el, listDepth)
      return
    case 'ac:image':
      addImage(walker, el)
      return
    case 'img':
      add(walker, el, {
        kind: 'image',
        assetRef: el.getAttribute('src') ?? '(알 수 없는 이미지)',
        ...optional('alt', el.getAttribute('alt')),
      })
      return
    case 'hr':
    case 'br':
      return
    default:
      walkChildren(el, walker, listDepth)
  }
}

const optional = <K extends string>(
  key: K,
  value: string | null | undefined,
): Record<K, string> | Record<never, never> => (value ? ({ [key]: value } as Record<K, string>) : {})

function addHeading(walker: Walker, el: Element, level: 1 | 2 | 3 | 4 | 5 | 6): void {
  while (walker.counters.length < level) walker.counters.push(0)
  walker.counters.length = level
  walker.counters[level - 1] = (walker.counters[level - 1] ?? 0) + 1
  add(walker, el, { kind: 'heading', level, text: textOf(el) })
}

/**
 * 본문이 없는 ac:link를 Confluence는 대상 제목으로 렌더한다.
 * storage의 textContent만 보면 그런 문단이 통째로 사라진다.
 */
function linkLabelsOf(el: Element): string {
  return findDescendants(el, 'ac:link')
    .map((link) => {
      const page = childOf(link, 'ri:page')
      const attachment = childOf(link, 'ri:attachment')
      return page?.getAttribute('ri:content-title') ?? attachment?.getAttribute('ri:filename') ?? ''
    })
    .filter(Boolean)
    .join(' ')
}

function addParagraph(walker: Walker, el: Element): void {
  const images = findDescendants(el, 'ac:image')
  const text = textOf(el) || linkLabelsOf(el)
  if (text) add(walker, el, { kind: 'paragraph', text })
  for (const image of images) addImage(walker, image)
}

function addList(walker: Walker, el: Element, ordered: boolean, depth: number): void {
  const items: string[] = []
  const nested: Element[] = []

  for (const li of childrenOf(el, 'li')) {
    const sublists = Array.from(li.children).filter((child) => tagOf(child) === 'ul' || tagOf(child) === 'ol')
    nested.push(...sublists)
    const clone = li.cloneNode(true) as Element
    for (const child of Array.from(clone.children)) {
      if (tagOf(child) === 'ul' || tagOf(child) === 'ol') child.remove()
    }
    const text = textOf(clone)
    if (text) items.push(text)
  }

  if (items.length > 0) add(walker, el, { kind: 'list', ordered, items, depth })
  for (const sublist of nested) addList(walker, sublist, tagOf(sublist) === 'ol', depth + 1)
}

function addTable(walker: Walker, el: Element): void {
  const headers: string[] = []
  const rows: string[][] = []

  findDescendants(el, 'tr').forEach((tr, index) => {
    const cells = Array.from(tr.children).filter((cell) => tagOf(cell) === 'th' || tagOf(cell) === 'td')
    if (cells.length === 0) return
    const values = cells.map(textOf)
    if (index === 0 && cells.every((cell) => tagOf(cell) === 'th')) headers.push(...values)
    else rows.push(values)
  })

  const width = Math.max(headers.length, ...rows.map((row) => row.length), 0)
  const caption = childOf(el, 'caption')

  add(walker, el, {
    kind: 'table',
    headers,
    rows,
    isLayoutTable: headers.length === 0 && width <= 2 && rows.length <= 2,
    ...optional('caption', caption ? textOf(caption) : null),
  })
}

function addMacro(walker: Walker, el: Element, listDepth: number): void {
  const name = (el.getAttribute('ac:name') ?? '').toLowerCase()
  const params: Record<string, string> = {}
  for (const param of childrenOf(el, 'ac:parameter')) {
    const key = param.getAttribute('ac:name')
    if (key) params[key] = textOf(param)
  }

  const plain = childOf(el, 'ac:plain-text-body')
  const rich = childOf(el, 'ac:rich-text-body')

  if (name === 'code') {
    const text = plain?.textContent ?? ''
    if (text.trim()) add(walker, el, { kind: 'code', text, ...optional('lang', params['language']) })
    return
  }

  if (rich && CONTAINER_MACROS.has(name)) {
    walkChildren(rich, walker, listDepth)
    return
  }

  if (rich && CALLOUT_MACROS.has(name)) {
    const text = textOf(rich)
    if (text) add(walker, el, { kind: 'callout', variant: name, text })
    return
  }

  // 본문 요소가 없으면 렌더 텍스트도 없다. el을 그대로 읽으면 파라미터 값이 본문으로 둔갑한다.
  const body = rich ?? plain
  add(walker, el, { kind: 'macro', name, params, ...optional('renderedText', body ? textOf(body) : null) })
}

function addImage(walker: Walker, el: Element): void {
  const attachment = childOf(el, 'ri:attachment')
  const url = childOf(el, 'ri:url')
  const caption = childOf(el, 'ac:caption')

  add(walker, el, {
    kind: 'image',
    assetRef: attachment?.getAttribute('ri:filename') ?? url?.getAttribute('ri:value') ?? '(알 수 없는 이미지)',
    ...optional('alt', el.getAttribute('ac:alt')),
    ...optional('caption', caption ? textOf(caption) : null),
  })
}
