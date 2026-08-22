import { defineRule } from '../define.js'

const VAGUE = new Set([
  '여기',
  '이곳',
  '링크',
  '클릭',
  '여기를 클릭',
  '자세히',
  '자세히 보기',
  '더보기',
  '바로가기',
  '참고',
  '참조',
  'here',
  'click here',
  'link',
  'this',
  'this link',
  'read more',
  'more',
  'see',
  'see here',
])

const isVague = (text: string): boolean => {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, '')
  return VAGUE.has(t) || /^https?:\/\//.test(t)
}

export const str007 = defineRule('STR007', (ctx) =>
  ctx.doc.links
    .filter((l) => isVague(l.text))
    .map((l) => ({
      blockId: l.blockId,
      message: `링크 텍스트 "${l.text}"만으로는 무엇을 가리키는지 알 수 없습니다`,
      why: 'AI는 링크를 따라가지 않습니다. 링크 텍스트가 곧 대상 문서에 대한 유일한 설명이므로, "여기"는 아무 정보도 전달하지 못합니다.',
      evidence: l.text,
      suggestion: { before: l.text, after: l.resolvedTitle ?? '대상 문서의 제목을 링크 텍스트로 쓰세요' },
    })),
)
