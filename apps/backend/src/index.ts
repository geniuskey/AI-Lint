import { createGeminiProvider } from '@ai-lint/llm'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { createPool } from './db/client.js'
import { migrate } from './db/migrate.js'
import { createPgQuota, createUnlimitedQuota } from './services/quota.js'
import { createMemoryStore, createPgStore } from './services/report-store.js'
import { createMemoryTraceIndex, createPgTraceIndex } from './services/trace-index.js'

const config = loadConfig()

const persistence = await (async () => {
  if (!config.DATABASE_URL) {
    return {
      store: createMemoryStore(),
      quota: createUnlimitedQuota(),
      traceIndex: createMemoryTraceIndex(),
      close: async () => {},
    }
  }
  const pool = createPool(config.DATABASE_URL)
  await migrate(pool)
  return {
    store: createPgStore(pool),
    quota: createPgQuota(pool, config.LLM_DAILY_LIMIT_PER_USER),
    traceIndex: createPgTraceIndex(pool),
    close: () => pool.end(),
  }
})()

const app = buildApp({
  provider: createGeminiProvider({
    apiKey: config.GEMINI_API_KEY,
    ...(config.GEMINI_MODEL ? { model: config.GEMINI_MODEL } : {}),
  }),
  serviceToken: config.SERVICE_TOKEN,
  store: persistence.store,
  quota: persistence.quota,
  traceIndex: persistence.traceIndex,
  limits: { maxBlocks: config.MAX_BLOCKS, llmMaxDocChars: config.LLM_MAX_DOC_CHARS },
  logLevel: config.LOG_LEVEL,
})

if (!config.DATABASE_URL) {
  app.log.warn('DATABASE_URL이 없어 리포트를 메모리에만 보관합니다. 재시작하면 사라집니다.')
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(persistence.close)
      .then(() => process.exit(0))
  })
}

await app.listen({ port: config.PORT, host: config.HOST })
