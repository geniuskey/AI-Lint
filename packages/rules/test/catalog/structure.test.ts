import { describe, it, expect } from 'vitest'
import type { Document } from '@ai-lint/ir'
import { createRegistry, DEFAULT_RULESET, runRules, STRUCTURE_RULES } from '../../src/index.js'
import { callout, code, filler, heading, image, link, list, macro, makeDoc, para, table } from '../helpers.js'

const reg = createRegistry(STRUCTURE_RULES)
const fire = (doc: Document): string[] => runRules(doc, DEFAULT_RULESET, reg).map((f) => f.ruleId)
const findingsFor = (doc: Document, ruleId: string) =>
  runRules(doc, DEFAULT_RULESET, reg).filter((f) => f.ruleId === ruleId)

describe('STR001 heading-hierarchy-skip', () => {
  it('h1 다음 h3이면 위반', () => {
    expect(fire(makeDoc([heading('a', 1, '개요'), heading('b', 3, '세부')]))).toContain('STR001')
  })

  it('h1 다음 h2면 정상', () => {
    expect(fire(makeDoc([heading('a', 1, '개요'), heading('b', 2, '세부')]))).not.toContain('STR001')
  })

  it('레벨이 내려가는 건 정상', () => {
    const doc = makeDoc([heading('a', 1, 'x'), heading('b', 2, 'y'), heading('c', 3, 'z'), heading('d', 1, 'w')])
    expect(fire(doc)).not.toContain('STR001')
  })

  it('건너뛴 제목 블록을 지목한다', () => {
    const [f] = findingsFor(makeDoc([heading('a', 1, '개요'), heading('b', 4, '세부')]), 'STR001')
    expect(f!.blockId).toBe('b')
    expect(f!.suggestion?.after).toContain('h2')
  })
})

describe('STR002 no-headings', () => {
  it('제목 없이 800자를 넘으면 위반', () => {
    expect(fire(makeDoc([para('p', filler(801))]))).toContain('STR002')
  })

  it('짧은 문서는 정상', () => {
    expect(fire(makeDoc([para('p', filler(200))]))).not.toContain('STR002')
  })

  it('제목이 있으면 길어도 정상', () => {
    expect(fire(makeDoc([heading('h', 1, '개요'), para('p', filler(2000))]))).not.toContain('STR002')
  })

  it('코드블록 길이는 본문 길이로 치지 않는다', () => {
    expect(fire(makeDoc([para('p', filler(100)), code('c', filler(2000), 'ts')]))).not.toContain('STR002')
  })
})

describe('STR003 section-too-long', () => {
  it('섹션 본문이 1500자를 넘으면 위반', () => {
    expect(fire(makeDoc([heading('h', 1, '개요'), para('p', filler(1501))]))).toContain('STR003')
  })

  it('1500자 이하면 정상', () => {
    expect(fire(makeDoc([heading('h', 1, '개요'), para('p', filler(1500))]))).not.toContain('STR003')
  })

  it('제목으로 잘 나뉜 긴 문서는 정상', () => {
    const doc = makeDoc([
      heading('h1', 1, '개요'),
      para('p1', filler(1000)),
      heading('h2', 2, '설계'),
      para('p2', filler(1000)),
      heading('h3', 2, '검증'),
      para('p3', filler(1000)),
    ])
    expect(fire(doc)).not.toContain('STR003')
  })

  it('긴 섹션의 제목 블록을 지목한다', () => {
    const doc = makeDoc([heading('h1', 1, '짧음'), para('p1', filler(10)), heading('h2', 2, '긺'), para('p2', filler(2000))])
    expect(findingsFor(doc, 'STR003').map((f) => f.blockId)).toEqual(['h2'])
  })
})

describe('STR004 table-as-image', () => {
  it('표를 암시하는 문맥 옆의 이미지는 위반', () => {
    expect(fire(makeDoc([para('p', '아래 표를 참고하세요.'), image('i', { alt: '표' })]))).toContain('STR004')
  })

  it('실제 table 블록이 같은 섹션에 있으면 정상', () => {
    const doc = makeDoc([para('p', '아래 표를 참고하세요.'), image('i', { alt: '표' }), table('t', ['단계'], [['1차']])])
    expect(fire(doc)).not.toContain('STR004')
  })

  it('ocrText가 있으면 정상', () => {
    expect(fire(makeDoc([para('p', '아래 표'), image('i', { ocrText: '단계 담당\n1차 김' })]))).not.toContain('STR004')
  })

  it('표를 암시하지 않는 문맥이면 정상', () => {
    expect(fire(makeDoc([para('p', '팀 워크숍 사진입니다.'), image('i', { alt: '워크숍 단체 사진' })]))).not.toContain(
      'STR004',
    )
  })

  it('직후 블록의 문맥도 본다', () => {
    expect(fire(makeDoc([image('i', { alt: '그림' }), para('p', '위 다이어그램의 각 단계는')]))).toContain('STR004')
  })
})

describe('STR005 image-missing-alt', () => {
  it('alt와 캡션이 모두 없으면 위반', () => {
    expect(fire(makeDoc([image('i', {})]))).toContain('STR005')
  })

  it('설명적인 alt가 있으면 정상', () => {
    expect(fire(makeDoc([image('i', { alt: '결제 승인 흐름도' })]))).not.toContain('STR005')
  })

  it('캡션만 있어도 정상', () => {
    expect(fire(makeDoc([image('i', { caption: '결제 승인 흐름도' })]))).not.toContain('STR005')
  })

  it('파일명 alt는 없는 것으로 본다', () => {
    expect(fire(makeDoc([image('i', { alt: 'image001.png' })]))).toContain('STR005')
  })

  it('"캡처3" 같은 자리표시자 alt도 위반', () => {
    expect(fire(makeDoc([image('i', { alt: '캡처3' })]))).toContain('STR005')
  })

  it('두 글자 이하 alt는 위반', () => {
    expect(fire(makeDoc([image('i', { alt: '표' })]))).toContain('STR005')
  })
})

describe('STR006 code-block-no-language', () => {
  it('언어 없는 3줄 이상 코드블록은 위반', () => {
    expect(fire(makeDoc([code('c', 'a\nb\nc')]))).toContain('STR006')
  })

  it('언어가 지정되면 정상', () => {
    expect(fire(makeDoc([code('c', 'a\nb\nc', 'typescript')]))).not.toContain('STR006')
  })

  it('3줄 미만 짧은 코드는 정상', () => {
    expect(fire(makeDoc([code('c', 'npm i')]))).not.toContain('STR006')
  })
})

describe('STR007 vague-link-text', () => {
  it('"여기" 링크 텍스트는 위반', () => {
    const doc = makeDoc([para('p', '자세한 내용은 여기')], { links: [link('p', '여기', 'https://x')] })
    expect(fire(doc)).toContain('STR007')
  })

  it('설명적 링크 텍스트는 정상', () => {
    const doc = makeDoc([para('p', '결제 API 명세 참고')], { links: [link('p', '결제 API 명세', 'https://x')] })
    expect(fire(doc)).not.toContain('STR007')
  })

  it('생 URL을 텍스트로 쓴 링크도 위반', () => {
    const doc = makeDoc([para('p', 'x')], { links: [link('p', 'https://wiki.example.com/a/b', 'https://x')] })
    expect(fire(doc)).toContain('STR007')
  })

  it('영어 "click here"도 위반', () => {
    const doc = makeDoc([para('p', 'x')], { links: [link('p', 'Click here', 'https://x')] })
    expect(fire(doc)).toContain('STR007')
  })

  it('링크가 속한 블록을 지목한다', () => {
    const doc = makeDoc([para('p', 'x')], { links: [link('p', '여기', 'https://x')] })
    expect(findingsFor(doc, 'STR007')[0]!.blockId).toBe('p')
  })
})

describe('STR008 layout-table', () => {
  it('헤더 없이 셀이 두 개뿐인 표는 위반', () => {
    expect(fire(makeDoc([table('t', [], [['왼쪽', '오른쪽']])]))).toContain('STR008')
  })

  it('어댑터가 레이아웃 표로 표시하면 위반', () => {
    expect(fire(makeDoc([table('t', ['a'], [['1']], { isLayoutTable: true })]))).toContain('STR008')
  })

  it('정상 데이터 표는 정상', () => {
    expect(fire(makeDoc([table('t', ['단계', '담당'], [['1차', '김'], ['2차', '이']])]))).not.toContain('STR008')
  })
})

describe('STR009 table-no-header', () => {
  it('헤더가 없고 행이 2개 이상이면 위반', () => {
    expect(fire(makeDoc([table('t', [], [['1차', '김'], ['2차', '이']])]))).toContain('STR009')
  })

  it('헤더가 있으면 정상', () => {
    expect(fire(makeDoc([table('t', ['단계', '담당'], [['1차', '김'], ['2차', '이']])]))).not.toContain('STR009')
  })

  it('레이아웃 표는 STR008이 맡으므로 중복 발화하지 않는다', () => {
    const fired = fire(makeDoc([table('t', [], [['a', 'b'], ['c', 'd']], { isLayoutTable: true })]))
    expect(fired).toContain('STR008')
    expect(fired).not.toContain('STR009')
  })
})

describe('STR010 deep-nesting', () => {
  it('4단계 중첩은 위반', () => {
    expect(fire(makeDoc([list('l', ['깊은 항목'], { depth: 4 })]))).toContain('STR010')
  })

  it('2단계는 정상', () => {
    expect(fire(makeDoc([list('l', ['항목'], { depth: 2 })]))).not.toContain('STR010')
  })

  it('경계값 3단계는 정상', () => {
    expect(fire(makeDoc([list('l', ['항목'], { depth: 3 })]))).not.toContain('STR010')
  })
})

describe('STR011 attachment-only', () => {
  it('본문이 200자 미만이고 첨부 링크가 있으면 위반', () => {
    const doc = makeDoc([para('p', '상세 내용은 첨부 참고')], {
      links: [link('p', '설계서.pptx', '/download/a.pptx', { target: 'attachment' })],
    })
    expect(fire(doc)).toContain('STR011')
  })

  it('본문이 충분하면 정상', () => {
    const doc = makeDoc([para('p', filler(300))], {
      links: [link('p', '설계서.pptx', '/download/a.pptx', { target: 'attachment' })],
    })
    expect(fire(doc)).not.toContain('STR011')
  })

  it('첨부가 없으면 짧아도 정상', () => {
    expect(fire(makeDoc([para('p', '짧은 안내문')]))).not.toContain('STR011')
  })
})

describe('STR012 unrendered-macro', () => {
  it('내용 매크로에 렌더 텍스트가 없으면 위반', () => {
    expect(fire(makeDoc([macro('m', 'viewxls')]))).toContain('STR012')
  })

  it('렌더 텍스트가 있으면 정상', () => {
    expect(fire(makeDoc([macro('m', 'excerpt-include', { renderedText: '요약 내용' })]))).not.toContain('STR012')
  })

  it('toc 같은 네비게이션 매크로는 정상', () => {
    expect(fire(makeDoc([macro('m', 'toc')]))).not.toContain('STR012')
  })

  it('대소문자를 가리지 않는다', () => {
    expect(fire(makeDoc([macro('m', 'ViewPDF')]))).toContain('STR012')
  })
})

describe('구조 룰 전반', () => {
  it('깨끗한 문서에서는 아무것도 발화하지 않는다', () => {
    const doc = makeDoc([
      heading('h1', 1, '결제 모듈 개편 설계'),
      para('p1', '이 문서는 결제 모듈 개편의 배경과 설계를 설명합니다.'),
      heading('h2', 2, '아키텍처'),
      para('p2', '승인 요청은 게이트웨이를 거쳐 정산 서비스로 전달됩니다.'),
      table('t1', ['단계', '담당'], [['1차', '김'], ['2차', '이']]),
      image('i1', { alt: '결제 승인 흐름도' }),
      code('c1', 'const a = 1\nconst b = 2\nconst c = 3', 'typescript'),
      list('l1', ['첫째', '둘째'], { depth: 1 }),
      callout('n1', 'info', '운영 반영 전 QA 승인이 필요합니다.'),
    ], { links: [link('p2', '정산 서비스 명세', 'https://wiki.example.com/settlement')] })

    expect(fire(doc)).toEqual([])
  })

  it('모든 구조 룰이 등록되어 있다', () => {
    expect(STRUCTURE_RULES.map((r) => r.id)).toEqual([
      'STR001', 'STR002', 'STR003', 'STR004', 'STR005', 'STR006',
      'STR007', 'STR008', 'STR009', 'STR010', 'STR011', 'STR012', 'STR013',
    ])
    expect(STRUCTURE_RULES.every((r) => r.axis === 'structure')).toBe(true)
  })
})

describe('STR013 emphasis-as-heading', () => {
  it('굵고 크게 흉내낸 제목이면 위반', () => {
    const doc = makeDoc([para('a', '사전 준비물', { emphasizedAsHeading: true })])
    expect(fire(doc)).toContain('STR013')
  })

  it('평범한 문단은 정상', () => {
    expect(fire(makeDoc([para('a', '먼저 설치 파일을 내려받습니다.')]))).not.toContain('STR013')
  })

  it('해당 문단을 지목한다', () => {
    const doc = makeDoc([para('a', '본문'), para('b', '사전 준비물', { emphasizedAsHeading: true })])
    expect(findingsFor(doc, 'STR013')[0]?.blockId).toBe('b')
  })
})
