import type { SourceAnchor } from '@ai-lint/ir'
import { SEVERITY_ORDER } from '@ai-lint/labels'
import type { Axis, Finding, Severity } from '@ai-lint/rules'

const AXIS_ORDER: Axis[] = ['structure', 'context', 'metadata']

/** 원본 위치로 자동 이동하지 않는 대신, 사람이 직접 찾아갈 수 있는 문장을 만든다. */
export function describeAnchor(anchor: SourceAnchor | null): string {
  if (anchor === null) return '문서 전체'
  switch (anchor.kind) {
    case 'pdf':
      return `${anchor.page}쪽`
    case 'pptx':
      return `${anchor.slide}번 슬라이드`
    case 'xlsx':
      return anchor.range === undefined ? `${anchor.sheet} 시트` : `${anchor.sheet} 시트 ${anchor.range}`
    case 'docx':
      return `${anchor.paragraphIndex + 1}번째 문단`
    case 'confluence':
      return `"${anchor.textQuote.exact}"`
  }
}

export const sortFindings = (findings: readonly Finding[]): Finding[] =>
  [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      AXIS_ORDER.indexOf(a.axis) - AXIS_ORDER.indexOf(b.axis),
  )

export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
  for (const finding of findings) counts[finding.severity] += 1
  return counts
}
