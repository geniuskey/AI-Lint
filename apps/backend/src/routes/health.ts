import type { FastifyPluginAsync } from 'fastify'

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/v1/health', async () => ({ status: 'ok' }))
}
