import { describe, it, expect } from 'vitest'
import { DEFAULT_RULESET, type ResolvedRuleset } from '@ai-lint/rules'
import { evidenceFound, verifyFindings } from '../src/verify.js'
import { makeDoc, para } from './helpers.js'

const doc = makeDoc([para('p1', '지난번 논의대로 3단계로 나눠서 진행하기로 했습니다.')])
const base = { ruleId: 'CTX001', blockId: 'p1', why: '이유', suggestion: null, confidence: 0.9 }
const one = (over: Record<string, unknown> = {}) => ({ findings: [{ ...base, evidence: '지난번 논의대로', ...over }] })

const withRule = (ruleId: string, config: Partial<ResolvedRuleset['rules'][string]>): ResolvedRuleset => ({
  ...DEFAULT_RULESET,
  rules: { ...DEFAULT_RULESET.rules, [ruleId]: { ...DEFAULT_RULESET.rules[ruleId]!, ...config } },
})

describe('verifyFindings', () => {
  it('근거가 원문에 있으면 통과시킨다', () => {
    const r = verifyFindings(one(), doc, DEFAULT_RULESET)
    expect(r.accepted).toHaveLength(1)
    expect(r.accepted[0]!.source).toBe('llm')
    expect(r.accepted[0]!.anchor).toEqual(doc.blocks[0]!.anchor)
    expect(r.accepted[0]!.axis).toBe('context')
    expect(r.accepted[0]!.confidence).toBe(0.9)
    expect(r.accepted[0]!.docsUrl).toContain('ctx001')
  })

  it('원문에 없는 근거를 만들어내면 폐기한다', () => {
    const r = verifyFindings(one({ evidence: '작년 워크샵에서 정한 대로' }), doc, DEFAULT_RULESET)
    expect(r.accepted).toHaveLength(0)
    expect(r.rejected[0]!.reason).toBe('evidence-not-found')
  })

  it('존재하지 않는 blockId를 폐기한다', () => {
    expect(verifyFindings(one({ blockId: 'p99' }), doc, DEFAULT_RULESET).rejected[0]!.reason).toBe('unknown-block')
  })

  it('공백 차이는 허용한다', () => {
    expect(verifyFindings(one({ evidence: '지난번  논의대로' }), doc, DEFAULT_RULESET).accepted).toHaveLength(1)
  })

  it('글자 하나 정도의 차이는 근사 일치로 허용한다', () => {
    expect(verifyFindings(one({ evidence: '3단계로 나눠서 진행하기로 했습니다' }), doc, DEFAULT_RULESET).accepted).toHaveLength(1)
  })

  it('카탈로그에 없는 룰 ID를 폐기한다', () => {
    expect(verifyFindings(one({ ruleId: 'CTX999' }), doc, DEFAULT_RULESET).rejected[0]!.reason).toBe('unknown-rule')
  })

  it('LLM 대상이 아닌 룰 ID를 폐기한다', () => {
    expect(verifyFindings(one({ ruleId: 'STR001' }), doc, DEFAULT_RULESET).rejected[0]!.reason).toBe('unknown-rule')
  })

  it('규칙셋에서 비활성인 룰을 폐기한다', () => {
    const rs = withRule('CTX001', { enabled: false })
    expect(verifyFindings(one(), doc, rs).rejected[0]!.reason).toBe('rule-disabled')
  })

  it('이 문서 유형에 적용되지 않는 룰을 폐기한다', () => {
    const rs = withRule('CTX007', { appliesTo: ['meeting-notes'] })
    const r = verifyFindings(one({ ruleId: 'CTX007' }), doc, rs)
    expect(r.rejected[0]!.reason).toBe('doctype-mismatch')
  })

  it('confidence가 임계치 미만이면 폐기한다', () => {
    expect(verifyFindings(one({ confidence: 0.3 }), doc, DEFAULT_RULESET).rejected[0]!.reason).toBe('low-confidence')
  })

  it('임계치를 낮추면 통과시킨다', () => {
    expect(verifyFindings(one({ confidence: 0.3 }), doc, DEFAULT_RULESET, { minConfidence: 0.2 }).accepted).toHaveLength(1)
  })

  it('suggestion.before가 원문에 없으면 suggestion만 버리고 finding은 살린다', () => {
    const r = verifyFindings(one({ suggestion: { before: '없는 문장', after: '고친 문장' } }), doc, DEFAULT_RULESET)
    expect(r.accepted).toHaveLength(1)
    expect(r.accepted[0]!.suggestion).toBeNull()
  })

  it('suggestion.before가 원문에 있으면 유지한다', () => {
    const suggestion = { before: '지난번 논의대로', after: '2026-07-15 리뷰 결정에 따라' }
    const r = verifyFindings(one({ suggestion }), doc, DEFAULT_RULESET)
    expect(r.accepted[0]!.suggestion).toEqual(suggestion)
  })

  it('스키마를 어긴 응답 전체를 안전하게 처리한다', () => {
    const r = verifyFindings({ nonsense: true }, doc, DEFAULT_RULESET)
    expect(r.accepted).toHaveLength(0)
    expect(r.rejected[0]!.reason).toBe('schema-invalid')
  })

  it('null 응답도 안전하게 처리한다', () => {
    expect(verifyFindings(null, doc, DEFAULT_RULESET).rejected[0]!.reason).toBe('schema-invalid')
  })

  it('일부 finding만 깨졌으면 나머지는 살린다', () => {
    const r = verifyFindings(
      { findings: [{ ...base, evidence: '지난번 논의대로' }, { ruleId: 'CTX002' }] },
      doc,
      DEFAULT_RULESET,
    )
    expect(r.accepted).toHaveLength(1)
    expect(r.rejected).toEqual([{ ruleId: 'CTX002', reason: 'schema-invalid' }])
  })

  it('같은 블록·같은 룰의 중복 finding을 하나로 합친다', () => {
    const r = verifyFindings(
      {
        findings: [
          { ...base, evidence: '지난번 논의대로' },
          { ...base, evidence: '지난번 논의대로', confidence: 0.7 },
        ],
      },
      doc,
      DEFAULT_RULESET,
    )
    expect(r.accepted).toHaveLength(1)
    expect(r.accepted[0]!.confidence).toBe(0.9)
  })

  it('룰이 다르면 같은 블록이어도 합치지 않는다', () => {
    const r = verifyFindings(
      {
        findings: [
          { ...base, evidence: '지난번 논의대로' },
          { ...base, ruleId: 'CTX005', evidence: '3단계로' },
        ],
      },
      doc,
      DEFAULT_RULESET,
    )
    expect(r.accepted).toHaveLength(2)
  })

  it('규칙셋의 심각도 오버라이드를 반영한다', () => {
    const rs = withRule('CTX001', { severity: 'info' })
    expect(verifyFindings(one(), doc, rs).accepted[0]!.severity).toBe('info')
  })
})

describe('evidenceFound', () => {
  it('정확히 일치하면 찾는다', () => {
    expect(evidenceFound('논의대로', '지난번 논의대로 진행')).toBe(true)
  })

  it('빈 근거는 찾지 못한 것으로 본다', () => {
    expect(evidenceFound('   ', '지난번 논의대로')).toBe(false)
  })

  it('아주 긴 블록에서는 근사 탐색을 건너뛴다', () => {
    const long = '가'.repeat(2500)
    expect(evidenceFound('나나나', long)).toBe(false)
    expect(evidenceFound('가가가', long)).toBe(true)
  })
})
