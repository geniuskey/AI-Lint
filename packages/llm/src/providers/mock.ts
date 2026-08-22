import { LlmError, type CompletionRequest, type LlmProvider } from '../provider.js'

export interface MockProvider extends LlmProvider {
  calls: CompletionRequest[]
}

/**
 * 미리 준비한 응답을 호출 순서대로 돌려주는 provider.
 * 응답 자리에 Error를 넣으면 그 차례에 던진다 — 실패 경로 테스트용.
 */
export function createMockProvider(responses: unknown[]): MockProvider {
  const queue = [...responses]
  const calls: CompletionRequest[] = []

  return {
    name: 'mock',
    calls,
    async complete(req) {
      calls.push(req)
      if (queue.length === 0) throw new LlmError(`목 응답이 소진되었습니다 (호출 ${calls.length}회)`, 'unknown')
      const next = queue.shift()
      if (next instanceof Error) throw next
      return next
    },
  }
}
