// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { extractBlocks } from '../src/blocks.js'
import { parseStorage } from '../src/dom.js'

const blocksOf = (xhtml: string) => extractBlocks(parseStorage(xhtml)).blocks

describe('extractBlocks', () => {
  it('제목과 문단을 순서대로 뽑는다', () => {
    const blocks = blocksOf('<h1>배경</h1><p>본문입니다</p>')
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph'])
    expect(blocks[0]).toMatchObject({ id: 'b1', kind: 'heading', level: 1, text: '배경' })
    expect(blocks[1]).toMatchObject({ id: 'b2', kind: 'paragraph', text: '본문입니다' })
  })

  it('빈 문단은 버린다', () => {
    expect(blocksOf('<p>&nbsp;</p><p></p><p>내용</p>')).toHaveLength(1)
  })

  it('제목 계층으로 path를 매긴다', () => {
    const blocks = blocksOf('<h1>가</h1><p>1</p><h2>나</h2><p>2</p><h1>다</h1><p>3</p>')
    expect(blocks.map((b) => b.path)).toEqual([[1], [1], [1, 1], [1, 1], [2], [2]])
  })

  it('건너뛴 제목 레벨에도 path를 만든다', () => {
    const blocks = blocksOf('<h2>가</h2><h4>나</h4>')
    expect(blocks.map((b) => b.path)).toEqual([
      [0, 1],
      [0, 1, 0, 1],
    ])
  })

  it('중첩 목록을 depth가 다른 별도 블록으로 나눈다', () => {
    const blocks = blocksOf('<ul><li>상위<ul><li>하위</li></ul></li></ul>')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false, items: ['상위'], depth: 1 })
    expect(blocks[1]).toMatchObject({ kind: 'list', items: ['하위'], depth: 2 })
  })

  it('표에서 헤더 행과 본문 행을 나눈다', () => {
    const blocks = blocksOf(
      '<table><tbody><tr><th>이름</th><th>값</th></tr><tr><td>a</td><td>1</td></tr></tbody></table>',
    )
    expect(blocks[0]).toMatchObject({
      kind: 'table',
      headers: ['이름', '값'],
      rows: [['a', '1']],
      isLayoutTable: false,
    })
  })

  it('헤더 없이 셀이 둘뿐인 표를 레이아웃 표로 표시한다', () => {
    const blocks = blocksOf('<table><tbody><tr><td>왼쪽</td><td>오른쪽</td></tr></tbody></table>')
    expect(blocks[0]).toMatchObject({ kind: 'table', headers: [], isLayoutTable: true })
  })

  it('code 매크로를 언어와 함께 코드 블록으로 바꾼다', () => {
    const blocks = blocksOf(
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">java</ac:parameter><ac:plain-text-body><![CDATA[int a = 1;]]></ac:plain-text-body></ac:structured-macro>',
    )
    expect(blocks[0]).toMatchObject({ kind: 'code', lang: 'java', text: 'int a = 1;' })
  })

  it('info 매크로를 callout으로 바꾼다', () => {
    const blocks = blocksOf(
      '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>주의사항</p></ac:rich-text-body></ac:structured-macro>',
    )
    expect(blocks[0]).toMatchObject({ kind: 'callout', variant: 'info', text: '주의사항' })
  })

  it('expand 매크로는 껍데기를 벗기고 안쪽을 그대로 올린다', () => {
    const blocks = blocksOf(
      '<ac:structured-macro ac:name="expand"><ac:rich-text-body><h2>안쪽</h2><p>내용</p></ac:rich-text-body></ac:structured-macro>',
    )
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph'])
  })

  it('본문을 추출하지 못한 매크로는 renderedText 없이 macro 블록으로 남긴다', () => {
    const blocks = blocksOf(
      '<ac:structured-macro ac:name="drawio"><ac:parameter ac:name="diagramName">arch</ac:parameter></ac:structured-macro>',
    )
    expect(blocks[0]).toMatchObject({ kind: 'macro', name: 'drawio', params: { diagramName: 'arch' } })
    expect(blocks[0]).not.toHaveProperty('renderedText')
  })

  it('첨부 이미지의 파일명과 alt를 가져온다', () => {
    const blocks = blocksOf('<p><ac:image ac:alt="구성도"><ri:attachment ri:filename="arch.png"/></ac:image></p>')
    expect(blocks[0]).toMatchObject({ kind: 'image', assetRef: 'arch.png', alt: '구성도' })
  })

  it('문단 안의 텍스트와 이미지를 둘 다 남긴다', () => {
    const blocks = blocksOf('<p>설명<ac:image><ri:url ri:value="https://x.test/a.png"/></ac:image></p>')
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'image'])
    expect(blocks[1]).toMatchObject({ assetRef: 'https://x.test/a.png' })
  })

  it('레이아웃 div는 껍데기만 벗기고 안쪽을 올린다', () => {
    const blocks = blocksOf('<div class="contentLayout"><div class="columnMacro"><p>안쪽</p></div></div>')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'paragraph', text: '안쪽' })
  })

  it('elements와 blocks가 같은 순서로 짝지어진다', () => {
    const { blocks, elements } = extractBlocks(parseStorage('<h1>가</h1><p>나</p>'))
    expect(elements).toHaveLength(blocks.length)
    expect(elements[1]?.textContent).toBe('나')
  })
})
