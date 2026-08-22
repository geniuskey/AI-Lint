import { describe, expect, it } from 'vitest'
import { normalizeStorage } from '../src/normalize.js'

describe('normalizeStorage', () => {
  it('CDATA 본문을 텍스트로 바꾼다', () => {
    const out = normalizeStorage('<ac:plain-text-body><![CDATA[const a = 1 < 2]]></ac:plain-text-body>')
    expect(out).toBe('<ac:plain-text-body>const a = 1 &lt; 2</ac:plain-text-body>')
  })

  it('CDATA 안의 마크업은 건드리지 않는다', () => {
    const out = normalizeStorage('<ac:plain-text-body><![CDATA[<ri:x/>]]></ac:plain-text-body>')
    expect(out).toBe('<ac:plain-text-body>&lt;ri:x/&gt;</ac:plain-text-body>')
  })

  it('일반 XHTML은 그대로 둔다', () => {
    const input = '<p>안녕</p><br/>'
    expect(normalizeStorage(input)).toBe(input)
  })
})
