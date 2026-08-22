import { describe, it, expect } from 'vitest'
import {
  createMockProvider,
  LLM_FINDING_SCHEMA,
  LlmError,
  LlmFindingSchema,
  LlmResponseSchema,
  toLlmError,
} from '../src/index.js'

const valid = {
  ruleId: 'CTX001',
  blockId: 'p3',
  evidence: '지난번 논의대로',
  why: '어떤 논의인지 문서에 없습니다.',
  suggestion: { before: '지난번 논의대로', after: '2026-07-15 아키텍처 리뷰 결정에 따라' },
  confidence: 0.9,
}

describe('LlmFindingSchema', () => {
  it('유효한 finding을 통과시킨다', () => {
    expect(() => LlmFindingSchema.parse(valid)).not.toThrow()
  })

  it('confidence 범위를 강제한다', () => {
    expect(() => LlmFindingSchema.parse({ ...valid, confidence: 1.5 })).toThrow()
    expect(() => LlmFindingSchema.parse({ ...valid, confidence: -0.1 })).toThrow()
  })

  it('suggestion은 null을 허용한다', () => {
    expect(LlmFindingSchema.parse({ ...valid, suggestion: null }).suggestion).toBeNull()
  })

  it('suggestion을 생략하면 null로 채운다', () => {
    const { suggestion: _omitted, ...rest } = valid
    expect(LlmFindingSchema.parse(rest).suggestion).toBeNull()
  })

  it('LLM 대상이 아닌 룰 ID를 거부한다', () => {
    expect(() => LlmFindingSchema.parse({ ...valid, ruleId: 'STR001' })).toThrow()
  })

  it('META001, META007은 LLM 대상이다', () => {
    expect(() => LlmFindingSchema.parse({ ...valid, ruleId: 'META001' })).not.toThrow()
    expect(() => LlmFindingSchema.parse({ ...valid, ruleId: 'META007' })).not.toThrow()
  })

  it('빈 evidence를 거부한다', () => {
    expect(() => LlmFindingSchema.parse({ ...valid, evidence: '' })).toThrow()
  })
})

describe('LlmResponseSchema', () => {
  it('findings 배열을 요구한다', () => {
    expect(() => LlmResponseSchema.parse({ findings: [] })).not.toThrow()
    expect(() => LlmResponseSchema.parse({ nonsense: true })).toThrow()
  })
})

describe('LLM_FINDING_SCHEMA', () => {
  it('ruleId enum이 zod 스키마와 같은 집합이다', () => {
    const items = (LLM_FINDING_SCHEMA.properties as Record<string, any>).findings.items
    const enumIds: string[] = items.properties.ruleId.enum
    expect(enumIds).toContain('CTX001')
    expect(enumIds).toContain('META007')
    expect(enumIds).not.toContain('STR001')
    expect(enumIds).toHaveLength(11)
  })

  it('suggestion을 제외한 필드를 필수로 요구한다', () => {
    const items = (LLM_FINDING_SCHEMA.properties as Record<string, any>).findings.items
    expect(items.required).toEqual(['ruleId', 'blockId', 'evidence', 'why', 'confidence'])
  })
})

describe('createMockProvider', () => {
  const req = (user: string) => ({ system: 's', user, schema: {}, maxTokens: 100 })

  it('호출 순서대로 응답을 반환하고 요청을 기록한다', async () => {
    const p = createMockProvider([{ findings: [] }, { findings: [{ ruleId: 'CTX001' }] }])
    await p.complete(req('u'))
    const second = await p.complete(req('u2'))
    expect(p.calls[1]!.user).toBe('u2')
    expect(second).toEqual({ findings: [{ ruleId: 'CTX001' }] })
  })

  it('응답이 소진되면 명확한 에러를 던진다', async () => {
    const p = createMockProvider([])
    await expect(p.complete(req('u'))).rejects.toThrow(/소진/)
  })

  it('응답 자리의 Error는 그대로 던진다', async () => {
    const boom = new LlmError('한도 초과', 'rate-limit')
    const p = createMockProvider([boom])
    await expect(p.complete(req('u'))).rejects.toBe(boom)
  })
})

describe('toLlmError', () => {
  it('LlmError는 그대로 통과시킨다', () => {
    const e = new LlmError('x', 'timeout')
    expect(toLlmError(e)).toBe(e)
  })

  it('401/403을 auth로 분류한다', () => {
    expect(toLlmError({ status: 403, message: 'x' }).kind).toBe('auth')
    expect(toLlmError(new Error('Invalid API key')).kind).toBe('auth')
  })

  it('429와 quota 메시지를 rate-limit으로 분류한다', () => {
    expect(toLlmError({ status: 429, message: 'x' }).kind).toBe('rate-limit')
    expect(toLlmError(new Error('RESOURCE_EXHAUSTED: quota')).kind).toBe('rate-limit')
  })

  it('타임아웃을 timeout으로 분류한다', () => {
    expect(toLlmError(new Error('deadline exceeded')).kind).toBe('timeout')
  })

  it('JSON 파싱 실패를 invalid-response로 분류한다', () => {
    expect(toLlmError(new SyntaxError('Unexpected token')).kind).toBe('invalid-response')
  })

  it('분류할 수 없으면 unknown으로 둔다', () => {
    expect(toLlmError(new Error('무슨 일인지 모름')).kind).toBe('unknown')
  })

  it('원인을 cause로 보존한다', () => {
    const cause = new Error('원인')
    expect(toLlmError(cause).cause).toBe(cause)
  })
})
