// @vitest-environment node
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BlockOfKind, Document } from '@ai-lint/ir'
import { beforeAll, describe, expect, it } from 'vitest'
import { pdfToDocument } from '../src/pdf.js'

// vite가 `new URL(<변수>, import.meta.url)`을 에셋 참조로 고쳐 쓰므로 경로를 직접 조립한다.
const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(here, 'fixtures', name)))

describe('pdfToDocument', () => {
  let doc: Document

  beforeAll(async () => {
    doc = await pdfToDocument(fixture('guide.pdf'), { uri: 'C:\\docs\\guide.pdf' })
  })

  it('본문보다 큰 짧은 줄을 제목으로 본다', () => {
    const headings = doc.blocks.filter((b): b is BlockOfKind<'heading'> => b.kind === 'heading')
    expect(headings.map((h) => h.text)).toEqual(['배포 절차', '사전 확인'])
  })

  it('본문은 문단으로 남긴다', () => {
    const paras = doc.blocks.filter((b): b is BlockOfKind<'paragraph'> => b.kind === 'paragraph')
    expect(paras[0]?.text).toContain('사내 배포 도구의 실행 절차')
    expect(paras[1]?.text).toContain('배포 대상 서버 목록')
  })

  it('앵커에 쪽 번호와 좌표를 담는다', () => {
    const anchor = doc.blocks[0]!.anchor
    if (anchor.kind !== 'pdf') throw new Error('앵커 종류가 다릅니다')
    expect(anchor.page).toBe(1)
    expect(anchor.bbox).toHaveLength(4)
  })

  it('출처를 pdf로 표시한다', () => {
    expect(doc.source.kind).toBe('pdf')
    expect(doc.source.uri).toBe('C:\\docs\\guide.pdf')
  })

  it('제목이 없으면 파일명에서 만든다', () => {
    expect(doc.title).toBe('guide')
  })
})

describe('스캔 PDF', () => {
  it('텍스트가 없으면 블록 없이 끝낸다', async () => {
    const doc = await pdfToDocument(fixture('scanned.pdf'), { uri: 'C:\\docs\\scanned.pdf' })
    expect(doc.blocks).toEqual([])
    expect(doc.source.kind).toBe('pdf')
  })
})
