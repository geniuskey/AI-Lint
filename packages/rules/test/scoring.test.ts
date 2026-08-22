import { describe, it, expect } from 'vitest'
import { DEFAULT_AXIS_WEIGHTS, gradeOf, scoreFindings, type Axis, type Finding, type Severity } from '../src/index.js'

const w = DEFAULT_AXIS_WEIGHTS

const f = (axis: Axis, severity: Severity, ruleId: string): Finding => ({
  id: `${ruleId}:x`,
  ruleId,
  axis,
  severity,
  blockId: 'b1',
  anchor: null,
  message: 'm',
  why: 'w',
  evidence: null,
  suggestion: null,
  source: 'rule',
  confidence: 1,
  docsUrl: 'https://example.com',
})

describe('scoreFindings', () => {
  it('finding이 없으면 만점 A', () => {
    const s = scoreFindings([], w)
    expect(s.total).toBe(100)
    expect(s.grade).toBe('A')
    expect(s.axes).toEqual({ structure: 100, context: 100, metadata: 100 })
  })

  it('심각도별 감점을 적용한다', () => {
    expect(scoreFindings([f('structure', 'error', 'STR004')], w).axes.structure).toBe(85)
    expect(scoreFindings([f('structure', 'warning', 'STR001')], w).axes.structure).toBe(94)
    expect(scoreFindings([f('structure', 'info', 'STR006')], w).axes.structure).toBe(98)
  })

  it('감점은 해당 축에만 적용된다', () => {
    const s = scoreFindings([f('context', 'error', 'CTX001')], w)
    expect(s.axes.context).toBe(85)
    expect(s.axes.structure).toBe(100)
    expect(s.axes.metadata).toBe(100)
  })

  it('같은 룰 반복은 3회까지만 전액 감점하고 이후 1점씩', () => {
    const five = Array.from({ length: 5 }, () => f('structure', 'error', 'STR004'))
    expect(scoreFindings(five, w).axes.structure).toBe(100 - 45 - 2)
  })

  it('룰이 다르면 각각 전액 감점한다', () => {
    const findings = [
      f('structure', 'error', 'STR004'),
      f('structure', 'error', 'STR005'),
      f('structure', 'error', 'STR011'),
      f('structure', 'error', 'STR002'),
    ]
    expect(scoreFindings(findings, w).axes.structure).toBe(100 - 60)
  })

  it('축 점수는 0 밑으로 내려가지 않는다', () => {
    const many = Array.from({ length: 30 }, (_, i) => f('context', 'error', `CTX00${i % 9}`))
    expect(scoreFindings(many, w).axes.context).toBe(0)
  })

  it('총점은 축 점수의 가중 평균이다', () => {
    const s = scoreFindings([f('context', 'error', 'CTX001')], w)
    expect(s.total).toBe(Math.round(100 * 0.35 + 85 * 0.45 + 100 * 0.2))
  })

  it('가중치를 바꾸면 총점이 달라진다', () => {
    const findings = [f('context', 'error', 'CTX001')]
    const contextHeavy = scoreFindings(findings, { structure: 0.1, context: 0.8, metadata: 0.1 })
    const contextLight = scoreFindings(findings, { structure: 0.45, context: 0.1, metadata: 0.45 })
    expect(contextHeavy.total).toBeLessThan(contextLight.total)
  })
})

describe('gradeOf', () => {
  it('등급 경계를 정확히 적용한다', () => {
    expect(gradeOf(100)).toBe('A')
    expect(gradeOf(90)).toBe('A')
    expect(gradeOf(89)).toBe('B')
    expect(gradeOf(75)).toBe('B')
    expect(gradeOf(74)).toBe('C')
    expect(gradeOf(60)).toBe('C')
    expect(gradeOf(59)).toBe('D')
    expect(gradeOf(0)).toBe('D')
  })
})
