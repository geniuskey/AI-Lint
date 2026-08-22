import { describe, it, expect } from 'vitest'
import type { Document } from '@ai-lint/ir'
import { planChunks } from '../src/chunk.js'
import { heading, makeDoc, para } from './helpers.js'

const filler = (n: number) => '가'.repeat(n)

const shortDoc = makeDoc([heading('h1', 1, '개요'), para('p1', '결제 모듈을 개편합니다.')])

const longDoc: Document = makeDoc(
  Array.from({ length: 8 }, (_, i) => [heading(`h${i}`, 2, `섹션 ${i}`), para(`p${i}`, filler(500))]).flat(),
)

const hugeSectionDoc = makeDoc([heading('h1', 1, '거대 섹션'), para('p1', filler(3000))])

describe('planChunks', () => {
  it('임계치 이하면 한 덩어리', () => {
    expect(planChunks(shortDoc, { maxChars: 12000 })).toHaveLength(1)
  })

  it('임계치를 넘으면 제목 경계로 나눈다', () => {
    const chunks = planChunks(longDoc, { maxChars: 2000 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.markdown.length).toBeLessThanOrEqual(2400)
  })

  it('모든 블록이 정확히 한 청크에 속한다', () => {
    const ids = planChunks(longDoc, { maxChars: 2000 }).flatMap((c) => c.blockIds)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(longDoc.blocks.map((b) => b.id).sort())
  })

  it('한 섹션이 단독으로 임계치를 넘으면 그 섹션만으로 청크를 만든다', () => {
    const chunks = planChunks(hugeSectionDoc, { maxChars: 500 })
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.blockIds).toEqual(['h1', 'p1'])
  })

  it('제목 블록은 자기 섹션의 청크에 함께 들어간다', () => {
    const chunks = planChunks(longDoc, { maxChars: 1200 })
    for (const c of chunks) expect(c.blockIds[0]).toMatch(/^h\d$/)
  })

  it('청크 인덱스는 0부터 연속이다', () => {
    const chunks = planChunks(longDoc, { maxChars: 2000 })
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i))
  })

  it('마크다운에 블록 ID 주석이 남아 있다', () => {
    expect(planChunks(shortDoc)[0]!.markdown).toContain('<!--b:p1-->')
  })

  it('블록이 없으면 빈 배열', () => {
    expect(planChunks(makeDoc([]))).toEqual([])
  })
})
