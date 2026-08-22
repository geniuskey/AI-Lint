const CLASS = 'ai-lint-highlight'
const STYLE_ID = 'ai-lint-highlight-style'
const DURATION_MS = 2400

// Confluence 본문 스타일에 밀리지 않도록 !important를 쓴다.
const STYLE = `
.${CLASS} {
  outline: 2px solid #f59e0b !important;
  outline-offset: 2px;
  background: rgba(245, 158, 11, 0.15) !important;
  transition: background 200ms ease-out;
}
`

/** 강조 대상은 페이지 본문이라 패널의 shadow DOM 스타일이 닿지 않는다. 문서에 한 번만 심는다. */
function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  doc.head.append(style)
}

export function highlight(target: Element, durationMs: number = DURATION_MS): void {
  const doc = target.ownerDocument
  ensureStyle(doc)
  doc.querySelectorAll(`.${CLASS}`).forEach((previous) => previous.classList.remove(CLASS))
  target.classList.add(CLASS)
  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  setTimeout(() => target.classList.remove(CLASS), durationMs)
}
