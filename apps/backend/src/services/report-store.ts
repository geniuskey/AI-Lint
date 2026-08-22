import type { LintReport } from '@ai-lint/contract'
import type { DocType } from '@ai-lint/ir'
import type { Pool } from '../db/client.js'

export interface CacheKey {
  documentHash: string
  rulesetId: string
  rulesetVersion: number
  promptVersion: number
}

export interface SaveMeta {
  promptVersion: number
  userId: string
}

export interface ReportStore {
  findByKey(key: CacheKey): Promise<LintReport | null>
  save(report: LintReport, meta: SaveMeta): Promise<void>
  listByUri(uri: string, limit: number): Promise<LintReport[]>
  getDocTypeOverride(uri: string): Promise<DocType | null>
  setDocTypeOverride(uri: string, docType: DocType, userId: string): Promise<void>
}

const keyOf = (k: CacheKey): string =>
  `${k.documentHash}|${k.rulesetId}|${k.rulesetVersion}|${k.promptVersion}`

const keyOfReport = (report: LintReport, promptVersion: number): CacheKey => ({
  documentHash: report.documentHash,
  rulesetId: report.rulesetId,
  rulesetVersion: report.rulesetVersion,
  promptVersion,
})

/** DATABASE_URL 없이 띄웠을 때와 테스트에서 쓴다. 프로세스가 죽으면 함께 사라진다. */
export function createMemoryStore(): ReportStore {
  const byKey = new Map<string, { report: LintReport; seq: number }>()
  const overrides = new Map<string, DocType>()
  let seq = 0

  return {
    async findByKey(key) {
      return byKey.get(keyOf(key))?.report ?? null
    },

    async save(report, meta) {
      byKey.set(keyOf(keyOfReport(report, meta.promptVersion)), { report, seq: ++seq })
    },

    async listByUri(uri, limit) {
      return [...byKey.values()]
        .filter((e) => e.report.documentUri === uri)
        .sort((a, b) => b.seq - a.seq)
        .slice(0, limit)
        .map((e) => e.report)
    },

    async getDocTypeOverride(uri) {
      return overrides.get(uri) ?? null
    },

    async setDocTypeOverride(uri, docType) {
      overrides.set(uri, docType)
    },
  }
}

export function createPgStore(pool: Pool): ReportStore {
  return {
    async findByKey(key) {
      const { rows } = await pool.query<{ payload: LintReport }>(
        `SELECT payload FROM reports
          WHERE document_hash = $1 AND ruleset_id = $2 AND ruleset_version = $3 AND prompt_version = $4`,
        [key.documentHash, key.rulesetId, key.rulesetVersion, key.promptVersion],
      )
      return rows[0]?.payload ?? null
    },

    async save(report, meta) {
      await pool.query(
        `INSERT INTO reports (report_id, document_uri, document_hash, ruleset_id, ruleset_version,
                              prompt_version, doc_type, score_total, score_grade, payload, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (document_hash, ruleset_id, ruleset_version, prompt_version) DO UPDATE SET
           report_id = EXCLUDED.report_id,
           document_uri = EXCLUDED.document_uri,
           doc_type = EXCLUDED.doc_type,
           score_total = EXCLUDED.score_total,
           score_grade = EXCLUDED.score_grade,
           payload = EXCLUDED.payload,
           created_by = EXCLUDED.created_by,
           created_at = now()`,
        [
          report.reportId,
          report.documentUri,
          report.documentHash,
          report.rulesetId,
          report.rulesetVersion,
          meta.promptVersion,
          report.docType,
          report.score.total,
          report.score.grade,
          JSON.stringify(report),
          meta.userId,
        ],
      )
    },

    async listByUri(uri, limit) {
      const { rows } = await pool.query<{ payload: LintReport }>(
        'SELECT payload FROM reports WHERE document_uri = $1 ORDER BY created_at DESC, report_id DESC LIMIT $2',
        [uri, limit],
      )
      return rows.map((r) => r.payload)
    },

    async getDocTypeOverride(uri) {
      const { rows } = await pool.query<{ doc_type: DocType }>(
        'SELECT doc_type FROM doctype_overrides WHERE document_uri = $1',
        [uri],
      )
      return rows[0]?.doc_type ?? null
    },

    async setDocTypeOverride(uri, docType, userId) {
      await pool.query(
        `INSERT INTO doctype_overrides (document_uri, doc_type, set_by) VALUES ($1,$2,$3)
         ON CONFLICT (document_uri) DO UPDATE SET doc_type = EXCLUDED.doc_type, set_by = EXCLUDED.set_by, set_at = now()`,
        [uri, docType, userId],
      )
    },
  }
}
