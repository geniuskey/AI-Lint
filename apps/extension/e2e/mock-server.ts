import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { LLM_REPORT, RULES_REPORT } from './fixtures/report.js'

export interface MockServer {
  url: string
  /** 검사에 넘어온 요청. 2단계 호출이 실제로 일어났는지 확인한다. */
  lintCalls: Array<{ useLlm: boolean }>
  close(): Promise<void>
}

const PAGE_HTML = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="ajs-page-id" content="789" />
    <title>결제 모듈 개편 설계</title>
  </head>
  <body>
    <div id="main-content" class="wiki-content">
      <h1>배경</h1>
      <p>지난번 논의대로 3단계로 나눠서 진행하기로 했습니다.</p>
      <h2>결정</h2>
      <p>승인 절차를 분리합니다.</p>
    </div>
  </body>
</html>`

const CONTENT_JSON = {
  id: '789',
  title: '결제 모듈 개편 설계',
  space: { key: 'ENG' },
  version: { number: 7, when: '2026-07-15T02:00:00.000Z' },
  history: { createdBy: { displayName: '박작성' } },
  metadata: { labels: { results: [{ name: '설계' }] }, properties: {} },
  ancestors: [{ title: '엔지니어링' }],
  body: {
    storage: {
      value:
        '<h1>배경</h1><p>지난번 논의대로 3단계로 나눠서 진행하기로 했습니다.</p><h2>결정</h2><p>승인 절차를 분리합니다.</p>',
    },
  },
}

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const send = (response: ServerResponse, status: number, body: string, type: string): void => {
  response.writeHead(status, {
    'content-type': type,
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
  })
  response.end(body)
}

export async function startMockServer(port: number): Promise<MockServer> {
  const lintCalls: MockServer['lintCalls'] = []

  const server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0] ?? ''

    if (request.method === 'OPTIONS') return send(response, 204, '', 'text/plain')
    if (path === '/pages/viewpage.action') return send(response, 200, PAGE_HTML, 'text/html; charset=utf-8')
    if (path === '/rest/api/content/789') return send(response, 200, JSON.stringify(CONTENT_JSON), 'application/json')

    if (path === '/v1/lint' && request.method === 'POST') {
      void readBody(request).then((raw) => {
        const { options } = JSON.parse(raw) as { options: { useLlm: boolean } }
        lintCalls.push({ useLlm: options.useLlm })
        send(response, 200, JSON.stringify(options.useLlm ? LLM_REPORT : RULES_REPORT), 'application/json')
      })
      return
    }

    if (path === '/v1/rulesets') {
      return send(response, 200, JSON.stringify({ rulesets: [{ id: 'default', name: '기본' }] }), 'application/json')
    }

    // 링크 확인용 HEAD 요청은 모두 살아 있다고 답한다.
    send(response, 200, '', 'text/plain')
  })

  await new Promise<void>((resolve) => server.listen(port, resolve))

  return {
    url: `http://localhost:${port}`,
    lintCalls,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  }
}
