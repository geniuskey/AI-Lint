// @vitest-environment happy-dom
import type { Score } from '@ai-lint/contract'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountPanel, type Panel } from '../src/content/panel/panel.js'

const score: Score = { total: 78, grade: 'B', axes: { structure: 80, context: 75, metadata: 80 } }

let container: HTMLElement
let panel: Panel
let onRun: ReturnType<typeof vi.fn>
let onDocTypeChange: ReturnType<typeof vi.fn>

const query = (selector: string): HTMLElement | null => panel.root.querySelector(selector)

beforeEach(() => {
  document.body.replaceChildren()
  container = document.createElement('div')
  document.body.append(container)
  onRun = vi.fn()
  onDocTypeChange = vi.fn()
  panel = mountPanel(container, { onRun, onDocTypeChange })
})

describe('mountPanel', () => {
  it('좌하단 버튼을 shadow DOM 안에 만든다', () => {
    expect(container.querySelector('#ai-lint-root')?.shadowRoot).not.toBeNull()
    expect(query('.fab')?.textContent).toContain('AI Lint')
  })

  it('버튼을 누르면 패널을 열고 검사를 시작한다', () => {
    query('.fab')?.click()
    expect(query('.panel')?.classList.contains('open')).toBe(true)
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('닫기 버튼은 검사를 다시 돌리지 않는다', () => {
    query('.fab')?.click()
    query('.close')?.click()
    expect(query('.panel')?.classList.contains('open')).toBe(false)
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('등급 배지를 버튼에 표시한다', () => {
    panel.setBadge('A')
    expect(query('.badge')?.textContent).toBe('A')
    panel.setBadge(null)
    expect(query('.badge')?.textContent).toBe('')
  })

  it('총점과 축별 점수를 보여준다', () => {
    panel.setScore(score)
    expect(query('.grade')?.textContent).toBe('B')
    expect(query('.total')?.textContent).toBe('78')
    expect(query('.axes')?.textContent).toContain('구조 80')
    expect(query('.axes')?.textContent).toContain('맥락 75')
  })

  it('배너를 띄우고 지운다', () => {
    panel.setBanner('한도를 다 썼습니다', 'warn')
    expect(query('.banner')?.hidden).toBe(false)
    expect(query('.banner')?.dataset['tone']).toBe('warn')
    panel.setBanner('', null)
    expect(query('.banner')?.hidden).toBe(true)
  })

  it('문서 유형을 고르면 알린다', () => {
    panel.setDocType('design')
    const select = query('.doctype') as HTMLSelectElement
    expect(select.value).toBe('design')
    select.value = 'guide'
    select.dispatchEvent(new Event('change'))
    expect(onDocTypeChange).toHaveBeenCalledWith('guide')
  })

  it('destroy는 호스트를 걷어낸다', () => {
    panel.destroy()
    expect(container.querySelector('#ai-lint-root')).toBeNull()
  })
})
