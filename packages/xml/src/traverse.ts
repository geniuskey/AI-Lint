export const tagOf = (el: Element): string => el.localName.toLowerCase()

/** HTML 파서는 접두사를 이름의 일부로 남긴다. `p:sld`에서 `sld`를 뽑는다. */
export const localOf = (el: Element): string => {
  const tag = tagOf(el)
  const colon = tag.indexOf(':')
  return colon === -1 ? tag : tag.slice(colon + 1)
}

/** 접두사를 적으면 정확히 맞아야 하고, 안 적으면 접두사를 무시하고 맞춘다. */
export function matches(el: Element, query: string): boolean {
  const wanted = query.toLowerCase()
  return wanted.includes(':') ? tagOf(el) === wanted : localOf(el) === wanted
}

export const childrenOf = (el: Element, query: string): Element[] =>
  Array.from(el.children).filter((child) => matches(child, query))

export const childOf = (el: Element, query: string): Element | null => childrenOf(el, query)[0] ?? null

/** querySelector는 `ac:image` 같은 이름을 셀렉터로 못 받으므로 직접 훑는다. */
export function findDescendants(root: Element, query: string): Element[] {
  const found: Element[] = []
  const visit = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      if (matches(child, query)) found.push(child)
      visit(child)
    }
  }
  visit(root)
  return found
}

export const findDescendant = (root: Element, query: string): Element | null =>
  findDescendants(root, query)[0] ?? null

export const textOf = (node: Node): string => (node.textContent ?? '').replace(/\s+/g, ' ').trim()

/** HTML 파서가 속성 이름을 소문자로 내리므로 원래 이름과 소문자를 모두 본다. */
export const attr = (el: Element, name: string): string | null =>
  el.getAttribute(name) ?? el.getAttribute(name.toLowerCase())
