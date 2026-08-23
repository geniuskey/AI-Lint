import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { useEffect, useRef, useState, type JSX } from 'react'
import { collectDocuments, extOf, type DocumentFile } from './core/collect.js'
import { toHtml } from './core/export-html.js'
import { toXlsx } from './core/export-xlsx.js'
import { defaultUseLlm, initialJobs, runLintQueue, type JobState } from './core/lint-file.js'
import { parseDocument } from './core/parse-file.js'
import {
  DEFAULT_DESKTOP_SETTINGS, loadSettings, saveSettings, toBackendSettings, type DesktopSettings,
} from './core/settings.js'
import {
  fileSystem, pickFiles, pickFolder, pickSavePath, readDocument, saveFile, settingsStore, tokenStore,
} from './platform/tauri.js'
import { JobTable } from './ui/JobTable.js'
import { ReportView } from './ui/ReportView.js'
import { TraceTab } from './ui/TraceTab.js'

function fileOfPath(path: string): DocumentFile | null {
  const name = path.split(/[\\/]/).pop() ?? path
  const ext = extOf(name)
  return ext === null ? null : { path, name, ext }
}

const stamp = (): string => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

export function App(): JSX.Element {
  const [settings, setSettings] = useState<DesktopSettings>(DEFAULT_DESKTOP_SETTINGS)
  const [token, setToken] = useState('')
  const [files, setFiles] = useState<DocumentFile[]>([])
  const [jobs, setJobs] = useState<JobState[]>([])
  const [running, setRunning] = useState(false)
  const [useLlm, setUseLlm] = useState(true)
  const [selected, setSelected] = useState(0)
  const [tab, setTab] = useState<'lint' | 'trace'>('lint')
  const cancelRef = useRef(false)

  useEffect(() => {
    void (async () => {
      setSettings(await loadSettings(settingsStore))
      setToken((await tokenStore.read()) ?? '')
    })()
  }, [])

  const loadFiles = (found: DocumentFile[]): void => {
    setFiles(found)
    setJobs(initialJobs(found))
    setUseLlm(defaultUseLlm(found.length))
    setSelected(0)
  }

  const onPickFolder = async (): Promise<void> => {
    const folder = await pickFolder()
    if (folder === null) return
    loadFiles(await collectDocuments(fileSystem, folder))
  }

  const onPickFiles = async (): Promise<void> => {
    const paths = await pickFiles()
    loadFiles(paths.map(fileOfPath).filter((file): file is DocumentFile => file !== null))
  }

  const onRun = async (): Promise<void> => {
    cancelRef.current = false
    setRunning(true)
    setJobs(initialJobs(files))
    try {
      await runLintQueue(
        { parse: (file) => parseDocument({ read: readDocument }, file), fetchImpl: tauriFetch },
        files,
        toBackendSettings(settings, token),
        {
          useLlm,
          concurrency: settings.concurrency,
          cancelled: () => cancelRef.current,
          onChange: (index, state) =>
            setJobs((prev) => prev.map((job, i) => (i === index ? state : job))),
        },
      )
    } finally {
      setRunning(false)
    }
  }

  const onExportHtml = async (): Promise<void> => {
    const path = await pickSavePath(`ai-lint-${stamp()}.html`)
    if (path === null) return
    await saveFile(path, new TextEncoder().encode(toHtml(jobs, new Date().toLocaleString('ko-KR'))))
  }

  const onExportXlsx = async (): Promise<void> => {
    const path = await pickSavePath(`ai-lint-${stamp()}.xlsx`)
    if (path === null) return
    await saveFile(path, toXlsx(jobs))
  }

  return (
    <main className="app">
      <h1>AI Lint</h1>

      <nav className="tabs">
        <button type="button" className={tab === 'lint' ? 'active' : ''} onClick={() => setTab('lint')}>
          문서 검사
        </button>
        <button type="button" className={tab === 'trace' ? 'active' : ''} onClick={() => setTab('trace')}>
          추적성
        </button>
      </nav>

      <section className="settings">
        <label>
          백엔드 주소
          <input
            value={settings.backendUrl}
            onChange={(e) => setSettings({ ...settings, backendUrl: e.target.value })}
            onBlur={() => void saveSettings(settingsStore, { backendUrl: settings.backendUrl }).then(setSettings)}
            placeholder="http://localhost:3000"
          />
        </label>
        <label>
          서비스 토큰
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onBlur={() => void tokenStore.write(token)}
          />
        </label>
      </section>

      {tab === 'trace' ? (
        <TraceTab settings={settings} token={token} />
      ) : (
        <>
          <section className="actions">
            <button type="button" onClick={() => void onPickFiles()} disabled={running}>파일 선택</button>
            <button type="button" onClick={() => void onPickFolder()} disabled={running}>폴더 선택</button>
            <label className="inline">
              <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} disabled={running} />
              AI 검사 사용
            </label>
            <button type="button" onClick={() => void onRun()} disabled={running || files.length === 0}>
              검사 시작
            </button>
            {running ? (
              <button type="button" onClick={() => { cancelRef.current = true }}>취소</button>
            ) : null}
            <button type="button" onClick={() => void onExportHtml()} disabled={running || jobs.length === 0}>
              HTML 저장
            </button>
            <button type="button" onClick={() => void onExportXlsx()} disabled={running || jobs.length === 0}>
              Excel 저장
            </button>
          </section>

          <section className="split">
            <JobTable jobs={jobs} selected={selected} onSelect={setSelected} />
            <ReportView job={jobs[selected]} />
          </section>
        </>
      )}
    </main>
  )
}
