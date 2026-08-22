import { defineRule } from '../define.js'

export const str014 = defineRule('STR014', (ctx) => {
  if (ctx.doc.source.kind !== 'pdf' || ctx.doc.blocks.length > 0) return []

  return [
    {
      blockId: null,
      message: '텍스트 레이어가 없는 스캔 PDF입니다',
      why: '그림만 있는 PDF는 검색도 인용도 되지 않습니다. AI는 이 문서의 내용을 한 글자도 읽지 못합니다.',
      suggestion: {
        before: ctx.doc.title,
        after: 'OCR로 텍스트 레이어를 넣거나, 원본 문서를 PDF로 다시 내보내세요.',
      },
    },
  ]
})
