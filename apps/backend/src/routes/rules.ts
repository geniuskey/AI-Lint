import { docsUrlFor, RULE_IDS, RULE_META } from '@ai-lint/rules'
import type { FastifyPluginAsync } from 'fastify'
import { HttpError } from '../errors.js'
import type { RulesetSource } from '../services/ruleset-source.js'

const catalog = RULE_IDS.map((id) => {
  const meta = RULE_META[id]!
  return {
    id: meta.id,
    name: meta.name,
    axis: meta.axis,
    defaultSeverity: meta.defaultSeverity,
    appliesTo: meta.appliesTo,
    description: meta.description,
    llm: meta.llm,
    docsUrl: docsUrlFor(meta.id),
  }
})

export function rulesRoutes(rulesets: RulesetSource): FastifyPluginAsync {
  return async (app) => {
    app.get('/v1/rules', async () => ({ rules: catalog }))

    app.get('/v1/rulesets', async () => ({ rulesets: rulesets.list() }))

    app.get<{ Params: { id: string } }>('/v1/rulesets/:id', async (request) => {
      const ruleset = rulesets.get(request.params.id)
      if (!ruleset) throw new HttpError(404, `알 수 없는 규칙셋입니다: ${request.params.id}`)
      return ruleset
    })
  }
}
