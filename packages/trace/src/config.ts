import type { IdPattern } from './ids.js'

export interface TraceConfig {
  patterns: IdPattern[]
  /** 상충 대조에 보낼 문서 쌍 상한 */
  maxPairs: number
  /** 발췌 길이 상한 */
  snippetChars: number
}

export const DEFAULT_ID_PATTERNS: IdPattern[] = [
  { kind: 'requirement', regex: 'REQ-\\d+' },
  { kind: 'test', regex: 'TC-\\d+' },
  { kind: 'ticket', regex: '[A-Z]{2,10}-\\d+' },
]

export const DEFAULT_TRACE_CONFIG: TraceConfig = {
  patterns: DEFAULT_ID_PATTERNS,
  maxPairs: 20,
  snippetChars: 400,
}
