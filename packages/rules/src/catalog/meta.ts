import type { RuleMeta } from '../types.js'

type MetaInput = Omit<RuleMeta, 'llm' | 'defaultOptions' | 'appliesTo'> &
  Partial<Pick<RuleMeta, 'llm' | 'defaultOptions' | 'appliesTo'>>

const meta = (m: MetaInput): RuleMeta => ({
  llm: false,
  defaultOptions: {},
  appliesTo: 'all',
  ...m,
})

/**
 * 룰 카탈로그의 단일 진실 공급원.
 * 규칙셋 검증, GET /v1/rules, LLM 프롬프트 생성이 모두 이 표를 참조한다.
 * 실제 판정 로직(check)은 catalog/structure, catalog/metadata에서 붙인다.
 */
export const RULE_META: Record<string, RuleMeta> = Object.fromEntries(
  [
    // ── 구조 & 청킹 친화성 ───────────────────────────────────────────────
    meta({
      id: 'STR001',
      name: 'heading-hierarchy-skip',
      axis: 'structure',
      defaultSeverity: 'warning',
      description: '제목 레벨을 건너뜁니다 (예: h2 다음에 h4).',
    }),
    meta({
      id: 'STR002',
      name: 'no-headings',
      axis: 'structure',
      defaultSeverity: 'error',
      description: '긴 문서인데 제목이 하나도 없습니다.',
      defaultOptions: { minChars: 800 },
    }),
    meta({
      id: 'STR003',
      name: 'section-too-long',
      axis: 'structure',
      defaultSeverity: 'warning',
      description: '한 섹션이 너무 길어 청크가 여러 주제를 섞습니다.',
      defaultOptions: { maxSectionChars: 1500 },
    }),
    meta({
      id: 'STR004',
      name: 'table-as-image',
      axis: 'structure',
      defaultSeverity: 'error',
      description: '표나 도표가 이미지로만 존재해 텍스트로 추출할 수 없습니다.',
    }),
    meta({
      id: 'STR005',
      name: 'image-missing-alt',
      axis: 'structure',
      defaultSeverity: 'error',
      description: '이미지에 대체 텍스트나 캡션이 없습니다.',
    }),
    meta({
      id: 'STR006',
      name: 'code-block-no-language',
      axis: 'structure',
      defaultSeverity: 'info',
      description: '코드블록에 언어가 지정되지 않았습니다.',
      defaultOptions: { minLines: 3 },
    }),
    meta({
      id: 'STR007',
      name: 'vague-link-text',
      axis: 'structure',
      defaultSeverity: 'warning',
      description: '"여기", "링크" 같은 무의미한 링크 텍스트입니다.',
    }),
    meta({
      id: 'STR008',
      name: 'layout-table',
      axis: 'structure',
      defaultSeverity: 'info',
      description: '데이터가 아니라 레이아웃 목적으로 쓰인 표입니다.',
    }),
    meta({
      id: 'STR009',
      name: 'table-no-header',
      axis: 'structure',
      defaultSeverity: 'warning',
      description: '표에 헤더 행이 없어 각 열의 의미를 알 수 없습니다.',
    }),
    meta({
      id: 'STR010',
      name: 'deep-nesting',
      axis: 'structure',
      defaultSeverity: 'info',
      description: '목록이 너무 깊게 중첩되어 있습니다.',
      defaultOptions: { maxDepth: 3 },
    }),
    meta({
      id: 'STR011',
      name: 'attachment-only',
      axis: 'structure',
      defaultSeverity: 'error',
      description: '본문이 거의 없고 첨부파일에만 내용이 있습니다.',
      defaultOptions: { minChars: 200 },
    }),
    meta({
      id: 'STR012',
      name: 'unrendered-macro',
      axis: 'structure',
      defaultSeverity: 'warning',
      description: '내용을 담은 매크로가 텍스트로 추출되지 않았습니다.',
    }),
    meta({
      id: 'STR013',
      name: 'emphasis-as-heading',
      axis: 'structure',
      defaultSeverity: 'warning',
      description: '제목 스타일 대신 굵게·큰 글씨로 제목을 표현했습니다.',
    }),

    // ── 맥락 자립성 (LLM) ────────────────────────────────────────────────
    meta({
      id: 'CTX001',
      name: 'dangling-reference',
      axis: 'context',
      defaultSeverity: 'error',
      llm: true,
      description: '"지난번 논의대로", "위 표 참고"처럼 문서 안에서 해소되지 않는 참조입니다.',
    }),
    meta({
      id: 'CTX002',
      name: 'undefined-term',
      axis: 'context',
      defaultSeverity: 'warning',
      llm: true,
      description: '정의 없이 등장하는 약어, 사내 은어, 코드네임입니다.',
    }),
    meta({
      id: 'CTX003',
      name: 'missing-purpose',
      axis: 'context',
      defaultSeverity: 'warning',
      llm: true,
      description: '문서의 목적과 범위가 도입부에 명시되지 않았습니다.',
    }),
    meta({
      id: 'CTX004',
      name: 'ambiguous-actor',
      axis: 'context',
      defaultSeverity: 'warning',
      llm: true,
      description: '주어가 생략되어 행위 주체가 불명확합니다.',
    }),
    meta({
      id: 'CTX005',
      name: 'unresolved-pronoun',
      axis: 'context',
      defaultSeverity: 'warning',
      llm: true,
      description: '지시대명사가 가리키는 대상이 같은 섹션 안에 없습니다.',
    }),
    meta({
      id: 'CTX006',
      name: 'relative-time',
      axis: 'context',
      defaultSeverity: 'info',
      llm: true,
      description: '"현재", "최근", "다음 주"처럼 절대 시점이 없는 시간 표현입니다.',
    }),
    meta({
      id: 'CTX007',
      name: 'decision-without-rationale',
      axis: 'context',
      defaultSeverity: 'warning',
      llm: true,
      appliesTo: ['design', 'meeting-notes', 'requirement'],
      description: '결정만 있고 근거나 검토한 대안이 없습니다.',
    }),
    meta({
      id: 'CTX008',
      name: 'section-topic-drift',
      axis: 'context',
      defaultSeverity: 'warning',
      llm: true,
      description: '섹션 제목과 실제 내용이 어긋납니다.',
    }),
    meta({
      id: 'CTX009',
      name: 'external-assumption',
      axis: 'context',
      defaultSeverity: 'info',
      llm: true,
      description: '문서 밖에 있는 전제에 의존해야 문장이 성립합니다.',
    }),

    // ── 메타데이터 & 최신성 ──────────────────────────────────────────────
    meta({
      id: 'META001',
      name: 'title-not-descriptive',
      axis: 'metadata',
      defaultSeverity: 'warning',
      llm: true,
      description: '제목이 내용을 대변하지 못합니다.',
    }),
    meta({
      id: 'META002',
      name: 'missing-summary',
      axis: 'metadata',
      defaultSeverity: 'warning',
      description: '긴 문서인데 요약이나 TL;DR이 없습니다.',
      defaultOptions: { minChars: 1200 },
    }),
    meta({
      id: 'META003',
      name: 'no-labels',
      axis: 'metadata',
      defaultSeverity: 'info',
      description: '라벨이 하나도 없습니다.',
    }),
    meta({
      id: 'META004',
      name: 'no-owner',
      axis: 'metadata',
      defaultSeverity: 'info',
      description: '문서 소유자나 담당자가 기재되지 않았습니다.',
    }),
    meta({
      id: 'META005',
      name: 'stale-document',
      axis: 'metadata',
      defaultSeverity: 'info',
      description: '최종 수정 후 오랜 시간이 지났습니다.',
      defaultOptions: { staleMonths: 12 },
    }),
    meta({
      id: 'META006',
      name: 'broken-link',
      axis: 'metadata',
      defaultSeverity: 'warning',
      description: '깨진 링크가 있습니다.',
    }),
    meta({
      id: 'META007',
      name: 'missing-required-section',
      axis: 'metadata',
      defaultSeverity: 'error',
      llm: true,
      description: '이 문서 유형에 필요한 섹션이 빠졌습니다.',
    }),
    meta({
      id: 'META008',
      name: 'draft-marker',
      axis: 'metadata',
      defaultSeverity: 'warning',
      description: 'TBD, 작성중 같은 미완성 표식이 남아 있습니다.',
    }),
  ].map((m) => [m.id, m]),
)

export const RULE_IDS = Object.keys(RULE_META)

/** LLM이 판정할 수 있는 룰. 구조화 출력 스키마의 enum과 프롬프트 생성에 쓴다. */
export const LLM_RULE_IDS = RULE_IDS.filter((id) => RULE_META[id]!.llm)
