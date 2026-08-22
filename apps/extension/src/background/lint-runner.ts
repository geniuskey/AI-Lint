import type { LintOptions, LintReport } from '@ai-lint/contract'
import type { Document } from '@ai-lint/ir'
import type { LintPhase, WorkerMessage } from '../shared/messages.js'
import type { Settings } from '../shared/settings.js'
import { BackendError } from './backend-client.js'

export interface RunnerDeps {
  settings: Settings
  request(document: Document, options: Partial<LintOptions>): Promise<LintReport>
}

const errorOf = (phase: LintPhase, error: unknown): WorkerMessage =>
  error instanceof BackendError
    ? { type: 'error', phase, kind: error.kind, message: error.message }
    : { type: 'error', phase, kind: 'server', message: error instanceof Error ? error.message : '검사에 실패했습니다.' }

export async function runLint(
  document: Document,
  deps: RunnerDeps,
  emit: (message: WorkerMessage) => void,
): Promise<void> {
  emit({ type: 'progress', phase: 'rules' })
  try {
    emit({ type: 'report', phase: 'rules', report: await deps.request(document, { useLlm: false, save: false }) })
  } catch (error) {
    emit(errorOf('rules', error))
    emit({ type: 'done' })
    return
  }

  if (!deps.settings.useLlm) {
    emit({ type: 'done' })
    return
  }

  emit({ type: 'progress', phase: 'llm' })
  try {
    emit({ type: 'report', phase: 'llm', report: await deps.request(document, { useLlm: true, save: true }) })
  } catch (error) {
    emit(errorOf('llm', error))
  }
  emit({ type: 'done' })
}
