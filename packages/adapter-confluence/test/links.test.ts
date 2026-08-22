// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { extractBlocks } from '../src/blocks.js'
import { parseStorage } from '../src/dom.js'
import { extractLinks } from '../src/links.js'

const ctx = { baseUrl: 'https://wiki.test', pageId: '123', spaceKey: 'ENG' }

const linksOf = (xhtml: string) => {
  const root = parseStorage(xhtml)
  const { blocks, elements } = extractBlocks(root)
  return extractLinks(blocks, elements, ctx)
}

describe('extractLinks', () => {
  it('앵커 태그를 블록에 묶어 뽑는다', () => {
    const links = linksOf('<p>본문 <a href="https://external.test/a">외부 문서</a></p>')
    expect(links).toEqual([
      { blockId: 'b1', text: '외부 문서', href: 'https://external.test/a', target: 'external', status: 'unchecked' },
    ])
  })

  it('같은 위키 주소와 상대 경로를 내부로 분류한다', () => {
    const links = linksOf('<p><a href="/display/ENG/Home">홈</a><a href="https://wiki.test/x">엑스</a></p>')
    expect(links.map((l) => l.target)).toEqual(['internal', 'internal'])
  })

  it('첨부 다운로드 경로를 attachment로 분류한다', () => {
    const links = linksOf('<p><a href="/download/attachments/123/spec.pptx">스펙</a></p>')
    expect(links[0]?.target).toBe('attachment')
  })

  it('문서 내 앵커를 anchor로 분류한다', () => {
    expect(linksOf('<p><a href="#section-2">아래</a></p>')[0]?.target).toBe('anchor')
  })

  it('ac:link의 대상 페이지 제목을 resolvedTitle로 남긴다', () => {
    const links = linksOf(
      '<p><ac:link><ri:page ri:content-title="결제 설계"/><ac:plain-text-link-body>설계 문서</ac:plain-text-link-body></ac:link></p>',
    )
    expect(links[0]).toMatchObject({
      text: '설계 문서',
      target: 'internal',
      resolvedTitle: '결제 설계',
      href: '/display/ENG/%EA%B2%B0%EC%A0%9C%20%EC%84%A4%EA%B3%84',
    })
  })

  it('링크 본문이 없으면 대상 제목을 텍스트로 쓴다', () => {
    const links = linksOf('<p><ac:link><ri:page ri:content-title="결제 설계"/></ac:link></p>')
    expect(links[0]?.text).toBe('결제 설계')
  })

  it('ac:link의 첨부 참조를 첨부 링크로 만든다', () => {
    const links = linksOf('<p><ac:link><ri:attachment ri:filename="회의록.pptx"/></ac:link></p>')
    expect(links[0]).toMatchObject({
      target: 'attachment',
      text: '회의록.pptx',
      href: '/download/attachments/123/%ED%9A%8C%EC%9D%98%EB%A1%9D.pptx',
    })
  })

  it('사용자 멘션은 링크로 세지 않는다', () => {
    expect(linksOf('<p><ac:link><ri:user ri:userkey="abc"/></ac:link></p>')).toHaveLength(0)
  })
})
