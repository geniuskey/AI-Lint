import { createGeminiProvider, createOpenAiCompatibleProvider, type LlmProvider } from '@ai-lint/llm'
import type { Config } from './config.js'

/** 설정 검증은 loadConfig의 superRefine이 끝냈다. 여기서는 값이 있다고 보고 조립만 한다. */
export function createProvider(config: Config): LlmProvider {
  if (config.LLM_PROVIDER === 'gemini') {
    return createGeminiProvider({
      apiKey: config.GEMINI_API_KEY!,
      ...(config.GEMINI_MODEL ? { model: config.GEMINI_MODEL } : {}),
    })
  }

  return createOpenAiCompatibleProvider({
    baseUrl: config.LLM_BASE_URL!,
    model: config.LLM_MODEL!,
    responseFormat: config.LLM_RESPONSE_FORMAT,
    timeoutMs: config.LLM_TIMEOUT_MS,
    ...(config.LLM_API_KEY ? { apiKey: config.LLM_API_KEY } : {}),
    ...(config.LLM_AUTH_HEADER ? { authHeader: config.LLM_AUTH_HEADER } : {}),
    ...(config.LLM_AUTH_SCHEME === undefined ? {} : { authScheme: config.LLM_AUTH_SCHEME }),
    ...(config.LLM_HEADERS ? { headers: config.LLM_HEADERS } : {}),
  })
}
