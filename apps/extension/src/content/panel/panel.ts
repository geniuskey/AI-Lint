import type { Grade, Score } from '@ai-lint/contract'
import type { DocType } from '@ai-lint/ir'
import { AXIS_LABELS, DOC_TYPE_LABELS, DOC_TYPES } from '../../shared/labels.js'
import { PANEL_STYLES } from './styles.js'

export type BannerTone = 'warn' | 'error'

export interface PanelHandlers {
  onRun(): void
  onDocTypeChange(docType: DocType): void
}

export interface Panel {
  readonly root: ShadowRoot
  /** 지적 목록을 그려 넣을 자리 */
  readonly body: HTMLElement
  open(): void
  close(): void
  setBadge(grade: Grade | null): void
  setScore(score: Score | null): void
  setStatus(text: string): void
  setBanner(text: string, tone: BannerTone | null): void
  setDocType(docType: DocType): void
  destroy(): void
}

const HOST_ID = 'ai-lint-root'

const TEMPLATE = `
<button class="fab" type="button">AI Lint<span class="badge"></span></button>
<aside class="panel">
  <header>
    <h1>AI Lint</h1>
    <button class="close" type="button">닫기</button>
  </header>
  <div class="score">
    <div class="grade">-</div>
    <div>
      <div class="total">-</div>
      <div class="axes"></div>
    </div>
    <select class="doctype" title="문서 유형"></select>
  </div>
  <div class="banner" hidden></div>
  <div class="status"></div>
  <div class="body"></div>
</aside>
`

const need = <T extends HTMLElement>(root: ShadowRoot, selector: string): T => {
  const found = root.querySelector<T>(selector)
  if (!found) throw new Error(`패널 요소를 찾지 못했습니다: ${selector}`)
  return found
}

export function mountPanel(container: HTMLElement, handlers: PanelHandlers): Panel {
  container.querySelector(`#${HOST_ID}`)?.remove()

  const host = document.createElement('div')
  host.id = HOST_ID
  container.append(host)

  // Confluence의 전역 CSS가 패널을 망가뜨리지 않도록 shadow DOM에 가둔다.
  const root = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = PANEL_STYLES
  root.append(style)
  const holder = document.createElement('div')
  holder.innerHTML = TEMPLATE
  root.append(...Array.from(holder.childNodes))

  const fab = need<HTMLButtonElement>(root, '.fab')
  const badge = need(root, '.badge')
  const aside = need(root, '.panel')
  const grade = need(root, '.grade')
  const total = need(root, '.total')
  const axes = need(root, '.axes')
  const banner = need(root, '.banner')
  const status = need(root, '.status')
  const body = need(root, '.body')
  const doctype = need<HTMLSelectElement>(root, '.doctype')

  doctype.replaceChildren(
    ...DOC_TYPES.map((value) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = DOC_TYPE_LABELS[value]
      return option
    }),
  )
  doctype.addEventListener('change', () => handlers.onDocTypeChange(doctype.value as DocType))

  const open = (): void => aside.classList.add('open')
  const close = (): void => aside.classList.remove('open')

  fab.addEventListener('click', () => {
    open()
    handlers.onRun()
  })
  need(root, '.close').addEventListener('click', close)

  return {
    root,
    body,
    open,
    close,
    setBadge(value) {
      badge.textContent = value ?? ''
    },
    setScore(score) {
      grade.textContent = score?.grade ?? '-'
      if (score) grade.dataset['grade'] = score.grade
      else delete grade.dataset['grade']
      total.textContent = score ? String(score.total) : '-'
      axes.textContent = score
        ? (Object.keys(AXIS_LABELS) as Array<keyof typeof AXIS_LABELS>)
            .map((axis) => `${AXIS_LABELS[axis]} ${score.axes[axis]}`)
            .join(' · ')
        : ''
    },
    setStatus(text) {
      status.textContent = text
    },
    setBanner(text, tone) {
      banner.textContent = text
      banner.hidden = tone === null
      if (tone) banner.dataset['tone'] = tone
      else delete banner.dataset['tone']
    },
    setDocType(value) {
      doctype.value = value
    },
    destroy() {
      host.remove()
    },
  }
}
