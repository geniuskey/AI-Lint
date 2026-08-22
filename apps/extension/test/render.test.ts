// @vitest-environment happy-dom
import type { Finding } from '@ai-lint/contract'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderFindings } from '../src/content/panel/render.js'

const finding = (patch: Partial<Finding>): Finding => ({
  id: 'f1',
  ruleId: 'STR001',
  axis: 'structure',
  severity: 'warning',
  blockId: 'b1',
  anchor: { kind: 'confluence', xpath: './p', textQuote: { exact: '본문' } },
  message: '제목이 없습니다',
  why: 'AI가 문서를 나눌 기준이 사라집니다',
  evidence: null,
  suggestion: null,
  source: 'rule',
  confidence: 1,
  docsUrl: 'https://docs.test/str001.md',
  ...patch,
})

let body: HTMLElement
let handlers: { onLocate: ReturnType<typeof vi.fn>; onCopy: ReturnType<typeof vi.fn> }

beforeEach(() => {
  body = document.createElement('div')
  handlers = { onLocate: vi.fn(), onCopy: vi.fn() }
})

describe('renderFindings', () => {
  it('지적이 없으면 안내만 보여준다', () => {
    renderFindings(body, [], handlers)
    expect(body.querySelector('.empty')?.textContent).toContain('지적할 내용이 없습니다')
  })

  it('심각도별로 묶고 오류를 먼저 둔다', () => {
    renderFindings(
      body,
      [
        finding({ id: 'a', severity: 'info' }),
        finding({ id: 'b', severity: 'error' }),
        finding({ id: 'c', severity: 'error' }),
      ],
      handlers,
    )
    const groups = Array.from(body.querySelectorAll('.group'))
    expect(groups.map((g) => g.getAttribute('data-severity'))).toEqual(['error', 'info'])
    expect(groups[0]?.querySelector('h2')?.textContent).toBe('오류 2')
  })

  it('룰 ID, 메시지, 근거를 보여준다', () => {
    renderFindings(body, [finding({ evidence: '세 번째 문단' })], handlers)
    expect(body.querySelector('.rule')?.textContent).toBe('STR001')
    expect(body.querySelector('.message')?.textContent).toBe('제목이 없습니다')
    expect(body.querySelector('.why')?.textContent).toBe('AI가 문서를 나눌 기준이 사라집니다')
    expect(body.querySelector('.evidence')?.textContent).toBe('세 번째 문단')
  })

  it('AI가 찾은 지적에 표식을 붙인다', () => {
    renderFindings(body, [finding({ source: 'llm' })], handlers)
    expect(body.querySelector('.src')?.textContent).toBe('AI')
  })

  it('룰이 찾은 지적에는 표식을 붙이지 않는다', () => {
    renderFindings(body, [finding({})], handlers)
    expect(body.querySelector('.src')).toBeNull()
  })

  it('수정 제안을 전후로 보여주고 복사를 넘긴다', () => {
    renderFindings(body, [finding({ suggestion: { before: '이것', after: '결제 승인 흐름' } })], handlers)
    expect(body.querySelector('.suggestion del')?.textContent).toBe('이것')
    expect(body.querySelector('.suggestion ins')?.textContent).toBe('결제 승인 흐름')

    body.querySelector<HTMLButtonElement>('.copy')?.click()
    expect(handlers.onCopy).toHaveBeenCalledWith('결제 승인 흐름')
  })

  it('위치 보기를 누르면 해당 지적을 넘긴다', () => {
    const target = finding({ id: 'x' })
    renderFindings(body, [target], handlers)
    body.querySelector<HTMLButtonElement>('.locate')?.click()
    expect(handlers.onLocate).toHaveBeenCalledWith(target)
  })

  it('앵커가 없으면 위치 보기 버튼을 만들지 않는다', () => {
    renderFindings(body, [finding({ anchor: null })], handlers)
    expect(body.querySelector('.locate')).toBeNull()
  })

  it('규칙 설명 링크를 새 탭으로 연다', () => {
    renderFindings(body, [finding({})], handlers)
    const docs = body.querySelector<HTMLAnchorElement>('.docs')
    expect(docs?.href).toBe('https://docs.test/str001.md')
    expect(docs?.target).toBe('_blank')
    expect(docs?.rel).toBe('noreferrer')
  })

  it('다시 그리면 이전 결과를 지운다', () => {
    renderFindings(body, [finding({}), finding({ id: 'f2' })], handlers)
    renderFindings(body, [finding({})], handlers)
    expect(body.querySelectorAll('.finding')).toHaveLength(1)
  })
})
