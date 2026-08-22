import { defineRule, num } from '../define.js'

export const str010 = defineRule('STR010', (ctx) => {
  const maxDepth = num(ctx.options, 'maxDepth', 3)

  return ctx.doc.blocks.flatMap((block) => {
    if (block.kind !== 'list' || block.depth <= maxDepth) return []

    return [
      {
        blockId: block.id,
        message: `목록이 ${block.depth}단계까지 중첩되어 있습니다`,
        why: '깊은 중첩은 텍스트로 펼쳐지는 순간 계층 정보를 잃습니다. AI는 4단계 아래 항목이 어느 상위 항목에 속하는지 되짚지 못합니다.',
        evidence: block.items.join(' ').slice(0, 60),
        suggestion: { before: `${block.depth}단계 중첩 목록`, after: '하위 항목을 별도 섹션이나 표로 승격하세요.' },
      },
    ]
  })
})
