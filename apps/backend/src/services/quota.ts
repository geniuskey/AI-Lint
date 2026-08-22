import type { Pool } from '../db/client.js'

export interface QuotaDecision {
  allowed: boolean
  reason?: 'daily-limit'
}

export interface QuotaService {
  check(userId: string): Promise<QuotaDecision>
  record(userId: string, calls: number): Promise<void>
}

const ALLOWED: QuotaDecision = { allowed: true }
const DENIED: QuotaDecision = { allowed: false, reason: 'daily-limit' }

/** UTC 날짜를 하루 경계로 쓴다. 인메모리 구현과 Postgres 구현이 같은 경계를 봐야 한다. */
const dayOf = (date: Date): string => date.toISOString().slice(0, 10)

export function createUnlimitedQuota(): QuotaService {
  return {
    async check() {
      return ALLOWED
    },
    async record() {},
  }
}

export function createMemoryQuota(dailyLimit: number, now: () => Date = () => new Date()): QuotaService {
  const used = new Map<string, number>()
  const keyOf = (userId: string): string => `${userId}|${dayOf(now())}`

  return {
    async check(userId) {
      return (used.get(keyOf(userId)) ?? 0) >= dailyLimit ? DENIED : ALLOWED
    },
    async record(userId, calls) {
      const key = keyOf(userId)
      used.set(key, (used.get(key) ?? 0) + calls)
    },
  }
}

export function createPgQuota(pool: Pool, dailyLimit: number): QuotaService {
  return {
    async check(userId) {
      const { rows } = await pool.query<{ calls: number }>(
        "SELECT calls FROM llm_usage WHERE user_id = $1 AND usage_date = (now() AT TIME ZONE 'UTC')::date",
        [userId],
      )
      return (rows[0]?.calls ?? 0) >= dailyLimit ? DENIED : ALLOWED
    },

    async record(userId, calls) {
      await pool.query(
        `INSERT INTO llm_usage (user_id, usage_date, calls)
         VALUES ($1, (now() AT TIME ZONE 'UTC')::date, $2)
         ON CONFLICT (user_id, usage_date) DO UPDATE SET calls = llm_usage.calls + EXCLUDED.calls`,
        [userId, calls],
      )
    },
  }
}

/** 테스트에서 쿼터 상태를 고정할 때 쓴다. */
export function createFixedQuota(decision: QuotaDecision): QuotaService & { recorded: Array<[string, number]> } {
  const recorded: Array<[string, number]> = []
  return {
    recorded,
    async check() {
      return decision
    },
    async record(userId, calls) {
      recorded.push([userId, calls])
    },
  }
}
