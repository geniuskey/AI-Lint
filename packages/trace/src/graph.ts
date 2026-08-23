import { definedIds, referencedIds, type DocIndexEntry } from './entry.js'
import type { IdKind } from './ids.js'

export interface TraceGraph {
  entries: DocIndexEntry[]
  byUri: Map<string, DocIndexEntry>
  /** ID → 그 ID를 정의하는 문서 uri */
  definedBy: Map<string, string[]>
  /** ID → 그 ID를 참조하는 문서 uri */
  referencedBy: Map<string, string[]>
  kinds: Map<string, IdKind>
}

const push = (map: Map<string, string[]>, key: string, value: string): void => {
  const list = map.get(key)
  if (list === undefined) map.set(key, [value])
  else list.push(value)
}

export function buildGraph(entries: readonly DocIndexEntry[]): TraceGraph {
  const definedBy = new Map<string, string[]>()
  const referencedBy = new Map<string, string[]>()
  const kinds = new Map<string, IdKind>()

  for (const entry of entries) {
    for (const mention of entry.mentions) {
      if (!kinds.has(mention.id)) kinds.set(mention.id, mention.kind)
    }
    for (const id of definedIds(entry)) push(definedBy, id, entry.uri)
    for (const id of referencedIds(entry)) push(referencedBy, id, entry.uri)
  }

  // 판정이 입력 순서에 흔들리지 않아야 같은 코퍼스에서 같은 리포트가 나온다.
  for (const list of [...definedBy.values(), ...referencedBy.values()]) list.sort()

  return {
    entries: [...entries].sort((a, b) => a.uri.localeCompare(b.uri)),
    byUri: new Map(entries.map((e) => [e.uri, e])),
    definedBy,
    referencedBy,
    kinds,
  }
}

export const allIds = (graph: TraceGraph): string[] => [...graph.kinds.keys()].sort()
