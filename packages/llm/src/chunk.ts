import { serializeBlocks, walkSections, type Block, type Document } from '@ai-lint/ir'

export interface Chunk {
  index: number
  markdown: string
  blockIds: string[]
}

export interface ChunkOptions {
  maxChars?: number
}

export const DEFAULT_MAX_CHUNK_CHARS = 12000

/**
 * 제목 경계로 문서를 나눈다. 블록은 절대 쪼개지 않는다 — 블록이 쪼개지면 LLM이 지목한 blockId가 어디를 뜻하는지 알 수 없다.
 * 섹션 하나가 단독으로 임계치를 넘으면 그대로 한 청크가 된다.
 */
export function planChunks(doc: Document, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHUNK_CHARS
  const groups: Block[][] = []
  let current: Block[] = []
  let currentChars = 0

  for (const section of walkSections(doc)) {
    const blocks = section.heading ? [section.heading, ...section.blocks] : section.blocks
    if (blocks.length === 0) continue

    const chars = serializeBlocks(blocks).length
    if (current.length > 0 && currentChars + chars > maxChars) {
      groups.push(current)
      current = []
      currentChars = 0
    }

    current.push(...blocks)
    currentChars += chars
  }

  if (current.length > 0) groups.push(current)
  if (groups.length === 0) return []

  return groups.map((blocks, index) => ({
    index,
    markdown: serializeBlocks(blocks),
    blockIds: blocks.map((b) => b.id),
  }))
}
