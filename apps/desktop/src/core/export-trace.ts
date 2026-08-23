import type { TraceFinding, TraceReport } from '@ai-lint/contract'
import { SEVERITY_LABELS } from '@ai-lint/labels'
import { escapeHtml, htmlPage } from './export-html.js'
import { buildXlsx } from './xlsx-writer.js'

const HEADERS = ['심각도', '규칙', '식별자', '문서', '내용', '이유']

const cells = (finding: TraceFinding): string[] => [
  SEVERITY_LABELS[finding.severity],
  finding.ruleId,
  finding.subjectId ?? '',
  finding.documents.map((d) => `${d.title} (${d.uri})`).join('\n'),
  finding.message,
  finding.evidence === null ? finding.why : `${finding.why}\n${finding.evidence}`,
]

export function summaryText(report: TraceReport): string {
  const base = `문서 ${report.documentCount}개, 식별자 ${report.idCount}개에서 ${report.findings.length}건을 찾았습니다.`
  return report.truncated
    ? `${base} 문서 쌍 ${report.stats.pairsConsidered}개 중 ${report.stats.pairsAnalyzed}개만 AI로 대조했습니다.`
    : base
}

export function toTraceHtml(report: TraceReport, generatedAt: string): string {
  const rows = report.findings
    .map(
      (f) =>
        `<tr>${cells(f)
          .map((c) => `<td>${escapeHtml(c).replace(/\n/g, '<br>')}</td>`)
          .join('')}</tr>`,
    )
    .join('')

  return htmlPage(
    '추적성 검사 결과',
    [
      '<h1>추적성 검사 결과</h1>',
      `<p class="muted">${escapeHtml(generatedAt)}</p>`,
      `<p>${escapeHtml(summaryText(report))}</p>`,
      `<table class="trace"><thead><tr>${HEADERS.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`,
    ].join(''),
  )
}

export const toTraceXlsx = (report: TraceReport): Uint8Array =>
  buildXlsx([{ name: '추적성', rows: [HEADERS, ...report.findings.map(cells)] }])
