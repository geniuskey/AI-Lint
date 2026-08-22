import { describe, expect, it } from 'vitest'
import { CANCELLED, messageOf, runQueue } from '../src/core/queue.js'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('runQueue', () => {
  it('결과를 입력 순서대로 돌려준다', async () => {
    const outcomes = await runQueue(
      [30, 5, 15],
      async (ms) => {
        await wait(ms)
        return ms
      },
      { concurrency: 3 },
    )
    expect(outcomes.map((o) => o.output)).toEqual([30, 5, 15])
  })

  it('동시 실행 수를 넘지 않는다', async () => {
    let running = 0
    let peak = 0
    await runQueue(
      Array.from({ length: 8 }, (_, i) => i),
      async (n) => {
        running += 1
        peak = Math.max(peak, running)
        await wait(5)
        running -= 1
        return n
      },
      { concurrency: 3 },
    )
    expect(peak).toBe(3)
  })

  it('하나가 실패해도 나머지를 끝까지 처리한다', async () => {
    const outcomes = await runQueue(
      ['a', 'b', 'c'],
      async (name) => {
        if (name === 'b') throw new Error('열 수 없는 파일입니다')
        return name.toUpperCase()
      },
      { concurrency: 2 },
    )
    expect(outcomes.map((o) => o.output)).toEqual(['A', null, 'C'])
    expect(outcomes[1]?.error).toBe('열 수 없는 파일입니다')
  })

  it('취소하면 남은 작업을 시작하지 않는다', async () => {
    let started = 0
    let cancel = false
    const outcomes = await runQueue(
      [1, 2, 3, 4],
      async (n) => {
        started += 1
        if (started === 2) cancel = true
        return n
      },
      { concurrency: 1, cancelled: () => cancel },
    )
    expect(started).toBe(2)
    expect(outcomes.slice(2).map((o) => o.error)).toEqual([CANCELLED, CANCELLED])
  })

  it('시작과 완료를 알린다', async () => {
    const log: string[] = []
    await runQueue([1, 2], async (n) => n * 2, {
      concurrency: 1,
      onStart: (item) => log.push(`시작 ${item}`),
      onSettled: (outcome) => log.push(`완료 ${outcome.output}`),
    })
    expect(log).toEqual(['시작 1', '완료 2', '시작 2', '완료 4'])
  })

  it('빈 목록이면 아무것도 하지 않는다', async () => {
    expect(await runQueue([], async () => 1, { concurrency: 3 })).toEqual([])
  })
})

describe('messageOf', () => {
  it('Error가 아닌 것도 문자열로 만든다', () => {
    expect(messageOf(new Error('망함'))).toBe('망함')
    expect(messageOf('문자열 예외')).toBe('문자열 예외')
  })
})
