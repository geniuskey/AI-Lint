import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config.js'
import { createProvider } from '../src/llm-provider.js'

const base = { SERVICE_TOKEN: 'x'.repeat(16) }
const openai = { ...base, LLM_BASE_URL: 'https://llm.mycorp.com/v1', LLM_MODEL: 'internal-gpt' }

describe('loadConfig', () => {
  it('기본 provider는 openai이고 baseUrl과 model을 요구한다', () => {
    expect(() => loadConfig({ ...base })).toThrow(/LLM_BASE_URL.*LLM_MODEL/)
    expect(loadConfig(openai).LLM_PROVIDER).toBe('openai')
  })

  it('gemini provider는 키를 요구한다', () => {
    expect(() => loadConfig({ ...base, LLM_PROVIDER: 'gemini' })).toThrow(/GEMINI_API_KEY/)
    expect(loadConfig({ ...base, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k' }).LLM_PROVIDER).toBe('gemini')
  })

  it('기본값은 Gemini 키 없이도 뜬다', () => {
    const config = loadConfig(openai)
    expect(config.GEMINI_API_KEY).toBeUndefined()
    expect(config.LLM_RESPONSE_FORMAT).toBe('json_schema')
    expect(config.LLM_TIMEOUT_MS).toBe(60_000)
  })

  it('LLM_HEADERS를 헤더 맵으로 읽는다', () => {
    const config = loadConfig({ ...openai, LLM_HEADERS: '{"x-dept-code":"AI-PLATFORM","x-request-source":"ai-lint"}' })
    expect(config.LLM_HEADERS).toEqual({ 'x-dept-code': 'AI-PLATFORM', 'x-request-source': 'ai-lint' })
  })

  it('LLM_HEADERS가 JSON이 아니면 부팅을 막는다', () => {
    expect(() => loadConfig({ ...openai, LLM_HEADERS: 'x-dept-code=AI-PLATFORM' })).toThrow(/LLM_HEADERS/)
  })

  it('LLM_HEADERS 값이 문자열이 아니면 부팅을 막는다', () => {
    expect(() => loadConfig({ ...openai, LLM_HEADERS: '{"x-retry":3}' })).toThrow(/LLM_HEADERS/)
  })

  it('LLM_BASE_URL이 URL이 아니면 부팅을 막는다', () => {
    expect(() => loadConfig({ ...openai, LLM_BASE_URL: 'llm.mycorp.com' })).toThrow(/LLM_BASE_URL/)
  })

  it('빈 문자열 변수는 없는 것으로 본다', () => {
    const config = loadConfig({
      ...openai,
      GEMINI_API_KEY: '',
      LLM_AUTH_HEADER: '',
      LLM_HEADERS: '',
      DATABASE_URL: '',
    })
    expect(config.GEMINI_API_KEY).toBeUndefined()
    expect(config.LLM_AUTH_HEADER).toBeUndefined()
    expect(config.LLM_HEADERS).toBeUndefined()
    expect(config.DATABASE_URL).toBeUndefined()
  })
})

describe('createProvider', () => {
  it('기본 설정이면 openai provider를 만든다', () => {
    const config = loadConfig({
      ...openai,
      LLM_API_KEY: 'secret',
      LLM_AUTH_HEADER: 'x-llm-token',
      LLM_HEADERS: '{"x-dept-code":"AI-PLATFORM"}',
    })
    expect(createProvider(config).name).toBe('openai:internal-gpt')
  })

  it('gemini 설정이면 gemini provider를 만든다', () => {
    const config = loadConfig({ ...base, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-2.5-pro' })
    expect(createProvider(config).name).toBe('gemini:gemini-2.5-pro')
  })
})
