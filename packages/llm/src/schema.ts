import { LLM_RULE_IDS } from '@ai-lint/rules'
import { z } from 'zod'
import type { JsonSchema } from './provider.js'

/** 모델이 STR 룰을 지어내지 못하도록 스키마 층에서 막는다. */
const RULE_ID_ENUM = [...LLM_RULE_IDS] as [string, ...string[]]

export const LlmSuggestionSchema = z.object({
  before: z.string().min(1),
  after: z.string().min(1),
})

export const LlmFindingSchema = z.object({
  ruleId: z.enum(RULE_ID_ENUM),
  blockId: z.string().min(1),
  evidence: z.string().min(1),
  why: z.string().min(1),
  suggestion: LlmSuggestionSchema.nullable().default(null),
  confidence: z.number().min(0).max(1),
})
export type LlmFinding = z.infer<typeof LlmFindingSchema>

export const LlmResponseSchema = z.object({
  findings: z.array(LlmFindingSchema),
})
export type LlmResponse = z.infer<typeof LlmResponseSchema>

/** Gemini responseSchema. zod 버전과 같은 제약을 걸어 응답 단계와 검증 단계가 어긋나지 않게 한다. */
export const LLM_FINDING_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ruleId: { type: 'string', enum: RULE_ID_ENUM },
          blockId: { type: 'string', description: '지적 대상 블록의 id. 본문에 <!--b:id--> 로 표시되어 있다.' },
          evidence: { type: 'string', description: '문제가 드러나는 원문 구절을 그대로 인용. 절대 바꿔 쓰지 않는다.' },
          why: { type: 'string', description: 'AI가 이 문서를 읽을 때 왜 문제가 되는지 한국어 한두 문장.' },
          suggestion: {
            type: 'object',
            nullable: true,
            properties: {
              before: { type: 'string', description: '원문 그대로의 문장.' },
              after: { type: 'string', description: '고쳐 쓴 문장.' },
            },
            required: ['before', 'after'],
          },
          confidence: { type: 'number', description: '0에서 1 사이. 확신이 없으면 낮게 준다.' },
        },
        required: ['ruleId', 'blockId', 'evidence', 'why', 'confidence'],
      },
    },
  },
  required: ['findings'],
}
