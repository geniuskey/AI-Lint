import { describe, it, expect } from 'vitest'
import { DEFAULT_RULESET } from '@ai-lint/rules'
import { analyzeContext } from '../src/analyzer.js'
import { LlmError, type CompletionRequest, type LlmProvider } from '../src/provider.js'
import { createMockProvider } from '../src/providers/mock.js'
import { heading, makeDoc, para } from './helpers.js'

const filler = (n: number) => '가'.repeat(n)

const doc = makeDoc([para('p1', '지난번 논의대로 3단계로 나눠서 진행하기로 했습니다.')])

const longDoc = makeDoc(
  Array.from({ length: 6 }, (_, i) => [
    heading(`h${i}`, 2, `섹션 ${i}`),
    para(`p${i}`, `${filler(400)} 지난번 논의대로`),
  ]).flat(),
)

const ctx = (blockId: string, evidence: string, confidence = 0.9) => ({
  ruleId: 'CTX001',
  blockId,
  evidence,
  why: '어떤 논의인지 문서에 없습니다.',
  suggestion: null,
  confidence,
})

/** 지정한 청크 호출에서만 실패하는 provider. 첫 호출은 요약이므로 성공시킨다. */
function createFlakyProvider(failAtChunk: number[]): LlmProvider & { calls: CompletionRequest[] } {
  const calls: CompletionRequest[] = []
  let chunkCall = -1

  return {
    name: 'flaky',
    calls,
    async complete(req) {
      calls.push(req)
      if (req.system.includes('요약하십시오')) return { summary: '결제 모듈 개편 문서입니다.' }
      chunkCall++
      if (failAtChunk.includes(chunkCall)) throw new LlmError('일시 오류', 'unknown')
      return { findings: [ctx(`p${chunkCall}`, '지난번 논의대로')] }
    },
  }
}

function createConcurrencyTrackingProvider(): LlmProvider & { maxObserved: number } {
  let active = 0
  const provider = {
    name: 'tracker',
    maxObserved: 0,
    async complete(req: CompletionRequest) {
      active++
      provider.maxObserved = Math.max(provider.maxObserved, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return req.system.includes('요약하십시오') ? { summary: '요약' } : { findings: [] }
    },
  }
  return provider
}

describe('analyzeContext', () => {
  it('검증을 통과한 finding만 반환한다', async () => {
    const provider = createMockProvider([
      { findings: [ctx('p1', '지난번 논의대로'), ctx('p1', '존재하지 않는 인용')] },
    ])
    const r = await analyzeContext(doc, DEFAULT_RULESET, provider)
    expect(r.findings).toHaveLength(1)
    expect(r.rejectedCount).toBe(1)
    expect(r.status).toBe('ok')
    expect(r.chunks).toBe(1)
  })

  it('청크가 하나면 요약 호출을 하지 않는다', async () => {
    const provider = createMockProvider([{ findings: [] }])
    await analyzeContext(doc, DEFAULT_RULESET, provider)
    expect(provider.calls).toHaveLength(1)
    expect(provider.calls[0]!.system).not.toContain('요약하십시오')
  })

  it('청크가 여럿이면 요약을 만들어 전역 맥락에 넣는다', async () => {
    const provider = createFlakyProvider([])
    await analyzeContext(longDoc, DEFAULT_RULESET, provider, { maxChars: 1000 })
    expect(provider.calls[0]!.system).toContain('요약하십시오')
    expect(provider.calls[1]!.user).toContain('요약: 결제 모듈 개편 문서입니다.')
  })

  it('청크 일부가 실패해도 성공한 청크 결과를 반환하고 partial을 표시한다', async () => {
    const provider = createFlakyProvider([1])
    const r = await analyzeContext(longDoc, DEFAULT_RULESET, provider, { maxChars: 1000, concurrency: 1 })
    expect(r.status).toBe('partial')
    expect(r.findings.length).toBeGreaterThan(0)
  })

  it('모든 청크가 실패하면 failed를 반환하고 예외를 던지지 않는다', async () => {
    const provider: LlmProvider = {
      name: 'always-fail',
      async complete() {
        throw new LlmError('죽음', 'unknown')
      },
    }
    const r = await analyzeContext(doc, DEFAULT_RULESET, provider)
    expect(r.status).toBe('failed')
    expect(r.findings).toHaveLength(0)
  })

  it('실패한 청크를 콜백으로 알린다', async () => {
    const seen: number[] = []
    const provider = createFlakyProvider([0])
    await analyzeContext(longDoc, DEFAULT_RULESET, provider, {
      maxChars: 1000,
      concurrency: 1,
      onChunkError: (i) => seen.push(i),
    })
    expect(seen).toEqual([0])
  })

  it('여러 청크에 걸친 동일 finding을 중복 제거한다', async () => {
    const provider: LlmProvider = {
      name: 'dup',
      async complete(req) {
        if (req.system.includes('요약하십시오')) return { summary: '요약' }
        return { findings: [ctx('p0', '지난번 논의대로', 0.8)] }
      },
    }
    const r = await analyzeContext(longDoc, DEFAULT_RULESET, provider, { maxChars: 1000 })
    expect(r.chunks).toBeGreaterThan(1)
    expect(r.findings).toHaveLength(1)
  })

  it('동시 호출 수를 제한한다', async () => {
    const provider = createConcurrencyTrackingProvider()
    await analyzeContext(longDoc, DEFAULT_RULESET, provider, { maxChars: 500, concurrency: 2 })
    expect(provider.maxObserved).toBeLessThanOrEqual(2)
  })

  it('프롬프트에 비활성 룰을 포함시키지 않는다', async () => {
    const provider = createMockProvider([{ findings: [] }])
    const rs = {
      ...DEFAULT_RULESET,
      rules: { ...DEFAULT_RULESET.rules, CTX006: { ...DEFAULT_RULESET.rules.CTX006!, enabled: false } },
    }
    await analyzeContext(doc, rs, provider)
    expect(provider.calls[0]!.system).not.toContain('CTX006')
    expect(provider.calls[0]!.system).toContain('CTX001')
  })

  it('문서 유형에 맞지 않는 룰을 프롬프트에서 뺀다', async () => {
    const provider = createMockProvider([{ findings: [] }])
    await analyzeContext(makeDoc([para('p1', 'x')], { docType: 'guide' }), DEFAULT_RULESET, provider)
    expect(provider.calls[0]!.system).not.toContain('CTX007')
  })

  it('블록이 없으면 LLM을 부르지 않는다', async () => {
    const provider = createMockProvider([])
    const r = await analyzeContext(makeDoc([]), DEFAULT_RULESET, provider)
    expect(r).toEqual({ findings: [], status: 'ok', rejectedCount: 0, chunks: 0 })
    expect(provider.calls).toHaveLength(0)
  })

  it('minConfidence를 검증기로 전달한다', async () => {
    const provider = createMockProvider([{ findings: [ctx('p1', '지난번 논의대로', 0.4)] }])
    const r = await analyzeContext(doc, DEFAULT_RULESET, provider, { minConfidence: 0.3 })
    expect(r.findings).toHaveLength(1)
  })
})
