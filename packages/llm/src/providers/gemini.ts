import { GoogleGenAI } from '@google/genai'
import { LlmError, toLlmError, type LlmProvider } from '../provider.js'

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash'

export interface GeminiOptions {
  apiKey: string
  model?: string
  /** 테스트에서 SDK를 갈아끼우기 위한 훅. 운영에서는 쓰지 않는다. */
  client?: Pick<GoogleGenAI, 'models'>
}

export function createGeminiProvider(opts: GeminiOptions): LlmProvider {
  const client = opts.client ?? new GoogleGenAI({ apiKey: opts.apiKey })
  const model = opts.model ?? DEFAULT_GEMINI_MODEL

  return {
    name: `gemini:${model}`,
    async complete(req) {
      try {
        const res = await client.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: req.user }] }],
          config: {
            systemInstruction: req.system,
            responseMimeType: 'application/json',
            responseSchema: req.schema,
            maxOutputTokens: req.maxTokens,
            temperature: req.temperature ?? 0.2,
          },
        })

        const text = res.text
        if (!text) throw new LlmError('LLM이 빈 응답을 반환했습니다', 'invalid-response')
        return JSON.parse(text)
      } catch (e) {
        throw toLlmError(e)
      }
    },
  }
}
