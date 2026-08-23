import { buildApp } from '../../apps/backend/src/app.js'
import type { Block, Document } from '../../packages/ir/src/index.js'
import type { LlmProvider } from '../../packages/llm/src/index.js'

export const SERVICE_TOKEN = 'shots-service-token'
export const USER_ID = 'docs-team'

/**
 * 스크린샷용 대역 모델.
 *
 * 응답을 통째로 박아 두지 않고 프롬프트에 실제로 들어온 블록에서 근거를 그대로 인용한다.
 * 그래야 백엔드의 검증 단계(verifyFindings)를 정상적으로 통과하고,
 * 문서에 실리는 화면이 손으로 그린 그림이 아니라 진짜 파이프라인의 출력이 된다.
 */
interface ContextTrigger {
  ruleId: string
  /** 블록 원문에 그대로 들어 있어야 하는 문자열. 근거이자 수정 제안의 before가 된다. */
  phrase: string
  why: string
  after?: string
}

const CONTEXT_TRIGGERS: ContextTrigger[] = [
  {
    ruleId: 'CTX001',
    phrase: '지난번 논의대로',
    why: '어떤 논의였는지 문서 안에 없습니다. 이 문단만 검색되어 읽히면 결정의 출처를 복원할 수 없습니다.',
    after: '2026-07-10 결제 설계 리뷰(WIKI-812)의 결론대로',
  },
  {
    ruleId: 'CTX002',
    phrase: 'PG 라우터',
    why: '사내에서만 통하는 이름입니다. 무엇을 하는 구성요소인지 문서 안에 정의가 없습니다.',
  },
  {
    ruleId: 'CTX007',
    phrase: '승인과 매입을 분리하고',
    why: '무엇을 검토한 끝에 분리했는지가 없습니다. 나중에 이 결정을 뒤집으려면 근거를 처음부터 다시 만들어야 합니다.',
  },
  {
    ruleId: 'CTX004',
    phrase: '실패율이 기준을 넘으면 즉시 되돌립니다',
    why: '되돌리는 주체가 문장에 없습니다. 당직자인지 배포 파이프라인인지 알 수 없습니다.',
    after: '실패율이 5%를 넘으면 배포 파이프라인이 직전 버전으로 자동 롤백합니다',
  },
  {
    ruleId: 'CTX009',
    phrase: '매출 12% 증가',
    why: '무엇 대비 12%인지가 문서 밖에 있습니다. 이 장표만 검색되면 숫자의 의미가 성립하지 않습니다.',
  },
  {
    ruleId: 'CTX002',
    phrase: 'MAU',
    why: '약어가 풀어 쓰이지 않았습니다. 같은 약어를 다른 뜻으로 쓰는 문서가 함께 검색되면 섞입니다.',
  },
  {
    ruleId: 'CTX002',
    phrase: '사내 배포 도구',
    why: '도구의 이름이 아니라 통칭입니다. 어떤 도구를 말하는지 문서 안에서 특정되지 않습니다.',
  },
  {
    ruleId: 'CTX001',
    phrase: '배포 대상 서버 목록',
    why: '그 목록이 어디에 있는지 문서 안에 없습니다.',
  },
  {
    ruleId: 'CTX009',
    phrase: '결제 실패 시 사유를 보여준다',
    why: '사유 코드 체계가 문서 밖에 있습니다. 어떤 값이 오는지 이 표만으로는 알 수 없습니다.',
  },
]

const MAX_FINDINGS_PER_CHUNK = 6

/** 프롬프트에 실린 `<!--b:ID--> 본문` 구간을 되돌린다. */
function blocksOf(user: string): Array<{ id: string; text: string }> {
  const marks = [...user.matchAll(/<!--b:(.+?)-->/g)]
  return marks.map((mark, i) => ({
    id: mark[1]!,
    text: user.slice(mark.index! + mark[0].length, marks[i + 1]?.index ?? user.length),
  }))
}

function findingsIn(user: string): unknown[] {
  const findings: unknown[] = []
  for (const block of blocksOf(user)) {
    for (const trigger of CONTEXT_TRIGGERS) {
      if (findings.length >= MAX_FINDINGS_PER_CHUNK) return findings
      if (!block.text.includes(trigger.phrase)) continue
      findings.push({
        ruleId: trigger.ruleId,
        blockId: block.id,
        evidence: trigger.phrase,
        why: trigger.why,
        suggestion: trigger.after ? { before: trigger.phrase, after: trigger.after } : null,
        confidence: 0.86,
      })
    }
  }
  return findings
}

function docTypeOf(user: string): { value: string; confidence: number } {
  if (user.includes('요구사항')) return { value: 'requirement', confidence: 0.91 }
  if (user.includes('가이드') || user.includes('절차')) return { value: 'guide', confidence: 0.88 }
  if (user.includes('리뷰') || user.includes('지표')) return { value: 'meeting-notes', confidence: 0.74 }
  return { value: 'design', confidence: 0.87 }
}

const CONTRADICTION = {
  subjectId: 'REQ-002',
  quoteA: '재시도는 최대 3회까지 허용한다',
  quoteB: '재시도는 최대 5회까지 허용한다',
  why: '같은 요구사항의 재시도 횟수를 요구사항 정의서는 3회, 설계 문서는 5회로 적었습니다.',
  confidence: 0.89,
}

function contradictionsIn(user: string): unknown[] {
  const [a = '', b = ''] = user.split('[문서 B]')
  const forward = a.includes(CONTRADICTION.quoteA) && b.includes(CONTRADICTION.quoteB)
  const backward = a.includes(CONTRADICTION.quoteB) && b.includes(CONTRADICTION.quoteA)
  if (forward) return [CONTRADICTION]
  if (backward) return [{ ...CONTRADICTION, quoteA: CONTRADICTION.quoteB, quoteB: CONTRADICTION.quoteA }]
  return []
}

export const scriptedProvider: LlmProvider = {
  name: 'scripted:shots',
  complete: async (request) => {
    const properties = (request.schema['properties'] ?? {}) as Record<string, unknown>
    if ('value' in properties) return docTypeOf(request.user)
    if ('summary' in properties) return { summary: '결제 모듈의 승인 흐름과 운영 절차를 다룬 문서입니다.' }
    if ('contradictions' in properties) return { contradictions: contradictionsIn(request.user) }
    return { findings: findingsIn(request.user) }
  },
}

// ── 추적성 코퍼스 ────────────────────────────────────────────────────────

let seq = 0
const at = (text: string): Block['anchor'] => ({
  kind: 'confluence',
  xpath: `//div[@id='main-content']/*[${++seq}]`,
  textQuote: { exact: text.slice(0, 40) },
})

const heading = (id: string, level: 1 | 2, text: string): Block => ({
  id,
  path: [1],
  anchor: at(text),
  kind: 'heading',
  level,
  text,
})

const para = (id: string, text: string): Block => ({ id, path: [1], anchor: at(text), kind: 'paragraph', text })

const wikiDoc = (
  page: number,
  title: string,
  docType: Document['docType']['value'],
  blocks: Block[],
  links: Document['links'] = [],
): Document => ({
  schemaVersion: 1,
  source: {
    kind: 'confluence',
    uri: `https://confluence.example.com/pages/${page}`,
    modifiedAt: '2026-08-04T01:00:00.000Z',
  },
  title,
  docType: { value: docType, confidence: 1, origin: 'label' },
  blocks,
  links,
  metadata: { labels: ['payment'], owner: '결제팀' },
})

/**
 * 문서 하나만 봐서는 드러나지 않는 문제를 만들어 둔 코퍼스.
 * REQ-003은 두 문서가 정의하고(TRC004), REQ-002는 테스트가 없고(TRC003) 서술이 어긋나며(TRC006),
 * REQ-014는 정의한 문서가 없다(TRC001). 설계 문서의 링크 하나는 인덱스 밖을 가리킨다(TRC005).
 */
export const CORPUS: Document[] = [
  wikiDoc(4001, '결제 요구사항 정의서', 'requirement', [
    heading('h1', 1, '결제 요구사항'),
    para('p1', 'REQ-001 사용자는 결제 수단을 추가할 수 있어야 한다.'),
    para('p2', 'REQ-002 결제 실패 시 사유를 보여준다. 재시도는 최대 3회까지 허용한다.'),
    para('p3', 'REQ-003 환불은 관리자만 승인한다.'),
  ]),
  wikiDoc(
    4002,
    '결제 승인 흐름 설계',
    'design',
    [
      heading('h1', 1, '개요'),
      para('p1', 'REQ-002와 REQ-003을 구현하기 위한 승인 흐름이다. 정산 배치 설계와 함께 읽어야 한다.'),
      heading('h2', 2, 'REQ-003 환불 승인'),
      para('p2', '환불은 관리자 승인 후 정산 배치가 처리한다.'),
      heading('h3', 2, '재시도 정책'),
      para('p3', 'REQ-002를 구현할 때 결제 실패 후 재시도는 최대 5회까지 허용한다.'),
    ],
    [
      {
        blockId: 'p1',
        text: '정산 배치 설계',
        href: 'https://confluence.example.com/pages/4900',
        target: 'internal',
      },
    ],
  ),
  wikiDoc(4003, '결제 모듈 통합 테스트 계획', 'guide', [
    heading('h1', 1, '통합 테스트 계획'),
    heading('h2', 2, 'TC-101 결제 수단 추가'),
    para('p1', 'REQ-001의 결제 수단 추가 흐름을 검증한다.'),
    heading('h3', 2, 'TC-102 환불 승인 권한'),
    para('p2', 'REQ-003의 환불 승인 권한을 검증한다.'),
  ]),
  wikiDoc(4004, '정산 배치 운영 가이드', 'guide', [
    heading('h1', 1, '정산 배치 운영'),
    para('p1', '야간 배치는 REQ-014의 정산 마감 시간을 따른다.'),
  ]),
]

export interface Backend {
  url: string
  close(): Promise<void>
}

/** 실제 백엔드를 그대로 띄운다. 코퍼스는 /v1/lint가 부수적으로 색인한다. */
export async function startBackend(port: number): Promise<Backend> {
  const app = buildApp({ provider: scriptedProvider, serviceToken: SERVICE_TOKEN })

  for (const document of CORPUS) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/lint',
      headers: { 'x-ai-lint-token': SERVICE_TOKEN, 'x-ai-lint-user': USER_ID },
      payload: { document, options: { useLlm: false, save: false } },
    })
    if (response.statusCode !== 200) throw new Error(`코퍼스 적재 실패 (${response.statusCode}): ${response.body}`)
  }

  await app.listen({ port, host: '127.0.0.1' })
  return { url: `http://127.0.0.1:${port}`, close: () => app.close() }
}
