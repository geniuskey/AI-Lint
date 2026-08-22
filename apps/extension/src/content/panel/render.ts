import type { Finding } from '@ai-lint/contract'
import { SEVERITY_LABELS, SEVERITY_ORDER } from '../../shared/labels.js'

export interface FindingHandlers {
  onLocate(finding: Finding): void
  onCopy(text: string): void
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function renderSuggestion(suggestion: { before: string; after: string }, onCopy: (text: string) => void): HTMLElement {
  const box = el('div', 'suggestion')
  box.append(el('del', undefined, suggestion.before), el('ins', undefined, suggestion.after))
  const copy = el('button', 'copy', '제안 복사')
  copy.type = 'button'
  copy.addEventListener('click', () => onCopy(suggestion.after))
  box.append(copy)
  return box
}

function renderFinding(finding: Finding, handlers: FindingHandlers): HTMLElement {
  const item = el('li', 'finding')
  item.dataset['severity'] = finding.severity

  const head = el('div', 'finding-head')
  head.append(el('span', 'rule', finding.ruleId))
  // 룰이 잡은 지적과 LLM이 잡은 지적은 신뢰도가 다르다. AI 쪽만 표식을 남긴다.
  if (finding.source === 'llm') head.append(el('span', 'src', 'AI'))
  item.append(head)

  item.append(el('p', 'message', finding.message), el('p', 'why', finding.why))
  if (finding.evidence) item.append(el('pre', 'evidence', finding.evidence))
  if (finding.suggestion) item.append(renderSuggestion(finding.suggestion, handlers.onCopy))

  const actions = el('div', 'actions')
  if (finding.anchor) {
    const locate = el('button', 'locate', '위치 보기')
    locate.type = 'button'
    locate.addEventListener('click', () => handlers.onLocate(finding))
    actions.append(locate)
  }
  const docs = el('a', 'docs', '규칙 설명')
  docs.href = finding.docsUrl
  docs.target = '_blank'
  docs.rel = 'noreferrer'
  actions.append(docs)
  item.append(actions)

  return item
}

export function renderFindings(body: HTMLElement, findings: Finding[], handlers: FindingHandlers): void {
  if (findings.length === 0) {
    body.replaceChildren(el('div', 'empty', '지적할 내용이 없습니다.'))
    return
  }

  const groups = SEVERITY_ORDER.map((severity) => {
    const matched = findings.filter((finding) => finding.severity === severity)
    if (matched.length === 0) return null

    const group = el('section', 'group')
    group.dataset['severity'] = severity
    group.append(el('h2', undefined, `${SEVERITY_LABELS[severity]} ${matched.length}`))
    const list = el('ul')
    list.append(...matched.map((finding) => renderFinding(finding, handlers)))
    group.append(list)
    return group
  }).filter((group): group is HTMLElement => group !== null)

  body.replaceChildren(...groups)
}
