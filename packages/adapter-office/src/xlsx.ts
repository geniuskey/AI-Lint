import { BlockList, makeDocument, titleFrom, type Document, type FileContext } from '@ai-lint/ir'
import { attr, childOf, childrenOf, findDescendants, textOf } from '@ai-lint/xml'
import { coreProperties, mergeContext, openPackage, parsePart, relationships, type Package } from './ooxml.js'

export function colIndexOf(ref: string): number {
  const letters = ref.replace(/\d+$/, '').toUpperCase()
  let index = 0
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64)
  return index - 1
}

const colNameOf = (index: number): string => {
  let name = ''
  let n = index + 1
  while (n > 0) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

function siText(si: Element): string {
  const direct = childOf(si, 't')
  if (direct !== null) return textOf(direct)
  return childrenOf(si, 'r')
    .map((run) => textOf(childOf(run, 't') ?? run))
    .join('')
}

function sharedStringsOf(pkg: Package): string[] {
  const root = parsePart(pkg, 'xl/sharedStrings.xml')
  return root === null ? [] : findDescendants(root, 'si').map(siText)
}

interface CellValue {
  text: string
  numeric: boolean
}

const EMPTY: CellValue = { text: '', numeric: false }

function cellValue(cell: Element, shared: string[]): CellValue {
  const type = attr(cell, 't')
  if (type === 'inlineStr') {
    const inline = childOf(cell, 'is')
    return { text: inline === null ? '' : siText(inline), numeric: false }
  }
  const value = childOf(cell, 'v')
  const raw = value === null ? '' : textOf(value)
  if (type === 's') return { text: shared[Number(raw)] ?? '', numeric: false }
  if (type === 'b') return { text: raw === '1' ? 'TRUE' : 'FALSE', numeric: false }
  if (type === 'str' || type === 'e') return { text: raw, numeric: false }
  return { text: raw, numeric: raw.length > 0 && Number.isFinite(Number(raw)) }
}

type Grid = CellValue[][]

/** 셀에 `r`이 있으면 그 열 번호를 믿는다. 빈 셀은 XML에 아예 없기 때문이다. */
function gridOf(sheet: Element, shared: string[]): Grid {
  const rows: Grid = []
  for (const row of findDescendants(sheet, 'row')) {
    const cells: CellValue[] = []
    for (const cell of childrenOf(row, 'c')) {
      const ref = attr(cell, 'r')
      const at = ref === null ? cells.length : colIndexOf(ref)
      while (cells.length <= at) cells.push(EMPTY)
      cells[at] = cellValue(cell, shared)
    }
    rows.push(cells)
  }

  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c.text === '')) rows.pop()
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  return rows.map((row) => {
    const filled = [...row]
    while (filled.length < width) filled.push(EMPTY)
    return filled
  })
}

interface TableShape {
  headers: string[]
  rows: string[][]
}

function shapeOf(grid: Grid): TableShape {
  const start = grid.findIndex((row) => row.some((cell) => cell.text !== ''))
  if (start === -1) return { headers: [], rows: [] }

  const body = grid.slice(start)
  const first = body[0]!
  // 헤더로 인정하는 조건: 첫 행이 빈칸 없이 전부 문자열이고, 아래에 숫자 셀이 있다.
  // 병합된 헤더는 좌상단 말고 전부 빈칸이 되므로 여기서 걸러진다.
  const looksLikeHeader =
    first.every((cell) => cell.text !== '' && !cell.numeric) &&
    body.slice(1).some((row) => row.some((cell) => cell.numeric))

  const texts = (rows: Grid): string[][] => rows.map((row) => row.map((c) => c.text))
  return looksLikeHeader
    ? { headers: first.map((c) => c.text), rows: texts(body.slice(1)) }
    : { headers: [], rows: texts(body) }
}

const rangeOf = (grid: Grid): string => `A1:${colNameOf((grid[0]?.length ?? 1) - 1)}${grid.length}`

export function xlsxToDocument(bytes: Uint8Array, ctx: FileContext): Document {
  const pkg = openPackage(bytes)
  const shared = sharedStringsOf(pkg)
  const rels = relationships(pkg, 'xl/workbook.xml')
  const workbook = parsePart(pkg, 'xl/workbook.xml')
  const list = new BlockList()

  for (const entry of workbook === null ? [] : findDescendants(workbook, 'sheet')) {
    const name = attr(entry, 'name')
    const relId = attr(entry, 'r:id')
    if (name === null || relId === null) continue

    // 차트 시트는 worksheets 밑에 있지 않다. 읽을 텍스트가 없으니 건너뛴다.
    const partPath = rels.get(relId)?.target
    if (partPath === undefined || !partPath.startsWith('xl/worksheets/')) continue

    const sheet = parsePart(pkg, partPath)
    if (sheet === null) continue
    const grid = gridOf(sheet, shared)
    if (grid.length === 0) continue

    list.add({ kind: 'heading', level: 1, text: name }, { kind: 'xlsx', sheet: name })
    const shape = shapeOf(grid)
    list.add(
      { kind: 'table', headers: shape.headers, rows: shape.rows, isLayoutTable: false },
      { kind: 'xlsx', sheet: name, range: rangeOf(grid) },
    )
  }

  const core = coreProperties(pkg)
  return makeDocument('xlsx', mergeContext(ctx, core), titleFrom(core.title, ctx), list.all())
}
