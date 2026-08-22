import { DocTypeSchema, outline, serializeToMarkdown, type DocType, type Document } from '@ai-lint/ir'
import { z } from 'zod'
import { DOCTYPE_SYSTEM_PROMPT } from './prompt.js'
import type { JsonSchema, LlmProvider } from './provider.js'

const HEAD_CHARS = 500

const DocTypeGuessSchema = z.object({
  value: DocTypeSchema,
  confidence: z.number().min(0).max(1),
})
export type DocTypeGuess = z.infer<typeof DocTypeGuessSchema>

export const DOCTYPE_RESPONSE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    value: { type: 'string', enum: [...DocTypeSchema.options] },
    confidence: { type: 'number' },
  },
  required: ['value', 'confidence'],
}

const UNKNOWN: DocTypeGuess = { value: 'unknown', confidence: 0 }

/** 라벨·템플릿으로 유형을 못 정했을 때만 부른다. 실패해도 검사는 계속되어야 하므로 예외를 던지지 않는다. */
export async function inferDocType(doc: Document, provider: LlmProvider): Promise<DocTypeGuess> {
  const user = [
    `제목: ${doc.title}`,
    `라벨: ${doc.metadata.labels.join(', ') || '(없음)'}`,
    ``,
    `목차:`,
    outline(doc) || '(제목 없음)',
    ``,
    `본문 앞부분:`,
    serializeToMarkdown(doc).slice(0, HEAD_CHARS),
  ].join('\n')

  try {
    const raw = await provider.complete({
      system: DOCTYPE_SYSTEM_PROMPT,
      user,
      schema: DOCTYPE_RESPONSE_SCHEMA,
      maxTokens: 256,
    })
    const parsed = DocTypeGuessSchema.safeParse(raw)
    return parsed.success ? parsed.data : UNKNOWN
  } catch {
    return UNKNOWN
  }
}

export const isKnownDocType = (value: string): value is DocType => DocTypeSchema.safeParse(value).success
