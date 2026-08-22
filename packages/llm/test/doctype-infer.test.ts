import { describe, it, expect } from 'vitest'
import { DOCTYPE_RESPONSE_SCHEMA, inferDocType, isKnownDocType } from '../src/doctype-infer.js'
import { LlmError, type LlmProvider } from '../src/provider.js'
import { createMockProvider } from '../src/providers/mock.js'
import { heading, makeDoc, para } from './helpers.js'

const doc = makeDoc([heading('h1', 1, '일시'), para('p1', '2026-07-15')], { title: '결제 스쿼드 주간 회의' })

describe('inferDocType', () => {
  it('모델 응답을 그대로 돌려준다', async () => {
    const provider = createMockProvider([{ value: 'meeting-notes', confidence: 0.85 }])
    expect(await inferDocType(doc, provider)).toEqual({ value: 'meeting-notes', confidence: 0.85 })
  })

  it('제목·라벨·목차·본문 앞부분을 프롬프트에 담는다', async () => {
    const provider = createMockProvider([{ value: 'meeting-notes', confidence: 0.9 }])
    await inferDocType(doc, provider)
    const user = provider.calls[0]!.user
    expect(user).toContain('결제 스쿼드 주간 회의')
    expect(user).toContain('payment')
    expect(user).toContain('일시')
  })

  it('알 수 없는 유형을 반환하면 unknown으로 떨어뜨린다', async () => {
    const provider = createMockProvider([{ value: 'blog-post', confidence: 0.9 }])
    expect(await inferDocType(doc, provider)).toEqual({ value: 'unknown', confidence: 0 })
  })

  it('confidence가 범위를 벗어나면 unknown으로 떨어뜨린다', async () => {
    const provider = createMockProvider([{ value: 'design', confidence: 2 }])
    expect(await inferDocType(doc, provider)).toEqual({ value: 'unknown', confidence: 0 })
  })

  it('호출이 실패해도 예외를 던지지 않는다', async () => {
    const provider: LlmProvider = {
      name: 'fail',
      async complete() {
        throw new LlmError('한도 초과', 'rate-limit')
      },
    }
    expect(await inferDocType(doc, provider)).toEqual({ value: 'unknown', confidence: 0 })
  })

  it('응답 스키마의 enum이 8개 유형을 모두 담는다', () => {
    const values = (DOCTYPE_RESPONSE_SCHEMA.properties as Record<string, any>).value.enum
    expect(values).toHaveLength(8)
    expect(values).toContain('troubleshooting')
  })
})

describe('isKnownDocType', () => {
  it('카탈로그에 있는 값만 통과시킨다', () => {
    expect(isKnownDocType('design')).toBe(true)
    expect(isKnownDocType('blog-post')).toBe(false)
  })
})
