export const CANCELLED = '취소됨'

export interface QueueOutcome<I, O> {
  item: I
  output: O | null
  error: string | null
}

export interface QueueOptions<I, O> {
  concurrency: number
  onStart?: (item: I, index: number) => void
  onSettled?: (outcome: QueueOutcome<I, O>, index: number) => void
  cancelled?: () => boolean
}

export const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export async function runQueue<I, O>(
  items: readonly I[],
  worker: (item: I, index: number) => Promise<O>,
  options: QueueOptions<I, O>,
): Promise<QueueOutcome<I, O>[]> {
  const outcomes: QueueOutcome<I, O>[] = new Array<QueueOutcome<I, O>>(items.length)
  let cursor = 0

  const pump = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return

      const item = items[index]!
      if (options.cancelled?.() === true) {
        outcomes[index] = { item, output: null, error: CANCELLED }
        continue
      }

      options.onStart?.(item, index)
      let outcome: QueueOutcome<I, O>
      try {
        outcome = { item, output: await worker(item, index), error: null }
      } catch (cause) {
        // 파일 하나가 깨졌다고 나머지 검사를 버리지 않는다.
        outcome = { item, output: null, error: messageOf(cause) }
      }
      outcomes[index] = outcome
      options.onSettled?.(outcome, index)
    }
  }

  const width = Math.max(1, Math.min(options.concurrency, items.length))
  await Promise.all(Array.from({ length: width }, () => pump()))
  return outcomes
}
