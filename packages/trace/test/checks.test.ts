import { describe, expect, it } from 'vitest'
import { runTraceChecks } from '../src/checks.js'
import type { DocIndexEntry } from '../src/entry.js'
import { buildGraph } from '../src/graph.js'
import type { IdKind } from '../src/ids.js'

const mention = (id: string, defining: boolean, kind: IdKind = 'requirement') => ({
  id, kind, blockId: 'b1', defining, snippet: id,
})

const entryOf = (uri: string, over: Partial<DocIndexEntry> = {}): DocIndexEntry => ({
  uri,
  title: uri,
  docType: 'design',
  documentHash: 'h',
  modifiedAt: null,
  mentions: [],
  linksTo: [],
  ...over,
})

const rulesOf = (entries: DocIndexEntry[]): string[] =>
  runTraceChecks(buildGraph(entries)).map((f) => f.ruleId)

describe('TRC001 정의되지 않은 참조', () => {
  it('아무도 정의하지 않은 ID를 참조하면 걸린다', () => {
    const findings = runTraceChecks(buildGraph([entryOf('doc-a', { mentions: [mention('REQ-9', false)] })]))
    const trc001 = findings.find((f) => f.ruleId === 'TRC001')

    expect(trc001).toMatchObject({ severity: 'error', subjectId: 'REQ-9', source: 'rule' })
    expect(trc001?.documents).toEqual([{ uri: 'doc-a', title: 'doc-a' }])
  })

  it('정의한 문서가 있으면 걸리지 않는다', () => {
    const rules = rulesOf([
      entryOf('doc-a', { mentions: [mention('REQ-9', false), mention('TC-1', false, 'test')] }),
      entryOf('req', { docType: 'requirement', mentions: [mention('REQ-9', true)] }),
      entryOf('tc', { mentions: [mention('TC-1', true, 'test')] }),
    ])
    expect(rules).not.toContain('TRC001')
  })
})

describe('TRC002 요구사항을 참조하지 않는 설계', () => {
  it('설계 문서가 요구사항을 안 걸면 걸린다', () => {
    const findings = runTraceChecks(buildGraph([entryOf('doc-a', { docType: 'design' })]))

    expect(findings.find((f) => f.ruleId === 'TRC002')).toMatchObject({
      severity: 'warning',
      subjectId: null,
      documents: [{ uri: 'doc-a', title: 'doc-a' }],
    })
  })

  it('요구사항을 하나라도 언급하면 걸리지 않는다', () => {
    const rules = rulesOf([
      entryOf('doc-a', { mentions: [mention('REQ-1', false)] }),
      entryOf('req', { docType: 'requirement', mentions: [mention('REQ-1', true), mention('TC-1', false, 'test')] }),
    ])
    expect(rules).not.toContain('TRC002')
  })

  it('설계가 아니면 보지 않는다', () => {
    expect(rulesOf([entryOf('doc-a', { docType: 'guide' })])).not.toContain('TRC002')
  })
})

describe('TRC003 테스트 없는 요구사항', () => {
  it('참조 문서에 테스트 ID가 없으면 걸린다', () => {
    const findings = runTraceChecks(
      buildGraph([
        entryOf('req', { docType: 'requirement', mentions: [mention('REQ-1', true)] }),
        entryOf('doc-a', { mentions: [mention('REQ-1', false)] }),
      ]),
    )
    const trc003 = findings.find((f) => f.ruleId === 'TRC003')

    expect(trc003).toMatchObject({ severity: 'warning', subjectId: 'REQ-1' })
    expect(trc003?.documents).toEqual([{ uri: 'req', title: 'req' }])
  })

  it('참조 문서 중 하나라도 테스트 ID를 가지면 걸리지 않는다', () => {
    const rules = rulesOf([
      entryOf('req', { docType: 'requirement', mentions: [mention('REQ-1', true)] }),
      entryOf('doc-a', { mentions: [mention('REQ-1', false), mention('TC-3', false, 'test')] }),
    ])
    expect(rules).not.toContain('TRC003')
  })

  it('요구사항이 아닌 ID는 보지 않는다', () => {
    expect(rulesOf([entryOf('doc-a', { mentions: [mention('PROJ-1', true, 'ticket')] })])).not.toContain('TRC003')
  })
})

describe('TRC004 중복 정의', () => {
  it('두 문서가 같은 ID를 정의하면 둘 다 담아 걸린다', () => {
    const findings = runTraceChecks(
      buildGraph([
        entryOf('doc-a', { mentions: [mention('REQ-1', true)] }),
        entryOf('doc-b', { mentions: [mention('REQ-1', true)] }),
      ]),
    )
    const trc004 = findings.find((f) => f.ruleId === 'TRC004')

    expect(trc004?.severity).toBe('error')
    expect(trc004?.documents.map((d) => d.uri)).toEqual(['doc-a', 'doc-b'])
  })

  it('한 문서만 정의하면 걸리지 않는다', () => {
    expect(rulesOf([entryOf('doc-a', { mentions: [mention('REQ-1', true)] })])).not.toContain('TRC004')
  })
})

describe('TRC005 인덱스에 없는 링크 대상', () => {
  it('대상이 없으면 참고로 알린다', () => {
    const findings = runTraceChecks(buildGraph([entryOf('doc-a', { linksTo: ['doc-z'] })]))
    expect(findings.find((f) => f.ruleId === 'TRC005')).toMatchObject({ severity: 'info' })
  })

  it('대상이 인덱스에 있으면 걸리지 않는다', () => {
    expect(rulesOf([entryOf('doc-a', { linksTo: ['doc-b'] }), entryOf('doc-b')])).not.toContain('TRC005')
  })
})

describe('정렬', () => {
  it('심각도가 높은 것부터 놓는다', () => {
    const findings = runTraceChecks(
      buildGraph([
        entryOf('doc-a', { linksTo: ['doc-z'], mentions: [mention('REQ-9', false)] }),
        entryOf('doc-b', { docType: 'design' }),
      ]),
    )

    expect(findings.map((f) => f.ruleId)).toEqual(['TRC001', 'TRC002', 'TRC005'])
  })

  it('지적 id는 서로 다르다', () => {
    const findings = runTraceChecks(
      buildGraph([entryOf('doc-a', { linksTo: ['x', 'y'] }), entryOf('doc-b', { linksTo: ['x'] })]),
    )
    expect(new Set(findings.map((f) => f.id)).size).toBe(findings.length)
  })

  it('빈 코퍼스는 아무 지적도 내지 않는다', () => {
    expect(runTraceChecks(buildGraph([]))).toEqual([])
  })
})
