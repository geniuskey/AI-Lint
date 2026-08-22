import type { AxisScores, AxisWeights, Finding, Grade, Score, Severity } from './types.js'

const PENALTY: Record<Severity, number> = { error: 15, warning: 6, info: 2 }

/** 같은 룰이 반복 위반될 때 전액 감점하는 횟수. 한 종류의 문제가 점수를 독점하지 않도록 한다. */
const FULL_PENALTY_LIMIT = 3
const REPEAT_PENALTY = 1

export const DEFAULT_AXIS_WEIGHTS: AxisWeights = {
  structure: 0.35,
  context: 0.45,
  metadata: 0.2,
}

export function gradeOf(total: number): Grade {
  if (total >= 90) return 'A'
  if (total >= 75) return 'B'
  if (total >= 60) return 'C'
  return 'D'
}

export function scoreFindings(findings: Finding[], weights: AxisWeights = DEFAULT_AXIS_WEIGHTS): Score {
  const axes: AxisScores = { structure: 100, context: 100, metadata: 100 }
  const seen = new Map<string, number>()

  for (const f of findings) {
    const count = (seen.get(f.ruleId) ?? 0) + 1
    seen.set(f.ruleId, count)
    const penalty = count <= FULL_PENALTY_LIMIT ? PENALTY[f.severity] : REPEAT_PENALTY
    axes[f.axis] = Math.max(0, axes[f.axis] - penalty)
  }

  const total = Math.round(
    axes.structure * weights.structure + axes.context * weights.context + axes.metadata * weights.metadata,
  )

  return { total, grade: gradeOf(total), axes }
}
