import { chromium, type BrowserContext } from '@playwright/test'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { writeAssets } from '../../apps/extension/scripts/build-assets.js'
import { USER_ID } from './backend.js'
import { CONTENT_JSON, PAGE_HTML, PAGE_ID } from './confluence-page.js'

const VIEWPORT = { width: 1280, height: 860 }

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,HEAD,OPTIONS',
}

const readBody = async (request: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

const send = (response: ServerResponse, status: number, body: string, type: string): void => {
  response.writeHead(status, { 'content-type': type, ...CORS })
  response.end(body)
}

/** Confluence 흉내와 백엔드 프록시를 겸한다. 확장은 이 origin 하나만 허용하도록 빌드된다. */
async function startSite(port: number, backendUrl: string): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0] ?? ''

    if (request.method === 'OPTIONS') return send(response, 204, '', 'text/plain')

    if (path.startsWith('/v1/')) {
      void readBody(request).then(async (body) => {
        const upstream = await fetch(`${backendUrl}${request.url}`, {
          method: request.method,
          headers: Object.entries(request.headers)
            .filter(([name]) => !['host', 'connection', 'content-length'].includes(name))
            .map(([name, value]) => [name, Array.isArray(value) ? value.join(',') : (value ?? '')]),
          body: body.length === 0 ? null : body,
        })
        send(response, upstream.status, await upstream.text(), 'application/json')
      })
      return
    }

    if (path === '/pages/viewpage.action') return send(response, 200, PAGE_HTML, 'text/html; charset=utf-8')
    if (path === `/rest/api/content/${PAGE_ID}`) {
      return send(response, 200, JSON.stringify(CONTENT_JSON), 'application/json')
    }

    // 링크 확인용 HEAD 요청은 살아 있다고 답한다.
    send(response, 200, '', 'text/plain')
  })

  await new Promise<void>((done) => server.listen(port, done))
  return {
    url: `http://localhost:${port}`,
    close: () => new Promise<void>((done, fail) => server.close((e) => (e ? fail(e) : done()))),
  }
}

export interface ExtensionShotOptions {
  root: string
  outDir: string
  backendUrl: string
  token: string
  port: number
}

export async function captureExtension(options: ExtensionShotOptions): Promise<string[]> {
  const site = await startSite(options.port, options.backendUrl)
  const distDir = resolve(options.root, 'apps/extension/dist')
  const profile = await mkdtemp(join(tmpdir(), 'ai-lint-shots-ext-'))
  const written: string[] = []

  // tsup 산출물은 그대로 두고 manifest의 origin만 목 서버로 갈아끼운다.
  process.env['AI_LINT_ORIGINS'] = `${site.url}/*`
  await writeAssets()

  let context: BrowserContext | null = null
  try {
    context = await chromium.launchPersistentContext(profile, {
      // MV3 확장은 headed 크롬에서만 안정적으로 로드된다.
      headless: false,
      channel: 'chromium',
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`],
    })

    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    const extensionId = new URL(worker.url()).host

    const settings = await context.newPage()
    // 옵션 페이지는 카드 하나뿐이다. 기본 뷰포트로 찍으면 아래가 통째로 여백이 된다.
    await settings.setViewportSize({ width: 700, height: 700 })
    await settings.goto(`chrome-extension://${extensionId}/options.html`)
    await settings.fill('#backendUrl', site.url)
    await settings.fill('#serviceToken', options.token)
    await settings.fill('#userId', USER_ID)
    await settings.click('#save')
    await settings.locator('#status').filter({ hasText: '저장했습니다' }).waitFor()
    await settings.waitForTimeout(200)
    const optionsShot = join(options.outDir, 'extension-options.png')
    await settings.screenshot({ path: optionsShot })
    written.push(optionsShot)
    await settings.close()

    const page = await context.newPage()
    await page.goto(`${site.url}/pages/viewpage.action?pageId=${PAGE_ID}`)
    await page.locator('.fab').waitFor()
    await page.waitForTimeout(400)
    const fabShot = join(options.outDir, 'extension-fab.png')
    await page.screenshot({ path: fabShot })
    written.push(fabShot)

    await page.locator('.fab').click()
    // 규칙 결과가 먼저 오고 AI 결과가 덮어쓴다. AI 배지가 붙을 때까지 기다린다.
    await page.locator('.src').first().waitFor({ timeout: 60_000 })
    await page.waitForTimeout(500)
    const panelShot = join(options.outDir, 'extension-panel.png')
    await page.screenshot({ path: panelShot })
    written.push(panelShot)
  } finally {
    await context?.close()
    await site.close()
    await rm(profile, { recursive: true, force: true })
    // 사내 origin으로 되돌려 놓는다.
    delete process.env['AI_LINT_ORIGINS']
    await writeAssets()
  }

  return written
}
