import type { SourceAnchor } from '@ai-lint/contract'

/** Confluence 스킨마다 본문 래퍼가 다르다. 앞에서부터 먼저 걸리는 것을 쓴다. */
const CONTENT_SELECTORS = ['#main-content', '.wiki-content', '#content']

/** 인용문이 길면 편집으로 뒷부분이 어긋나기 쉽다. 앞부분만 본다. */
const NEEDLE_MAX = 40

/** XPathResult.FIRST_ORDERED_NODE_TYPE. 전역 XPathResult가 없는 DOM 구현도 있어 값으로 쓴다. */
const FIRST_ORDERED_NODE = 9

export function contentRoot(doc: Document): HTMLElement {
  for (const selector of CONTENT_SELECTORS) {
    const found = doc.querySelector<HTMLElement>(selector)
    if (found) return found
  }
  return doc.body
}

function byXPath(xpath: string, root: HTMLElement, doc: Document): HTMLElement | null {
  if (!xpath || typeof doc.evaluate !== 'function') return null
  try {
    const node = doc.evaluate(xpath, root, null, FIRST_ORDERED_NODE, null).singleNodeValue
    return node?.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : null
  } catch {
    // 저장 시점의 XHTML 경로가 렌더된 DOM에서 그대로 통하지 않을 수 있다. 인용문으로 넘긴다.
    return null
  }
}

function deepestMatch(needle: string, root: HTMLElement): HTMLElement | null {
  if (!root.textContent?.includes(needle)) return null
  let found = root
  for (;;) {
    const child = Array.from(found.children).find(
      (candidate): candidate is HTMLElement =>
        candidate instanceof HTMLElement && (candidate.textContent?.includes(needle) ?? false),
    )
    if (!child) return found
    found = child
  }
}

export function locate(anchor: SourceAnchor | null, doc: Document): HTMLElement | null {
  if (!anchor || anchor.kind !== 'confluence') return null

  const root = contentRoot(doc)
  const byPath = byXPath(anchor.xpath, root, doc)
  if (byPath && byPath !== root) return byPath

  const needle = anchor.textQuote.exact.slice(0, NEEDLE_MAX).trim()
  if (!needle) return null

  const found = deepestMatch(needle, root)
  // 본문 전체를 가리키는 건 위치를 못 찾은 것과 같다.
  return found && found !== root ? found : null
}
