import { totalTextLength } from '@ai-lint/ir'
import { defineRule, num } from '../define.js'

export const str011 = defineRule('STR011', (ctx) => {
  const minChars = num(ctx.options, 'minChars', 200)
  const length = totalTextLength(ctx.doc)
  if (length >= minChars) return []

  const attachments = ctx.doc.links.filter((l) => l.target === 'attachment')
  if (attachments.length === 0) return []

  return [
    {
      blockId: attachments[0]!.blockId,
      message: `본문이 ${length}자뿐이고 내용이 첨부파일 ${attachments.length}건에 들어 있습니다`,
      why: '첨부파일은 별도로 열어야 읽을 수 있습니다. 페이지만 검색되는 환경에서 이 문서는 제목만 있고 알맹이가 없는 문서로 취급됩니다.',
      evidence: attachments.map((l) => l.text).join(', ').slice(0, 60),
      suggestion: {
        before: '첨부파일 링크만 있는 페이지',
        after: '첨부의 핵심 내용을 본문에 옮겨 적고, 첨부는 원본 보관용으로 두세요.',
      },
    },
  ]
})
