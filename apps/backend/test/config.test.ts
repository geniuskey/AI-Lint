import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config.js'
import { createProvider } from '../src/llm-provider.js'

const base = { SERVICE_TOKEN: 'x'.repeat(16) }

describe('loadConfig', () => {
  it('기본 provider는 gemini이고 키를 요구한다', () => {
    expect(() => loadConfig({ ...base })).toThrow(/GEMINI_API_KEY/)
    expect(loadConfig({ ...base, GEMINI_API_KEY: 'k' }).LLM_PROVIDER).toBe('gemini')
  })

  it('openai provider는 baseUrl과 model을 요구한다', () => {
    expect(() => loadConfig({ ...base, LLM_PROVIDER: 'openai' })).toThrow(/LLM_BASE_URL.*LLM_MODEL/)
  })

  it('openai provider는 Gemini 키 없이도 뜬다', () => {
    const config = loadConfig({
      ...base,
      LLM_PROVIDER: 'openai',
      LLM_BASE_URL: 'https://llm.mycorp.com/v1',
      LLM_MODEL: 'internal-gpt',
    })
    expect(config.GEMINI_API_KEY).toBeUndefined()
    expect(config.LLM_RESPONSE_FORMAT).toBe('json_schema')
    expect(config.LLM_TIMEOUT_MS).toBe(60_000)
  })

  it('LLM_HEADERS를 헤더 맵으로 읽는다', () => {
    const config = loadConfig({
      ...base,
      LLM_PROVIDER: 'openai',
      LLM_BASE_URL: 'https://llm.mycorp.com/v1',
      LLM_MODEL: 'internal-gpt',
      LLM_HEADERS: '{"x-dept-code":"AI-PLATFORM","x-request-source":"ai-lint"}',
    })
    expect(config.LLM_HEADERS).toEqual({ 'x-dept-code': 'AI-PLATFORM', 'x-request-source': 'ai-lint' })
  })

  it('LLM_HEADERS가 JSON이 아니면 부팅을 막는다', () => {
    const env = {
      ...base,
      LLM_PROVIDER: 'openai',
      LLM_BASE_URL: 'https://llm.mycorp.com/v1',
      LLM_MODEL: 'internal-gpt',
      LLM_HEADERS: 'x-dept-code=AI-PLATFORM',
    }
    expect(() => loadConfig(env)).toThrow(/LLM_HEADERS/)
  })

  it('LLM_HEADERS 값이 문자열이 아니면 부팅을 막는다', () => {
    const env = {
      ...base,
      LLM_PROVIDER: 'openai',
      LLM_BASE_URL: 'https://llm.mycorp.com/v1',
      LLM_MODEL: 'internal-gpt',
      LLM_HEADERS: '{"x-retry":3}',
    }
    expect(() => loadConfig(env)).toThrow(/LLM_HEADERS/)
  })

  it('LLM_BASE_URL이 URL이 아니면 부팅을 막는다', () => {
    const env = { ...base, LLM_PROVIDER: 'openai', LLM_BASE_URL: 'llm.mycorp.com', LLM_MODEL: 'internal-gpt' }
    expect(() => loadConfig(env)).toThrow(/LLM_BASE_URL/)
  })

  it('빈 문자열 변수는 없는 것으로 본다', () => {
    const config = loadConfig({
      ...base,
      LLM_PROVIDER: 'openai',
      LLM_BASE_URL: 'https://llm.mycorp.com/v1',
      LLM_MODEL: 'internal-gpt',
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
  it('gemini 설정이면 gemini provider를 만든다', () => {
    const config = loadConfig({ ...base, GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-2.5-pro' })
    expect(createProvider(config).name).toBe('gemini:gemini-2.5-pro')
  })

  it('openai 설정이면 openai provider를 만든다', () => {
    const config = loadConfig({
      ...base,
      LLM_PROVIDER: 'openai',
      LLM_BASE_URL: 'https://llm.mycorp.com/v1',
      LLM_MODEL: 'internal-gpt',
      LLM_API_KEY: 'secret',
      LLM_AUTH_HEADER: 'x-llm-token',
      LLM_HEADERS: '{"x-dept-code":"AI-PLATFORM"}',
    })
    expect(createProvider(config).name).toBe('openai:internal-gpt')
  })
})
