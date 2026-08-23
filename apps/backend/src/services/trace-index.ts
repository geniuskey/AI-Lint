import type { DocIndexEntry } from '@ai-lint/trace'
import type { Pool } from '../db/client.js'

/** 그래프를 메모리에 통째로 올린다. 상한이 없으면 코퍼스가 커진 뒤 이 라우트가 서버를 넘어뜨린다. */
export const MAX_INDEX_DOCS = 5000

export interface TraceIndexStore {
  upsert(entry: DocIndexEntry): Promise<void>
  /** 최근 갱신 순으로 MAX_INDEX_DOCS까지 */
  all(): Promise<DocIndexEntry[]>
  count(): Promise<number>
}

export function createMemoryTraceIndex(): TraceIndexStore {
  const byUri = new Map<string, { entry: DocIndexEntry; seq: number }>()
  let seq = 0

  return {
    async upsert(entry) {
      byUri.set(entry.uri, { entry, seq: ++seq })
    },

    async all() {
      return [...byUri.values()]
        .sort((a, b) => b.seq - a.seq)
        .slice(0, MAX_INDEX_DOCS)
        .map((held) => held.entry)
    },

    async count() {
      return byUri.size
    },
  }
}

export function createPgTraceIndex(pool: Pool): TraceIndexStore {
  return {
    async upsert(entry) {
      await pool.query(
        `INSERT INTO doc_index (document_uri, title, doc_type, document_hash, modified_at, payload)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (document_uri) DO UPDATE SET
           title = EXCLUDED.title,
           doc_type = EXCLUDED.doc_type,
           document_hash = EXCLUDED.document_hash,
           modified_at = EXCLUDED.modified_at,
           payload = EXCLUDED.payload,
           updated_at = now()`,
        [entry.uri, entry.title, entry.docType, entry.documentHash, entry.modifiedAt, JSON.stringify(entry)],
      )
    },

    async all() {
      const { rows } = await pool.query<{ payload: DocIndexEntry }>(
        'SELECT payload FROM doc_index ORDER BY updated_at DESC, document_uri LIMIT $1',
        [MAX_INDEX_DOCS],
      )
      return rows.map((row) => row.payload)
    },

    async count() {
      const { rows } = await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM doc_index',
      )
      return Number(rows[0]?.count ?? 0)
    },
  }
}
