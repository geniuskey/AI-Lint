import { blockText, type Block } from '@ai-lint/ir'
import { defineRule } from '../define.js'

const TABLE_HINT = /표|차트|그래프|다이어그램|아키텍처|플로우|table|chart|diagram/i

/** 이미지 주변 문맥이 표·도표를 가리키는가. 직전 2블록, 직후 1블록을 본다. */
const hintedByNeighbors = (blocks: Block[], index: number): boolean =>
  [index - 2, index - 1, index + 1]
    .map((i) => blocks[i])
    .some((b) => b !== undefined && TABLE_HINT.test(blockText(b)))

export const str004 = defineRule('STR004', (ctx) => {
  const blocks = ctx.doc.blocks

  return blocks.flatMap((block, index) => {
    if (block.kind !== 'image' || block.ocrText) return []
    if (!hintedByNeighbors(blocks, index)) return []

    const section = ctx.sections.find((s) => s.blocks.includes(block))
    if (section?.blocks.some((b) => b.kind === 'table')) return []

    return [
      {
        blockId: block.id,
        message: '표나 도표로 보이는 이미지인데 텍스트 데이터가 없습니다',
        why: '이미지 속 표는 AI에게 존재하지 않는 데이터입니다. 주변 문장은 이 그림을 참조하는데 정작 값은 읽을 수 없어, 답변에서 근거가 빠지거나 지어내게 됩니다.',
        evidence: block.assetRef,
        suggestion: {
          before: `[이미지: ${block.alt ?? block.assetRef}]`,
          after: '이미지를 유지하되 같은 내용을 표 블록으로도 옮겨 적으세요.',
        },
      },
    ]
  })
})
