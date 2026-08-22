import { createRegistry, type RuleRegistry } from '../registry.js'
import type { Rule } from '../types.js'
import { STRUCTURE_RULES } from './structure/index.js'

export { STRUCTURE_RULES }
export { isMeaningfulAlt } from './structure/index.js'
export { defineRule } from './define.js'

export const METADATA_RULES: Rule[] = []

/** 판정 로직이 구현된 전체 룰. CTX 룰은 LLM이 담당하므로 여기 없다. */
export const ALL_RULES: Rule[] = [...STRUCTURE_RULES, ...METADATA_RULES]

export const defaultRegistry: RuleRegistry = createRegistry(ALL_RULES)
