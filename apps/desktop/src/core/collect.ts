export type DocExt = 'pptx' | 'docx' | 'xlsx' | 'pdf'

const EXTS: DocExt[] = ['pptx', 'docx', 'xlsx', 'pdf']

export interface RawEntry {
  name: string
  path: string
  isDir: boolean
  modifiedMs: number | null
}

export interface FileSystem {
  listDir(path: string): Promise<RawEntry[]>
}

export interface DocumentFile {
  path: string
  name: string
  ext: DocExt
  modifiedAt?: string
}

export function extOf(name: string): DocExt | null {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return null
  const ext = name.slice(dot + 1).toLowerCase()
  return EXTS.find((candidate) => candidate === ext) ?? null
}

/** `~$`로 시작하는 것은 Office가 문서를 열어둘 때 만드는 잠금 파일이다. */
export const isCollectible = (name: string): boolean => !name.startsWith('~$') && extOf(name) !== null

const fileOf = (entry: RawEntry, ext: DocExt): DocumentFile => ({
  path: entry.path,
  name: entry.name,
  ext,
  ...(entry.modifiedMs === null ? {} : { modifiedAt: new Date(entry.modifiedMs).toISOString() }),
})

export async function collectDocuments(
  fs: FileSystem,
  root: string,
  maxDepth = 8,
): Promise<DocumentFile[]> {
  if (maxDepth < 0) return []

  let entries: RawEntry[]
  try {
    entries = await fs.listDir(root)
  } catch {
    // 접근 권한이 없는 폴더 하나 때문에 수집 전체를 멈추지 않는다.
    return []
  }

  const found: DocumentFile[] = []
  for (const entry of entries) {
    if (entry.isDir) {
      found.push(...(await collectDocuments(fs, entry.path, maxDepth - 1)))
      continue
    }
    const ext = extOf(entry.name)
    if (ext === null || !isCollectible(entry.name)) continue
    found.push(fileOf(entry, ext))
  }
  return found
}
