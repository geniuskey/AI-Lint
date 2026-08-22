import { useEffect, useState, type JSX } from 'react'
import { collectDocuments, extOf, type DocumentFile } from './core/collect.js'
import {
  DEFAULT_DESKTOP_SETTINGS, loadSettings, saveSettings, type DesktopSettings,
} from './core/settings.js'
import { fileSystem, pickFiles, pickFolder, settingsStore, tokenStore } from './platform/tauri.js'

function fileOfPath(path: string): DocumentFile | null {
  const name = path.split(/[\\/]/).pop() ?? path
  const ext = extOf(name)
  return ext === null ? null : { path, name, ext }
}

export function App(): JSX.Element {
  const [settings, setSettings] = useState<DesktopSettings>(DEFAULT_DESKTOP_SETTINGS)
  const [token, setToken] = useState('')
  const [files, setFiles] = useState<DocumentFile[]>([])

  useEffect(() => {
    void (async () => {
      setSettings(await loadSettings(settingsStore))
      setToken((await tokenStore.read()) ?? '')
    })()
  }, [])

  const onPickFolder = async (): Promise<void> => {
    const folder = await pickFolder()
    if (folder === null) return
    setFiles(await collectDocuments(fileSystem, folder))
  }

  const onPickFiles = async (): Promise<void> => {
    const paths = await pickFiles()
    setFiles(paths.map(fileOfPath).filter((file): file is DocumentFile => file !== null))
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
        <button type="button" onClick={() => void onPickFiles()}>파일 선택</button>
        <button type="button" onClick={() => void onPickFolder()}>폴더 선택</button>
      </section>

      <p>{files.length}개 파일</p>
      <ul>
        {files.map((file) => (
          <li key={file.path}>{file.name}</li>
        ))}
      </ul>
    </main>
  )
}
