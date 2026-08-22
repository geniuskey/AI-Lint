// @vitest-environment happy-dom
import { xlsxToDocument } from '@ai-lint/adapter-office'
import type { LintReport } from '@ai-lint/contract'
import type { Finding } from '@ai-lint/rules'
import { describe, expect, it } from 'vitest'
import { escapeHtml, toHtml } from '../src/core/export-html.js'
import { toXlsx } from '../src/core/export-xlsx.js'
import type { JobState } from '../src/core/lint-file.js'

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'f1', ruleId: 'STR001', axis: 'structure', severity: 'error',
  blockId: 'b1', anchor: { kind: 'pdf', page: 12 },
  message: '제목이 없습니다', why: '청킹 기준이 사라집니다',
  evidence: null, suggestion: null, source: 'rule', confidence: 1, docsUrl: '',
  ...over,
})

const reportOf = (over: Partial<LintReport> = {}): LintReport => ({
  reportId: 'r1', documentUri: 'C:\\d\\a.pdf', documentHash: 'h1',
  docType: 'design', rulesetId: 'default', rulesetVersion: 1,
  score: { total: 72, grade: 'C', axes: { structure: 70, context: 60, metadata: 90 } },
  findings: [finding()],
  stats: { rulesEvaluated: 20, llmFindingsRejected: 0, durationMs: 100 },
  llmStatus: 'ok', truncated: false, cached: false, createdAt: '2026-08-22T00:00:00.000Z',
  ...over,
})

const jobOf = (name: string, report: LintReport | null, error: string | null = null): JobState => ({
  file: { path: `C:\\d\\${name}`, name, ext: 'pdf' },
  phase: report === null ? 'failed' : 'done',
  report,
  error,
})

describe('escapeHtml', () => {
  it('꺾쇠와 따옴표를 막는다', () => {
    expect(escapeHtml('<script>"a" & \'b\'</script>'))
      .toBe('&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;')
  })
})

describe('toHtml', () => {
  it('파일마다 점수와 지적을 담는다', () => {
    const html = toHtml([jobOf('a.pdf', reportOf())], '2026-08-22T00:00:00.000Z')
    expect(html).toContain('a.pdf')
    expect(html).toContain('72')
    expect(html).toContain('제목이 없습니다')
    expect(html).toContain('12쪽')
  })

  it('실패한 파일도 이유와 함께 남긴다', () => {
    const html = toHtml([jobOf('b.pdf', null, '암호가 걸린 파일입니다')], '2026-08-22T00:00:00.000Z')
    expect(html).toContain('암호가 걸린 파일입니다')
  })

  it('문서 내용이 태그로 살아나지 않는다', () => {
    const html = toHtml(
      [jobOf('c.pdf', reportOf({ findings: [finding({ message: '<img onerror=x>' })] }))],
      '2026-08-22T00:00:00.000Z',
    )
    expect(html).not.toContain('<img onerror=x>')
    expect(html).toContain('&lt;img onerror=x&gt;')
  })

  it('바깥 파일을 하나도 부르지 않는다', () => {
    const html = toHtml([jobOf('a.pdf', reportOf())], '2026-08-22T00:00:00.000Z')
    expect(html).not.toMatch(/<(script|link|img)\b/)
  })
})

describe('toXlsx', () => {
  it('다시 읽어보면 요약과 지적이 그대로 있다', () => {
    const bytes = toXlsx([jobOf('a.pdf', reportOf()), jobOf('b.pdf', null, '열 수 없습니다')])
    const doc = xlsxToDocument(bytes, { uri: 'C:\\out.xlsx' })
    const text = doc.blocks.map((block) => JSON.stringify(block)).join('\n')

    expect(text).toContain('a.pdf')
    expect(text).toContain('72')
    expect(text).toContain('열 수 없습니다')
    expect(text).toContain('제목이 없습니다')
    expect(text).toContain('12쪽')
  })

  it('두 시트로 나눈다', () => {
    const doc = xlsxToDocument(toXlsx([jobOf('a.pdf', reportOf())]), { uri: 'C:\\out.xlsx' })
    const sheets = doc.blocks
      .filter((block) => block.anchor.kind === 'xlsx')
      .map((block) => (block.anchor.kind === 'xlsx' ? block.anchor.sheet : ''))
    expect(new Set(sheets)).toEqual(new Set(['요약', '지적']))
  })

  it('지적이 하나도 없어도 읽히는 파일을 만든다', () => {
    const doc = xlsxToDocument(
      toXlsx([jobOf('a.pdf', reportOf({ findings: [] }))]),
      { uri: 'C:\\out.xlsx' },
    )
    expect(doc.blocks.length).toBeGreaterThan(0)
  })
})
