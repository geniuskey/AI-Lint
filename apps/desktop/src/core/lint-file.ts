import { requestLint, type BackendSettings } from '@ai-lint/backend-client'
import type { LintReport } from '@ai-lint/contract'
import type { Document } from '@ai-lint/ir'
import type { DocumentFile } from './collect.js'
import { runQueue } from './queue.js'

export type JobPhase = 'pending' | 'parsing' | 'linting' | 'done' | 'failed'

export interface JobState {
  file: DocumentFile
  phase: JobPhase
  report: LintReport | null
  error: string | null
}

export interface LintDeps {
  parse(file: DocumentFile): Promise<Document>
  fetchImpl: typeof fetch
}

export interface RunOptions {
  useLlm: boolean
  concurrency: number
  onChange(index: number, state: JobState): void
  cancelled?: () => boolean
}

export const initialJobs = (files: readonly DocumentFile[]): JobState[] =>
  files.map((file) => ({ file, phase: 'pending', report: null, error: null }))

/** 폴더 하나를 통째로 검사하면 수십 건이 되므로 LLM 쿼터가 금방 마른다. 파일 하나일 때만 켠다. */
export const defaultUseLlm = (fileCount: number): boolean => fileCount === 1

export async function runLintQueue(
  deps: LintDeps,
  files: readonly DocumentFile[],
  settings: BackendSettings,
  options: RunOptions,
): Promise<JobState[]> {
  const jobs = initialJobs(files)

  const move = (index: number, patch: Partial<JobState>): void => {
    const next = { ...jobs[index]!, ...patch }
    jobs[index] = next
    options.onChange(index, next)
  }

  await runQueue(
    files,
    async (file, index) => {
      move(index, { phase: 'parsing' })
      const document = await deps.parse(file)
      move(index, { phase: 'linting' })
      const report = await requestLint(document, { useLlm: options.useLlm }, settings, deps.fetchImpl)
      move(index, { phase: 'done', report })
      return report
    },
    {
      concurrency: options.concurrency,
      ...(options.cancelled === undefined ? {} : { cancelled: options.cancelled }),
      onSettled: (outcome, index) => {
        if (outcome.error !== null) move(index, { phase: 'failed', error: outcome.error })
      },
    },
  )

  return jobs
}
