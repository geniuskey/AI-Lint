import { z } from 'zod'

/**
 * 원본 문서에서 인용한 텍스트와 그 주변 문맥.
 * 렌더된 DOM 구조가 storage format과 달라 xpath가 빗나갈 때의 fallback 검색에 쓴다.
 * W3C Web Annotation의 TextQuoteSelector와 같은 방식.
 */
export const TextQuoteSchema = z.object({
  exact: z.string().min(1),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
})

export type TextQuote = z.infer<typeof TextQuoteSchema>

export const SourceAnchorSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('confluence'),
    xpath: z.string(),
    textQuote: TextQuoteSchema,
  }),
  z.object({
    kind: z.literal('pptx'),
    slide: z.number().int().positive(),
    shapeId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('docx'),
    paragraphIndex: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('xlsx'),
    sheet: z.string(),
    range: z.string().optional(),
  }),
  z.object({
    kind: z.literal('pdf'),
    page: z.number().int().positive(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  }),
])

export type SourceAnchor = z.infer<typeof SourceAnchorSchema>
