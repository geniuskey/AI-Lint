import { describe, expect, it } from 'vitest'
import { detectDocType } from '../src/doctype.js'

describe('detectDocType', () => {
  it('라벨이 매핑에 있으면 그 유형을 쓴다', () => {
    expect(detectDocType(['meeting-notes'], {})).toEqual({ value: 'meeting-notes', confidence: 0.9, origin: 'label' })
  })

  it('한글 라벨도 인식한다', () => {
    expect(detectDocType(['설계'], {}).value).toBe('design')
  })

  it('라벨 대소문자와 공백을 무시한다', () => {
    expect(detectDocType(['API Doc'], {}).value).toBe('api-doc')
  })

  it('라벨이 없으면 블루프린트 키에서 찾는다', () => {
    const properties = { blueprint: { key: 'com.atlassian.confluence.plugins:meeting-notes-blueprint' } }
    expect(detectDocType([], properties)).toEqual({ value: 'meeting-notes', confidence: 0.8, origin: 'template' })
  })

  it('라벨이 블루프린트보다 우선한다', () => {
    const properties = { blueprint: { key: 'meeting-notes-blueprint' } }
    expect(detectDocType(['설계'], properties).origin).toBe('label')
  })

  it('아무 단서도 없으면 LLM 추론에 맡긴다', () => {
    expect(detectDocType([], {})).toEqual({ value: 'unknown', confidence: 0, origin: 'llm' })
  })

  it('매핑에 없는 라벨은 무시한다', () => {
    expect(detectDocType(['2026', 'team-a'], {}).origin).toBe('llm')
  })
})
