import { describe, it, expect } from 'vitest'
import type { Document } from '@ai-lint/ir'
import { createRegistry, DEFAULT_RULESET, METADATA_RULES, runRules } from '../../src/index.js'
import { code, filler, heading, link, makeDoc, para } from '../helpers.js'
import type { MakeDocOptions } from '../helpers.js'

const reg = createRegistry(METADATA_RULES)
const NOW = new Date('2026-08-22T00:00:00Z')

const fire = (doc: Document, now: Date = NOW): string[] =>
  runRules(doc, DEFAULT_RULESET, reg, { now }).map((f) => f.ruleId)

const findingsFor = (doc: Document, ruleId: string, now: Date = NOW) =>
  runRules(doc, DEFAULT_RULESET, reg, { now }).filter((f) => f.ruleId === ruleId)

/** 검사 대상 룰 외의 잡음을 없앤 기본 문서. 각 describe에서 필요한 것만 무너뜨린다. */
const clean = (opts: MakeDocOptions = {}) =>
  makeDoc(
    [
      heading('h1', 1, '배경'),
      para('p1', '결제 모듈 개편의 배경을 설명합니다.'),
      heading('h2', 1, '결정'),
      para('p2', '승인과 정산을 분리해 3단계로 개편합니다.'),
      heading('h3', 1, '대안'),
      para('p3', '일괄 교체안은 롤백 비용이 커 제외했습니다.'),
    ],
    {
      title: '결제 모듈 개편 설계',
      labels: ['payment'],
      owner: '김담당',
      modifiedAt: '2026-08-01T00:00:00Z',
      ...opts,
    },
  )

describe('META001 title-not-descriptive', () => {
  it('"회의록"만 있는 제목은 위반', () => {
    expect(fire(clean({ docType: 'meeting-notes', title: '회의록' }))).toContain('META001')
  })

  it('날짜와 주제가 있는 제목은 정상', () => {
    expect(fire(clean({ title: '[2026-07-15] 결제 모듈 아키텍처 리뷰' }))).not.toContain('META001')
  })

  it('"복사본" 접미가 붙으면 위반', () => {
    expect(fire(clean({ title: '결제 설계 (복사본)' }))).toContain('META001')
  })

  it('5자 미만 제목은 위반', () => {
    expect(fire(clean({ title: '결제' }))).toContain('META001')
  })

  it('Untitled는 대소문자와 무관하게 위반', () => {
    expect(fire(clean({ title: 'untitled' }))).toContain('META001')
  })
})

describe('META002 missing-summary', () => {
  const long = (opts: MakeDocOptions = {}) =>
    makeDoc([heading('h', 1, '상세 설계'), para('p', filler(1300))], {
      title: '결제 모듈 개편 설계',
      labels: ['payment'],
      owner: '김담당',
      modifiedAt: '2026-08-01T00:00:00Z',
      ...opts,
    })

  it('1200자를 넘는데 요약 섹션이 없으면 위반', () => {
    expect(fire(long())).toContain('META002')
  })

  it('요약 섹션이 있으면 정상', () => {
    const doc = makeDoc(
      [heading('h0', 1, '요약'), para('p0', '결제 모듈을 3단계로 개편합니다.'), heading('h', 2, '상세'), para('p', filler(1300))],
      { labels: ['payment'], owner: '김담당' },
    )
    expect(fire(doc)).not.toContain('META002')
  })

  it('제목 없는 도입 문단도 요약으로 인정한다', () => {
    const doc = makeDoc([para('lead', filler(120)), heading('h', 1, '상세'), para('p', filler(1300))], {
      labels: ['payment'],
      owner: '김담당',
    })
    expect(fire(doc)).not.toContain('META002')
  })

  it('짧은 문서는 요약이 없어도 정상', () => {
    expect(fire(clean())).not.toContain('META002')
  })
})

describe('META003 no-labels', () => {
  it('라벨이 비면 위반', () => {
    expect(fire(clean({ labels: [] }))).toContain('META003')
  })

  it('라벨이 하나라도 있으면 정상', () => {
    expect(fire(clean({ labels: ['payment'] }))).not.toContain('META003')
  })
})

describe('META004 no-owner', () => {
  it('owner가 없으면 위반', () => {
    const doc = makeDoc([para('p', '내용')], { labels: ['x'] })
    expect(fire(doc)).toContain('META004')
  })

  it('owner가 있으면 정상', () => {
    expect(fire(clean({ owner: '김담당' }))).not.toContain('META004')
  })

  it('본문에 "담당자: 홍길동"이 있으면 정상', () => {
    const doc = makeDoc([para('p', '담당자: 홍길동')], { labels: ['x'] })
    expect(fire(doc)).not.toContain('META004')
  })

  it('코드블록 안의 owner 표기는 인정하지 않는다', () => {
    const doc = makeDoc([code('c', 'owner: root', 'yaml')], { labels: ['x'] })
    expect(fire(doc)).toContain('META004')
  })
})

describe('META005 stale-document', () => {
  it('임계 기간을 넘긴 문서는 위반', () => {
    expect(fire(clean({ modifiedAt: '2023-01-01T00:00:00Z' }))).toContain('META005')
  })

  it('최근 수정 문서는 정상', () => {
    expect(fire(clean({ modifiedAt: '2026-08-01T00:00:00Z' }))).not.toContain('META005')
  })

  it('modifiedAt이 없으면 발화하지 않는다', () => {
    const doc = makeDoc([para('p', 'x')], { labels: ['x'], owner: '김' })
    expect(fire(doc)).not.toContain('META005')
  })

  it('파싱할 수 없는 날짜는 발화하지 않는다', () => {
    expect(fire(clean({ modifiedAt: '언젠가' }))).not.toContain('META005')
  })

  it('경과 개월 수를 메시지에 담는다', () => {
    const [f] = findingsFor(clean({ modifiedAt: '2024-08-22T00:00:00Z' }), 'META005')
    expect(f!.message).toMatch(/2[0-9]개월/)
  })
})

describe('META006 broken-link', () => {
  it('깨진 링크가 있으면 위반', () => {
    const doc = clean({ links: [link('p1', '정산 명세', 'https://x/gone', { status: 'broken' })] })
    expect(fire(doc)).toContain('META006')
  })

  it('상태가 ok거나 unchecked면 정상', () => {
    const doc = clean({
      links: [
        link('p', '정산 명세', 'https://x/a', { status: 'ok' }),
        link('p', '결제 명세', 'https://x/b', { status: 'unchecked' }),
      ],
    })
    expect(fire(doc)).not.toContain('META006')
  })

  it('깨진 링크마다 하나씩 발화한다', () => {
    const doc = clean({
      links: [
        link('p', 'a', 'https://x/a', { status: 'broken' }),
        link('p', 'b', 'https://x/b', { status: 'broken' }),
      ],
    })
    expect(findingsFor(doc, 'META006')).toHaveLength(2)
  })
})

describe('META007 missing-required-section', () => {
  const meetingBlocks = [
    heading('h1', 1, '일시'),
    para('p1', '2026-07-15'),
    heading('h2', 1, '참석자'),
    para('p2', '김, 이'),
    heading('h3', 1, '결정사항'),
    para('p3', '3단계로 진행'),
  ]

  it('회의록에 액션아이템이 없으면 위반', () => {
    const doc = makeDoc(meetingBlocks, { docType: 'meeting-notes', labels: ['x'], owner: '김' })
    expect(findingsFor(doc, 'META007')[0]!.message).toContain('액션아이템')
  })

  it('필수 섹션이 모두 있으면 정상', () => {
    const doc = makeDoc([...meetingBlocks, heading('h4', 1, '액션아이템'), para('p4', '김: API 초안')], {
      docType: 'meeting-notes',
      labels: ['x'],
      owner: '김',
    })
    expect(fire(doc)).not.toContain('META007')
  })

  it('동의어 제목도 인정한다', () => {
    const doc = makeDoc([...meetingBlocks, heading('h4', 1, 'Action Items'), para('p4', 'x')], {
      docType: 'meeting-notes',
      labels: ['x'],
      owner: '김',
    })
    expect(fire(doc)).not.toContain('META007')
  })

  it('unknown 유형은 발화하지 않는다', () => {
    const doc = makeDoc([para('p', 'x')], { docType: 'unknown', labels: ['x'], owner: '김' })
    expect(fire(doc)).not.toContain('META007')
  })

  it('누락 항목을 한 번에 모아 보고한다', () => {
    const doc = makeDoc([heading('h1', 1, '일시'), para('p1', 'x')], {
      docType: 'meeting-notes',
      labels: ['x'],
      owner: '김',
    })
    expect(findingsFor(doc, 'META007')).toHaveLength(1)
    expect(findingsFor(doc, 'META007')[0]!.message).toContain('참석자')
  })
})

describe('META008 draft-marker', () => {
  it('TBD가 남아 있으면 위반', () => {
    expect(fire(makeDoc([para('p', '응답 형식은 TBD')], { labels: ['x'], owner: '김' }))).toContain('META008')
  })

  it('"작성중"도 잡는다', () => {
    expect(fire(makeDoc([para('p', '이 절은 작성중입니다')], { labels: ['x'], owner: '김' }))).toContain('META008')
  })

  it('코드블록 안의 TODO는 무시한다', () => {
    expect(fire(makeDoc([code('c', '// TODO: refactor', 'ts')], { labels: ['x'], owner: '김' }))).not.toContain(
      'META008',
    )
  })

  it('"TODO"만 적힌 제목은 섹션 이름으로 본다', () => {
    const doc = makeDoc([heading('h', 1, 'TODO'), para('p', '김: API 초안 작성')], { labels: ['x'], owner: '김' })
    expect(fire(doc)).not.toContain('META008')
  })

  it('미완성 표식이 없으면 정상', () => {
    expect(fire(clean())).not.toContain('META008')
  })

  it('표식 주변 문맥을 근거로 담는다', () => {
    const doc = makeDoc([para('p', '재시도 정책은 TBD 상태입니다')], { labels: ['x'], owner: '김' })
    expect(findingsFor(doc, 'META008')[0]!.evidence).toContain('재시도 정책')
  })
})

describe('메타데이터 룰 전반', () => {
  it('깨끗한 문서에서는 아무것도 발화하지 않는다', () => {
    expect(fire(clean())).toEqual([])
  })

  it('모든 메타데이터 룰이 등록되어 있다', () => {
    expect(METADATA_RULES.map((r) => r.id)).toEqual([
      'META001', 'META002', 'META003', 'META004', 'META005', 'META006', 'META007', 'META008',
    ])
    expect(METADATA_RULES.every((r) => r.axis === 'metadata')).toBe(true)
  })
})
