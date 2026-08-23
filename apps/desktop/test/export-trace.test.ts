// @vitest-environment happy-dom
import { xlsxToDocument } from '@ai-lint/adapter-office'
import type { TraceFinding, TraceReport } from '@ai-lint/contract'
import { describe, expect, it } from 'vitest'
import { toTraceHtml, toTraceXlsx } from '../src/core/export-trace.js'

const finding = (over: Partial<TraceFinding> = {}): TraceFinding => ({
  id: 'TRC001:REQ-9',
  ruleId: 'TRC001',
  severity: 'error',
  message: '정의되지 않은 식별자를 참조합니다',
  why: 'REQ-9를 정의하는 문서가 인덱스에 없습니다',
  documents: [{ uri: 'https://wiki/a', title: '결제 설계' }],
  subjectId: 'REQ-9',
  evidence: null,
  source: 'rule',
  confidence: 1,
  ...over,
})

const reportOf = (over: Partial<TraceReport> = {}): TraceReport => ({
  reportId: 'r1',
  documentCount: 12,
  idCount: 30,
  findings: [finding()],
  stats: { pairsConsidered: 3, pairsAnalyzed: 3, llmFindingsRejected: 0, durationMs: 40 },
  llmStatus: 'ok',
  truncated: false,
  createdAt: '2026-08-23T00:00:00.000Z',
  ...over,
})

describe('toTraceHtml', () => {
  it('요약과 지적을 담는다', () => {
    const html = toTraceHtml(reportOf(), '2026-08-23')
    expect(html).toContain('12')
    expect(html).toContain('REQ-9')
    expect(html).toContain('결제 설계')
    expect(html).toContain('정의되지 않은 식별자를 참조합니다')
  })

  it('문서 내용이 태그로 살아나지 않는다', () => {
    const html = toTraceHtml(reportOf({ findings: [finding({ why: '<img onerror=x>' })] }), '2026-08-23')
    expect(html).not.toContain('<img onerror=x>')
    expect(html).toContain('&lt;img onerror=x&gt;')
  })

  it('바깥 파일을 하나도 부르지 않는다', () => {
    expect(toTraceHtml(reportOf(), '2026-08-23')).not.toMatch(/<(script|link|img)\b/)
  })

  it('일부만 대조했으면 그 사실을 적는다', () => {
    const html = toTraceHtml(
      reportOf({
        truncated: true,
        stats: { pairsConsidered: 50, pairsAnalyzed: 20, llmFindingsRejected: 0, durationMs: 1 },
      }),
      '2026-08-23',
    )
    expect(html).toContain('50')
    expect(html).toContain('20')
  })
})

describe('toTraceXlsx', () => {
  it('다시 읽어보면 지적이 그대로 있다', () => {
    const doc = xlsxToDocument(toTraceXlsx(reportOf()), { uri: 'C:\\out.xlsx' })
    const text = doc.blocks.map((block) => JSON.stringify(block)).join('\n')

    expect(text).toContain('TRC001')
    expect(text).toContain('REQ-9')
    expect(text).toContain('결제 설계')
  })

  it('지적이 하나도 없어도 읽히는 파일을 만든다', () => {
    const doc = xlsxToDocument(toTraceXlsx(reportOf({ findings: [] })), { uri: 'C:\\out.xlsx' })
    expect(doc.blocks.length).toBeGreaterThan(0)
  })
})
