import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Pool } from './client.js'

const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url)

/**
 * 이름순으로 미적용 마이그레이션만 트랜잭션 안에서 실행한다.
 * 파일 하나가 곧 한 트랜잭션이다 — 절반만 적용된 스키마가 남지 않는다.
 */
export async function migrate(pool: Pool): Promise<string[]> {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())')

  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  )
  const files = (await readdir(fileURLToPath(MIGRATIONS_DIR))).filter((f) => f.endsWith('.sql')).sort()
  const pending = files.filter((f) => !applied.has(f))

  for (const file of pending) {
    const sql = await readFile(new URL(file, MIGRATIONS_DIR), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw new Error(`마이그레이션 실패: ${file}`, { cause: error })
    } finally {
      client.release()
    }
  }

  return pending
}
