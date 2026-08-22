import type { Finding, LintReport } from '@ai-lint/contract'

const base = {
  documentUri: 'http://localhost:4181/pages/viewpage.action?pageId=789',
  documentHash: 'hash',
  docType: 'design' as const,
  rulesetId: 'default',
  rulesetVersion: 1,
  stats: { rulesEvaluated: 20, llmFindingsRejected: 0, durationMs: 12 },
  truncated: false,
  cached: false,
  createdAt: '2026-08-22T00:00:00.000Z',
}

const QUOTE = '지난번 논의대로 3단계로 나눠서 진행하기로 했습니다.'

const finding = (id: string, ruleId: string, severity: Finding['severity'], message: string): Finding => ({
  id,
  ruleId,
  axis: 'structure',
  severity,
  blockId: 'b2',
  anchor: { kind: 'confluence', xpath: './p', textQuote: { exact: QUOTE } },
  message,
  why: 'AI가 이 문서를 읽을 때 맥락을 잃습니다.',
  evidence: QUOTE,
  suggestion: { before: '지난번 논의대로', after: '2026-07-10 결제 설계 리뷰에서' },
  source: 'rule',
  confidence: 1,
  docsUrl: `https://docs.test/${ruleId.toLowerCase()}.md`,
})

export const RULES_REPORT: LintReport = {
  ...base,
  reportId: 'rules-1',
  score: { total: 82, grade: 'B', axes: { structure: 85, context: 100, metadata: 60 } },
  findings: [finding('f1', 'META004', 'warning', '담당자가 없습니다')],
  llmStatus: 'skipped',
  llmSkipReason: 'disabled',
}

export const LLM_REPORT: LintReport = {
  ...base,
  reportId: 'llm-1',
  score: { total: 68, grade: 'C', axes: { structure: 85, context: 55, metadata: 60 } },
  findings: [
    RULES_REPORT.findings[0]!,
    {
      ...finding('f2', 'CTX001', 'error', '앞선 논의를 가리키기만 합니다'),
      axis: 'context',
      source: 'llm',
      confidence: 0.82,
    },
  ],
  llmStatus: 'ok',
}
