import type { Axis, DocType, Document, Section, Severity, SourceAnchor } from '@ai-lint/ir'

export type { Axis, DocType, Document, Section, Severity, SourceAnchor }

/** 룰이 뱉는 날것의 검출 결과. 심각도·축·앵커는 러너가 채운다. */
export interface RawFinding {
  blockId: string | null
  message: string
  why: string
  evidence?: string
  suggestion?: { before: string; after: string }
}

export interface RuleContext {
  doc: Document
  sections: Section[]
  options: Record<string, unknown>
  /** META005처럼 현재 시각에 의존하는 룰을 위해 주입한다. 룰이 Date.now()를 직접 부르면 테스트가 불안정해진다. */
  now: Date
}

export interface RuleMeta {
  id: string
  name: string
  axis: Axis
  defaultSeverity: Severity
  appliesTo: DocType[] | 'all'
  description: string
  /** LLM이 판정하는 룰. 결정적 러너는 건너뛴다. */
  llm: boolean
  defaultOptions: Record<string, unknown>
}

export interface Rule extends RuleMeta {
  check(ctx: RuleContext): RawFinding[]
}

export interface Finding {
  id: string
  ruleId: string
  axis: Axis
  severity: Severity
  blockId: string | null
  anchor: SourceAnchor | null
  message: string
  why: string
  evidence: string | null
  suggestion: { before: string; after: string } | null
  source: 'rule' | 'llm'
  confidence: number
  docsUrl: string
}

export interface RuleConfig {
  enabled: boolean
  severity: Severity
  options: Record<string, unknown>
  appliesTo?: DocType[] | 'all'
}

export interface AxisWeights {
  structure: number
  context: number
  metadata: number
}

export type AxisScores = AxisWeights

export interface ResolvedRuleset {
  id: string
  version: number
  name: string
  axisWeights: AxisWeights
  rules: Record<string, RuleConfig>
}

export type Grade = 'A' | 'B' | 'C' | 'D'

export interface Score {
  total: number
  grade: Grade
  axes: AxisScores
}

/** 룰 카탈로그 페이지. 룰마다 `#str001` 형태의 앵커가 있다. */
export const RULE_DOCS_BASE = 'https://geniuskey.github.io/AI-Lint/rules/'

export const docsUrlFor = (ruleId: string): string => `${RULE_DOCS_BASE}#${ruleId.toLowerCase()}`
