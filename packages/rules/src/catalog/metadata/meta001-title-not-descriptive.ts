import { defineRule } from '../define.js'

/** 내용을 전혀 좁혀주지 않는 제목. 단독으로 쓰였을 때만 문제다. */
const GENERIC = new Set([
  '회의록',
  '회의',
  '메모',
  '임시',
  '테스트',
  '문서',
  '노트',
  '자료',
  '정리',
  '초안',
  'untitled',
  'notes',
  'note',
  'memo',
  'test',
  'draft',
  'new page',
  '제목없음',
  '제목 없음',
])

const DERIVED = /복사본|사본|백업|copy of|\bcopy\b|\bold\b|deprecated/i

export const meta001 = defineRule('META001', (ctx) => {
  const title = ctx.doc.title.trim()
  const normalized = title.toLowerCase()

  const reason = GENERIC.has(normalized)
    ? '내용을 알 수 없는 일반명사 제목입니다'
    : DERIVED.test(title)
      ? '복사본·백업 흔적이 제목에 남아 있습니다'
      : title.length < 5
        ? '제목이 너무 짧아 내용을 특정하지 못합니다'
        : null

  if (reason === null) return []

  return [
    {
      blockId: null,
      message: `제목 "${title}" — ${reason}`,
      why: '제목은 검색 결과에서 이 문서를 고를지 말지를 결정하는 유일한 단서입니다. 제목이 내용을 대변하지 못하면 관련 있는 문서가 후보에서 먼저 탈락합니다.',
      evidence: title,
      suggestion: { before: title, after: '무엇에 대한 문서인지 드러나게 쓰세요. 예: "[2026-07-15] 결제 모듈 아키텍처 리뷰"' },
    },
  ]
})
