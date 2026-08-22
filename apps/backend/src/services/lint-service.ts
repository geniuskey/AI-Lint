import { randomUUID } from 'node:crypto'
import type { LintOptions, LintReport, LlmSkipReason } from '@ai-lint/contract'
import { hashDocument, totalTextLength, type DocType, type Document } from '@ai-lint/ir'
import { activeLlmRules, analyzeContext, inferDocType, type LlmProvider } from '@ai-lint/llm'
import { runRules, scoreFindings, type Finding, type ResolvedRuleset, type RuleRegistry } from '@ai-lint/rules'
import { HttpError } from '../errors.js'
import type { QuotaService } from './quota.js'
import type { CacheKey, ReportStore } from './report-store.js'
import type { RulesetSource } from './ruleset-source.js'

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
  store: ReportStore
  quota: QuotaService
  limits: Limits
  promptVersion: number
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

/** 쿼터에 기록할 실제 호출 수를 센다. 요약·유형추론까지 포함해야 상한이 의미를 갖는다. */
function countingProvider(provider: LlmProvider): { provider: LlmProvider; calls: () => number } {
  let calls = 0
  return {
    provider: {
      name: provider.name,
      complete: (req) => {
        calls++
        return provider.complete(req)
      },
    },
    calls: () => calls,
  }
}

/**
 * 스펙 7장의 검사 파이프라인.
 * 룰 검사는 LLM을 기다리지 않고, LLM이 죽어도 룰 결과는 반드시 나간다.
 */
export async function lintDocument(
  input: Document,
  options: LintOptions,
  deps: LintDeps,
  userId: string,
): Promise<LintReport> {
  const startedAt = Date.now()

  const ruleset = deps.rulesets.get(options.rulesetId)
  if (!ruleset) throw new HttpError(404, `알 수 없는 규칙셋입니다: ${options.rulesetId}`)

  const truncation = truncate(input, deps.limits.maxBlocks)
  // 사용자가 유형을 직접 정했으면 LLM 추론보다 먼저 확정한다. 캐시 키도 이 유형을 반영해야 한다.
  const doc = await applyDocTypeOverride(truncation.doc, deps.store)

  const documentHash = hashDocument(doc)
  const cacheKey: CacheKey = {
    documentHash,
    rulesetId: ruleset.id,
    rulesetVersion: ruleset.version,
    promptVersion: deps.promptVersion,
  }

  const cached = await deps.store.findByKey(cacheKey)
  if (cached) return { ...cached, cached: true }

  const skipReason = await resolveSkipReason(doc, options, deps, userId)
  const useLlm = skipReason === undefined

  const counted = countingProvider(deps.provider)
  const target = useLlm ? await resolveDocType(doc, counted.provider) : doc

  const ruleFindings = runRules(target, ruleset, deps.registry, { now: deps.now() })
  const llm = useLlm ? await analyzeContext(target, ruleset, counted.provider) : null
  if (counted.calls() > 0) await deps.quota.record(userId, counted.calls())

  const findings = sortFindings([...ruleFindings, ...(llm?.findings ?? [])], target)
  const docType = target.docType.value

  const report: LintReport = {
    reportId: randomUUID(),
    documentUri: target.source.uri,
    documentHash,
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
    truncated: truncation.truncated,
    cached: false,
    createdAt: deps.now().toISOString(),
  }

  if (options.save) {
    await deps.store.save(report, { promptVersion: deps.promptVersion, userId })
  }

  return report
}

async function resolveSkipReason(
  doc: Document,
  options: LintOptions,
  deps: LintDeps,
  userId: string,
): Promise<LlmSkipReason | undefined> {
  if (!options.useLlm) return 'disabled'
  if (totalTextLength(doc) > deps.limits.llmMaxDocChars) return 'too-large'
  if (!(await deps.quota.check(userId)).allowed) return 'quota'
  return undefined
}

async function applyDocTypeOverride(doc: Document, store: ReportStore): Promise<Document> {
  const override = await store.getDocTypeOverride(doc.source.uri)
  if (!override) return doc
  return { ...doc, docType: { value: override, confidence: 1, origin: 'user' } }
}

/** 클라이언트가 유형을 못 정한 문서만 LLM에 물어본다. 라벨·템플릿·사용자 지정이면 그대로 믿는다. */
async function resolveDocType(doc: Document, provider: LlmProvider): Promise<Document> {
  if (doc.docType.origin !== 'llm') return doc

  const guess = await inferDocType(doc, provider)
  return { ...doc, docType: { ...guess, origin: 'llm' } }
}
