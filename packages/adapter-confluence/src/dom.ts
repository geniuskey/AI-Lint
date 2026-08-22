import { normalizeStorage } from './normalize.js'

/**
 * storage format을 text/html로 읽는다.
 * XML 파서를 쓰면 ac:·ri: 접두사가 선언되지 않아서, `&nbsp;` 같은 엔티티에서도 통째로 실패한다.
 * HTML 파서는 관대하고 태그 이름에 콜론을 그대로 둔다.
 */
export function parseStorage(xhtml: string): Element {
  const parsed = new DOMParser().parseFromString(normalizeStorage(xhtml), 'text/html')
  return parsed.body
}

export const tagOf = (el: Element): string => el.localName.toLowerCase()

export const childrenOf = (el: Element, tag: string): Element[] =>
  Array.from(el.children).filter((child) => tagOf(child) === tag)

export const childOf = (el: Element, tag: string): Element | null => childrenOf(el, tag)[0] ?? null

/** querySelector는 `ac:image` 같은 이름을 셀렉터로 못 받으므로 직접 훑는다. */
export function findDescendants(root: Element, tag: string): Element[] {
  const found: Element[] = []
  const visit = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      if (tagOf(child) === tag) found.push(child)
      visit(child)
    }
  }
  visit(root)
  return found
}

export const findDescendant = (root: Element, tag: string): Element | null => findDescendants(root, tag)[0] ?? null

export const textOf = (node: Node): string => (node.textContent ?? '').replace(/\s+/g, ' ').trim()
