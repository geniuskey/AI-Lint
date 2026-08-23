import type { CompletionRequest, LlmProvider } from '@ai-lint/llm'
import { describe, expect, it } from 'vitest'
import { analyzeContradictions, selectPairs } from '../src/contradiction.js'
import type { DocIndexEntry } from '../src/entry.js'
import { buildGraph } from '../src/graph.js'
import type { IdKind } from '../src/ids.js'

const mention = (id: string, snippet: string, kind: IdKind = 'requirement') => ({
  id, kind, blockId: 'b1', defining: false, snippet,
})

const entryOf = (uri: string, mentions: DocIndexEntry['mentions']): DocIndexEntry => ({
  uri,
  title: uri,
  docType: 'design',
  documentHash: 'h',
  modifiedAt: null,
  mentions,
  linksTo: [],
})

const providerOf = (reply: unknown): LlmProvider & { seen: CompletionRequest[] } => {
  const seen: CompletionRequest[] = []
  return {
    seen,
    name: 'mock',
    async complete(req) {
      seen.push(req)
      if (typeof reply === 'function') return (reply as () => unknown)()
      return reply
    },
  }
}

describe('selectPairs', () => {
  it('ID를 공유하는 쌍만 고른다', () => {
    const graph = buildGraph([
      entryOf('a', [mention('REQ-1', 'REQ-1 한도는 100이다')]),
      entryOf('b', [mention('REQ-1', 'REQ-1 한도는 200이다')]),
      entryOf('c', [mention('REQ-9', 'REQ-9는 별개다')]),
    ])
    const { pairs } = selectPairs(graph, 10)

    expect(pairs).toHaveLength(1)
    expect([pairs[0]?.a.uri, pairs[0]?.b.uri]).toEqual(['a', 'b'])
    expect(pairs[0]?.sharedIds).toEqual(['REQ-1'])
  })

  it('공유 ID가 많은 쌍을 앞에 놓는다', () => {
    const graph = buildGraph([
      entryOf('c', [mention('REQ-1', 'x')]),
      entryOf('a', [mention('REQ-1', 'x'), mention('REQ-2', 'y')]),
      entryOf('b', [mention('REQ-1', 'x'), mention('REQ-2', 'y')]),
    ])
    const { pairs } = selectPairs(graph, 10)

    expect([pairs[0]?.a.uri, pairs[0]?.b.uri]).toEqual(['a', 'b'])
    expect(pairs[0]?.sharedIds).toEqual(['REQ-1', 'REQ-2'])
  })

  it('상한을 넘으면 자르고 원래 수를 알려준다', () => {
    const graph = buildGraph([
      entryOf('a', [mention('REQ-1', 'x')]),
      entryOf('b', [mention('REQ-1', 'x')]),
      entryOf('c', [mention('REQ-1', 'x')]),
    ])
    const { pairs, considered } = selectPairs(graph, 1)

    expect(pairs).toHaveLength(1)
    expect(considered).toBe(3)
  })

  it('공유하는 문서가 없으면 빈 목록이다', () => {
    expect(selectPairs(buildGraph([entryOf('a', [mention('REQ-1', 'x')])]), 10).pairs).toEqual([])
  })
})

describe('analyzeContradictions', () => {
  const graph = buildGraph([
    entryOf('a', [mention('REQ-1', 'REQ-1 결제 한도는 100만원이다')]),
    entryOf('b', [mention('REQ-1', 'REQ-1 결제 한도는 200만원이다')]),
  ])
  const { pairs } = selectPairs(graph, 10)

  const candidate = (over: Record<string, unknown> = {}) => ({
    contradictions: [
      {
        subjectId: 'REQ-1',
        quoteA: '결제 한도는 100만원이다',
        quoteB: '결제 한도는 200만원이다',
        why: '같은 요구사항의 한도가 다릅니다',
        confidence: 0.9,
        ...over,
      },
    ],
  })

  it('근거가 원문에 있으면 지적으로 채택한다', async () => {
    const result = await analyzeContradictions(pairs, providerOf(candidate()))

    expect(result.status).toBe('ok')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      ruleId: 'TRC006',
      severity: 'error',
      source: 'llm',
      subjectId: 'REQ-1',
      confidence: 0.9,
    })
    expect(result.findings[0]?.documents.map((d) => d.uri)).toEqual(['a', 'b'])
    expect(result.findings[0]?.evidence).toContain('100만원')
  })

  it('원문에 없는 근거는 버린다', async () => {
    const result = await analyzeContradictions(pairs, providerOf(candidate({ quoteA: '한도는 무제한이다' })))

    expect(result.findings).toHaveLength(0)
    expect(result.rejectedCount).toBe(1)
  })

  it('신뢰도가 낮으면 버린다', async () => {
    const result = await analyzeContradictions(pairs, providerOf(candidate({ confidence: 0.2 })))
    expect(result.findings).toHaveLength(0)
  })

  it('모양이 어긋난 응답은 버린다', async () => {
    const result = await analyzeContradictions(pairs, providerOf({ contradictions: [{ subjectId: 'REQ-1' }] }))
    expect(result.findings).toHaveLength(0)
    expect(result.rejectedCount).toBe(1)
  })

  it('LLM이 죽어도 던지지 않고 failed로 알린다', async () => {
    const result = await analyzeContradictions(
      pairs,
      providerOf(() => {
        throw new Error('boom')
      }),
    )

    expect(result.status).toBe('failed')
    expect(result.findings).toEqual([])
  })

  it('공유 ID의 발췌만 프롬프트에 넣는다', async () => {
    const wide = buildGraph([
      entryOf('a', [mention('REQ-1', 'REQ-1 한도 100'), mention('REQ-7', '비밀번호 규칙')]),
      entryOf('b', [mention('REQ-1', 'REQ-1 한도 200')]),
    ])
    const provider = providerOf({ contradictions: [] })

    await analyzeContradictions(selectPairs(wide, 10).pairs, provider)

    expect(provider.seen[0]?.user).toContain('REQ-1 한도 100')
    expect(provider.seen[0]?.user).not.toContain('비밀번호 규칙')
  })

  it('쌍이 없으면 LLM을 부르지 않는다', async () => {
    const provider = providerOf({ contradictions: [] })
    const result = await analyzeContradictions([], provider)

    expect(provider.seen).toHaveLength(0)
    expect(result.status).toBe('ok')
  })
})
