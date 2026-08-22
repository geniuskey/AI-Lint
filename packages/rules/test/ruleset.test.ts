import { describe, it, expect } from 'vitest'
import { DEFAULT_RULESET, loadRuleset, RULE_IDS, RULE_META } from '../src/index.js'

describe('loadRuleset', () => {
  it('YAML을 파싱해 규칙셋을 만든다', () => {
    const rs = loadRuleset(`
id: team-a
version: 2
name: A팀 규칙셋
axisWeights: { structure: 0.3, context: 0.5, metadata: 0.2 }
rules:
  STR003: { enabled: true, severity: warning, options: { maxSectionChars: 900 } }
`)
    expect(rs.id).toBe('team-a')
    expect(rs.version).toBe(2)
    expect(rs.axisWeights.context).toBe(0.5)
    expect(rs.rules.STR003!.options.maxSectionChars).toBe(900)
  })

  it('명시되지 않은 룰은 카탈로그 기본값으로 채운다', () => {
    const rs = loadRuleset('id: x\nversion: 1\nname: x\nrules: {}\n')
    expect(Object.keys(rs.rules).sort()).toEqual([...RULE_IDS].sort())
    expect(rs.rules.STR001!.enabled).toBe(true)
    expect(rs.rules.STR001!.severity).toBe('warning')
    expect(rs.rules.STR005!.severity).toBe('error')
  })

  it('룰 옵션은 기본값 위에 덮어쓴다', () => {
    const rs = loadRuleset('id: x\nversion: 1\nname: x\nrules: { META005: { options: { staleMonths: 6 } } }\n')
    expect(rs.rules.META005!.options.staleMonths).toBe(6)
    expect(rs.rules.META002!.options.minChars).toBe(1200)
  })

  it('axisWeights가 없으면 기본 가중치를 쓴다', () => {
    const rs = loadRuleset('id: x\nversion: 1\nname: x\nrules: {}\n')
    expect(rs.axisWeights).toEqual({ structure: 0.35, context: 0.45, metadata: 0.2 })
  })

  it('축 가중치 합이 1이 아니면 거부한다', () => {
    expect(() =>
      loadRuleset('id: x\nversion: 1\nname: x\naxisWeights: { structure: 0.5, context: 0.5, metadata: 0.5 }\nrules: {}\n'),
    ).toThrow(/가중치/)
  })

  it('알 수 없는 룰 ID를 거부한다', () => {
    expect(() => loadRuleset('id: x\nversion: 1\nname: x\nrules: { STR999: { enabled: true } }\n')).toThrow(/STR999/)
  })

  it('필수 필드가 없으면 거부한다', () => {
    expect(() => loadRuleset('version: 1\nname: x\nrules: {}\n')).toThrow()
  })

  it('알 수 없는 심각도를 거부한다', () => {
    expect(() => loadRuleset('id: x\nversion: 1\nname: x\nrules: { STR001: { severity: fatal } }\n')).toThrow()
  })
})

describe('DEFAULT_RULESET', () => {
  it('전체 룰을 활성 상태로 담는다', () => {
    expect(Object.keys(DEFAULT_RULESET.rules)).toHaveLength(31)
    expect(Object.values(DEFAULT_RULESET.rules).every((r) => r.enabled)).toBe(true)
  })

  it('오버라이드가 없으면 appliesTo를 비워 룰 기본값이 쓰이게 한다', () => {
    expect(DEFAULT_RULESET.rules.CTX007!.appliesTo).toBeUndefined()
    expect(RULE_META.CTX007!.appliesTo).toEqual(['design', 'meeting-notes', 'requirement'])
  })
})
