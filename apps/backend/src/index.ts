import { createGeminiProvider } from '@ai-lint/llm'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'

const config = loadConfig()

const app = buildApp({
  provider: createGeminiProvider({
    apiKey: config.GEMINI_API_KEY,
    ...(config.GEMINI_MODEL ? { model: config.GEMINI_MODEL } : {}),
  }),
  serviceToken: config.SERVICE_TOKEN,
  limits: { maxBlocks: config.MAX_BLOCKS, llmMaxDocChars: config.LLM_MAX_DOC_CHARS },
  logLevel: config.LOG_LEVEL,
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0))
  })
}

await app.listen({ port: config.PORT, host: config.HOST })
