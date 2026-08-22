import { describe, it, expect, vi } from 'vitest'
import { createRegistry, DEFAULT_RULESET, runRules, type Rule } from '../src/index.js'
import { makeDoc, para } from './helpers.js'

const alwaysFires: Rule = {
  id: 'STR001',
  name: 'heading-hierarchy-skip',
  axis: 'structure',
  defaultSeverity: 'warning',
  appliesTo: 'all',
  description: 'test',
  llm: false,
  defaultOptions: {},
  check: (ctx) => ctx.doc.blocks.map((b) => ({ blockId: b.id, message: '문제', why: '이유' })),
}

const doc = () => makeDoc([para('p1', '본문')])

describe('runRules', () => {
  it('finding에 축·심각도·출처·앵커를 채운다', () => {
    const d = doc()
    const [f] = runRules(d, DEFAULT_RULESET, createRegistry([alwaysFires]))
    expect(f!.ruleId).toBe('STR001')
    expect(f!.axis).toBe('structure')
    expect(f!.severity).toBe('warning')
    expect(f!.source).toBe('rule')
    expect(f!.confidence).toBe(1)
    expect(f!.anchor).toEqual(d.blocks[0]!.anchor)
    expect(f!.docsUrl).toContain('str001')
  })

  it('finding id는 결정적이다', () => {
    const d = doc()
    const first = runRules(d, DEFAULT_RULESET, createRegistry([alwaysFires]))
    const second = runRules(d, DEFAULT_RULESET, createRegistry([alwaysFires]))
    expect(first.map((f) => f.id)).toEqual(second.map((f) => f.id))
  })

  it('비활성 룰은 실행하지 않는다', () => {
    const ruleset = {
      ...DEFAULT_RULESET,
      rules: { ...DEFAULT_RULESET.rules, STR001: { ...DEFAULT_RULESET.rules.STR001!, enabled: false } },
    }
    expect(runRules(doc(), ruleset, createRegistry([alwaysFires]))).toHaveLength(0)
  })

  it('규칙셋의 심각도 오버라이드를 적용한다', () => {
    const ruleset = {
      ...DEFAULT_RULESET,
      rules: { ...DEFAULT_RULESET.rules, STR001: { ...DEFAULT_RULESET.rules.STR001!, severity: 'error' as const } },
    }
    expect(runRules(doc(), ruleset, createRegistry([alwaysFires]))[0]!.severity).toBe('error')
  })

  it('문서 유형에 해당하지 않는 룰은 건너뛴다', () => {
    const registry = createRegistry([{ ...alwaysFires, appliesTo: ['meeting-notes'] }])
    expect(runRules(makeDoc([para('p1', 'x')], { docType: 'design' }), DEFAULT_RULESET, registry)).toHaveLength(0)
  })

  it('규칙셋의 appliesTo가 룰 기본값보다 우선한다', () => {
    const registry = createRegistry([{ ...alwaysFires, appliesTo: ['meeting-notes'] }])
    const ruleset = {
      ...DEFAULT_RULESET,
      rules: { ...DEFAULT_RULESET.rules, STR001: { ...DEFAULT_RULESET.rules.STR001!, appliesTo: 'all' as const } },
    }
    expect(runRules(makeDoc([para('p1', 'x')], { docType: 'design' }), ruleset, registry)).toHaveLength(1)
  })

  it('룰 하나가 예외를 던져도 나머지 룰 결과를 반환한다', () => {
    const boom: Rule = {
      ...alwaysFires,
      id: 'STR002',
      check: () => {
        throw new Error('boom')
      },
    }
    const onRuleError = vi.fn()
    const findings = runRules(doc(), DEFAULT_RULESET, createRegistry([boom, alwaysFires]), { onRuleError })
    expect(findings).toHaveLength(1)
    expect(onRuleError).toHaveBeenCalledWith('STR002', expect.any(Error))
  })

  it('룰에 기본 옵션과 규칙셋 옵션을 병합해 전달한다', () => {
    const captured: Record<string, unknown>[] = []
    const capturing: Rule = {
      ...alwaysFires,
      defaultOptions: { maxSectionChars: 1500, keepMe: true },
      check: (ctx) => {
        captured.push(ctx.options)
        return []
      },
    }
    const ruleset = {
      ...DEFAULT_RULESET,
      rules: {
        ...DEFAULT_RULESET.rules,
        STR001: { ...DEFAULT_RULESET.rules.STR001!, options: { maxSectionChars: 900 } },
      },
    }
    runRules(doc(), ruleset, createRegistry([capturing]))
    expect(captured[0]).toEqual({ maxSectionChars: 900, keepMe: true })
  })

  it('now를 주입하면 룰이 그 값을 받는다', () => {
    const now = new Date('2020-01-01T00:00:00Z')
    let seen: Date | undefined
    const capturing: Rule = {
      ...alwaysFires,
      check: (ctx) => {
        seen = ctx.now
        return []
      },
    }
    runRules(doc(), DEFAULT_RULESET, createRegistry([capturing]), { now })
    expect(seen).toBe(now)
  })

  it('레지스트리에 중복 룰 ID가 있으면 생성에서 막는다', () => {
    expect(() => createRegistry([alwaysFires, alwaysFires])).toThrow(/중복/)
  })
})
