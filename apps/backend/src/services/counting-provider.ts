import type { LlmProvider } from '@ai-lint/llm'

/** 쿼터에 기록할 실제 호출 수를 센다. 요약·유형추론까지 포함해야 상한이 의미를 갖는다. */
export function countingProvider(provider: LlmProvider): { provider: LlmProvider; calls: () => number } {
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
