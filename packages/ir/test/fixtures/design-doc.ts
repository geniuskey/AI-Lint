import type { Document, SourceAnchor } from '../../src/index.js'

const anchor = (exact: string, i: number): SourceAnchor => ({
  kind: 'confluence',
  xpath: `//div[@id='main']/*[${i}]`,
  textQuote: { exact },
})

export const designDoc: Document = {
  schemaVersion: 1,
  source: {
    kind: 'confluence',
    uri: 'https://wiki.example.com/pages/viewpage.action?pageId=12345',
    version: '7',
    modifiedAt: '2026-07-15T02:00:00Z',
    author: 'kim',
    space: 'PAY',
  },
  title: '결제 모듈 개편',
  docType: { value: 'design', confidence: 0.92, origin: 'llm' },
  blocks: [
    { id: 'h1', path: [1], anchor: anchor('결제 모듈 개편', 1), kind: 'heading', level: 1, text: '결제 모듈 개편' },
    {
      id: 'p1',
      path: [1],
      anchor: anchor('지난번 논의대로', 2),
      kind: 'paragraph',
      text: '지난번 논의대로 3단계로 나눠서 진행하기로 했습니다.',
    },
    { id: 'h2', path: [1, 1], anchor: anchor('개요', 3), kind: 'heading', level: 2, text: '개요' },
    {
      id: 'p2',
      path: [1, 1],
      anchor: anchor('현재 결제 모듈은', 4),
      kind: 'paragraph',
      text: '현재 결제 모듈은 PG사별 분기가 서비스 레이어에 흩어져 있습니다.',
    },
    {
      id: 't1',
      path: [1, 1],
      anchor: anchor('단계', 5),
      kind: 'table',
      headers: ['단계', '담당'],
      rows: [
        ['1차', '김'],
        ['2차', '이'],
      ],
      isLayoutTable: false,
    },
    { id: 'h3', path: [1, 2], anchor: anchor('아키텍처', 6), kind: 'heading', level: 2, text: '아키텍처' },
    {
      id: 'p3',
      path: [1, 2],
      anchor: anchor('아래 다이어그램', 7),
      kind: 'paragraph',
      text: '아래 다이어그램을 참고하세요.',
    },
    { id: 'i1', path: [1, 2], anchor: anchor('이미지', 8), kind: 'image', assetRef: 'att-901' },
    {
      id: 'c1',
      path: [1, 2],
      anchor: anchor('interface', 9),
      kind: 'code',
      lang: 'typescript',
      text: 'interface PaymentGateway {\n  charge(amount: number): Promise<Receipt>\n}',
    },
    {
      id: 'p4',
      path: [1, 2],
      anchor: anchor('어댑터 인터페이스는', 10),
      kind: 'paragraph',
      text: '어댑터 인터페이스는 PG사 추가 시에만 변경됩니다.',
    },
  ],
  links: [
    { blockId: 'p2', text: '여기', href: 'https://wiki.example.com/x/1', target: 'internal' },
  ],
  metadata: { labels: ['payment', 'architecture'], owner: 'kim', ancestors: ['결제', '설계'] },
}
