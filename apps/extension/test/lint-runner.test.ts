import type { LintOptions, LintReport } from '@ai-lint/contract'
import type { Document } from '@ai-lint/ir'
import { describe, expect, it, vi } from 'vitest'
import { BackendError } from '../src/background/backend-client.js'
import { runLint } from '../src/background/lint-runner.js'
import type { WorkerMessage } from '../src/shared/messages.js'
import { DEFAULT_SETTINGS } from '../src/shared/settings.js'

const doc = { title: '테스트' } as unknown as Document
const report = (id: string): LintReport => ({ reportId: id }) as LintReport

const collect = async (
  request: (document: Document, options: Partial<LintOptions>) => Promise<LintReport>,
  useLlm = true,
): Promise<WorkerMessage[]> => {
  const messages: WorkerMessage[] = []
  await runLint(doc, { settings: { ...DEFAULT_SETTINGS, useLlm }, request }, (m) => messages.push(m))
  return messages
}

describe('runLint', () => {
  it('룰 결과를 먼저 내보내고 LLM 결과로 덮어쓴다', async () => {
    const request = vi.fn().mockResolvedValueOnce(report('rules')).mockResolvedValueOnce(report('llm'))

    const messages = await collect(request)

    expect(messages.map((m) => m.type)).toEqual(['progress', 'report', 'progress', 'report', 'done'])
    expect(request.mock.calls[0]?.[1]).toEqual({ useLlm: false, save: false })
    expect(request.mock.calls[1]?.[1]).toEqual({ useLlm: true, save: true })
    expect(messages[1]).toMatchObject({ phase: 'rules', report: { reportId: 'rules' } })
    expect(messages[3]).toMatchObject({ phase: 'llm', report: { reportId: 'llm' } })
  })

  it('AI 검사를 껐으면 두 번째 호출을 하지 않는다', async () => {
    const request = vi.fn().mockResolvedValue(report('rules'))
    const messages = await collect(request, false)

    expect(request).toHaveBeenCalledTimes(1)
    expect(messages.map((m) => m.type)).toEqual(['progress', 'report', 'done'])
  })

  it('LLM 단계가 실패해도 룰 결과는 남기고 배너만 띄운다', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(report('rules'))
      .mockRejectedValueOnce(new BackendError('quota'))

    const messages = await collect(request)

    expect(messages.map((m) => m.type)).toEqual(['progress', 'report', 'progress', 'error', 'done'])
    expect(messages[3]).toMatchObject({ phase: 'llm', kind: 'quota' })
  })

  it('룰 단계가 실패하면 LLM 단계로 넘어가지 않는다', async () => {
    const request = vi.fn().mockRejectedValue(new BackendError('offline'))
    const messages = await collect(request)

    expect(request).toHaveBeenCalledTimes(1)
    expect(messages.map((m) => m.type)).toEqual(['progress', 'error', 'done'])
    expect(messages[1]).toMatchObject({ phase: 'rules', kind: 'offline' })
  })

  it('예상 못 한 예외도 server 오류로 감싼다', async () => {
    const request = vi.fn().mockRejectedValue(new Error('boom'))
    const messages = await collect(request)
    expect(messages[1]).toMatchObject({ kind: 'server', message: 'boom' })
  })
})
