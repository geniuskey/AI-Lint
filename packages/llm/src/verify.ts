import { blockText, type Block, type Document } from '@ai-lint/ir'
import { docsUrlFor, LLM_RULE_IDS, RULE_META, type Finding, type ResolvedRuleset } from '@ai-lint/rules'
import { z } from 'zod'
import { LlmSuggestionSchema } from './schema.js'

export type RejectionReason =
  | 'unknown-rule'
  | 'rule-disabled'
  | 'doctype-mismatch'
  | 'unknown-block'
  | 'evidence-not-found'
  | 'low-confidence'
  | 'schema-invalid'

export interface RejectionRecord {
  ruleId?: string
  reason: RejectionReason
}

export interface VerifyResult {
  accepted: Finding[]
  rejected: RejectionRecord[]
}

export interface VerifyOptions {
  minConfidence?: number
}

const DEFAULT_MIN_CONFIDENCE = 0.6
/** 유사도 탐색은 O(n·m)이다. 긴 블록에서는 정확 일치 실패를 그냥 폐기로 본다. */
const FUZZY_MAX_BLOCK_CHARS = 2000
const FUZZY_THRESHOLD = 0.9

/**
 * 검증 단계에서는 ruleId를 문자열로 받는다.
 * enum으로 막으면 모르는 룰과 형식 오류가 같은 사유로 뭉뚱그려져 원인 추적이 어렵다.
 */
const CandidateSchema = z.object({
  ruleId: z.string().min(1),
  blockId: z.string().min(1),
  evidence: z.string().min(1),
  why: z.string().min(1),
  suggestion: LlmSuggestionSchema.nullish().transform((v) => v ?? null),
  confidence: z.number().min(0).max(1),
})
type Candidate = z.infer<typeof CandidateSchema>

const normalize = (s: string): string => s.replace(/\s+/g, ' ').trim()

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(cur[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost)
    }
    prev = cur
  }

  return prev[b.length]!
}

const similarity = (a: string, b: string): number => {
  const longest = Math.max(a.length, b.length)
  return longest === 0 ? 1 : 1 - editDistance(a, b) / longest
}

/** 공백 차이는 허용하고, 그래도 못 찾으면 슬라이딩 윈도로 근사 일치를 찾는다. */
export function evidenceFound(evidence: string, text: string): boolean {
  const needle = normalize(evidence)
  const haystack = normalize(text)
  if (needle.length === 0) return false
  if (haystack.includes(needle)) return true
  if (haystack.length > FUZZY_MAX_BLOCK_CHARS) return false

  const window = needle.length
  for (let i = 0; i + window <= haystack.length; i++) {
    if (similarity(needle, haystack.slice(i, i + window)) >= FUZZY_THRESHOLD) return true
  }
  return false
}

const LLM_RULES = new Set(LLM_RULE_IDS)

function checkOne(
  f: Candidate,
  doc: Document,
  ruleset: ResolvedRuleset,
  minConfidence: number,
  blocks: Map<string, Block>,
): { ok: true; block: Block } | { ok: false; reason: RejectionReason } {
  const meta = RULE_META[f.ruleId]
  if (!meta || !LLM_RULES.has(f.ruleId)) return { ok: false, reason: 'unknown-rule' }

  const config = ruleset.rules[f.ruleId]
  if (!config || !config.enabled) return { ok: false, reason: 'rule-disabled' }

  const appliesTo = config.appliesTo ?? meta.appliesTo
  if (appliesTo !== 'all' && !appliesTo.includes(doc.docType.value)) return { ok: false, reason: 'doctype-mismatch' }

  const block = blocks.get(f.blockId)
  if (!block) return { ok: false, reason: 'unknown-block' }

  if (f.confidence < minConfidence) return { ok: false, reason: 'low-confidence' }
  if (!evidenceFound(f.evidence, blockText(block))) return { ok: false, reason: 'evidence-not-found' }

  return { ok: true, block }
}

/**
 * LLM 응답을 IR과 대조해 지어낸 지적을 걸러낸다.
 * 스펙 7.4절의 조건을 모두 통과한 finding만 리포트에 오른다.
 */
export function verifyFindings(
  raw: unknown,
  doc: Document,
  ruleset: ResolvedRuleset,
  opts: VerifyOptions = {},
): VerifyResult {
  const minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE
  const items = (raw as { findings?: unknown } | null)?.findings

  // 응답 껍데기부터 깨졌으면 개별 finding을 볼 수 없다.
  if (!Array.isArray(items)) return { accepted: [], rejected: [{ reason: 'schema-invalid' }] }

  const blocks = new Map(doc.blocks.map((b) => [b.id, b]))
  const rejected: RejectionRecord[] = []
  // (ruleId, blockId)가 같으면 같은 지적으로 보고 confidence가 높은 쪽만 남긴다.
  const best = new Map<string, { f: Candidate; block: Block }>()

  for (const item of items) {
    const parsed = CandidateSchema.safeParse(item)
    if (!parsed.success) {
      const ruleId = (item as { ruleId?: unknown })?.ruleId
      rejected.push({ ...(typeof ruleId === 'string' ? { ruleId } : {}), reason: 'schema-invalid' })
      continue
    }

    const f = parsed.data
    const check = checkOne(f, doc, ruleset, minConfidence, blocks)
    if (!check.ok) {
      rejected.push({ ruleId: f.ruleId, reason: check.reason })
      continue
    }

    const key = `${f.ruleId}:${f.blockId}`
    const existing = best.get(key)
    if (!existing || f.confidence > existing.f.confidence) best.set(key, { f, block: check.block })
  }

  const accepted = [...best.values()].map(({ f, block }) => toFinding(f, block, ruleset))
  return { accepted, rejected }
}

function toFinding(f: Candidate, block: Block, ruleset: ResolvedRuleset): Finding {
  const meta = RULE_META[f.ruleId]!
  // suggestion.before가 원문에 없으면 제안만 버린다. 지적 자체는 근거로 이미 뒷받침됐다.
  const suggestion = f.suggestion && evidenceFound(f.suggestion.before, blockText(block)) ? f.suggestion : null

  return {
    id: `${f.ruleId}:${f.blockId}:llm`,
    ruleId: f.ruleId,
    axis: meta.axis,
    severity: ruleset.rules[f.ruleId]?.severity ?? meta.defaultSeverity,
    blockId: f.blockId,
    anchor: block.anchor,
    message: meta.description,
    why: f.why,
    evidence: f.evidence,
    suggestion,
    source: 'llm',
    confidence: f.confidence,
    docsUrl: docsUrlFor(f.ruleId),
  }
}
