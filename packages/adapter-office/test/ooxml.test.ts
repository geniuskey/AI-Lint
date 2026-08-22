// @vitest-environment happy-dom
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  compareNatural,
  coreProperties,
  openPackage,
  parsePart,
  relationships,
  relsPathFor,
  resolveTarget,
} from '../src/ooxml.js'

const zipOf = (files: Record<string, string>): Uint8Array =>
  zipSync(Object.fromEntries(Object.entries(files).map(([name, text]) => [name, strToU8(text)])))

describe('compareNatural', () => {
  it('숫자를 자릿수가 아니라 크기로 비교한다', () => {
    expect(['slide10.xml', 'slide2.xml', 'slide1.xml'].sort(compareNatural))
      .toEqual(['slide1.xml', 'slide2.xml', 'slide10.xml'])
  })
})

describe('openPackage', () => {
  const pkg = openPackage(zipOf({ 'a/b.xml': '<root>내용</root>', 'c.bin': '' }))

  it('파트 이름을 알려준다', () => {
    expect(pkg.names()).toContain('a/b.xml')
  })

  it('없는 파트는 null을 준다', () => {
    expect(pkg.text('없음.xml')).toBeNull()
  })

  it('UTF-8 본문을 읽는다', () => {
    expect(pkg.text('a/b.xml')).toBe('<root>내용</root>')
  })
})

describe('parsePart', () => {
  it('파트를 파싱해 루트 요소를 준다', () => {
    const pkg = openPackage(zipOf({ 'x.xml': '<?xml version="1.0"?><w:document><w:body/></w:document>' }))
    expect(parsePart(pkg, 'x.xml')?.firstElementChild?.localName).toBe('w:document')
  })

  it('없는 파트면 null을 준다', () => {
    expect(parsePart(openPackage(zipOf({})), 'x.xml')).toBeNull()
  })
})

describe('relsPathFor', () => {
  it('파트 옆의 _rels 경로를 만든다', () => {
    expect(relsPathFor('xl/workbook.xml')).toBe('xl/_rels/workbook.xml.rels')
    expect(relsPathFor('ppt/slides/slide1.xml')).toBe('ppt/slides/_rels/slide1.xml.rels')
  })

  it('최상위 파트도 처리한다', () => {
    expect(relsPathFor('workbook.xml')).toBe('_rels/workbook.xml.rels')
  })
})

describe('resolveTarget', () => {
  it('파트 위치를 기준으로 상대 경로를 푼다', () => {
    expect(resolveTarget('xl/workbook.xml', 'worksheets/sheet1.xml')).toBe('xl/worksheets/sheet1.xml')
  })

  it('상위로 올라가는 경로를 정리한다', () => {
    expect(resolveTarget('ppt/slides/slide1.xml', '../notesSlides/notesSlide1.xml'))
      .toBe('ppt/notesSlides/notesSlide1.xml')
  })

  it('절대 경로는 앞 슬래시만 뗀다', () => {
    expect(resolveTarget('xl/workbook.xml', '/xl/styles.xml')).toBe('xl/styles.xml')
  })
})

describe('relationships', () => {
  const pkg = openPackage(
    zipOf({
      'xl/_rels/workbook.xml.rels': `<Relationships>
        <Relationship Id="rId1" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/>
        <Relationship Id="rId2" Type="http://x/hyperlink" Target="https://x.test/a" TargetMode="External"/>
      </Relationships>`,
    }),
  )
  const rels = relationships(pkg, 'xl/workbook.xml')

  it('아이디로 대상 파트 경로를 찾는다', () => {
    expect(rels.get('rId1')?.target).toBe('xl/worksheets/sheet1.xml')
  })

  it('외부 링크는 주소를 그대로 둔다', () => {
    expect(rels.get('rId2')?.target).toBe('https://x.test/a')
    expect(rels.get('rId2')?.external).toBe(true)
  })

  it('관계 파일이 없으면 빈 맵을 준다', () => {
    expect(relationships(openPackage(zipOf({})), 'xl/workbook.xml').size).toBe(0)
  })
})

describe('coreProperties', () => {
  it('제목·작성자·수정 시각을 읽는다', () => {
    const pkg = openPackage(
      zipOf({
        'docProps/core.xml': `<cp:coreProperties>
          <dc:title>결제 모듈 개편</dc:title>
          <dc:creator>홍길동</dc:creator>
          <dcterms:modified>2026-01-02T03:04:05Z</dcterms:modified>
        </cp:coreProperties>`,
      }),
    )
    expect(coreProperties(pkg)).toEqual({
      title: '결제 모듈 개편',
      creator: '홍길동',
      modified: '2026-01-02T03:04:05Z',
    })
  })

  it('파일이 없으면 빈 객체를 준다', () => {
    expect(coreProperties(openPackage(zipOf({})))).toEqual({})
  })

  it('빈 값은 담지 않는다', () => {
    const pkg = openPackage(zipOf({ 'docProps/core.xml': '<cp:coreProperties><dc:title>  </dc:title></cp:coreProperties>' }))
    expect(coreProperties(pkg)).toEqual({})
  })
})
