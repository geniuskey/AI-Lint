import type { JSX } from 'react'
import { countBySeverity } from '../core/describe.js'
import type { JobState } from '../core/lint-file.js'

const PHASE_LABELS: Record<JobState['phase'], string> = {
  pending: '대기',
  parsing: '읽는 중',
  linting: '검사 중',
  done: '완료',
  failed: '실패',
}

function Counts({ job }: { job: JobState }): JSX.Element {
  if (job.report === null) return <span className="muted">-</span>
  const counts = countBySeverity(job.report.findings)
  return (
    <span className="counts">
      <span className="sev-error">{counts.error}</span>
      <span className="sev-warning">{counts.warning}</span>
      <span className="sev-info">{counts.info}</span>
    </span>
  )
}

export function JobTable({
  jobs,
  selected,
  onSelect,
}: {
  jobs: readonly JobState[]
  selected: number
  onSelect(index: number): void
}): JSX.Element {
  if (jobs.length === 0) return <p className="muted">파일이나 폴더를 선택하세요.</p>

  return (
    <table className="jobs">
      <thead>
        <tr>
          <th>파일</th>
          <th>상태</th>
          <th>점수</th>
          <th>오류·경고·정보</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job, index) => (
          <tr
            key={job.file.path}
            className={index === selected ? 'selected' : undefined}
            onClick={() => onSelect(index)}
          >
            <td title={job.file.path}>{job.file.name}</td>
            <td>{job.error === null ? PHASE_LABELS[job.phase] : job.error}</td>
            <td>{job.report === null ? '-' : `${job.report.score.total} (${job.report.score.grade})`}</td>
            <td>
              <Counts job={job} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
