import { z } from 'zod'

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().min(1).default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** 확장·데스크톱 앱이 x-ai-lint-token으로 보내는 값. 짧으면 무차별 대입에 노출된다. */
  SERVICE_TOKEN: z.string().min(16),
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().min(1).optional(),
  DATABASE_URL: z.string().min(1).optional(),
  LLM_MAX_DOC_CHARS: z.coerce.number().int().positive().default(200_000),
  LLM_DAILY_LIMIT_PER_USER: z.coerce.number().int().nonnegative().default(200),
  MAX_BLOCKS: z.coerce.number().int().positive().default(2000),
})

export type Config = z.infer<typeof EnvSchema>

/** 부팅 시 한 번 호출한다. 설정이 틀렸으면 요청을 받기 전에 죽는 편이 낫다. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env)
  if (parsed.success) return parsed.data

  const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
  throw new Error(`환경변수 설정이 올바르지 않습니다 — ${detail}`)
}
