import { z } from 'zod'
import { SourceAnchorSchema } from './anchor.js'

export const DocTypeSchema = z.enum([
  'meeting-notes',
  'requirement',
  'design',
  'guide',
  'api-doc',
  'troubleshooting',
  'reference',
  'unknown',
])
export type DocType = z.infer<typeof DocTypeSchema>

export const SeveritySchema = z.enum(['error', 'warning', 'info'])
export type Severity = z.infer<typeof SeveritySchema>

export const AxisSchema = z.enum(['structure', 'context', 'metadata'])
export type Axis = z.infer<typeof AxisSchema>

const BlockBaseSchema = z.object({
  id: z.string().min(1),
  /** 제목 계층상 위치. 예: [2,1] = 2번째 h1 아래 1번째 h2 */
  path: z.array(z.number().int().nonnegative()),
  anchor: SourceAnchorSchema,
})

const withBase = <T extends z.ZodRawShape>(shape: T) => BlockBaseSchema.extend(shape)

export const BlockSchema = z.discriminatedUnion('kind', [
  withBase({
    kind: z.literal('heading'),
    level: z.number().int().min(1).max(6),
    text: z.string(),
  }),
  withBase({
    kind: z.literal('paragraph'),
    text: z.string(),
  }),
  withBase({
    kind: z.literal('list'),
    ordered: z.boolean(),
    items: z.array(z.string()),
    depth: z.number().int().nonnegative(),
  }),
  withBase({
    kind: z.literal('table'),
    caption: z.string().optional(),
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    isLayoutTable: z.boolean(),
  }),
  withBase({
    kind: z.literal('code'),
    lang: z.string().optional(),
    text: z.string(),
  }),
  withBase({
    kind: z.literal('image'),
    alt: z.string().optional(),
    caption: z.string().optional(),
    ocrText: z.string().optional(),
    assetRef: z.string(),
  }),
  withBase({
    kind: z.literal('callout'),
    variant: z.string(),
    text: z.string(),
  }),
  withBase({
    kind: z.literal('macro'),
    name: z.string(),
    params: z.record(z.string()),
    renderedText: z.string().optional(),
  }),
  withBase({
    kind: z.literal('slide'),
    index: z.number().int().positive(),
    notes: z.string().optional(),
  }),
])
export type Block = z.infer<typeof BlockSchema>

export type BlockOfKind<K extends Block['kind']> = Extract<Block, { kind: K }>
export type HeadingBlock = BlockOfKind<'heading'>

export const LinkSchema = z.object({
  blockId: z.string(),
  /** 링크 텍스트. "여기" 같은 무의미 텍스트 검출용 (STR007) */
  text: z.string(),
  href: z.string(),
  target: z.enum(['internal', 'external', 'attachment', 'anchor']),
  resolvedTitle: z.string().optional(),
  status: z.enum(['ok', 'broken', 'unchecked']).optional(),
})
export type Link = z.infer<typeof LinkSchema>

export const SourceKindSchema = z.enum(['confluence', 'pptx', 'docx', 'xlsx', 'pdf'])
export type SourceKind = z.infer<typeof SourceKindSchema>

export const DocumentSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.object({
    kind: SourceKindSchema,
    uri: z.string().min(1),
    version: z.string().optional(),
    modifiedAt: z.string().optional(),
    author: z.string().optional(),
    space: z.string().optional(),
  }),
  title: z.string(),
  docType: z.object({
    value: DocTypeSchema,
    confidence: z.number().min(0).max(1),
    origin: z.enum(['label', 'template', 'llm', 'user']),
  }),
  blocks: z.array(BlockSchema),
  links: z.array(LinkSchema),
  metadata: z.object({
    labels: z.array(z.string()),
    owner: z.string().optional(),
    reviewedAt: z.string().optional(),
    ancestors: z.array(z.string()).optional(),
  }),
})
export type Document = z.infer<typeof DocumentSchema>
