import { makeDocument } from '@ai-lint/ir'
import { describe, expect, it } from 'vitest'
import type { DocumentFile } from '../src/core/collect.js'
import { defaultUseLlm, initialJobs, runLintQueue, type JobState } from '../src/core/lint-file.js'

const fileOf = (name: string): DocumentFile => ({
  path: `C:\\d\\${name}`, name, ext: 'docx',
})

const okFetch: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as { document: { source: { uri: string } } }
  return new Response(JSON.stringify({ reportId: `r-${body.document.source.uri}` }), { status: 200 })
}

const parseOf = (broken: string[] = []) => async (file: DocumentFile) => {
  if (broken.includes(file.name)) throw new Error('암호가 걸린 파일입니다')
  return makeDocument('docx', { uri: file.path }, file.name, [])
}

const settings = {
  backendUrl: 'http://localhost:3000', serviceToken: 'tok', userId: '', rulesetId: 'default',
}

const collect = (): { jobs: JobState[]; onChange: (i: number, s: JobState) => void } => {
  const jobs: JobState[] = []
  return { jobs, onChange: (_i, state) => jobs.push(state) }
}

describe('defaultUseLlm', () => {
  it('파일이 하나면 켜고 여러 개면 끈다', () => {
    expect(defaultUseLlm(1)).toBe(true)
    expect(defaultUseLlm(2)).toBe(false)
    expect(defaultUseLlm(0)).toBe(false)
  })
})

describe('initialJobs', () => {
  it('모든 파일을 대기 상태로 만든다', () => {
    expect(initialJobs([fileOf('a.docx')])[0]).toEqual({
      file: fileOf('a.docx'), phase: 'pending', report: null, error: null,
    })
  })
})

describe('runLintQueue', () => {
  it('파싱과 검사 단계를 순서대로 알린다', async () => {
    const { jobs, onChange } = collect()
    const final = await runLintQueue(
      { parse: parseOf(), fetchImpl: okFetch }, [fileOf('a.docx')], settings,
      { useLlm: true, concurrency: 1, onChange },
    )
    expect(jobs.map((j) => j.phase)).toEqual(['parsing', 'linting', 'done'])
    expect(final[0]?.report?.reportId).toBe('r-C:\\d\\a.docx')
  })

  it('파싱이 실패해도 다음 파일을 계속 검사한다', async () => {
    const { onChange } = collect()
    const final = await runLintQueue(
      { parse: parseOf(['a.docx']), fetchImpl: okFetch },
      [fileOf('a.docx'), fileOf('b.docx')], settings,
      { useLlm: false, concurrency: 1, onChange },
    )
    expect(final[0]).toMatchObject({ phase: 'failed', error: '암호가 걸린 파일입니다', report: null })
    expect(final[1]?.phase).toBe('done')
  })

  it('백엔드 오류 문구를 그대로 담는다', async () => {
    const failFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: '오늘 한도를 다 썼습니다' }), { status: 429 })
    const { onChange } = collect()
    const final = await runLintQueue(
      { parse: parseOf(), fetchImpl: failFetch }, [fileOf('a.docx')], settings,
      { useLlm: true, concurrency: 1, onChange },
    )
    expect(final[0]).toMatchObject({ phase: 'failed', error: '오늘 한도를 다 썼습니다' })
  })

  it('LLM 사용 여부를 요청에 실어 보낸다', async () => {
    const sent: unknown[] = []
    const spyFetch: typeof fetch = async (_input, init) => {
      sent.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ reportId: 'r1' }), { status: 200 })
    }
    const { onChange } = collect()
    await runLintQueue({ parse: parseOf(), fetchImpl: spyFetch }, [fileOf('a.docx')], settings, {
      useLlm: false, concurrency: 1, onChange,
    })
    expect(sent[0]).toMatchObject({ options: { useLlm: false, rulesetId: 'default' } })
  })
})
