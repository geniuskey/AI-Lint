import { AXIS_LABELS, SEVERITY_LABELS } from '@ai-lint/labels'
import { countBySeverity, describeAnchor, sortFindings } from './describe.js'
import type { JobState } from './lint-file.js'
import { buildXlsx, type CellValue } from './xlsx-writer.js'

function summaryRows(jobs: readonly JobState[]): CellValue[][] {
  const rows: CellValue[][] = [['파일', '경로', '점수', '등급', '오류', '경고', '정보', '상태']]
  for (const job of jobs) {
    if (job.report === null) {
      rows.push([job.file.name, job.file.path, 0, '-', 0, 0, 0, job.error ?? '실패'])
      continue
    }
    const counts = countBySeverity(job.report.findings)
    rows.push([
      job.file.name, job.file.path, job.report.score.total, job.report.score.grade,
      counts.error, counts.warning, counts.info, '완료',
    ])
  }
  return rows
}

function findingRows(jobs: readonly JobState[]): CellValue[][] {
  const rows: CellValue[][] = [['파일', '심각도', '규칙', '축', '위치', '내용', '이유', '수정 제안']]
  for (const job of jobs) {
    if (job.report === null) continue
    for (const finding of sortFindings(job.report.findings)) {
      rows.push([
        job.file.name, SEVERITY_LABELS[finding.severity], finding.ruleId, AXIS_LABELS[finding.axis],
        describeAnchor(finding.anchor), finding.message, finding.why,
        finding.suggestion === null ? '' : finding.suggestion.after,
      ])
    }
  }
  return rows
}

export const toXlsx = (jobs: readonly JobState[]): Uint8Array =>
  buildXlsx([
    { name: '요약', rows: summaryRows(jobs) },
    { name: '지적', rows: findingRows(jobs) },
  ])
