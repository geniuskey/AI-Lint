import { defineRule } from '../define.js'

export const str008 = defineRule('STR008', (ctx) =>
  ctx.doc.blocks.flatMap((block) => {
    if (block.kind !== 'table') return []
    const cells = block.rows.flat().length
    // 어댑터가 레이아웃 표라고 표시했거나, 헤더 없이 셀이 두 개뿐이면 칸 나누기 용도로 본다.
    if (!block.isLayoutTable && !(block.headers.length === 0 && cells <= 2)) return []

    return [
      {
        blockId: block.id,
        message: '데이터가 아니라 화면 배치 목적으로 쓰인 표입니다',
        why: '표는 AI에게 "행과 열에 의미가 있다"는 신호입니다. 배치용 표는 없는 관계를 있는 것처럼 읽히게 만들어 잘못된 대응을 만들어냅니다.',
        evidence: block.rows.flat().join(' | ').slice(0, 60),
        suggestion: { before: '표로 나눈 배치', after: '표를 풀고 문단이나 목록으로 쓰세요.' },
      },
    ]
  }),
)
