/** HTML5 void 요소. `<br></br>`는 `<br>` 두 개로 파싱되므로 절대 펴면 안 된다. */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

/** 속성값 안의 따옴표를 건너뛰며 `/>`까지 읽는다. */
const SELF_CLOSING = /<([\w-]+(?::[\w-]+)?)((?:[^>"']|"[^"]*"|'[^']*')*?)\/>/g

/** HTML 파서는 self-closing 커스텀 태그를 모르고 뒤 형제를 자식으로 삼킨다. */
export function expandSelfClosing(xml: string): string {
  return xml.replace(SELF_CLOSING, (match, tag: string, attrs: string) =>
    VOID_TAGS.has(tag.toLowerCase()) ? match : `<${tag}${attrs}></${tag}>`)
}

/**
 * XML 조각을 text/html로 읽는다.
 * application/xml로 읽으면 OOXML의 접두사가 선언되지 않아 통째로 실패한다.
 * HTML 파서는 관대하고 태그 이름에 콜론을 그대로 둔다.
 */
export function parseFragment(xml: string): Element {
  const parsed = new DOMParser().parseFromString(expandSelfClosing(xml), 'text/html')
  return parsed.body
}
