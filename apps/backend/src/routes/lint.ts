import type { FastifyPluginAsync } from 'fastify'
import { lintDocument, LintRequestSchema, type LintDeps } from '../services/lint-service.js'

export function lintRoutes(deps: LintDeps): FastifyPluginAsync {
  return async (app) => {
    app.post('/v1/lint', async (request) => {
      const { document, options } = LintRequestSchema.parse(request.body)
      return lintDocument(document, options, deps, request.userId)
    })
  }
}
