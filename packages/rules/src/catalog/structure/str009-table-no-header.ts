import { defineRule } from '../define.js'

export const str009 = defineRule('STR009', (ctx) =>
  ctx.doc.blocks.flatMap((block) => {
    if (block.kind !== 'table' || block.isLayoutTable) return []
    if (block.headers.length > 0 || block.rows.length < 2) return []

    return [
      {
        blockId: block.id,
        message: `${block.rows.length}행짜리 표에 헤더 행이 없습니다`,
        why: '헤더가 없으면 각 열이 무엇인지 알 수 없습니다. AI는 표를 행 단위로 인용하면서 값이 어떤 항목의 값인지 붙이지 못합니다.',
        evidence: block.rows[0]!.join(' | ').slice(0, 60),
        suggestion: { before: block.rows[0]!.join(' | '), after: '첫 행을 헤더로 지정하거나 열 이름 행을 추가하세요.' },
      },
    ]
  }),
)
