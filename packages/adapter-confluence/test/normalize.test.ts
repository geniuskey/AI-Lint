import { describe, expect, it } from 'vitest'
import { normalizeStorage } from '../src/normalize.js'

describe('normalizeStorage', () => {
  it('CDATA 본문을 텍스트로 바꾼다', () => {
    const out = normalizeStorage('<ac:plain-text-body><![CDATA[const a = 1 < 2]]></ac:plain-text-body>')
    expect(out).toBe('<ac:plain-text-body>const a = 1 &lt; 2</ac:plain-text-body>')
  })

  it('self-closing 커스텀 태그를 짝 있는 태그로 편다', () => {
    const out = normalizeStorage('<ac:image><ri:attachment ri:filename="a.png"/></ac:image>')
    expect(out).toBe('<ac:image><ri:attachment ri:filename="a.png"></ri:attachment></ac:image>')
  })

  it('속성값 안의 슬래시를 태그 끝으로 오인하지 않는다', () => {
    const out = normalizeStorage('<ri:url ri:value="https://x.test/a"/>')
    expect(out).toBe('<ri:url ri:value="https://x.test/a"></ri:url>')
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
