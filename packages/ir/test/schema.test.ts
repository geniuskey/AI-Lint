import { describe, it, expect } from 'vitest'
import { DocumentSchema } from '../src/index.js'
import { designDoc } from './fixtures/design-doc.js'

const clone = () => structuredClone(designDoc) as Record<string, unknown> & typeof designDoc

describe('DocumentSchema', () => {
  it('픽스처 문서를 통과시킨다', () => {
    expect(DocumentSchema.parse(designDoc).title).toBe('결제 모듈 개편')
  })

  it('알 수 없는 블록 kind를 거부한다', () => {
    const bad = clone()
    ;(bad.blocks[0] as { kind: string }).kind = 'sparkle'
    expect(() => DocumentSchema.parse(bad)).toThrow()
  })

  it('heading level 범위를 강제한다', () => {
    const bad = clone()
    ;(bad.blocks[0] as { level: number }).level = 9
    expect(() => DocumentSchema.parse(bad)).toThrow()
  })

  it('anchor kind와 필드가 맞지 않으면 거부한다', () => {
    const bad = clone()
    ;(bad.blocks[0] as { anchor: unknown }).anchor = { kind: 'pptx' }
    expect(() => DocumentSchema.parse(bad)).toThrow()
  })

  it('confidence 범위를 강제한다', () => {
    const bad = clone()
    bad.docType.confidence = 1.5
    expect(() => DocumentSchema.parse(bad)).toThrow()
  })

  it('알 수 없는 docType을 거부한다', () => {
    const bad = clone()
    ;(bad.docType as { value: string }).value = 'novel'
    expect(() => DocumentSchema.parse(bad)).toThrow()
  })

  it('schemaVersion 누락을 거부한다', () => {
    const { schemaVersion: _v, ...rest } = clone()
    expect(() => DocumentSchema.parse(rest)).toThrow()
  })
})
