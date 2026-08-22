import { DEFAULT_RULESET, loadRuleset, type ResolvedRuleset } from '@ai-lint/rules'

export interface RulesetSummary {
  id: string
  version: number
  name: string
}

export interface RulesetSource {
  get(id: string): ResolvedRuleset | undefined
  list(): RulesetSummary[]
}

const summarize = (rs: ResolvedRuleset): RulesetSummary => ({ id: rs.id, version: rs.version, name: rs.name })

/**
 * 규칙셋은 배포 단위로 고정된다 — 요청마다 YAML을 다시 파싱할 이유가 없다.
 * Task 9에서 DB 기반 소스를 추가할 때도 이 인터페이스만 만족하면 된다.
 */
export function createMemoryRulesetSource(rulesets: ResolvedRuleset[] = [DEFAULT_RULESET]): RulesetSource {
  const byId = new Map(rulesets.map((rs) => [rs.id, rs]))
  return {
    get: (id) => byId.get(id),
    list: () => [...byId.values()].map(summarize),
  }
}

export function createYamlRulesetSource(documents: string[]): RulesetSource {
  return createMemoryRulesetSource([DEFAULT_RULESET, ...documents.map(loadRuleset)])
}
