import { blockText } from '@ai-lint/ir'
import { defineRule } from '../define.js'

const OWNER_IN_BODY = /(작성자|담당자|책임자|owner|maintainer|responsible|poc)\s*[:：]\s*\S/i

export const meta004 = defineRule('META004', (ctx) => {
  if (ctx.doc.metadata.owner) return []
  if (ctx.doc.blocks.some((b) => b.kind !== 'code' && OWNER_IN_BODY.test(blockText(b)))) return []

  return [
    {
      blockId: null,
      message: '문서 소유자나 담당자가 기재되지 않았습니다',
      why: '내용이 낡았을 때 누구에게 확인해야 하는지 알 수 없습니다. 소유자가 없는 문서는 검증할 방법이 없어 신뢰도를 낮게 잡아야 합니다.',
      suggestion: { before: '(담당자 없음)', after: '문서 상단에 "담당자: 홍길동" 형태로 적거나 페이지 소유자를 지정하세요.' },
    },
  ]
})
