import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { FileSystem, RawEntry } from '../core/collect.js'
import type { JsonStore, TokenStore } from '../core/settings.js'

export const fileSystem: FileSystem = {
  listDir: (path) => invoke<RawEntry[]>('list_dir', { path }),
}

export const settingsStore: JsonStore = {
  read: () => invoke<string | null>('read_settings'),
  write: (json) => invoke<void>('write_settings', { json }),
}

export const tokenStore: TokenStore = {
  read: () => invoke<string | null>('read_token'),
  write: (token) => invoke<void>('write_token', { token }),
}

export async function readDocument(path: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>('read_document', { path }))
}

export const saveFile = (path: string, bytes: Uint8Array): Promise<void> =>
  invoke<void>('save_file', { path, contents: Array.from(bytes) })

export async function pickFiles(): Promise<string[]> {
  const picked = await open({
    multiple: true,
    filters: [{ name: '문서', extensions: ['pptx', 'docx', 'xlsx', 'pdf'] }],
  })
  if (picked === null) return []
  return Array.isArray(picked) ? picked : [picked]
}

export async function pickFolder(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false })
  return typeof picked === 'string' ? picked : null
}

export const pickSavePath = (defaultName: string): Promise<string | null> =>
  save({ defaultPath: defaultName })
