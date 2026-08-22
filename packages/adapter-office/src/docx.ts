import {
  BlockList,
  makeDocument,
  titleFrom,
  type BlockBody,
  type Document,
  type FileContext,
  type SourceAnchor,
} from '@ai-lint/ir'
import { attr, childOf, childrenOf, findDescendant, findDescendants, localOf, textOf } from '@ai-lint/xml'
import { coreProperties, mergeContext, openPackage, parsePart, relationships, type Package } from './ooxml.js'

/** Word 기본 글자 크기(11pt)를 half-point로 적은 값 */
const DEFAULT_SIZE = 22

const child = (el: Element | null, query: string): Element | null =>
  el === null ? null : childOf(el, query)

const attrOf = (el: Element | null, name: string): string | null => (el === null ? null : attr(el, name))

const numberOf = (el: Element | null, name: string): number | null => {
  const raw = attrOf(el, name)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

/** `<w:b/>`처럼 값이 없으면 켜진 것이다. */
const isOn = (el: Element | null): boolean => {
  if (el === null) return false
  const val = attr(el, 'w:val')
  return val === null || !['0', 'false', 'off'].includes(val)
}

function median(values: number[]): number {
  if (values.length === 0) return DEFAULT_SIZE
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

/** styleId → 제목 단계. Word가 스타일 ID를 지역화해도 w:name이나 outlineLvl로 잡는다. */
function headingLevels(pkg: Package): Map<string, number> {
  const levels = new Map<string, number>()
  const styles = parsePart(pkg, 'word/styles.xml')
  if (styles === null) return levels

  for (const style of findDescendants(styles, 'style')) {
    const id = attr(style, 'w:styleId')
    if (id === null) continue

    const byName = /^heading\s*([1-6])$/i.exec(attrOf(childOf(style, 'name'), 'w:val') ?? '')
    if (byName) {
      levels.set(id, Number(byName[1]))
      continue
    }
    const outline = numberOf(findDescendant(style, 'outlineLvl'), 'w:val')
    if (outline !== null && outline >= 0 && outline <= 5) levels.set(id, outline + 1)
  }
  return levels
}

function defaultSizeOf(pkg: Package): number {
  const styles = parsePart(pkg, 'word/styles.xml')
  const defaults = styles === null ? null : findDescendant(styles, 'docDefaults')
  const rPr = defaults === null ? null : findDescendant(defaults, 'rPrDefault')
  return numberOf(rPr === null ? null : findDescendant(rPr, 'sz'), 'w:val') ?? DEFAULT_SIZE
}

/** numId → 번호 목록 여부. 서식이 bullet이면 글머리 기호다. */
function orderedByNumId(pkg: Package): Map<string, boolean> {
  const result = new Map<string, boolean>()
  const root = parsePart(pkg, 'word/numbering.xml')
  if (root === null) return result

  const formats = new Map<string, boolean>()
  for (const abstract of findDescendants(root, 'abstractNum')) {
    const id = attr(abstract, 'w:abstractNumId')
    if (id === null) continue
    const fmt = attrOf(child(childOf(abstract, 'lvl'), 'numFmt'), 'w:val')
    formats.set(id, fmt !== 'bullet' && fmt !== 'none')
  }
  for (const num of findDescendants(root, 'num')) {
    const numId = attr(num, 'w:numId')
    const abstractId = attrOf(childOf(num, 'abstractNumId'), 'w:val')
    if (numId === null || abstractId === null) continue
    result.set(numId, formats.get(abstractId) ?? false)
  }
  return result
}

interface Para {
  text: string
  level: number | null
  numId: string | null
  ilvl: number
  allBold: boolean
  maxSize: number
  sizes: number[]
}

function readPara(el: Element, levels: Map<string, number>, fallbackSize: number): Para {
  const pPr = childOf(el, 'pPr')
  const styleId = attrOf(child(pPr, 'pStyle'), 'w:val')
  const numPr = child(pPr, 'numPr')
  const paraRPr = child(pPr, 'rPr')
  const paraBold = isOn(child(paraRPr, 'b'))
  const paraSize = numberOf(child(paraRPr, 'sz'), 'w:val')

  const runs = childrenOf(el, 'r')
  const sizes: number[] = []
  let allBold = runs.length > 0
  let maxSize = 0
  let text = ''

  for (const run of runs) {
    const rPr = childOf(run, 'rPr')
    const runText = childrenOf(run, 't')
      .map((t) => t.textContent ?? '')
      .join('')
    if (runText.length === 0) continue

    if (!(isOn(child(rPr, 'b')) || paraBold)) allBold = false
    const size = numberOf(child(rPr, 'sz'), 'w:val') ?? paraSize ?? fallbackSize
    sizes.push(size)
    maxSize = Math.max(maxSize, size)
    text += runText
  }
  if (text.length === 0) allBold = false

  return {
    text: text.replace(/\s+/g, ' ').trim(),
    level: styleId === null ? null : levels.get(styleId) ?? null,
    numId: attrOf(child(numPr, 'numId'), 'w:val'),
    ilvl: numberOf(child(numPr, 'ilvl'), 'w:val') ?? 0,
    allBold,
    maxSize: maxSize === 0 ? fallbackSize : maxSize,
    sizes,
  }
}

/** 머리글 행으로 지정됐거나 첫 행이 통째로 굵으면 헤더로 본다. */
function tableBody(el: Element): BlockBody {
  const trs = childrenOf(el, 'tr')
  const rows = trs.map((row) =>
    childrenOf(row, 'tc').map((cell) =>
      childrenOf(cell, 'p')
        .map((p) => textOf(p))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    ),
  )

  const first = rows[0]
  const firstTr = trs[0]
  const runs = firstTr === undefined ? [] : findDescendants(firstTr, 'r')
  const marked = isOn(child(child(firstTr ?? null, 'trPr'), 'tblHeader'))
  const allBold = runs.length > 0 && runs.every((run) => isOn(child(childOf(run, 'rPr'), 'b')))
  const hasHeader =
    first !== undefined && rows.length > 1 && first.every((c) => c.length > 0) && (marked || allBold)

  return hasHeader
    ? { kind: 'table', headers: first, rows: rows.slice(1), isLayoutTable: false }
    : { kind: 'table', headers: [], rows, isLayoutTable: false }
}

export function docxToDocument(bytes: Uint8Array, ctx: FileContext): Document {
  const pkg = openPackage(bytes)
  const document = parsePart(pkg, 'word/document.xml')
  const body = document === null ? null : findDescendant(document, 'body')
  const list = new BlockList()

  if (body !== null) {
    const levels = headingLevels(pkg)
    const fallbackSize = defaultSizeOf(pkg)
    const ordered = orderedByNumId(pkg)
    const rels = relationships(pkg, 'word/document.xml')
    const children = Array.from(body.children)

    const paras = children.map((el) =>
      localOf(el) === 'p' ? readPara(el, levels, fallbackSize) : null,
    )
    // 본문 글자 크기 중앙값. 제목 스타일 문단은 기준에서 뺀다.
    const bodySize = median(paras.flatMap((p) => (p !== null && p.level === null ? p.sizes : [])))

    let cursor = 0
    while (cursor < children.length) {
      const el = children[cursor]!
      const anchor: SourceAnchor = { kind: 'docx', paragraphIndex: cursor }

      if (localOf(el) === 'tbl') {
        list.add(tableBody(el), anchor)
        cursor += 1
        continue
      }

      const para = paras[cursor] ?? null
      if (para === null) {
        cursor += 1
        continue
      }

      const drawing = findDescendant(el, 'docPr')
      if (drawing !== null) {
        const alt = (attr(drawing, 'descr') ?? '').trim()
        const embed = attrOf(findDescendant(el, 'blip'), 'r:embed')
        const target = embed === null ? undefined : rels.get(embed)?.target
        list.add(
          {
            kind: 'image',
            assetRef: target ?? attr(drawing, 'name') ?? 'image',
            ...(alt.length > 0 ? { alt } : {}),
          },
          anchor,
        )
        cursor += 1
        continue
      }

      if (para.text.length === 0) {
        cursor += 1
        continue
      }

      if (para.level !== null) {
        list.add({ kind: 'heading', level: para.level, text: para.text }, anchor)
        cursor += 1
        continue
      }

      if (para.numId !== null) {
        const items: string[] = []
        let end = cursor
        while (end < children.length) {
          const next = paras[end]
          if (!next || next.numId !== para.numId || next.ilvl !== para.ilvl || next.text.length === 0) break
          items.push(next.text)
          end += 1
        }
        list.add(
          { kind: 'list', ordered: ordered.get(para.numId) ?? false, items, depth: para.ilvl },
          anchor,
        )
        cursor = end
        continue
      }

      // 가짜 제목: 스타일 없음 + 모든 런이 굵게 + 본문보다 2pt(4 half-point) 이상 큼 + 짧음
      const fake = para.allBold && para.maxSize >= bodySize + 4 && para.text.length < 80
      list.add({ kind: 'paragraph', text: para.text, ...(fake ? { emphasizedAsHeading: true } : {}) }, anchor)
      cursor += 1
    }
  }

  const core = coreProperties(pkg)
  return makeDocument('docx', mergeContext(ctx, core), titleFrom(core.title, ctx), list.all())
}
