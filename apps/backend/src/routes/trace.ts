import { TraceRequestSchema } from '@ai-lint/contract'
import type { FastifyPluginAsync } from 'fastify'
import { analyzeTrace, type TraceDeps } from '../services/trace-service.js'

export function traceRoutes(deps: TraceDeps): FastifyPluginAsync {
  return async (app) => {
    app.post('/v1/trace/analyze', async (request) =>
      analyzeTrace(TraceRequestSchema.parse(request.body ?? {}), deps, request.userId),
    )
  }
}
