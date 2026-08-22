import { DocTypeSchema } from '@ai-lint/ir'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { ReportStore } from '../services/report-store.js'

const OverrideSchema = z.object({
  uri: z.string().min(1),
  docType: DocTypeSchema,
})

export function doctypeRoutes(store: ReportStore): FastifyPluginAsync {
  return async (app) => {
    app.post('/v1/doctype-overrides', async (request, reply) => {
      const { uri, docType } = OverrideSchema.parse(request.body)
      await store.setDocTypeOverride(uri, docType, request.userId)
      return reply.code(201).send({ uri, docType })
    })

    app.get('/v1/doctype-overrides', async (request) => {
      const { uri } = z.object({ uri: z.string().min(1) }).parse(request.query)
      return { uri, docType: await store.getDocTypeOverride(uri) }
    })
  }
}
