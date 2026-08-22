// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BlockOfKind, Document } from '@ai-lint/ir'
import { beforeAll, describe, expect, it } from 'vitest'
import { colIndexOf, xlsxToDocument } from '../src/xlsx.js'

// vite가 `new URL(<변수>, import.meta.url)`을 에셋 참조로 고쳐 쓰므로 경로를 직접 조립한다.
const here = dirname(fileURLToPath(import.meta.url))
const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(join(here, 'fixtures', name)))

const tablesOf = (doc: Document): Array<BlockOfKind<'table'>> =>
  doc.blocks.filter((b): b is BlockOfKind<'table'> => b.kind === 'table')

const headingsOf = (doc: Document): Array<BlockOfKind<'heading'>> =>
  doc.blocks.filter((b): b is BlockOfKind<'heading'> => b.kind === 'heading')

describe('colIndexOf', () => {
  it('열 문자를 0 기준 번호로 바꾼다', () => {
    expect(colIndexOf('A1')).toBe(0)
    expect(colIndexOf('C12')).toBe(2)
    expect(colIndexOf('AA3')).toBe(26)
    expect(colIndexOf('BC100')).toBe(54)
  })
})

describe('xlsxToDocument', () => {
  let doc: Document

  beforeAll(() => {
    doc = xlsxToDocument(fixture('report.xlsx'), { uri: 'C:\\docs\\report.xlsx' })
  })

  it('시트마다 1단계 제목을 만든다', () => {
    expect(headingsOf(doc).map((h) => h.text)).toEqual(['요구사항', '집계'])
    expect(headingsOf(doc).every((h) => h.level === 1)).toBe(true)
  })

  it('빈 시트는 건너뛴다', () => {
    expect(doc.blocks.some((b) => b.kind === 'heading' && b.text === '빈시트')).toBe(false)
  })

  it('첫 행이 전부 문자열이고 아래에 숫자가 있으면 헤더로 본다', () => {
    const table = tablesOf(doc)[0]!
    expect(table.headers).toEqual(['ID', '요구사항', '우선순위'])
    expect(table.rows).toHaveLength(3)
    expect(table.rows[0]).toEqual(['REQ-001', '결제 수단을 추가할 수 있어야 한다', '1'])
    expect(table.rows[2]).toEqual(['REQ-003', '환불은 관리자만 승인한다', '1'])
  })

  it('헤더 행이 병합되면 헤더를 못 만든다', () => {
    const table = tablesOf(doc)[1]!
    expect(table.headers).toEqual([])
    expect(table.rows[0]).toEqual(['2026년 상반기 집계', ''])
    expect(table.rows[1]).toEqual(['완료', '12'])
  })

  it('앵커에 시트 이름과 범위를 담는다', () => {
    expect(tablesOf(doc)[0]!.anchor).toEqual({ kind: 'xlsx', sheet: '요구사항', range: 'A1:C4' })
    expect(tablesOf(doc)[1]!.anchor).toEqual({ kind: 'xlsx', sheet: '집계', range: 'A1:B3' })
    expect(headingsOf(doc)[0]!.anchor).toEqual({ kind: 'xlsx', sheet: '요구사항' })
  })

  it('표는 레이아웃 표가 아니다', () => {
    expect(tablesOf(doc).every((t) => t.isLayoutTable)).toBe(false)
  })

  it('문서 속성에서 제목과 작성자를 가져온다', () => {
    expect(doc.source.kind).toBe('xlsx')
    expect(doc.source.uri).toBe('C:\\docs\\report.xlsx')
    expect(doc.title).toBe('결제 모듈 요구사항')
    expect(doc.source.author).toBe('테스터')
    expect(doc.source.modifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('호출자가 준 수정 시각이 문서 속성보다 우선한다', () => {
    const other = xlsxToDocument(fixture('report.xlsx'), {
      uri: 'C:\\docs\\report.xlsx',
      modifiedAt: '2020-01-01T00:00:00Z',
    })
    expect(other.source.modifiedAt).toBe('2020-01-01T00:00:00Z')
  })

  it('블록 경로가 시트마다 올라간다', () => {
    expect(doc.blocks.map((b) => b.path)).toEqual([[1], [1], [2], [2]])
  })
})
