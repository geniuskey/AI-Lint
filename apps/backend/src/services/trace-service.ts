import { randomUUID } from 'node:crypto'
import type { LlmSkipReason, TraceReport, TraceRequest } from '@ai-lint/contract'
import type { LlmProvider } from '@ai-lint/llm'
import {
  analyzeContradictions,
  buildGraph,
  runTraceChecks,
  selectPairs,
  sortTraceFindings,
  type TraceConfig,
} from '@ai-lint/trace'
import { countingProvider } from './counting-provider.js'
import type { QuotaService } from './quota.js'
import type { TraceIndexStore } from './trace-index.js'

export interface TraceDeps {
  provider: LlmProvider
  index: TraceIndexStore
  quota: QuotaService
  config: TraceConfig
  now: () => Date
}

const EMPTY_STATS = { pairsConsidered: 0, pairsAnalyzed: 0, llmFindingsRejected: 0 }

/**
 * 결정적 판정이 먼저 나오고, LLM 대조는 그 위에 얹는다.
 * LLM이 죽거나 쿼터가 막혀도 그래프 판정은 반드시 나간다.
 */
export async function analyzeTrace(
  request: TraceRequest,
  deps: TraceDeps,
  userId: string,
): Promise<TraceReport> {
  const startedAt = Date.now()

  const entries = await deps.index.all()
  const graph = buildGraph(entries)
  let findings = runTraceChecks(graph)

  const skipReason = await resolveSkipReason(request, deps, userId)
  const selection = skipReason === undefined ? selectPairs(graph, deps.config.maxPairs) : null

  let stats = { ...EMPTY_STATS }
  let llmStatus: TraceReport['llmStatus'] = 'skipped'

  if (selection !== null) {
    const counted = countingProvider(deps.provider)
    const result = await analyzeContradictions(selection.pairs, counted.provider)
    if (counted.calls() > 0) await deps.quota.record(userId, counted.calls())

    findings = sortTraceFindings([...findings, ...result.findings])
    llmStatus = result.status
    stats = {
      pairsConsidered: selection.considered,
      pairsAnalyzed: selection.pairs.length,
      llmFindingsRejected: result.rejectedCount,
    }
  }

  return {
    reportId: randomUUID(),
    documentCount: await deps.index.count(),
    idCount: graph.kinds.size,
    findings,
    stats: { ...stats, durationMs: Date.now() - startedAt },
    llmStatus,
    ...(skipReason ? { llmSkipReason: skipReason } : {}),
    truncated: stats.pairsConsidered > stats.pairsAnalyzed,
    createdAt: deps.now().toISOString(),
  }
}

async function resolveSkipReason(
  request: TraceRequest,
  deps: TraceDeps,
  userId: string,
): Promise<LlmSkipReason | undefined> {
  if (!request.useLlm) return 'disabled'
  if (!(await deps.quota.check(userId)).allowed) return 'quota'
  return undefined
}
