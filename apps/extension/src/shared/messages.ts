import type { LintReport } from '@ai-lint/contract'
import type { DocType, Document } from '@ai-lint/ir'

export const PORT_NAME = 'ai-lint'

export type LintPhase = 'rules' | 'llm'

export type BackendErrorKind = 'unconfigured' | 'unauthorized' | 'forbidden' | 'quota' | 'offline' | 'server'

export type ContentMessage =
  | { type: 'lint'; document: Document }
  | { type: 'set-doctype'; uri: string; docType: DocType }

export type WorkerMessage =
  | { type: 'progress'; phase: LintPhase }
  | { type: 'report'; phase: LintPhase; report: LintReport }
  | { type: 'error'; phase: LintPhase; kind: BackendErrorKind; message: string }
  | { type: 'doctype-saved' }
  | { type: 'done' }
