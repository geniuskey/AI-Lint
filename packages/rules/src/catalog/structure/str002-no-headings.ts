import { headings, totalTextLength } from '@ai-lint/ir'
import { defineRule, num } from '../define.js'

export const str002 = defineRule('STR002', (ctx) => {
  const minChars = num(ctx.options, 'minChars', 800)
  const length = totalTextLength(ctx.doc)
  if (headings(ctx.doc).length > 0 || length <= minChars) return []

  return [
    {
      blockId: null,
      message: `본문이 ${length}자인데 제목이 하나도 없습니다`,
      why: '제목이 없으면 문서 전체가 하나의 덩어리로 취급됩니다. AI는 질문과 관련된 부분만 골라내지 못하고 문서 전체를 통째로 읽거나 임의의 길이로 잘라야 합니다.',
    },
  ]
})
