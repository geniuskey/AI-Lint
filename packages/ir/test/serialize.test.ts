import { describe, it, expect } from 'vitest'
import { hashDocument, serializeToMarkdown } from '../src/index.js'
import { designDoc } from './fixtures/design-doc.js'

describe('serializeToMarkdown', () => {
  const md = serializeToMarkdown(designDoc)

  it('모든 블록 앞에 ID 주석을 붙인다', () => {
    for (const b of designDoc.blocks) expect(md).toContain(`<!--b:${b.id}-->`)
  })

  it('heading을 레벨에 맞는 마크다운 제목으로 쓴다', () => {
    expect(md).toContain('# 결제 모듈 개편')
    expect(md).toContain('## 개요')
  })

  it('table을 마크다운 표로 쓴다', () => {
    expect(md).toContain('| 단계 | 담당 |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| 1차 | 김 |')
  })

  it('alt 없는 이미지를 명시적으로 표시한다', () => {
    expect(md).toContain('[이미지: alt 없음]')
  })

  it('alt가 있으면 드러낸다', () => {
    const doc = structuredClone(designDoc)
    const image = doc.blocks.find((b) => b.id === 'i1')!
    Object.assign(image, { alt: '결제 흐름도' })
    expect(serializeToMarkdown(doc)).toContain('[이미지: 결제 흐름도]')
  })

  it('code를 언어 표기와 함께 펜스로 감싼다', () => {
    expect(md).toContain('```typescript')
  })

  it('추출 불가 매크로를 명시한다', () => {
    const doc = structuredClone(designDoc)
    doc.blocks.push({
      id: 'm1',
      path: [1],
      anchor: { kind: 'confluence', xpath: '//x', textQuote: { exact: 'x' } },
      kind: 'macro',
      name: 'viewxls',
      params: { name: 'plan.xlsx' },
    })
    expect(serializeToMarkdown(doc)).toContain('[매크로: viewxls — 내용 추출 불가]')
  })
})

describe('hashDocument', () => {
  it('같은 내용이면 같은 해시', () => {
    expect(hashDocument(designDoc)).toBe(hashDocument(structuredClone(designDoc)))
  })

  it('본문이 바뀌면 해시가 바뀐다', () => {
    const changed = structuredClone(designDoc)
    const target = changed.blocks.find((b) => b.id === 'p1')!
    Object.assign(target, { text: `${(target as { text: string }).text} 추가` })
    expect(hashDocument(changed)).not.toBe(hashDocument(designDoc))
  })

  it('앵커만 바뀌면 해시가 그대로다', () => {
    const changed = structuredClone(designDoc)
    changed.blocks[0]!.anchor = { kind: 'confluence', xpath: '//div[99]', textQuote: { exact: '다른 인용' } }
    expect(hashDocument(changed)).toBe(hashDocument(designDoc))
  })

  it('페이지 버전만 올라가고 내용이 같으면 해시가 그대로다', () => {
    const changed = structuredClone(designDoc)
    changed.source.version = '8'
    changed.source.modifiedAt = '2026-08-01T00:00:00Z'
    expect(hashDocument(changed)).toBe(hashDocument(designDoc))
  })

  it('라벨 순서가 달라도 같은 해시', () => {
    const changed = structuredClone(designDoc)
    changed.metadata.labels = [...designDoc.metadata.labels].reverse()
    expect(hashDocument(changed)).toBe(hashDocument(designDoc))
  })

  it('라벨이 추가되면 해시가 바뀐다', () => {
    const changed = structuredClone(designDoc)
    changed.metadata.labels = [...designDoc.metadata.labels, 'new']
    expect(hashDocument(changed)).not.toBe(hashDocument(designDoc))
  })
})
