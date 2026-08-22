/** 속성값 안의 따옴표를 건너뛰며 `/>`까지 읽는다. ac:·ri: 네임스페이스 태그만 대상으로 한다. */
const SELF_CLOSING = /<((?:ac|ri):[\w-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)\/>/g
const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g

const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * storage format을 HTML 파서에 넣기 전에 손본다.
 * CDATA는 HTML 파서가 주석으로 버리고, self-closing 커스텀 태그는 뒤 형제를 자식으로 삼킨다.
 * 먼저 CDATA를 처리해야 그 안의 마크업이 두 번째 치환에 걸리지 않는다.
 */
export function normalizeStorage(xhtml: string): string {
  return xhtml
    .replace(CDATA, (_match, text: string) => escapeText(text))
    .replace(SELF_CLOSING, (_match, tag: string, attrs: string) => `<${tag}${attrs}></${tag}>`)
}
