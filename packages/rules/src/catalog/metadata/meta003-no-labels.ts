import { defineRule } from '../define.js'

export const meta003 = defineRule('META003', (ctx) => {
  if (ctx.doc.metadata.labels.length > 0) return []

  return [
    {
      blockId: null,
      message: '라벨이 하나도 없습니다',
      why: '라벨은 문서를 주제·팀·수명주기로 묶는 유일한 구조화 신호입니다. 라벨이 없으면 검색 범위를 좁히지 못해 무관한 문서와 같은 후보군에 섞입니다.',
      suggestion: { before: '(라벨 없음)', after: '주제·시스템·문서 유형 라벨을 최소 2개 붙이세요. 예: payment, design' },
    },
  ]
})
