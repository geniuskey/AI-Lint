import type { SourceAnchor } from '@ai-lint/contract'

/** Confluence 스킨마다 본문 래퍼가 다르다. 앞에서부터 먼저 걸리는 것을 쓴다. */
const CONTENT_SELECTORS = ['#main-content', '.wiki-content', '#content']

/** 인용문이 길수록 렌더 차이로 어긋날 확률이 높다. 앞부분만 본다. */
const NEEDLE_MAX = 40

/** XPathResult.FIRST_ORDERED_NODE_TYPE. 전역 XPathResult가 없는 DOM 구현도 있어 값으로 쓴다. */
const FIRST_ORDERED_NODE = 9

const normalize = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim()

export function contentRoot(dom: Document): Element {
  for (const selector of CONTENT_SELECTORS) {
    const found = dom.querySelector(selector)
    if (found) return found
  }
  return dom.body
}

function byXPath(xpath: string, root: Element, dom: Document): Element | null {
  if (typeof dom.evaluate !== 'function') return null
  try {
    const node = dom.evaluate(xpath, root, null, FIRST_ORDERED_NODE, null).singleNodeValue
    return node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : null
  } catch {
    // 어댑터가 만든 xpath는 storage 기준이라 렌더된 DOM에서 문법 오류가 날 수 있다.
    return null
  }
}

function deepestMatch(el: Element, needle: string): Element | null {
  if (!normalize(el.textContent).includes(needle)) return null
  for (const child of Array.from(el.children)) {
    const found = deepestMatch(child, needle)
    if (found) return found
  }
  return el
}

export function locate(anchor: SourceAnchor | null, dom: Document): Element | null {
  if (!anchor || anchor.kind !== 'confluence') return null

  const root = contentRoot(dom)
  const needle = normalize(anchor.textQuote.exact).slice(0, NEEDLE_MAX)
  if (!needle) return null

  // xpath는 storage 기준이라 렌더된 DOM에서 빗나갈 수 있다. 인용문으로 검증한 뒤에만 믿는다.
  const candidate = anchor.xpath ? byXPath(anchor.xpath, root, dom) : null
  if (candidate && candidate !== root && normalize(candidate.textContent).includes(needle)) return candidate

  // 본문 전체를 가리키는 건 위치를 못 찾은 것과 같다.
  const found = deepestMatch(root, needle)
  return found === root ? null : found
}
