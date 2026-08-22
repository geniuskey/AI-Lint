import { defineRule, num } from '../define.js'

export const str003 = defineRule('STR003', (ctx) => {
  const maxSectionChars = num(ctx.options, 'maxSectionChars', 1500)

  return ctx.sections
    .filter((s) => s.charCount > maxSectionChars)
    .map((s) => ({
      blockId: s.heading?.id ?? s.blocks[0]?.id ?? null,
      message: `"${s.heading?.text ?? '(제목 없는 첫 구간)'}" 섹션이 ${s.charCount}자로 너무 깁니다`,
      why: `한 섹션이 ${maxSectionChars}자를 넘으면 검색 단위 하나에 여러 주제가 섞입니다. AI가 이 청크를 인용하면 질문과 무관한 내용까지 함께 딸려옵니다.`,
      ...(s.heading ? { evidence: s.heading.text } : {}),
    }))
})
