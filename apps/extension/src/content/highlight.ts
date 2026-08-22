const CLASS = 'ai-lint-highlight'
const STYLE_ID = 'ai-lint-highlight-style'
const DURATION_MS = 2400

function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  // 패널과 달리 본문에 직접 붙는 스타일이라 클래스 이름을 길게 잡아 충돌을 피한다.
  style.textContent = `.${CLASS} { outline: 2px solid #f59e0b; outline-offset: 2px; background: #fef3c7; transition: background 400ms ease-out; }`
  doc.head.append(style)
}

export function highlight(target: HTMLElement, durationMs: number = DURATION_MS): void {
  const doc = target.ownerDocument
  ensureStyle(doc)
  doc.querySelectorAll(`.${CLASS}`).forEach((previous) => previous.classList.remove(CLASS))
  target.classList.add(CLASS)
  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  setTimeout(() => target.classList.remove(CLASS), durationMs)
}
