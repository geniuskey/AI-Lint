import { requestTrace } from '@ai-lint/backend-client'
import type { TraceReport } from '@ai-lint/contract'
import { SEVERITY_LABELS } from '@ai-lint/labels'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { useState, type JSX } from 'react'
import { summaryText, toTraceHtml, toTraceXlsx } from '../core/export-trace.js'
import { toBackendSettings, type DesktopSettings } from '../core/settings.js'
import { pickSavePath, saveFile } from '../platform/tauri.js'

export interface TraceTabProps {
  settings: DesktopSettings
  token: string
}

const stamp = (): string => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

export function TraceTab({ settings, token }: TraceTabProps): JSX.Element {
  const [report, setReport] = useState<TraceReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [useLlm, setUseLlm] = useState(true)

  const onRun = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    try {
      setReport(await requestTrace({ useLlm }, toBackendSettings(settings, token), tauriFetch))
    } catch (cause) {
      setReport(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(false)
    }
  }

  const onExportHtml = async (): Promise<void> => {
    if (report === null) return
    const path = await pickSavePath(`ai-lint-trace-${stamp()}.html`)
    if (path === null) return
    await saveFile(path, new TextEncoder().encode(toTraceHtml(report, new Date().toLocaleString('ko-KR'))))
  }

  const onExportXlsx = async (): Promise<void> => {
    if (report === null) return
    const path = await pickSavePath(`ai-lint-trace-${stamp()}.xlsx`)
    if (path === null) return
    await saveFile(path, toTraceXlsx(report))
  }

  return (
    <>
      <section className="card actions">
        <button type="button" className="primary" onClick={() => void onRun()} disabled={running}>코퍼스 조회</button>
        <label className="inline">
          <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} disabled={running} />
          AI 대조 사용
        </label>
        <button type="button" onClick={() => void onExportHtml()} disabled={running || report === null}>
          HTML 저장
        </button>
        <button type="button" onClick={() => void onExportXlsx()} disabled={running || report === null}>
          Excel 저장
        </button>
      </section>

      {error !== null ? <p className="error">{error}</p> : null}
      {report === null ? (
        <p className="muted">코퍼스를 조회하면 지금까지 검사한 문서들의 추적성을 확인할 수 있습니다.</p>
      ) : (
        <section className="report">
          <p>{summaryText(report)}</p>
          {report.documentCount === 0 ? (
            <p className="muted">아직 검사한 문서가 없습니다. 문서 검사 탭에서 먼저 검사하세요.</p>
          ) : (
            <table className="trace">
              <thead>
                <tr><th>심각도</th><th>규칙</th><th>식별자</th><th>문서</th><th>내용</th></tr>
              </thead>
              <tbody>
                {report.findings.map((finding) => (
                  <tr key={finding.id}>
                    <td className={`sev-${finding.severity}`}>{SEVERITY_LABELS[finding.severity]}</td>
                    <td>{finding.ruleId}</td>
                    <td>{finding.subjectId ?? ''}</td>
                    <td>{finding.documents.map((d) => d.title).join(', ')}</td>
                    <td>
                      <p className="finding-message">{finding.message}</p>
                      <p className="muted">{finding.why}</p>
                      {finding.evidence !== null ? <pre className="evidence">{finding.evidence}</pre> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  )
}
