import { defineRule } from '../define.js'

export const str013 = defineRule('STR013', (ctx) =>
  ctx.doc.blocks.flatMap((block) => {
    if (block.kind !== 'paragraph' || block.emphasizedAsHeading !== true) return []

    return [
      {
        blockId: block.id,
        message: '제목 스타일 없이 굵게·크게로 제목을 흉내냈습니다',
        why: '글자 모양만 바꾼 제목은 문서 구조에 남지 않습니다. 추출 도구가 섹션 경계를 찾지 못해 여러 주제가 한 청크로 묶이고, 인용할 때 어느 절의 내용인지 붙일 수 없습니다.',
        evidence: block.text.slice(0, 60),
        suggestion: {
          before: block.text,
          after: '제목 1~3 스타일을 적용하세요.',
        },
      },
    ]
  }),
)
