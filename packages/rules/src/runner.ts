import { walkSections, type Document } from '@ai-lint/ir'
import type { RuleRegistry } from './registry.js'
import { docsUrlFor, type Finding, type RawFinding, type ResolvedRuleset, type Rule } from './types.js'

export interface RunOptions {
  now?: Date
  onRuleError?: (ruleId: string, error: unknown) => void
}

function toFinding(rule: Rule, raw: RawFinding, index: number, severity: Finding['severity'], doc: Document): Finding {
  const block = raw.blockId === null ? undefined : doc.blocks.find((b) => b.id === raw.blockId)
  return {
    id: `${rule.id}:${raw.blockId ?? '-'}:${index}`,
    ruleId: rule.id,
    axis: rule.axis,
    severity,
    blockId: raw.blockId,
    anchor: block?.anchor ?? null,
    message: raw.message,
    why: raw.why,
    evidence: raw.evidence ?? null,
    suggestion: raw.suggestion ?? null,
    source: 'rule',
    confidence: 1,
    docsUrl: docsUrlFor(rule.id),
  }
}

export function runRules(
  doc: Document,
  ruleset: ResolvedRuleset,
  registry: RuleRegistry,
  opts: RunOptions = {},
): Finding[] {
  const sections = walkSections(doc)
  const now = opts.now ?? new Date()
  const findings: Finding[] = []

  for (const rule of registry.all()) {
    const config = ruleset.rules[rule.id]
    if (!config || !config.enabled) continue

    const appliesTo = config.appliesTo ?? rule.appliesTo
    if (appliesTo !== 'all' && !appliesTo.includes(doc.docType.value)) continue

    // 룰 하나가 죽어도 전체 검사가 죽으면 안 된다.
    try {
      const raw = rule.check({
        doc,
        sections,
        options: { ...rule.defaultOptions, ...config.options },
        now,
      })
      raw.forEach((r, i) => findings.push(toFinding(rule, r, i, config.severity, doc)))
    } catch (error) {
      opts.onRuleError?.(rule.id, error)
    }
  }

  return findings
}
