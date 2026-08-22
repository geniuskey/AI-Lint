import { LlmError, type LlmProvider } from '@ai-lint/llm'
import { defaultRegistry, type RuleRegistry } from '@ai-lint/rules'
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { ZodError } from 'zod'
import { createAuthHook } from './auth.js'
import { HttpError } from './errors.js'
import { healthRoutes } from './routes/health.js'
import { lintRoutes } from './routes/lint.js'
import { rulesRoutes } from './routes/rules.js'
import { DEFAULT_LIMITS, type Limits, type LintDeps } from './services/lint-service.js'
import { createMemoryRulesetSource, type RulesetSource } from './services/ruleset-source.js'

export interface AppDeps {
  provider: LlmProvider
  serviceToken: string
  rulesets?: RulesetSource
  registry?: RuleRegistry
  limits?: Partial<Limits>
  now?: () => Date
  logLevel?: string
}

/** IR 전체가 한 요청에 들어온다. 슬라이드가 많은 PPTX는 기본 1MB를 쉽게 넘는다. */
const BODY_LIMIT = 32 * 1024 * 1024

const formatZodError = (error: ZodError): string =>
  error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')

function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply): FastifyReply {
  if (error instanceof ZodError) {
    return reply.code(400).send({ error: formatZodError(error) })
  }
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ error: error.message })
  }
  if (error instanceof LlmError) {
    return reply.code(502).send({ error: `LLM 호출에 실패했습니다 (${error.kind})` })
  }
  if (typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500) {
    return reply.code(error.statusCode).send({ error: error.message })
  }

  // 스택과 내부 메시지는 로그에만 남긴다.
  request.log.error({ err: error }, '처리하지 못한 오류')
  return reply.code(500).send({ error: '서버 내부 오류가 발생했습니다.' })
}

/**
 * 목 provider와 인메모리 규칙셋만으로 앱 전체를 띄울 수 있어야 테스트가 라우트를 통째로 검증할 수 있다.
 * 그래서 buildApp은 의존성을 주입받는 팩토리다.
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: deps.logLevel ? { level: deps.logLevel } : false,
    bodyLimit: BODY_LIMIT,
  })

  const lintDeps: LintDeps = {
    provider: deps.provider,
    rulesets: deps.rulesets ?? createMemoryRulesetSource(),
    registry: deps.registry ?? defaultRegistry,
    limits: { ...DEFAULT_LIMITS, ...deps.limits },
    now: deps.now ?? (() => new Date()),
  }

  app.decorateRequest('userId', 'anonymous')
  app.addHook('onRequest', createAuthHook(deps.serviceToken))

  app.setErrorHandler(errorHandler)

  app.register(healthRoutes)
  app.register(rulesRoutes(lintDeps.rulesets))
  app.register(lintRoutes(lintDeps))

  return app
}
