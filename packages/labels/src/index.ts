import type { Axis, DocType, Severity } from '@ai-lint/ir'

/** IR의 DocTypeSchema는 zod 값이라 UI에서 못 쓴다. 표시 이름과 함께 여기서 나열한다. */
export const DOC_TYPE_LABELS: Record<DocType, string> = {
  'meeting-notes': '회의록',
  requirement: '요구사항',
  design: '설계',
  guide: '가이드',
  'api-doc': 'API 문서',
  troubleshooting: '트러블슈팅',
  reference: '레퍼런스',
  unknown: '미분류',
}

export const DOC_TYPES = Object.keys(DOC_TYPE_LABELS) as DocType[]

export const SEVERITY_LABELS: Record<Severity, string> = {
  error: '오류',
  warning: '경고',
  info: '참고',
}

/** 지적 목록을 묶는 순서. 확장 패널과 데스크톱 결과 뷰가 같은 순서를 쓴다. */
export const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info']

export const AXIS_LABELS: Record<Axis, string> = {
  structure: '구조',
  context: '맥락',
  metadata: '메타데이터',
}
