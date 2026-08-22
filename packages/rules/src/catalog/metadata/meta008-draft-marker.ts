import { blockText } from '@ai-lint/ir'
import { defineRule } from '../define.js'

const MARKER = /\bTBD\b|\bTODO\b|\bFIXME\b|\bXXX\b|작성\s?중|추후\s?작성|미정|\?{3,}/i

export const meta008 = defineRule('META008', (ctx) =>
  ctx.doc.blocks.flatMap((block) => {
    // 코드블록의 TODO는 코드에 대한 메모지 문서의 미완성 표식이 아니다.
    if (block.kind === 'code') return []

    const text = blockText(block)
    const hit = MARKER.exec(text)
    if (!hit) return []
    // "TODO"만 적힌 제목은 섹션 이름이지 미완성 표식이 아니다.
    if (block.kind === 'heading' && text.trim().length === hit[0].length) return []

    return [
      {
        blockId: block.id,
        message: `미완성 표식 "${hit[0]}"이 남아 있습니다`,
        why: 'AI는 미완성 표식을 걸러내지 않고 그 주변 문장을 확정된 내용처럼 인용합니다. 채워지지 않은 자리가 사실로 둔갑합니다.',
        evidence: text.slice(Math.max(0, hit.index - 20), hit.index + 40),
        suggestion: { before: hit[0], after: '내용을 채우거나, 아직 정해지지 않았다면 언제 누가 정하는지 적으세요.' },
      },
    ]
  }),
)
