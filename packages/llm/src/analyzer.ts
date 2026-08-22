import type { Document } from '@ai-lint/ir'
import type { Finding, ResolvedRuleset } from '@ai-lint/rules'
import { planChunks, type Chunk } from './chunk.js'
import { buildGlobalContext, buildSystemPrompt, buildUserPrompt, SUMMARY_SYSTEM_PROMPT } from './prompt.js'
import type { LlmProvider } from './provider.js'
import { LLM_FINDING_SCHEMA } from './schema.js'
import { verifyFindings } from './verify.js'

export type AnalyzeStatus = 'ok' | 'partial' | 'failed'

export interface AnalyzeResult {
  findings: Finding[]
  status: AnalyzeStatus
  rejectedCount: number
  chunks: number
}

export interface AnalyzeOptions {
  maxChars?: number
  concurrency?: number
  minConfidence?: number
  maxTokens?: number
  onChunkError?: (index: number, error: unknown) => void
}

const DEFAULT_CONCURRENCY = 4
const DEFAULT_MAX_TOKENS = 4096
const SUMMARY_MAX_TOKENS = 512
const SUMMARY_MAX_INPUT_CHARS = 20000

/** 동시 실행 수를 제한하며 순서대로 결과를 모은다. LLM 쿼터를 한 문서가 독차지하지 않게 한다. */
async function mapWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** 청크가 여러 개일 때만 부른다. 하나면 LLM이 이미 전문을 보므로 요약이 필요 없다. */
async function summarize(doc: Document, chunks: Chunk[], provider: LlmProvider): Promise<string | undefined> {
  const text = chunks
    .map((c) => c.markdown)
    .join('\n\n')
    .slice(0, SUMMARY_MAX_INPUT_CHARS)

  try {
    const raw = await provider.complete({
      system: SUMMARY_SYSTEM_PROMPT,
      user: `제목: ${doc.title}\n\n${text}`,
      schema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      maxTokens: SUMMARY_MAX_TOKENS,
    })
    const summary = (raw as { summary?: unknown })?.summary
    return typeof summary === 'string' && summary.trim() ? summary.trim() : undefined
  } catch {
    // 요약은 있으면 좋은 보조 맥락이다. 실패해도 검사는 진행한다.
    return undefined
  }
}

/**
 * 문서를 청크로 나눠 LLM에 맥락 검사를 맡기고, 응답을 IR과 대조해 검증한다.
 * 어떤 경우에도 예외를 던지지 않는다 — 백엔드는 룰 결과만이라도 돌려줘야 한다.
 */
export async function analyzeContext(
  doc: Document,
  ruleset: ResolvedRuleset,
  provider: LlmProvider,
  opts: AnalyzeOptions = {},
): Promise<AnalyzeResult> {
  const chunkOpts = opts.maxChars === undefined ? {} : { maxChars: opts.maxChars }
  const chunks = planChunks(doc, chunkOpts)
  if (chunks.length === 0) return { findings: [], status: 'ok', rejectedCount: 0, chunks: 0 }

  const summary = chunks.length > 1 ? await summarize(doc, chunks, provider) : undefined
  const global = buildGlobalContext(doc, summary)
  const system = buildSystemPrompt(ruleset, doc.docType.value)
  const verifyOpts = opts.minConfidence === undefined ? {} : { minConfidence: opts.minConfidence }

  const perChunk = await mapWithLimit(chunks, opts.concurrency ?? DEFAULT_CONCURRENCY, async (chunk) => {
    try {
      const raw = await provider.complete({
        system,
        user: buildUserPrompt(chunk, global),
        schema: LLM_FINDING_SCHEMA,
        maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      })
      return { ok: true as const, ...verifyFindings(raw, doc, ruleset, verifyOpts) }
    } catch (error) {
      opts.onChunkError?.(chunk.index, error)
      return { ok: false as const, accepted: [] as Finding[], rejected: [] }
    }
  })

  const succeeded = perChunk.filter((r) => r.ok).length
  // 청크 경계에 걸친 블록이 여러 번 지적될 수 있다. 같은 (룰, 블록)이면 한 번만 남긴다.
  const merged = new Map<string, Finding>()
  for (const r of perChunk) {
    for (const f of r.accepted) {
      const existing = merged.get(f.id)
      if (!existing || f.confidence > existing.confidence) merged.set(f.id, f)
    }
  }

  return {
    findings: [...merged.values()],
    status: succeeded === chunks.length ? 'ok' : succeeded === 0 ? 'failed' : 'partial',
    rejectedCount: perChunk.reduce((n, r) => n + r.rejected.length, 0),
    chunks: chunks.length,
  }
}
