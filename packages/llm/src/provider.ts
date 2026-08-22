/** Gemini의 responseSchema로 그대로 넘길 수 있는 JSON Schema 조각. */
export type JsonSchema = Record<string, unknown>

export interface CompletionRequest {
  system: string
  user: string
  schema: JsonSchema
  maxTokens: number
  temperature?: number
}

export interface LlmProvider {
  name: string
  complete(req: CompletionRequest): Promise<unknown>
}

export type LlmErrorKind = 'auth' | 'rate-limit' | 'timeout' | 'invalid-response' | 'unknown'

export class LlmError extends Error {
  readonly kind: LlmErrorKind

  constructor(message: string, kind: LlmErrorKind, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'LlmError'
    this.kind = kind
  }
}

const statusOf = (e: unknown): number | undefined => {
  if (typeof e !== 'object' || e === null) return undefined
  const record = e as Record<string, unknown>
  for (const key of ['status', 'statusCode', 'code']) {
    const value = record[key]
    if (typeof value === 'number') return value
  }
  return undefined
}

/** SDK가 던지는 잡다한 에러를 처리 가능한 분류로 좁힌다. 백엔드는 이 kind만 보고 응답을 정한다. */
export function toLlmError(e: unknown): LlmError {
  if (e instanceof LlmError) return e

  const message = e instanceof Error ? e.message : String(e)
  const status = statusOf(e)

  if (e instanceof SyntaxError) return new LlmError(`응답을 JSON으로 읽지 못했습니다: ${message}`, 'invalid-response', { cause: e })
  if (status === 401 || status === 403 || /api key|unauthorized|permission denied/i.test(message))
    return new LlmError(`LLM 인증에 실패했습니다: ${message}`, 'auth', { cause: e })
  if (status === 429 || /rate limit|quota|resource_exhausted/i.test(message))
    return new LlmError(`LLM 호출 한도를 초과했습니다: ${message}`, 'rate-limit', { cause: e })
  if (status === 504 || /timeout|timed out|deadline/i.test(message))
    return new LlmError(`LLM 응답이 시간 내에 오지 않았습니다: ${message}`, 'timeout', { cause: e })

  return new LlmError(`LLM 호출에 실패했습니다: ${message}`, 'unknown', { cause: e })
}
