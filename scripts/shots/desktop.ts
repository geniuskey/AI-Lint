import { chromium, type Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { copyFile, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { USER_ID } from './backend.js'
import { stubFetch, tauriStub } from './tauri-stub.js'

const VITE_PORT = 5174
const VIEWPORT = { width: 1280, height: 880 }

/** 화면에는 파일 이름만 나온다. 경로는 임시 폴더라 스크린샷에 남지 않는다. */
const SAMPLES = [
  { from: 'packages/adapter-office/test/fixtures/guide.docx', as: '배포 도구 설치 가이드.docx' },
  { from: 'packages/adapter-office/test/fixtures/deck.pptx', as: '분기 리뷰.pptx' },
  { from: 'packages/adapter-office/test/fixtures/report.xlsx', as: '결제 모듈 요구사항.xlsx' },
  { from: 'packages/adapter-pdf/test/fixtures/guide.pdf', as: '배포 절차서.pdf' },
]

async function stageSamples(root: string): Promise<string[]> {
  const dir = await mkdtemp(join(tmpdir(), 'ai-lint-shots-'))
  const paths: string[] = []
  for (const sample of SAMPLES) {
    const target = join(dir, sample.as)
    await copyFile(resolve(root, sample.from), target)
    paths.push(target)
  }
  return paths
}

async function waitForServer(url: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      /* 아직 안 떴다 */
    }
    await new Promise((done) => setTimeout(done, 500))
  }
  throw new Error(`개발 서버가 뜨지 않았습니다: ${url}`)
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(250)
}

export interface DesktopShotOptions {
  root: string
  outDir: string
  backendUrl: string
  token: string
}

export async function captureDesktop(options: DesktopShotOptions): Promise<string[]> {
  const paths = await stageSamples(options.root)
  const vite = spawn('pnpm', ['--filter', '@ai-lint/desktop', 'dev:vite'], {
    cwd: options.root,
    shell: true,
    stdio: 'ignore',
  })

  const browser = await chromium.launch()
  const written: string[] = []

  try {
    await waitForServer(`http://localhost:${VITE_PORT}/`)

    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2 })
    const page = await context.newPage()
    page.on('pageerror', (cause) => console.error('[desktop]', cause.message))
    page.on('console', (message) => {
      if (message.type() === 'error') console.error('[desktop]', message.text())
    })
    await page.exposeFunction('__shotFetch', stubFetch)
    await page.exposeFunction('__shotRead', async (path: string) => (await readFile(path)).toString('base64'))
    await page.addInitScript({
      content: tauriStub({
        settings: JSON.stringify({
          backendUrl: options.backendUrl,
          userId: USER_ID,
          rulesetId: 'default',
          concurrency: 3,
        }),
        token: options.token,
        pick: paths,
      }),
    })

    await page.goto(`http://localhost:${VITE_PORT}/`)
    await page.getByRole('button', { name: '문서 검사' }).waitFor()

    // 추적성부터 찍는다. 아래에서 문서를 검사하면 코퍼스에 파일 4개가 섞여 든다.
    await page.getByRole('button', { name: '추적성' }).click()
    await page.getByRole('button', { name: '코퍼스 조회' }).click()
    await page.locator('table.trace tbody tr').first().waitFor({ timeout: 60_000 })
    await settle(page)
    const trace = join(options.outDir, 'desktop-trace.png')
    await page.screenshot({ path: trace })
    written.push(trace)

    await page.getByRole('button', { name: '문서 검사' }).click()
    await page.getByRole('button', { name: '파일 선택' }).click()
    await page.locator('table.jobs tbody tr').first().waitFor()
    await page.getByLabel('AI 검사 사용').check()
    await page.getByRole('button', { name: '검사 시작' }).click()
    // 취소 버튼은 큐가 도는 동안에만 있다. 사라지면 전부 끝난 것이다.
    const cancel = page.getByRole('button', { name: '취소' })
    await cancel.waitFor({ state: 'visible', timeout: 30_000 })
    await cancel.waitFor({ state: 'detached', timeout: 180_000 })
    await page.locator('table.jobs tbody tr').first().click()
    await settle(page)
    const lint = join(options.outDir, 'desktop-lint.png')
    await page.screenshot({ path: lint })
    written.push(lint)
  } finally {
    await browser.close()
    vite.kill()
  }

  return written
}
