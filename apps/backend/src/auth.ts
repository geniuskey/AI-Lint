import { timingSafeEqual } from 'node:crypto'
import type { onRequestAsyncHookHandler } from 'fastify'

declare module 'fastify' {
  interface FastifyRequest {
    userId: string
  }
}

/** 로드밸런서 헬스체크가 토큰을 들고 다닐 이유가 없다. */
const PUBLIC_PATHS = new Set(['/v1/health'])

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  // 길이가 다르면 timingSafeEqual이 던진다. 길이 자체는 비밀이 아니므로 먼저 거른다.
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function createAuthHook(serviceToken: string): onRequestAsyncHookHandler {
  return async function authenticate(request, reply) {
    const path = request.url.split('?')[0] ?? request.url
    if (PUBLIC_PATHS.has(path)) return

    const token = request.headers['x-ai-lint-token']
    if (typeof token !== 'string' || !safeEqual(token, serviceToken)) {
      return reply.code(401).send({ error: '유효한 서비스 토큰이 필요합니다.' })
    }

    const user = request.headers['x-ai-lint-user']
    request.userId = typeof user === 'string' && user.trim() ? user.trim() : 'anonymous'
  }
}
