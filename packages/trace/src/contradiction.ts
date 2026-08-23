import type { TraceFinding } from '@ai-lint/contract'
import { evidenceFound, type AnalyzeStatus, type JsonSchema, type LlmProvider } from '@ai-lint/llm'
import { z } from 'zod'
import { sortTraceFindings, TRACE_RULES } from './checks.js'
import type { DocIndexEntry } from './entry.js'
import type { TraceGraph } from './graph.js'

export interface ContradictionPair {
  sharedIds: string[]
  a: DocIndexEntry
  b: DocIndexEntry
}

export interface ContradictionOptions {
  minConfidence?: number
  concurrency?: number
  maxTokens?: number
  onPairError?: (pair: ContradictionPair, error: unknown) => void
}

export interface ContradictionResult {
  findings: TraceFinding[]
  status: AnalyzeStatus
  rejectedCount: number
}

const DEFAULT_MIN_CONFIDENCE = 0.6
const DEFAULT_CONCURRENCY = 3
const DEFAULT_MAX_TOKENS = 2048

const CONTRADICTION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    contradictions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subjectId: { type: 'string' },
          quoteA: { type: 'string' },
          quoteB: { type: 'string' },
          why: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['subjectId', 'quoteA', 'quoteB', 'why', 'confidence'],
      },
    },
  },
  required: ['contradictions'],
}

const CandidateSchema = z.object({
  subjectId: z.string().min(1),
  quoteA: z.string().min(1),
  quoteB: z.string().min(1),
  why: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

const SYSTEM_PROMPT = `당신은 기술 문서 감사자다.
같은 식별자를 다루는 두 문서의 발췌를 받아, 서로 모순되는 서술만 찾아낸다.

지켜야 할 것:
- 두 발췌에 실제로 적힌 문장만 인용한다. 없는 문장을 지어내면 그 지적은 폐기된다.
- 표현이 다를 뿐 같은 뜻이면 상충이 아니다. 수치, 조건, 책임 주체가 실제로 어긋날 때만 보고한다.
- 한쪽에만 있는 내용은 상충이 아니다.
- 확신이 없으면 confidence를 낮게 준다.
- why는 한국어 한두 문장으로 무엇이 어긋나는지 적는다.`

function snippetsFor(entry: DocIndexEntry, ids: ReadonlySet<string>): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const mention of entry.mentions) {
    if (!ids.has(mention.id) || seen.has(mention.snippet)) continue
    seen.add(mention.snippet)
    lines.push(`- ${mention.snippet}`)
  }
  return lines.join('\n')
}

function buildUserPrompt(pair: ContradictionPair): string {
  const ids = new Set(pair.sharedIds)
  return [
    `공유 식별자: ${pair.sharedIds.join(', ')}`,
    '',
    `[문서 A] ${pair.a.title}`,
    snippetsFor(pair.a, ids),
    '',
    `[문서 B] ${pair.b.title}`,
    snippetsFor(pair.b, ids),
  ].join('\n')
}

/** 같은 ID를 다루는 문서 쌍만 후보다. 전량 대조는 문서 수의 제곱으로 늘어난다. */
export function selectPairs(
  graph: TraceGraph,
  maxPairs: number,
): { pairs: ContradictionPair[]; considered: number } {
  const shared = new Map<string, { a: string; b: string; ids: string[] }>()

  for (const id of graph.kinds.keys()) {
    const uris = [
      ...new Set([...(graph.definedBy.get(id) ?? []), ...(graph.referencedBy.get(id) ?? [])]),
    ].sort()

    for (let i = 0; i < uris.length; i++) {
      for (let j = i + 1; j < uris.length; j++) {
        const key = `${uris[i]!}|${uris[j]!}`
        const existing = shared.get(key)
        if (existing === undefined) shared.set(key, { a: uris[i]!, b: uris[j]!, ids: [id] })
        else existing.ids.push(id)
      }
    }
  }

  const pairs = [...shared.values()]
    .sort((x, y) => y.ids.length - x.ids.length || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
    .slice(0, maxPairs)
    .map((entry) => ({
      sharedIds: [...entry.ids].sort(),
      a: graph.byUri.get(entry.a)!,
      b: graph.byUri.get(entry.b)!,
    }))

  return { pairs, considered: shared.size }
}

async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function verifyPair(
  raw: unknown,
  pair: ContradictionPair,
  minConfidence: number,
): { accepted: TraceFinding[]; rejected: number } {
  const items = (raw as { contradictions?: unknown } | null)?.contradictions
  if (!Array.isArray(items)) return { accepted: [], rejected: 1 }

  const ids = new Set(pair.sharedIds)
  const textA = snippetsFor(pair.a, ids)
  const textB = snippetsFor(pair.b, ids)
  const accepted: TraceFinding[] = []
  let rejected = 0

  for (const item of items) {
    const parsed = CandidateSchema.safeParse(item)
    if (!parsed.success) {
      rejected++
      continue
    }

    const candidate = parsed.data
    const grounded =
      candidate.confidence >= minConfidence &&
      evidenceFound(candidate.quoteA, textA) &&
      evidenceFound(candidate.quoteB, textB)

    if (!grounded) {
      rejected++
      continue
    }

    accepted.push({
      id: `TRC006:${pair.a.uri}:${pair.b.uri}:${candidate.subjectId}`,
      ruleId: 'TRC006',
      severity: TRACE_RULES.TRC006.severity,
      message: TRACE_RULES.TRC006.message,
      why: candidate.why,
      documents: [
        { uri: pair.a.uri, title: pair.a.title },
        { uri: pair.b.uri, title: pair.b.title },
      ],
      subjectId: candidate.subjectId,
      evidence: `A: ${candidate.quoteA}\nB: ${candidate.quoteB}`,
      source: 'llm',
      confidence: candidate.confidence,
    })
  }

  return { accepted, rejected }
}

/** 어떤 경우에도 던지지 않는다. 결정적 판정은 이미 나와 있고 그것만이라도 돌려줘야 한다. */
export async function analyzeContradictions(
  pairs: readonly ContradictionPair[],
  provider: LlmProvider,
  opts: ContradictionOptions = {},
): Promise<ContradictionResult> {
  if (pairs.length === 0) return { findings: [], status: 'ok', rejectedCount: 0 }

  const minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE

  const perPair = await mapWithLimit(pairs, opts.concurrency ?? DEFAULT_CONCURRENCY, async (pair) => {
    try {
      const raw = await provider.complete({
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(pair),
        schema: CONTRADICTION_SCHEMA,
        maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      })
      return { ok: true, ...verifyPair(raw, pair, minConfidence) }
    } catch (error) {
      opts.onPairError?.(pair, error)
      return { ok: false, accepted: [] as TraceFinding[], rejected: 0 }
    }
  })

  const succeeded = perPair.filter((result) => result.ok).length
  const merged = new Map<string, TraceFinding>()
  for (const result of perPair) {
    for (const found of result.accepted) {
      const existing = merged.get(found.id)
      if (existing === undefined || found.confidence > existing.confidence) merged.set(found.id, found)
    }
  }

  return {
    findings: sortTraceFindings([...merged.values()]),
    status: succeeded === pairs.length ? 'ok' : succeeded === 0 ? 'failed' : 'partial',
    rejectedCount: perPair.reduce((n, result) => n + result.rejected, 0),
  }
}
