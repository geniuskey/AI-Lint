import type { RawFinding, Rule, RuleContext } from '../types.js'
import { RULE_META } from './meta.js'

/** 카탈로그 메타에 판정 로직을 붙여 실행 가능한 룰을 만든다. 메타는 meta.ts 한 곳에만 산다. */
export function defineRule(id: string, check: (ctx: RuleContext) => RawFinding[]): Rule {
  const meta = RULE_META[id]
  if (!meta) throw new Error(`카탈로그에 없는 룰 ID입니다: ${id}`)
  return { ...meta, check }
}

export const num = (options: Record<string, unknown>, key: string, fallback: number): number => {
  const value = options[key]
  return typeof value === 'number' ? value : fallback
}
