import type { Finding } from '@ai-lint/rules'
import { describe, expect, it } from 'vitest'
import { countBySeverity, describeAnchor, sortFindings } from '../src/core/describe.js'

const finding = (id: string, severity: Finding['severity'], axis: Finding['axis']): Finding => ({
  id, ruleId: 'STR001', axis, severity, blockId: null, anchor: null,
  message: '메시지', why: '이유', evidence: null, suggestion: null,
  source: 'rule', confidence: 1, docsUrl: '',
})

describe('describeAnchor', () => {
  it('PDF는 쪽 번호로 말한다', () => {
    expect(describeAnchor({ kind: 'pdf', page: 12 })).toBe('12쪽')
  })

  it('슬라이드는 번호로 말한다', () => {
    expect(describeAnchor({ kind: 'pptx', slide: 3 })).toBe('3번 슬라이드')
  })

  it('시트는 이름과 범위를 함께 말한다', () => {
    expect(describeAnchor({ kind: 'xlsx', sheet: '요구사항', range: 'A1:C9' }))
      .toBe('요구사항 시트 A1:C9')
    expect(describeAnchor({ kind: 'xlsx', sheet: '요구사항' })).toBe('요구사항 시트')
  })

  it('문단 번호는 1부터 센다', () => {
    expect(describeAnchor({ kind: 'docx', paragraphIndex: 0 })).toBe('1번째 문단')
  })

  it('Confluence는 인용문을 보여준다', () => {
    expect(describeAnchor({ kind: 'confluence', xpath: '/x', textQuote: { exact: '결제 모듈' } }))
      .toBe('"결제 모듈"')
  })

  it('앵커가 없으면 문서 전체로 본다', () => {
    expect(describeAnchor(null)).toBe('문서 전체')
  })
})

describe('sortFindings', () => {
  it('심각한 것부터 놓는다', () => {
    const sorted = sortFindings([
      finding('a', 'info', 'structure'),
      finding('b', 'error', 'context'),
      finding('c', 'warning', 'metadata'),
    ])
    expect(sorted.map((f) => f.id)).toEqual(['b', 'c', 'a'])
  })

  it('같은 심각도면 축 순서를 따른다', () => {
    const sorted = sortFindings([
      finding('a', 'error', 'metadata'),
      finding('b', 'error', 'structure'),
      finding('c', 'error', 'context'),
    ])
    expect(sorted.map((f) => f.id)).toEqual(['b', 'c', 'a'])
  })

  it('원본 배열을 건드리지 않는다', () => {
    const input = [finding('a', 'info', 'structure'), finding('b', 'error', 'structure')]
    sortFindings(input)
    expect(input.map((f) => f.id)).toEqual(['a', 'b'])
  })
})

describe('countBySeverity', () => {
  it('심각도별로 센다', () => {
    expect(countBySeverity([
      finding('a', 'error', 'structure'),
      finding('b', 'error', 'context'),
      finding('c', 'info', 'metadata'),
    ])).toEqual({ error: 2, warning: 0, info: 1 })
  })
})
