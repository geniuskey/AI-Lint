// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BlockOfKind, Document } from '@ai-lint/ir'
import { beforeAll, describe, expect, it } from 'vitest'
import { docxToDocument } from '../src/docx.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(here, 'fixtures', name)))

describe('docxToDocument', () => {
  let doc: Document

  beforeAll(() => {
    doc = docxToDocument(fixture('guide.docx'), { uri: 'C:\\docs\\guide.docx' })
  })

  it('제목 스타일을 heading 블록으로 만든다', () => {
    const heading = doc.blocks.find((b): b is BlockOfKind<'heading'> => b.kind === 'heading')
    expect(heading?.level).toBe(1)
    expect(heading?.text).toBe('설치 가이드')
  })

  it('굵고 큰 가짜 제목은 문단으로 두되 표시를 남긴다', () => {
    const fake = doc.blocks.find(
      (b): b is BlockOfKind<'paragraph'> => b.kind === 'paragraph' && b.text === '사전 준비물',
    )
    expect(fake?.emphasizedAsHeading).toBe(true)
  })

  it('평범한 문단에는 표시를 남기지 않는다', () => {
    const normal = doc.blocks.find(
      (b): b is BlockOfKind<'paragraph'> => b.kind === 'paragraph' && b.text.startsWith('이 문서는'),
    )
    expect(normal?.emphasizedAsHeading).toBeUndefined()
  })

  it('연속된 글머리 기호 문단을 한 목록으로 묶는다', () => {
    const list = doc.blocks.find((b): b is BlockOfKind<'list'> => b.kind === 'list')
    expect(list?.ordered).toBe(false)
    expect(list?.items).toEqual(['관리자 권한 계정', '사내 네트워크 접속'])
    expect(list?.depth).toBe(0)
  })

  it('머리글 행이 지정된 표는 헤더를 가진다', () => {
    const table = doc.blocks.find((b): b is BlockOfKind<'table'> => b.kind === 'table')
    expect(table?.headers).toEqual(['항목', '값'])
    expect(table?.rows).toEqual([
      ['최소 메모리', '8GB'],
      ['디스크', '2GB'],
    ])
    expect(table?.isLayoutTable).toBe(false)
  })

  it('앵커에 본문 문단 번호를 담는다', () => {
    const anchors = doc.blocks.map((b) => b.anchor)
    expect(anchors[0]).toEqual({ kind: 'docx', paragraphIndex: 0 })
    expect(anchors.every((a) => a.kind === 'docx')).toBe(true)
  })

  it('문서 속성에서 제목과 작성자를 읽는다', () => {
    expect(doc.title).toBe('설치 가이드')
    expect(doc.source.author).toBe('테스터')
    expect(doc.source.kind).toBe('docx')
    expect(doc.source.uri).toBe('C:\\docs\\guide.docx')
  })
})
