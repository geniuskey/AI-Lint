import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { ReportStore } from '../services/report-store.js'

const ListQuerySchema = z.object({
  uri: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

export function reportsRoutes(store: ReportStore): FastifyPluginAsync {
  return async (app) => {
    app.get('/v1/reports', async (request) => {
      const { uri, limit } = ListQuerySchema.parse(request.query)
      return { reports: await store.listByUri(uri, limit) }
    })
  }
}
