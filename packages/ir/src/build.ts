import type { SourceAnchor } from './anchor.js'
import type { Block, Document, SourceKind } from './schema.js'

/** 블록에서 러너가 채우는 공통 필드를 뺀 나머지. 어댑터는 이것만 만든다. */
export type BlockBody = {
  [K in Block['kind']]: Omit<Extract<Block, { kind: K }>, 'id' | 'path' | 'anchor'>
}[Block['kind']]

/** 블록을 순서대로 받아 아이디와 제목 계층 경로를 매긴다. */
export class BlockList {
  private readonly blocks: Block[] = []
  private readonly counters: number[] = []
  private seq = 0

  add(body: BlockBody, anchor: SourceAnchor): Block {
    if (body.kind === 'heading') this.bump(body.level)
    this.seq += 1
    const block = { ...body, id: `b${this.seq}`, path: [...this.counters], anchor } as Block
    this.blocks.push(block)
    return block
  }

  all(): Block[] {
    return this.blocks
  }

  private bump(level: number): void {
    while (this.counters.length < level) this.counters.push(0)
    this.counters.length = level
    this.counters[level - 1] = (this.counters[level - 1] ?? 0) + 1
  }
}

export interface FileContext {
  uri: string
  modifiedAt?: string
  author?: string
}

export const fileNameOf = (uri: string): string => {
  const parts = uri.split(/[\\/]/)
  return parts[parts.length - 1] ?? uri
}

/** 문서 안에 제목이 없으면 확장자를 뗀 파일 이름을 쓴다. */
export function titleFrom(candidate: string | undefined, ctx: FileContext): string {
  const trimmed = (candidate ?? '').trim()
  return trimmed === '' ? fileNameOf(ctx.uri).replace(/\.[^.]+$/, '') : trimmed
}

/**
 * 파일 기반 어댑터가 만드는 문서.
 * 파일에는 Confluence 라벨 같은 유형 힌트가 없다. origin을 llm으로 두어 백엔드가 분류하게 한다
 * (template로 두면 "템플릿이 미분류라고 했다"는 뜻이 되어 유형별 규칙이 하나도 걸리지 않는다).
 */
export const makeDocument = (
  kind: SourceKind,
  ctx: FileContext,
  title: string,
  blocks: Block[],
): Document => ({
  schemaVersion: 1,
  source: {
    kind,
    uri: ctx.uri,
    ...(ctx.modifiedAt === undefined ? {} : { modifiedAt: ctx.modifiedAt }),
    ...(ctx.author === undefined ? {} : { author: ctx.author }),
  },
  title,
  docType: { value: 'unknown', confidence: 0, origin: 'llm' },
  blocks,
  links: [],
  metadata: { labels: [] },
})
