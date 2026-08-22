import {
  BlockList,
  makeDocument,
  titleFrom,
  type BlockBody,
  type Document,
  type FileContext,
  type SourceAnchor,
} from '@ai-lint/ir'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { TextItem } from 'pdfjs-dist/types/src/display/api.js'

/** 브라우저에서만 필요하다. Node는 pdf.js가 알아서 워커 없이 돈다. */
export function setPdfWorkerSrc(src: string): void {
  GlobalWorkerOptions.workerSrc = src
}

interface Line {
  text: string
  size: number
  x: number
  y: number
  width: number
}

function linesOf(items: TextItem[]): Line[] {
  const lines: Line[] = []
  for (const item of items) {
    // 낱말 사이 공백도 별개 항목으로 온다. 버리면 글자가 다 붙어버린다.
    if (item.str === '') continue
    const size = Math.hypot(item.transform[1] ?? 0, item.transform[3] ?? 0) || 1
    const x = item.transform[4] ?? 0
    const y = item.transform[5] ?? 0
    const last = lines[lines.length - 1]
    // 같은 줄로 볼 기준: 기준선 차이가 글자 크기의 절반 이내
    if (last !== undefined && Math.abs(last.y - y) <= last.size * 0.5) {
      last.text += item.str
      last.width = Math.max(last.width, x + item.width - last.x)
      last.size = Math.max(last.size, size)
      continue
    }
    if (item.str.trim().length === 0) continue
    lines.push({ text: item.str, size, x, y, width: item.width })
  }
  return lines
    .map((line) => ({ ...line, text: line.text.replace(/\s+/g, ' ').trim() }))
    .filter((line) => line.text.length > 0)
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function headingLevel(size: number, body: number): number | null {
  if (body === 0) return null
  const ratio = size / body
  if (ratio >= 1.6) return 1
  if (ratio >= 1.35) return 2
  if (ratio >= 1.2) return 3
  return null
}

/** bbox는 PDF 사용자 좌표계의 [x, 기준선 y, 너비, 글자 높이]다. */
const anchorFor = (page: number, line: Line): SourceAnchor => ({
  kind: 'pdf',
  page,
  bbox: [line.x, line.y, line.width, line.size],
})

export async function pdfToDocument(bytes: Uint8Array, ctx: FileContext): Promise<Document> {
  const pdf = await getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false }).promise

  const pages: Line[][] = []
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const content = await (await pdf.getPage(page)).getTextContent()
    pages.push(linesOf(content.items.filter((item): item is TextItem => 'str' in item)))
  }

  const list = new BlockList()
  const bodySize = median(pages.flat().map((line) => line.size))

  pages.forEach((lines, offset) => {
    const page = offset + 1
    let buffer: Line[] = []

    const flush = (): void => {
      const first = buffer[0]
      if (first === undefined) return
      const body: BlockBody = { kind: 'paragraph', text: buffer.map((l) => l.text).join(' ') }
      list.add(body, anchorFor(page, first))
      buffer = []
    }

    for (const line of lines) {
      const level = line.text.length < 80 ? headingLevel(line.size, bodySize) : null
      if (level !== null) {
        flush()
        list.add({ kind: 'heading', level, text: line.text }, anchorFor(page, line))
        continue
      }
      buffer.push(line)
    }
    flush()
  })

  return makeDocument('pdf', ctx, titleFrom(undefined, ctx), list.all())
}
