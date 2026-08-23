import type { Severity } from '@ai-lint/rules'
import { z } from 'zod'
import type { LlmSkipReason, LlmStatus } from './report.js'

export const TraceRequestSchema = z.object({ useLlm: z.boolean().default(true) }).default({})
export type TraceRequest = z.infer<typeof TraceRequestSchema>

export interface TraceDocumentRef {
  uri: string
  title: string
}

export interface TraceFinding {
  id: string
  ruleId: string
  severity: Severity
  message: string
  why: string
  /** 이 지적에 걸린 문서들 */
  documents: TraceDocumentRef[]
  subjectId: string | null
  evidence: string | null
  source: 'rule' | 'llm'
  confidence: number
}

export interface TraceReport {
  reportId: string
  /** 인덱스에 쌓인 문서 수 */
  documentCount: number
  /** 그래프에 등장한 고유 식별자 수 */
  idCount: number
  findings: TraceFinding[]
  stats: {
    pairsConsidered: number
    pairsAnalyzed: number
    llmFindingsRejected: number
    durationMs: number
  }
  llmStatus: LlmStatus
  llmSkipReason?: LlmSkipReason
  /** 후보 쌍 상한에 걸려 일부만 대조했다 */
  truncated: boolean
  createdAt: string
}
