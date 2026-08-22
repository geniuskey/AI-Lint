import { randomUUID } from 'node:crypto'
import { DocumentSchema, hashDocument, totalTextLength, type DocType, type Document } from '@ai-lint/ir'
import { activeLlmRules, analyzeContext, inferDocType, type LlmProvider } from '@ai-lint/llm'
import { runRules, scoreFindings, type Finding, type ResolvedRuleset, type RuleRegistry, type Score } from '@ai-lint/rules'
import { z } from 'zod'
import { HttpError } from '../errors.js'
import type { RulesetSource } from './ruleset-source.js'

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
  truncated: boolean
  cached: boolean
  createdAt: string
}

export interface Limits {
  /** 이 수를 넘는 블록은 잘라낸다. 거대한 페이지 하나가 서버를 점유하는 것을 막는다. */
  maxBlocks: number
  /** 이 길이를 넘으면 LLM 검사를 건너뛴다. 룰 검사는 그대로 수행한다. */
  llmMaxDocChars: number
}

export const DEFAULT_LIMITS: Limits = { maxBlocks: 2000, llmMaxDocChars: 200_000 }

export interface LintDeps {
  provider: LlmProvider
  rulesets: RulesetSource
  registry: RuleRegistry
  limits: Limits
  now: () => Date
}

const SEVERITY_RANK = { error: 0, warning: 1, info: 2 } as const

function truncate(doc: Document, maxBlocks: number): { doc: Document; truncated: boolean } {
  if (doc.blocks.length <= maxBlocks) return { doc, truncated: false }

  const blocks = doc.blocks.slice(0, maxBlocks)
  const kept = new Set(blocks.map((b) => b.id))
  // 잘려나간 블록을 가리키는 링크를 남기면 앵커가 없는 지적이 생긴다.
  return { doc: { ...doc, blocks, links: doc.links.filter((l) => kept.has(l.blockId)) }, truncated: true }
}

/** 문서 순서 → 심각도 → 룰 ID. 확장이 본문을 따라 내려가며 표시할 수 있어야 한다. */
function sortFindings(findings: Finding[], doc: Document): Finding[] {
  const position = new Map(doc.blocks.map((b, i) => [b.id, i]))
  const at = (f: Finding): number => (f.blockId === null ? -1 : (position.get(f.blockId) ?? Number.MAX_SAFE_INTEGER))

  return [...findings].sort(
    (a, b) =>
      at(a) - at(b) || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.ruleId.localeCompare(b.ruleId),
  )
}

function countDeterministicRules(registry: RuleRegistry, ruleset: ResolvedRuleset, docType: DocType): number {
  return registry.all().filter((rule) => {
    const config = ruleset.rules[rule.id]
    if (!config?.enabled) return false
    const appliesTo = config.appliesTo ?? rule.appliesTo
    return appliesTo === 'all' || appliesTo.includes(docType)
  }).length
}

/**
 * 스펙 7장의 검사 파이프라인.
 * 룰 검사는 LLM을 기다리지 않고, LLM이 죽어도 룰 결과는 반드시 나간다.
 */
export async function lintDocument(input: Document, options: LintOptions, deps: LintDeps): Promise<LintReport> {
  const startedAt = Date.now()

  const ruleset = deps.rulesets.get(options.rulesetId)
  if (!ruleset) throw new HttpError(404, `알 수 없는 규칙셋입니다: ${options.rulesetId}`)

  const { doc, truncated } = truncate(input, deps.limits.maxBlocks)

  const skipReason = resolveSkipReason(doc, options, deps.limits)
  const useLlm = skipReason === undefined

  const target = useLlm ? await resolveDocType(doc, deps.provider) : doc

  const ruleFindings = runRules(target, ruleset, deps.registry, { now: deps.now() })
  const llm = useLlm ? await analyzeContext(target, ruleset, deps.provider) : null

  const findings = sortFindings([...ruleFindings, ...(llm?.findings ?? [])], target)
  const docType = target.docType.value

  return {
    reportId: randomUUID(),
    documentUri: target.source.uri,
    documentHash: hashDocument(target),
    docType,
    rulesetId: ruleset.id,
    rulesetVersion: ruleset.version,
    score: scoreFindings(findings, ruleset.axisWeights),
    findings,
    stats: {
      rulesEvaluated:
        countDeterministicRules(deps.registry, ruleset, docType) +
        (useLlm ? activeLlmRules(ruleset, docType).length : 0),
      llmFindingsRejected: llm?.rejectedCount ?? 0,
      durationMs: Date.now() - startedAt,
    },
    llmStatus: llm?.status ?? 'skipped',
    ...(skipReason ? { llmSkipReason: skipReason } : {}),
    truncated,
    cached: false,
    createdAt: deps.now().toISOString(),
  }
}

function resolveSkipReason(doc: Document, options: LintOptions, limits: Limits): LlmSkipReason | undefined {
  if (!options.useLlm) return 'disabled'
  if (totalTextLength(doc) > limits.llmMaxDocChars) return 'too-large'
  return undefined
}

/** 클라이언트가 유형을 못 정한 문서만 LLM에 물어본다. 라벨·템플릿으로 정해졌으면 그대로 믿는다. */
async function resolveDocType(doc: Document, provider: LlmProvider): Promise<Document> {
  if (doc.docType.origin !== 'llm') return doc

  const guess = await inferDocType(doc, provider)
  return { ...doc, docType: { ...guess, origin: 'llm' } }
}
