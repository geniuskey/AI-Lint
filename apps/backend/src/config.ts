import { z } from 'zod'

/** `{"x-dept-code":"AI-PLATFORM"}` 형태의 JSON. 헤더 값에 콤마가 들어갈 수 있어 k=v 목록은 쓰지 않는다. */
const HeaderMap = z.string().transform((raw, ctx): Record<string, string> => {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'JSON으로 읽을 수 없습니다' })
    return z.NEVER
  }

  const record = z.record(z.string()).safeParse(parsed)
  if (!record.success) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '문자열 값만 가진 JSON 객체여야 합니다' })
    return z.NEVER
  }
  return record.data
})

const EnvSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(8787),
    HOST: z.string().min(1).default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    /** 확장·데스크톱 앱이 x-ai-lint-token으로 보내는 값. 짧으면 무차별 대입에 노출된다. */
    SERVICE_TOKEN: z.string().min(16),
    LLM_PROVIDER: z.enum(['openai', 'gemini']).default('openai'),
    /** OpenAI 호환 엔드포인트. `/chat/completions` 앞부분까지. */
    LLM_BASE_URL: z.string().url().optional(),
    LLM_MODEL: z.string().min(1).optional(),
    LLM_API_KEY: z.string().min(1).optional(),
    LLM_AUTH_HEADER: z.string().min(1).optional(),
    /** 지정하지 않으면 Authorization에만 Bearer가 붙고 커스텀 헤더에는 토큰만 실린다. */
    LLM_AUTH_SCHEME: z.string().min(1).optional(),
    LLM_HEADERS: HeaderMap.optional(),
    LLM_RESPONSE_FORMAT: z.enum(['json_schema', 'json_object']).default('json_schema'),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    GEMINI_API_KEY: z.string().min(1).optional(),
    GEMINI_MODEL: z.string().min(1).optional(),
    DATABASE_URL: z.string().min(1).optional(),
    LLM_MAX_DOC_CHARS: z.coerce.number().int().positive().default(200_000),
    LLM_DAILY_LIMIT_PER_USER: z.coerce.number().int().nonnegative().default(200),
    MAX_BLOCKS: z.coerce.number().int().positive().default(2000),
  })
  .superRefine((env, ctx) => {
    const require = (path: string, present: unknown) => {
      if (present) return
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: `LLM_PROVIDER=${env.LLM_PROVIDER}일 때 필요합니다` })
    }

    if (env.LLM_PROVIDER === 'openai') {
      require('LLM_BASE_URL', env.LLM_BASE_URL)
      require('LLM_MODEL', env.LLM_MODEL)
    } else require('GEMINI_API_KEY', env.GEMINI_API_KEY)
  })

export type Config = z.infer<typeof EnvSchema>

/**
 * 부팅 시 한 번 호출한다. 설정이 틀렸으면 요청을 받기 전에 죽는 편이 낫다.
 *
 * 빈 문자열은 없는 것으로 본다. docker compose의 `${VAR:-}`가 쓰지 않는 변수까지
 * 빈 값으로 채워 넣기 때문에, 그대로 두면 안 쓰는 provider의 설정이 검증에 걸린다.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''))
  const parsed = EnvSchema.safeParse(present)
  if (parsed.success) return parsed.data

  const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')
  throw new Error(`환경변수 설정이 올바르지 않습니다 — ${detail}`)
}
