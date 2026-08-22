import { outline, type DocType, type Document } from '@ai-lint/ir'
import { LLM_RULE_IDS, RULE_META, type ResolvedRuleset } from '@ai-lint/rules'
import type { Chunk } from './chunk.js'

const BASE_INSTRUCTIONS = `당신은 문서가 AI(RAG·LLM 에이전트)에게 읽힐 수 있는지 검사하는 린터입니다.
사람이 회의 맥락을 공유한 상태에서만 이해되는 표현을 찾아내는 것이 목표입니다.

판정 기준:
- 이 문서를 섹션 단위로 잘라 검색 결과로만 읽는 사람이 의미를 복원할 수 있는가
- 복원할 수 없다면 어떤 표현이 원인인가

반드시 지킬 것:
- evidence는 반드시 원문에서 그대로 복사한 문자열이어야 합니다. 요약하거나 바꿔 쓰면 폐기됩니다.
- blockId는 <!--b:ID--> 주석에 나타난 ID여야 합니다.
- 확신이 없으면 보고하지 마십시오. 놓치는 것보다 잘못 지적하는 것이 나쁩니다.
- suggestion.before도 원문 그대로여야 합니다. 고칠 방법이 명확하지 않으면 suggestion을 null로 두십시오.
- 같은 블록에 같은 문제를 두 번 보고하지 마십시오.`

/** 규칙셋에서 켜져 있고 이 문서 유형에 적용되는 LLM 룰만 프롬프트에 싣는다. */
export function activeLlmRules(ruleset: ResolvedRuleset, docType: DocType): string[] {
  return LLM_RULE_IDS.filter((id) => {
    const config = ruleset.rules[id]
    if (!config || !config.enabled) return false
    const appliesTo = config.appliesTo ?? RULE_META[id]!.appliesTo
    return appliesTo === 'all' || appliesTo.includes(docType)
  })
}

export function buildSystemPrompt(ruleset: ResolvedRuleset, docType: DocType): string {
  const rules = activeLlmRules(ruleset, docType)
    .map((id) => `- ${id} (${RULE_META[id]!.name}): ${RULE_META[id]!.description}`)
    .join('\n')

  return `${BASE_INSTRUCTIONS}

검사할 항목은 다음뿐입니다. 목록에 없는 문제는 보고하지 마십시오.
${rules}`
}

export interface GlobalContext {
  title: string
  docType: DocType
  outline: string
  summary?: string
}

export function buildGlobalContext(doc: Document, summary?: string): GlobalContext {
  return {
    title: doc.title,
    docType: doc.docType.value,
    outline: outline(doc),
    ...(summary ? { summary } : {}),
  }
}

/**
 * 청크 하나에 대한 사용자 프롬프트.
 * 청크는 문서의 일부만 담으므로, 자립성을 판정하려면 문서 전체의 골격을 함께 줘야 한다.
 */
export function buildUserPrompt(chunk: Chunk, global: GlobalContext): string {
  const parts = [
    `# 문서 정보`,
    `제목: ${global.title}`,
    `유형: ${global.docType}`,
    global.summary ? `요약: ${global.summary}` : null,
    ``,
    `## 문서 전체 목차`,
    global.outline || '(제목 없음)',
    ``,
    `# 검사 대상 (${chunk.index + 1}번째 구간)`,
    `아래 구간에 대해서만 보고하십시오. 목차와 요약은 맥락 판단용이며 검사 대상이 아닙니다.`,
    ``,
    chunk.markdown,
  ]

  return parts.filter((p) => p !== null).join('\n')
}

export const SUMMARY_SYSTEM_PROMPT =
  '문서 전체를 읽고 무엇에 대한 문서인지 3문장 이내의 한국어로 요약하십시오. 판단이나 평가는 하지 말고 내용만 요약하십시오.'

export const DOCTYPE_SYSTEM_PROMPT = `문서의 유형을 분류하십시오. 다음 중 하나여야 합니다:
- meeting-notes: 회의록
- requirement: 요구사항 정의서
- design: 설계 문서, 아키텍처 결정 기록
- guide: 사용 가이드, 절차서
- api-doc: API 명세
- troubleshooting: 장애·문제 해결 기록
- reference: 용어집, 참조표
- unknown: 위 어디에도 해당하지 않음

확신이 없으면 unknown과 낮은 confidence를 주십시오.`
