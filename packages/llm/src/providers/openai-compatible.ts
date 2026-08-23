import { LlmError, toLlmError, type JsonSchema, type LlmProvider } from '../provider.js'

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

/**
 * 구조화 출력을 요구하는 방식.
 * `json_schema`는 스키마를 그대로 넘기고, `json_object`는 JSON만 요구한 뒤 스키마를 시스템 지시에 싣는다.
 * 사내 라우터가 response_format.json_schema를 거부하면 후자로 내린다.
 */
export type ResponseFormatMode = 'json_schema' | 'json_object'

export interface OpenAiCompatibleOptions {
  /** `/chat/completions` 앞부분. 예: `https://llm.mycorp.com/v1` */
  baseUrl: string
  model: string
  apiKey?: string
  /** 토큰을 실을 헤더. 사내 라우터는 Authorization 대신 자체 헤더를 쓰는 경우가 많다. */
  authHeader?: string
  /** 토큰 앞에 붙는 스킴. 빈 문자열이면 토큰만 보낸다. */
  authScheme?: string
  /** 라우터가 요구하는 필수 헤더들. */
  headers?: Record<string, string>
  responseFormat?: ResponseFormatMode
  timeoutMs?: number
  /** 테스트에서 갈아끼우기 위한 훅. 운영에서는 쓰지 않는다. */
  fetch?: FetchLike
}

export const DEFAULT_AUTH_HEADER = 'Authorization'
export const DEFAULT_TIMEOUT_MS = 60_000

/** Authorization에만 Bearer를 붙인다. 자체 헤더에 Bearer를 붙이는 라우터는 드물다. */
const defaultScheme = (header: string): string => (header.toLowerCase() === 'authorization' ? 'Bearer' : '')

/** OpenAPI 방언인 `nullable: true`를 표준 JSON Schema union 타입으로 바꾼다. */
export function normalizeJsonSchema(schema: JsonSchema): JsonSchema {
  return walk(schema) as JsonSchema
}

function walk(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(walk)
  if (typeof node !== 'object' || node === null) return node

  const { nullable, ...rest } = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rest)) out[key] = walk(value)
  if (nullable === true && typeof out.type === 'string') out.type = [out.type, 'null']
  return out
}

const FENCED = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/

/** 일부 모델은 JSON을 코드 펜스로 감싸 보낸다. */
function parseContent(text: string): unknown {
  const fenced = FENCED.exec(text)
  return JSON.parse(fenced ? fenced[1]! : text)
}

function contentOf(body: unknown): string {
  const message = (body as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content

  if (typeof message === 'string') return message
  // 일부 라우터는 content를 파트 배열로 돌려준다.
  if (Array.isArray(message)) {
    return message
      .map((part) => (typeof part === 'object' && part !== null ? String((part as { text?: unknown }).text ?? '') : ''))
      .join('')
  }
  return ''
}

export function createOpenAiCompatibleProvider(opts: OpenAiCompatibleOptions): LlmProvider {
  const endpoint = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const authHeader = opts.authHeader ?? DEFAULT_AUTH_HEADER
  const scheme = opts.authScheme ?? defaultScheme(authHeader)
  const mode: ResponseFormatMode = opts.responseFormat ?? 'json_schema'
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const doFetch = opts.fetch ?? ((input, init) => fetch(input, init))

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...opts.headers,
    ...(opts.apiKey ? { [authHeader]: scheme ? `${scheme} ${opts.apiKey}` : opts.apiKey } : {}),
  }

  return {
    name: `openai:${opts.model}`,
    async complete(req) {
      const schema = normalizeJsonSchema(req.schema)
      const system =
        mode === 'json_schema'
          ? req.system
          : `${req.system}\n\n응답은 다음 JSON Schema를 만족하는 JSON 객체 하나여야 합니다. 다른 텍스트를 덧붙이지 마십시오.\n${JSON.stringify(schema)}`

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const res = await doFetch(endpoint, {
          method: 'POST',
          headers,
          signal: controller.signal,
          body: JSON.stringify({
            model: opts.model,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: req.user },
            ],
            temperature: req.temperature ?? 0.2,
            max_tokens: req.maxTokens,
            response_format:
              mode === 'json_schema'
                ? { type: 'json_schema', json_schema: { name: 'ai_lint_result', schema } }
                : { type: 'json_object' },
          }),
        })

        if (!res.ok) {
          const detail = await res.text().catch(() => '')
          throw Object.assign(new Error(`LLM이 ${res.status}를 반환했습니다${detail ? ` — ${detail.slice(0, 500)}` : ''}`), {
            status: res.status,
          })
        }

        const text = contentOf(await res.json())
        if (!text) throw new LlmError('LLM이 빈 응답을 반환했습니다', 'invalid-response')
        return parseContent(text)
      } catch (e) {
        if (controller.signal.aborted) throw new LlmError(`LLM 응답이 ${timeoutMs}ms 안에 오지 않았습니다`, 'timeout', { cause: e })
        throw toLlmError(e)
      } finally {
        clearTimeout(timer)
      }
    },
  }
}
