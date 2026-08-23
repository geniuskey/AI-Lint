import { AXIS_LABELS, DOC_TYPE_LABELS, SEVERITY_LABELS } from '@ai-lint/labels'
import type { Finding } from '@ai-lint/rules'
import { countBySeverity, describeAnchor, sortFindings } from './describe.js'
import type { JobState } from './lint-file.js'

const ENTITIES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (ch) => ENTITIES[ch]!)

const STYLE = `
body { font-family: 'Malgun Gothic', system-ui, sans-serif; margin: 24px; color: #1a1a1a; }
h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 28px; }
table { border-collapse: collapse; margin-bottom: 16px; }
th, td { border: 1px solid #d0d4da; padding: 4px 8px; text-align: left; }
th { background: #f0f3f7; }
.finding { border-top: 1px solid #e3e6ea; padding: 8px 0; }
.where { color: #6b7280; }
.error { color: #b3261e; } .warning { color: #c98a1a; } .info { color: #3f7ac2; }
pre { background: #f6f7f9; padding: 8px; white-space: pre-wrap; }
.muted { color: #6b7280; }
table.trace td { vertical-align: top; }
`

function summaryRow(job: JobState): string {
  if (job.report === null) {
    return `<tr><td>${escapeHtml(job.file.name)}</td><td colspan="5" class="error">${escapeHtml(job.error ?? '실패')}</td></tr>`
  }
  const counts = countBySeverity(job.report.findings)
  return `<tr><td>${escapeHtml(job.file.name)}</td><td>${job.report.score.total}</td><td>${job.report.score.grade}</td><td>${counts.error}</td><td>${counts.warning}</td><td>${counts.info}</td></tr>`
}

function findingHtml(finding: Finding): string {
  const suggestion =
    finding.suggestion === null
      ? ''
      : `<pre>${escapeHtml(finding.suggestion.before)}</pre><pre>${escapeHtml(finding.suggestion.after)}</pre>`
  const evidence = finding.evidence === null ? '' : `<pre>${escapeHtml(finding.evidence)}</pre>`
  return `<div class="finding">
<p><span class="${finding.severity}">${SEVERITY_LABELS[finding.severity]}</span>
${escapeHtml(finding.ruleId)} · ${AXIS_LABELS[finding.axis]}
<span class="where">${escapeHtml(describeAnchor(finding.anchor))}</span></p>
<p><strong>${escapeHtml(finding.message)}</strong></p>
<p>${escapeHtml(finding.why)}</p>${evidence}${suggestion}</div>`
}

function detailHtml(job: JobState): string {
  if (job.report === null) {
    return `<h2>${escapeHtml(job.file.name)}</h2><p class="error">${escapeHtml(job.error ?? '실패')}</p>`
  }
  const { report } = job
  const axes = (['structure', 'context', 'metadata'] as const)
    .map((axis) => `${AXIS_LABELS[axis]} ${report.score.axes[axis]}`)
    .join(' · ')
  return `<h2>${escapeHtml(job.file.name)}</h2>
<p>${escapeHtml(job.file.path)}</p>
<p>${report.score.total}점 (${report.score.grade}) · ${DOC_TYPE_LABELS[report.docType]} · ${axes}</p>
${sortFindings(report.findings).map(findingHtml).join('\n')}`
}

export const htmlPage = (title: string, body: string): string =>
  `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${STYLE}</style></head><body>
${body}
</body></html>`

export function toHtml(jobs: readonly JobState[], generatedAt: string): string {
  return htmlPage(
    'AI Lint 검사 결과',
    `<h1>AI Lint 검사 결과</h1>
<p>${escapeHtml(generatedAt)} · 파일 ${jobs.length}개</p>
<table><thead><tr><th>파일</th><th>점수</th><th>등급</th><th>오류</th><th>경고</th><th>정보</th></tr></thead>
<tbody>${jobs.map(summaryRow).join('')}</tbody></table>
${jobs.map(detailHtml).join('\n')}`,
  )
}
