import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { useEffect, useRef, useState, type JSX } from 'react'
import { collectDocuments, extOf, type DocumentFile } from './core/collect.js'
import { defaultUseLlm, initialJobs, runLintQueue, type JobState } from './core/lint-file.js'
import { parseDocument } from './core/parse-file.js'
import {
  DEFAULT_DESKTOP_SETTINGS, loadSettings, saveSettings, toBackendSettings, type DesktopSettings,
} from './core/settings.js'
import {
  fileSystem, pickFiles, pickFolder, readDocument, settingsStore, tokenStore,
} from './platform/tauri.js'

const PHASE_LABELS: Record<JobState['phase'], string> = {
  pending: '대기', parsing: '읽는 중', linting: '검사 중', done: '완료', failed: '실패',
}

function fileOfPath(path: string): DocumentFile | null {
  const name = path.split(/[\\/]/).pop() ?? path
  const ext = extOf(name)
  return ext === null ? null : { path, name, ext }
}

export function App(): JSX.Element {
  const [settings, setSettings] = useState<DesktopSettings>(DEFAULT_DESKTOP_SETTINGS)
  const [token, setToken] = useState('')
  const [files, setFiles] = useState<DocumentFile[]>([])
  const [jobs, setJobs] = useState<JobState[]>([])
  const [running, setRunning] = useState(false)
  const [useLlm, setUseLlm] = useState(true)
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

  return (
    <main className="app">
      <h1>AI Lint</h1>

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
      </section>

      <ul className="jobs">
        {jobs.map((job) => (
          <li key={job.file.path}>
            <span>{job.file.name}</span>
            <span>{PHASE_LABELS[job.phase]}</span>
            {job.error === null ? null : <span className="error">{job.error}</span>}
          </li>
        ))}
      </ul>
    </main>
  )
}
