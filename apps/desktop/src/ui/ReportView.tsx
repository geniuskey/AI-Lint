import type { LlmStatus } from '@ai-lint/contract'
import { AXIS_LABELS, DOC_TYPE_LABELS, SEVERITY_LABELS } from '@ai-lint/labels'
import type { Finding } from '@ai-lint/rules'
import type { JSX } from 'react'
import { describeAnchor, sortFindings } from '../core/describe.js'
import type { JobState } from '../core/lint-file.js'

function FindingCard({ finding }: { finding: Finding }): JSX.Element {
  return (
    <li className="finding" data-severity={finding.severity}>
      <div className="finding-head">
        <span className={`badge sev-${finding.severity}`}>{SEVERITY_LABELS[finding.severity]}</span>
        <span className="muted">{finding.ruleId}</span>
        <span className="muted">{AXIS_LABELS[finding.axis]}</span>
        <span className="muted">{describeAnchor(finding.anchor)}</span>
        {finding.source === 'llm' ? <span className="badge llm">AI</span> : null}
      </div>
      <p className="finding-message">{finding.message}</p>
      <p className="muted">{finding.why}</p>
      {finding.evidence === null ? null : <pre className="evidence">{finding.evidence}</pre>}
      {finding.suggestion === null ? null : (
        <div className="suggestion">
          <pre className="before">{finding.suggestion.before}</pre>
          <pre className="after">{finding.suggestion.after}</pre>
        </div>
      )}
    </li>
  )
}

/** `ok`가 없으므로 정상일 때는 아무 문장도 붙지 않는다. */
const LLM_NOTES: Partial<Record<LlmStatus, string>> = {
  skipped: 'AI 검사를 건너뛰었습니다. 규칙 검사 결과만 표시합니다.',
  partial: 'AI 검사 일부가 실패했습니다.',
  failed: 'AI 검사가 실패했습니다. 규칙 검사 결과만 표시합니다.',
}

export function ReportView({ job }: { job: JobState | undefined }): JSX.Element {
  if (job === undefined) return <p className="muted">왼쪽에서 파일을 고르세요.</p>
  if (job.error !== null) return <p className="error">{job.error}</p>
  if (job.report === null) return <p className="muted">아직 검사하지 않았습니다.</p>

  const { report } = job
  const note = LLM_NOTES[report.llmStatus]

  return (
    <div className="report">
      <div className="score">
        <span className={`grade grade-${report.score.grade}`}>{report.score.grade}</span>
        <strong>{report.score.total}점</strong>
        <span className="muted">{DOC_TYPE_LABELS[report.docType]}</span>
      </div>

      <ul className="axes">
        {(['structure', 'context', 'metadata'] as const).map((axis) => (
          <li key={axis}>
            {AXIS_LABELS[axis]} <strong>{report.score.axes[axis]}</strong>
          </li>
        ))}
      </ul>

      {note === undefined ? null : <p className="note">{note}</p>}
      {report.truncated ? <p className="note">문서가 길어 앞부분만 검사했습니다.</p> : null}

      <ul className="findings">
        {sortFindings(report.findings).map((finding) => (
          <FindingCard key={finding.id} finding={finding} />
        ))}
      </ul>

      {report.findings.length === 0 ? <p className="muted">지적할 내용이 없습니다.</p> : null}
    </div>
  )
}
