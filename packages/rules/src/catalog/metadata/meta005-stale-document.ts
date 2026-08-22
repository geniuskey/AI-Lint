import { defineRule, num } from '../define.js'

const MS_PER_MONTH = 30 * 24 * 60 * 60 * 1000

export const meta005 = defineRule('META005', (ctx) => {
  const staleMonths = num(ctx.options, 'staleMonths', 12)
  const raw = ctx.doc.source.modifiedAt
  if (!raw) return []

  const modified = new Date(raw)
  if (Number.isNaN(modified.getTime())) return []

  const months = Math.floor((ctx.now.getTime() - modified.getTime()) / MS_PER_MONTH)
  if (months < staleMonths) return []

  return [
    {
      blockId: null,
      message: `마지막 수정 후 약 ${months}개월이 지났습니다 (${raw.slice(0, 10)})`,
      why: '오래된 문서와 최신 문서가 같은 무게로 검색되면, AI는 이미 폐기된 결정을 현행 사실처럼 인용합니다.',
      evidence: raw,
      suggestion: {
        before: `최종 수정: ${raw.slice(0, 10)}`,
        after: '내용을 검토해 갱신하거나, 유효하지 않다면 상단에 보관·대체 문서 안내를 남기세요.',
      },
    },
  ]
})
