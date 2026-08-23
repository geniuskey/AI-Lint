import type { TraceDocumentRef, TraceFinding } from '@ai-lint/contract'
import type { Severity } from '@ai-lint/rules'
import type { DocIndexEntry } from './entry.js'
import type { TraceGraph } from './graph.js'

export interface TraceRuleMeta {
  severity: Severity
  message: string
}

/** RULE_META에는 넣지 않는다. 이 룰들은 단일 문서 검사에서 실행될 수 없다. */
export const TRACE_RULES = {
  TRC001: { severity: 'error', message: '정의되지 않은 식별자를 참조합니다' },
  TRC002: { severity: 'warning', message: '설계 문서가 요구사항을 참조하지 않습니다' },
  TRC003: { severity: 'warning', message: '요구사항에 연결된 테스트가 없습니다' },
  TRC004: { severity: 'error', message: '같은 식별자를 두 문서가 정의합니다' },
  TRC005: { severity: 'info', message: '링크 대상 문서가 인덱스에 없습니다' },
  TRC006: { severity: 'error', message: '같은 식별자에 대한 서술이 서로 어긋납니다' },
} as const satisfies Record<string, TraceRuleMeta>

export type TraceRuleId = keyof typeof TRACE_RULES

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

const refOf = (entry: DocIndexEntry): TraceDocumentRef => ({ uri: entry.uri, title: entry.title })

const refsOf = (graph: TraceGraph, uris: readonly string[]): TraceDocumentRef[] =>
  uris
    .map((uri) => graph.byUri.get(uri))
    .filter((entry): entry is DocIndexEntry => entry !== undefined)
    .map(refOf)

function finding(
  ruleId: TraceRuleId,
  id: string,
  why: string,
  documents: TraceDocumentRef[],
  subjectId: string | null,
): TraceFinding {
  const meta = TRACE_RULES[ruleId]
  return {
    id,
    ruleId,
    severity: meta.severity,
    message: meta.message,
    why,
    documents,
    subjectId,
    evidence: null,
    source: 'rule',
    confidence: 1,
  }
}

function undefinedReferences(graph: TraceGraph): TraceFinding[] {
  const findings: TraceFinding[] = []
  for (const [id, uris] of graph.referencedBy) {
    if ((graph.definedBy.get(id)?.length ?? 0) > 0) continue
    findings.push(
      finding(
        'TRC001',
        `TRC001:${id}`,
        `${id}을(를) 정의하는 문서가 인덱스에 없습니다. 원본 문서를 검사해 인덱스에 넣거나 참조를 고치세요.`,
        refsOf(graph, uris),
        id,
      ),
    )
  }
  return findings
}

function designsWithoutRequirements(graph: TraceGraph): TraceFinding[] {
  return graph.entries
    .filter((entry) => entry.docType === 'design')
    .filter((entry) => !entry.mentions.some((m) => m.kind === 'requirement'))
    .map((entry) =>
      finding(
        'TRC002',
        `TRC002:${entry.uri}`,
        '이 설계가 어떤 요구사항을 푸는지 문서만 보고는 알 수 없습니다. 요구사항 식별자를 본문에 적으세요.',
        [refOf(entry)],
        null,
      ),
    )
}

function untestedRequirements(graph: TraceGraph): TraceFinding[] {
  const findings: TraceFinding[] = []
  for (const [id, definers] of graph.definedBy) {
    if (graph.kinds.get(id) !== 'requirement') continue

    const tested = (graph.referencedBy.get(id) ?? []).some(
      (uri) => graph.byUri.get(uri)?.mentions.some((m) => m.kind === 'test') === true,
    )
    if (tested) continue

    findings.push(
      finding(
        'TRC003',
        `TRC003:${id}`,
        `${id}을(를) 참조하는 문서 중 테스트 식별자를 가진 것이 없습니다. 검증 근거가 문서로 남지 않았습니다.`,
        refsOf(graph, definers),
        id,
      ),
    )
  }
  return findings
}

function duplicateDefinitions(graph: TraceGraph): TraceFinding[] {
  const findings: TraceFinding[] = []
  for (const [id, uris] of graph.definedBy) {
    if (uris.length < 2) continue
    findings.push(
      finding(
        'TRC004',
        `TRC004:${id}`,
        `${id}을(를) ${uris.length}개 문서가 정의합니다. 어느 쪽이 원본인지 알 수 없습니다.`,
        refsOf(graph, uris),
        id,
      ),
    )
  }
  return findings
}

function danglingLinks(graph: TraceGraph): TraceFinding[] {
  const findings: TraceFinding[] = []
  for (const entry of graph.entries) {
    for (const target of entry.linksTo) {
      if (graph.byUri.has(target)) continue
      findings.push(
        finding(
          'TRC005',
          `TRC005:${entry.uri}:${target}`,
          `${target}이(가) 인덱스에 없습니다. 끊긴 링크이거나 아직 검사하지 않은 문서입니다.`,
          [refOf(entry)],
          null,
        ),
      )
    }
  }
  return findings
}

export function sortTraceFindings(findings: readonly TraceFinding[]): TraceFinding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.id.localeCompare(b.id),
  )
}

export function runTraceChecks(graph: TraceGraph): TraceFinding[] {
  return sortTraceFindings([
    ...undefinedReferences(graph),
    ...designsWithoutRequirements(graph),
    ...untestedRequirements(graph),
    ...duplicateDefinitions(graph),
    ...danglingLinks(graph),
  ])
}
