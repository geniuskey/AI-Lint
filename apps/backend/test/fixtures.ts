import type { Block, Document, SourceAnchor } from '@ai-lint/ir'

let seq = 0
const anchorFor = (exact: string): SourceAnchor => ({
  kind: 'confluence',
  xpath: `//div[@id='main']/*[${++seq}]`,
  textQuote: { exact: exact.slice(0, 40) || 'empty' },
})

const base = (id: string, text: string) => ({ id, path: [1], anchor: anchorFor(text) })

export const heading = (id: string, level: 1 | 2 | 3, text: string): Block => ({
  ...base(id, text),
  kind: 'heading',
  level,
  text,
})

export const para = (id: string, text: string): Block => ({ ...base(id, text), kind: 'paragraph', text })

/**
 * 룰 finding이 반드시 나오는 설계 문서.
 * - META004: 담당자 없음
 * - META007: design에 필요한 "대안" 섹션 없음
 * p1은 CTX001(맥락 자립성)의 근거 문자열을 담고 있어 LLM finding 검증 테스트에 쓴다.
 */
export const designDoc: Document = {
  schemaVersion: 1,
  source: {
    kind: 'confluence',
    uri: 'https://wiki.example.com/pages/1',
    modifiedAt: '2026-08-01T00:00:00.000Z',
  },
  title: '결제 모듈 개편 설계',
  docType: { value: 'design', confidence: 1, origin: 'label' },
  blocks: [
    heading('h1', 1, '배경'),
    para('p1', '지난번 논의대로 3단계로 나눠서 진행하기로 했습니다.'),
    heading('h2', 2, '결정'),
    para('p2', '결제 승인과 매입을 분리하고 매입은 야간 배치로 처리한다.'),
  ],
  links: [],
  metadata: { labels: ['payment'] },
}

export const ctxFinding = (blockId: string, evidence: string, confidence = 0.9) => ({
  ruleId: 'CTX001',
  blockId,
  evidence,
  why: '어떤 논의를 가리키는지 문서 안에 없습니다.',
  suggestion: null,
  confidence,
})
