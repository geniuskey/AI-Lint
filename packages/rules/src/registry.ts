import type { Rule } from './types.js'

export interface RuleRegistry {
  get(id: string): Rule | undefined
  all(): Rule[]
}

/**
 * 판정 로직이 구현된 룰만 담는다. CTX 룰은 LLM이 담당하므로 여기 없다.
 * 팩토리인 이유: 테스트가 전역 상태를 오염시키지 않고 원하는 룰만 담은 레지스트리를 만들 수 있어야 한다.
 */
export function createRegistry(rules: Rule[]): RuleRegistry {
  const byId = new Map(rules.map((r) => [r.id, r]))
  if (byId.size !== rules.length) {
    const seen = new Set<string>()
    const dup = rules.find((r) => (seen.has(r.id) ? true : (seen.add(r.id), false)))
    throw new Error(`룰 ID가 중복되었습니다: ${dup?.id}`)
  }
  return {
    get: (id) => byId.get(id),
    all: () => [...rules],
  }
}
