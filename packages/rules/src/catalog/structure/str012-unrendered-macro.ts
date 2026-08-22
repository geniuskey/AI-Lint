import { defineRule } from '../define.js'

/** 본문 콘텐츠를 담는 매크로. toc·children 같은 네비게이션 매크로는 비어 있어도 문제가 아니다. */
const CONTENT_MACROS = new Set([
  'include',
  'excerpt-include',
  'excerpt',
  'multimedia',
  'viewxls',
  'viewpdf',
  'viewdoc',
  'viewppt',
  'widget',
  'iframe',
  'html',
  'drawio',
  'gliffy',
])

export const str012 = defineRule('STR012', (ctx) =>
  ctx.doc.blocks.flatMap((block) => {
    if (block.kind !== 'macro' || block.renderedText) return []
    if (!CONTENT_MACROS.has(block.name.toLowerCase())) return []

    return [
      {
        blockId: block.id,
        message: `${block.name} 매크로의 내용이 텍스트로 추출되지 않았습니다`,
        why: '매크로가 화면에만 그려지고 저장 형식에는 참조만 남으면, 문서를 수집하는 쪽에서는 빈 자리로 보입니다. 그 자리의 내용은 검색에 잡히지 않습니다.',
        evidence: block.name,
        suggestion: {
          before: `[매크로: ${block.name}]`,
          after: '핵심 내용을 매크로 바깥 본문에도 요약해 두세요.',
        },
      },
    ]
  }),
)
