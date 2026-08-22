const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g

const escapeText = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** HTML 파서는 CDATA를 주석으로 보고 버린다. 파서에 넣기 전에 본문을 텍스트로 바꾼다. */
export function normalizeStorage(xhtml: string): string {
  return xhtml.replace(CDATA, (_match, text: string) => escapeText(text))
}
