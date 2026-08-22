import { describe, expect, it } from 'vitest'
import { collectDocuments, extOf, isCollectible, type FileSystem, type RawEntry } from '../src/core/collect.js'

const dir = (name: string, path: string): RawEntry => ({ name, path, isDir: true, modifiedMs: null })
const file = (name: string, path: string, modifiedMs: number | null = 0): RawEntry => ({
  name, path, isDir: false, modifiedMs,
})

const fsOf = (tree: Record<string, RawEntry[]>): FileSystem => ({
  async listDir(path) {
    return tree[path] ?? []
  },
})

describe('extOf / isCollectible', () => {
  it('지원 확장자만 인식한다', () => {
    expect(extOf('보고서.docx')).toBe('docx')
    expect(extOf('보고서.DOCX')).toBe('docx')
    expect(extOf('보고서.hwp')).toBeNull()
    expect(extOf('확장자없음')).toBeNull()
  })

  it('Office 임시 파일은 거른다', () => {
    expect(isCollectible('~$보고서.docx')).toBe(false)
    expect(isCollectible('보고서.docx')).toBe(true)
  })
})

describe('collectDocuments', () => {
  it('하위 폴더까지 재귀로 모은다', async () => {
    const fs = fsOf({
      'C:\\d': [file('a.docx', 'C:\\d\\a.docx'), dir('sub', 'C:\\d\\sub'), file('메모.txt', 'C:\\d\\메모.txt')],
      'C:\\d\\sub': [file('b.pdf', 'C:\\d\\sub\\b.pdf'), file('~$c.xlsx', 'C:\\d\\sub\\~$c.xlsx')],
    })
    const found = await collectDocuments(fs, 'C:\\d')
    expect(found.map((f) => f.path)).toEqual(['C:\\d\\a.docx', 'C:\\d\\sub\\b.pdf'])
    expect(found[0]?.ext).toBe('docx')
  })

  it('수정 시각을 ISO 문자열로 바꾼다', async () => {
    const fs = fsOf({ 'C:\\d': [file('a.docx', 'C:\\d\\a.docx', 1_700_000_000_000)] })
    const found = await collectDocuments(fs, 'C:\\d')
    expect(found[0]?.modifiedAt).toBe(new Date(1_700_000_000_000).toISOString())
  })

  it('수정 시각이 없으면 키를 넣지 않는다', async () => {
    const fs = fsOf({ 'C:\\d': [file('a.docx', 'C:\\d\\a.docx', null)] })
    expect('modifiedAt' in (await collectDocuments(fs, 'C:\\d'))[0]!).toBe(false)
  })

  it('깊이 제한을 넘으면 내려가지 않는다', async () => {
    const fs = fsOf({
      'C:\\d': [dir('1', 'C:\\d\\1')],
      'C:\\d\\1': [file('a.docx', 'C:\\d\\1\\a.docx')],
    })
    expect(await collectDocuments(fs, 'C:\\d', 0)).toEqual([])
  })

  it('읽을 수 없는 폴더는 건너뛰고 계속한다', async () => {
    const fs: FileSystem = {
      async listDir(path) {
        if (path === 'C:\\d\\deny') throw new Error('접근 거부')
        if (path === 'C:\\d') return [dir('deny', 'C:\\d\\deny'), file('a.pdf', 'C:\\d\\a.pdf')]
        return []
      },
    }
    expect((await collectDocuments(fs, 'C:\\d')).map((f) => f.name)).toEqual(['a.pdf'])
  })
})
