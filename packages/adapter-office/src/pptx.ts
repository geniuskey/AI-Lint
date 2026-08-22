import {
  BlockList,
  makeDocument,
  titleFrom,
  type BlockBody,
  type Document,
  type FileContext,
} from '@ai-lint/ir'
import { attr, childOf, childrenOf, findDescendant, findDescendants, localOf, textOf } from '@ai-lint/xml'
import {
  compareNatural,
  coreProperties,
  mergeContext,
  openPackage,
  parsePart,
  relationships,
  type Package,
  type Relationship,
} from './ooxml.js'

const attrOf = (el: Element | null, name: string): string | null => (el === null ? null : attr(el, name))

type Bullet = 'none' | 'char' | 'auto' | 'inherit'

interface ParaInfo {
  text: string
  level: number
  bullet: Bullet
}

function bulletOf(pPr: Element | null): Bullet {
  if (pPr === null) return 'inherit'
  if (childOf(pPr, 'buNone') !== null) return 'none'
  if (childOf(pPr, 'buAutoNum') !== null) return 'auto'
  if (childOf(pPr, 'buChar') !== null) return 'char'
  return 'inherit'
}

function parasOf(txBody: Element): ParaInfo[] {
  return childrenOf(txBody, 'p')
    .map((p) => {
      const pPr = childOf(p, 'pPr')
      const level = Number(attrOf(pPr, 'lvl') ?? '0')
      const text = findDescendants(p, 't')
        .map((t) => t.textContent ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
      return { text, level: Number.isFinite(level) ? level : 0, bullet: bulletOf(pPr) }
    })
    .filter((para) => para.text.length > 0)
}

function textBlocks(paras: ParaInfo[], isBodyPlaceholder: boolean): BlockBody[] {
  const listed = (para: ParaInfo): false | { ordered: boolean } => {
    if (para.bullet === 'auto') return { ordered: true }
    if (para.bullet === 'char') return { ordered: false }
    // 자리표시자 본문은 마스터에서 글머리 기호를 물려받는다. 문단이 둘 이상이면 목록으로 본다.
    if (para.bullet === 'inherit' && isBodyPlaceholder && paras.length > 1) return { ordered: false }
    return false
  }

  const blocks: BlockBody[] = []
  let cursor = 0
  while (cursor < paras.length) {
    const para = paras[cursor]!
    const mark = listed(para)
    if (mark === false) {
      blocks.push({ kind: 'paragraph', text: para.text })
      cursor += 1
      continue
    }
    const items: string[] = []
    while (cursor < paras.length) {
      const next = paras[cursor]!
      const nextMark = listed(next)
      if (nextMark === false || nextMark.ordered !== mark.ordered || next.level !== para.level) break
      items.push(next.text)
      cursor += 1
    }
    blocks.push({ kind: 'list', ordered: mark.ordered, items, depth: para.level })
  }
  return blocks
}

interface Shape {
  id: string
  blocks: BlockBody[]
  titleText: string | null
}

function readShape(el: Element, rels: Map<string, Relationship>): Shape | null {
  const name = localOf(el)
  const cNvPr = findDescendant(el, 'cNvPr')
  const id = attrOf(cNvPr, 'id') ?? ''

  if (name === 'sp') {
    const type = attrOf(findDescendant(el, 'ph'), 'type')
    const txBody = childOf(el, 'txBody')
    if (txBody === null) return null
    const paras = parasOf(txBody)
    if (paras.length === 0) return null

    if (type === 'title' || type === 'ctrTitle') {
      return { id, blocks: [], titleText: paras.map((p) => p.text).join(' ') }
    }
    const isBody = type === 'body' || type === 'subTitle' || type === 'outline'
    return { id, blocks: textBlocks(paras, isBody), titleText: null }
  }

  if (name === 'graphicframe') {
    const tbl = findDescendant(el, 'tbl')
    if (tbl === null) return null
    const rows = childrenOf(tbl, 'tr').map((row) => childrenOf(row, 'tc').map((cell) => textOf(cell)))
    const first = rows[0]
    const hasHeader = first !== undefined && rows.length > 1 && first.every((c) => c.length > 0)
    return {
      id,
      titleText: null,
      blocks: [
        hasHeader
          ? { kind: 'table', headers: first, rows: rows.slice(1), isLayoutTable: false }
          : { kind: 'table', headers: [], rows, isLayoutTable: false },
      ],
    }
  }

  if (name === 'pic') {
    const alt = (attrOf(cNvPr, 'descr') ?? '').trim()
    const embed = attrOf(findDescendant(el, 'blip'), 'r:embed')
    const target = embed === null ? undefined : rels.get(embed)?.target
    return {
      id,
      titleText: null,
      blocks: [
        {
          kind: 'image',
          assetRef: target ?? attrOf(cNvPr, 'name') ?? 'image',
          ...(alt.length > 0 ? { alt } : {}),
        },
      ],
    }
  }

  return null
}

function collectShapes(tree: Element, rels: Map<string, Relationship>): Shape[] {
  const shapes: Shape[] = []
  for (const child of Array.from(tree.children)) {
    if (localOf(child) === 'grpsp') {
      shapes.push(...collectShapes(child, rels))
      continue
    }
    const shape = readShape(child, rels)
    if (shape !== null) shapes.push(shape)
  }
  return shapes
}

function notesOf(pkg: Package, slidePath: string): string {
  const notesPath = [...relationships(pkg, slidePath).values()]
    .map((rel) => rel.target)
    .find((path) => path.startsWith('ppt/notesSlides/'))
  if (notesPath === undefined) return ''
  const notes = parsePart(pkg, notesPath)
  const tree = notes === null ? null : findDescendant(notes, 'spTree')
  if (tree === null) return ''

  for (const sp of findDescendants(tree, 'sp')) {
    if (attrOf(findDescendant(sp, 'ph'), 'type') !== 'body') continue
    const txBody = childOf(sp, 'txBody')
    if (txBody === null) continue
    return parasOf(txBody)
      .map((p) => p.text)
      .join('\n')
  }
  return ''
}

/** 슬라이드 순서는 파일 이름이 아니라 `p:sldIdLst`에 있다. */
function slidePathsOf(pkg: Package): string[] {
  const presentation = parsePart(pkg, 'ppt/presentation.xml')
  if (presentation === null) {
    return pkg
      .names()
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort(compareNatural)
  }

  const rels = relationships(pkg, 'ppt/presentation.xml')
  const paths: string[] = []
  for (const sldId of findDescendants(presentation, 'sldId')) {
    const relId = attr(sldId, 'r:id')
    const target = relId === null ? undefined : rels.get(relId)?.target
    if (target !== undefined) paths.push(target)
  }
  return paths
}

export function pptxToDocument(bytes: Uint8Array, ctx: FileContext): Document {
  const pkg = openPackage(bytes)
  const list = new BlockList()

  slidePathsOf(pkg).forEach((slidePath, offset) => {
    const index = offset + 1
    const slide = parsePart(pkg, slidePath)
    if (slide === null) return
    const tree = findDescendant(slide, 'spTree')
    const shapes = tree === null ? [] : collectShapes(tree, relationships(pkg, slidePath))

    const title = shapes.find((shape) => shape.titleText !== null)
    if (title !== undefined) {
      list.add(
        { kind: 'heading', level: 1, text: title.titleText! },
        { kind: 'pptx', slide: index, shapeId: title.id },
      )
    }

    const notes = notesOf(pkg, slidePath)
    list.add({ kind: 'slide', index, ...(notes.length > 0 ? { notes } : {}) }, { kind: 'pptx', slide: index })

    for (const shape of shapes) {
      for (const body of shape.blocks) {
        list.add(body, { kind: 'pptx', slide: index, shapeId: shape.id })
      }
    }
  })

  const core = coreProperties(pkg)
  return makeDocument('pptx', mergeContext(ctx, core), titleFrom(core.title, ctx), list.all())
}
