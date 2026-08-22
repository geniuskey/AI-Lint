import { totalTextLength } from '@ai-lint/ir'
import { defineRule, num } from '../define.js'

const SUMMARY_HEADING = /요약|개요|한줄|한 줄|정리|배경|목적|tl;?dr|summary|overview|abstract|purpose/i

/** 제목 없이 문서 맨 앞에 놓인 도입 문단도 요약으로 인정한다. */
const LEAD_MIN_CHARS = 100

export const meta002 = defineRule('META002', (ctx) => {
  const minChars = num(ctx.options, 'minChars', 1200)
  const length = totalTextLength(ctx.doc)
  if (length <= minChars) return []

  const head = ctx.sections.slice(0, 2)
  const hasSummaryHeading = head.some((s) => s.heading !== null && SUMMARY_HEADING.test(s.heading.text))
  const hasLead = ctx.sections[0]?.heading === null && (ctx.sections[0]?.charCount ?? 0) >= LEAD_MIN_CHARS
  if (hasSummaryHeading || hasLead) return []

  return [
    {
      blockId: ctx.doc.blocks[0]?.id ?? null,
      message: `본문이 ${length}자인데 요약이 없습니다`,
      why: '요약이 있으면 AI가 문서 전체를 읽지 않고도 이 문서가 질문과 관련 있는지 판단합니다. 요약이 없으면 긴 문서일수록 검색에서 통째로 밀려납니다.',
      suggestion: {
        before: '(요약 없음)',
        after: '문서 맨 앞에 이 문서가 무엇을 다루고 누가 읽어야 하는지 3줄 이내로 적으세요.',
      },
    },
  ]
})
