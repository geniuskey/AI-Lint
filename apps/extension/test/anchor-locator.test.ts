// @vitest-environment happy-dom
import type { SourceAnchor } from '@ai-lint/contract'
import { beforeEach, describe, expect, it } from 'vitest'
import { contentRoot, locate } from '../src/content/anchor-locator.js'

const anchor = (patch: Partial<Extract<SourceAnchor, { kind: 'confluence' }>>): SourceAnchor => ({
  kind: 'confluence',
  xpath: './p[1]',
  textQuote: { exact: '결제 승인 흐름을 정리한다' },
  ...patch,
})

const LONG_PARAGRAPH = '결제 승인 요청은 게이트웨이를 거쳐 원장에 기록되며 실패하면 재시도 큐로 들어간다'

/** happy-dom에는 XPath가 없다. 어댑터가 만드는 './tag[n]' 형태만 흉내 낸다. */
function stubXPath(): void {
  const evaluate = (expression: string, context: Node): { singleNodeValue: Node | null } => {
    if (expression === '.') return { singleNodeValue: context }
    const parsed = /^\.\/([a-z]+)\[(\d+)\]$/.exec(expression)
    if (!parsed) throw new Error(`잘못된 XPath: ${expression}`)
    const [, tag, index] = parsed
    const matched = Array.from((context as Element).children).filter((c) => c.tagName.toLowerCase() === tag)
    return { singleNodeValue: matched[Number(index) - 1] ?? null }
  }
  document.evaluate = evaluate as unknown as Document['evaluate']
}

beforeEach(() => {
  document.body.innerHTML = `
    <div id="main-content">
      <h2>배경</h2>
      <p>결제 승인 흐름을 정리한다</p>
      <p>두 번째   문단이다</p>
      <p>${LONG_PARAGRAPH}</p>
      <div class="wrap"><span>깊은 곳의 문장</span></div>
    </div>
  `
  stubXPath()
})

describe('contentRoot', () => {
  it('본문 컨테이너를 찾는다', () => {
    expect(contentRoot(document).id).toBe('main-content')
  })

  it('본문 컨테이너가 없으면 body를 쓴다', () => {
    document.body.innerHTML = '<article><p>컨테이너 밖 문장</p></article>'
    expect(contentRoot(document).tagName).toBe('BODY')
  })
})

describe('locate', () => {
  it('앵커가 없으면 null이다', () => {
    expect(locate(null, document)).toBeNull()
  })

  it('Confluence 앵커가 아니면 null이다', () => {
    expect(locate({ kind: 'pptx', slide: 1 }, document)).toBeNull()
  })

  it('xpath가 짚은 요소가 인용문을 담고 있으면 그것을 쓴다', () => {
    const found = locate(anchor({ xpath: './p[2]', textQuote: { exact: '두 번째 문단이다' } }), document)
    expect(found?.textContent).toBe('두 번째   문단이다')
  })

  it('xpath가 엉뚱한 곳을 짚으면 인용문으로 다시 찾는다', () => {
    // 렌더된 DOM은 storage와 구조가 달라 인덱스가 어긋날 수 있다.
    const found = locate(anchor({ xpath: './p[2]' }), document)
    expect(found?.textContent).toBe('결제 승인 흐름을 정리한다')
  })

  it('망가진 xpath여도 죽지 않고 인용문으로 넘어간다', () => {
    const found = locate(anchor({ xpath: './ac:image[[' }), document)
    expect(found?.textContent).toBe('결제 승인 흐름을 정리한다')
  })

  it('공백 차이를 무시한다', () => {
    const found = locate(anchor({ xpath: '', textQuote: { exact: '두 번째 문단이다' } }), document)
    expect(found?.tagName).toBe('P')
  })

  it('인용문을 감싼 가장 깊은 요소를 고른다', () => {
    const found = locate(anchor({ xpath: '', textQuote: { exact: '깊은 곳의 문장' } }), document)
    expect(found?.tagName).toBe('SPAN')
  })

  it('긴 인용문은 앞부분만으로 찾는다', () => {
    const edited = `${LONG_PARAGRAPH} 그리고 나중에 덧붙은 문장이다`
    const found = locate(anchor({ xpath: '', textQuote: { exact: edited } }), document)
    expect(found?.textContent).toBe(LONG_PARAGRAPH)
  })

  it('어디에도 없으면 null이다', () => {
    expect(locate(anchor({ xpath: '', textQuote: { exact: '없는 문장' } }), document)).toBeNull()
  })

  it('본문 전체가 걸리면 쓸모없는 위치라 null이다', () => {
    expect(locate(anchor({ xpath: '.', textQuote: { exact: '배경' } }), document)?.tagName).toBe('H2')
    expect(locate(anchor({ xpath: '.', textQuote: { exact: '없는 문장' } }), document)).toBeNull()
  })
})
