import { DocTypeSchema, SeveritySchema } from '@ai-lint/ir'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { RULE_META } from './catalog/meta.js'
import { DEFAULT_AXIS_WEIGHTS } from './scoring.js'
import type { AxisWeights, ResolvedRuleset, RuleConfig } from './types.js'

const AxisWeightsSchema = z.object({
  structure: z.number().min(0).max(1),
  context: z.number().min(0).max(1),
  metadata: z.number().min(0).max(1),
})

const RuleConfigInputSchema = z.object({
  enabled: z.boolean().optional(),
  severity: SeveritySchema.optional(),
  options: z.record(z.unknown()).optional(),
  appliesTo: z.union([z.array(DocTypeSchema), z.literal('all')]).optional(),
})

const RulesetInputSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().min(1),
  axisWeights: AxisWeightsSchema.optional(),
  rules: z.record(RuleConfigInputSchema).default({}),
})

export type RulesetInput = z.input<typeof RulesetInputSchema>

const WEIGHT_TOLERANCE = 0.001

function assertWeightsSumToOne(weights: AxisWeights): void {
  const sum = weights.structure + weights.context + weights.metadata
  if (Math.abs(sum - 1) > WEIGHT_TOLERANCE) {
    throw new Error(`축 가중치의 합이 1이어야 합니다. 현재 합: ${sum}`)
  }
}

export function resolveRuleset(input: unknown): ResolvedRuleset {
  const parsed = RulesetInputSchema.parse(input)

  for (const ruleId of Object.keys(parsed.rules)) {
    if (!RULE_META[ruleId]) {
      throw new Error(`알 수 없는 룰 ID입니다: ${ruleId}`)
    }
  }

  const axisWeights = parsed.axisWeights ?? DEFAULT_AXIS_WEIGHTS
  assertWeightsSumToOne(axisWeights)

  const rules: Record<string, RuleConfig> = {}
  for (const [ruleId, meta] of Object.entries(RULE_META)) {
    const override = parsed.rules[ruleId]
    rules[ruleId] = {
      enabled: override?.enabled ?? true,
      severity: override?.severity ?? meta.defaultSeverity,
      options: { ...meta.defaultOptions, ...(override?.options ?? {}) },
      ...(override?.appliesTo !== undefined ? { appliesTo: override.appliesTo } : {}),
    }
  }

  return { id: parsed.id, version: parsed.version, name: parsed.name, axisWeights, rules }
}

export function loadRuleset(yamlText: string): ResolvedRuleset {
  return resolveRuleset(parseYaml(yamlText))
}

export const DEFAULT_RULESET: ResolvedRuleset = resolveRuleset({
  id: 'default',
  version: 1,
  name: '기본 규칙셋',
  rules: {},
})
