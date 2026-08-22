import { DocumentSchema, type DocType } from '@ai-lint/ir'
import type { Finding, Score } from '@ai-lint/rules'
import { z } from 'zod'

export const LintOptionsSchema = z
  .object({
    useLlm: z.boolean().default(true),
    rulesetId: z.string().min(1).default('default'),
    save: z.boolean().default(true),
  })
  .default({})

export type LintOptions = z.infer<typeof LintOptionsSchema>

export const LintRequestSchema = z.object({
  document: DocumentSchema,
  options: LintOptionsSchema,
})

export type LintRequest = z.infer<typeof LintRequestSchema>

export type LlmStatus = 'ok' | 'partial' | 'skipped' | 'failed'
export type LlmSkipReason = 'disabled' | 'quota' | 'too-large'

export interface LintReport {
  reportId: string
  documentUri: string
  documentHash: string
  docType: DocType
  rulesetId: string
  rulesetVersion: number
  score: Score
  findings: Finding[]
  stats: {
    rulesEvaluated: number
    llmFindingsRejected: number
    durationMs: number
  }
  llmStatus: LlmStatus
  llmSkipReason?: LlmSkipReason
  /** 블록 수 상한을 넘어 잘라서 검사했다 */
  truncated: boolean
  /** 같은 해시의 기존 리포트를 재사용했다 */
  cached: boolean
  createdAt: string
}
