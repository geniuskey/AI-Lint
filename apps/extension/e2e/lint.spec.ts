import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test, type BrowserContext } from '@playwright/test'
import { startMockServer, type MockServer } from './mock-server.js'
import { PORT } from './origin.js'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(here, '../dist')

let server: MockServer
let context: BrowserContext
let profile: string

test.beforeAll(async () => {
  server = await startMockServer(PORT)
  profile = await mkdtemp(join(tmpdir(), 'ai-lint-'))
  context = await chromium.launchPersistentContext(profile, {
    // MV3 확장은 headed 크롬에서만 안정적으로 로드된다.
    headless: false,
    channel: 'chromium',
    args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`],
  })

  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  const extensionId = new URL(worker.url()).host

  const options = await context.newPage()
  await options.goto(`chrome-extension://${extensionId}/options.html`)
  await options.fill('#backendUrl', server.url)
  await options.fill('#serviceToken', 'e2e-token')
  await options.fill('#userId', 'e2e-user')
  await options.click('#save')
  await expect(options.locator('#status')).toHaveText('저장했습니다')
  await options.close()
})

test.afterAll(async () => {
  await context.close()
  await server.close()
  await rm(profile, { recursive: true, force: true })
})

test('버튼을 누르면 룰 결과가 먼저 나오고 AI 결과가 뒤따른다', async () => {
  const page = await context.newPage()
  await page.goto(`${server.url}/pages/viewpage.action?pageId=789`)

  const fab = page.locator('.fab')
  await expect(fab).toBeVisible()
  await fab.click()

  // 2단계 결과가 1단계를 덮어쓴다.
  await expect(page.locator('.grade')).toHaveText('C')
  await expect(page.locator('.finding')).toHaveCount(2)
  await expect(page.locator('.src')).toHaveText('AI')
  await expect(page.locator('.total')).toHaveText('68')

  expect(server.lintCalls).toEqual([{ useLlm: false }, { useLlm: true }])
})

test('위치 보기를 누르면 본문 문단을 강조한다', async () => {
  const page = await context.newPage()
  await page.goto(`${server.url}/pages/viewpage.action?pageId=789`)
  await page.locator('.fab').click()
  await expect(page.locator('.finding')).toHaveCount(2)

  await page.locator('.finding').first().locator('.locate').click()
  const highlighted = page.locator('.ai-lint-highlight')
  await expect(highlighted).toHaveCount(1)
  await expect(highlighted).toHaveText('지난번 논의대로 3단계로 나눠서 진행하기로 했습니다.')
})

test('Confluence 페이지가 아니면 버튼을 만들지 않는다', async () => {
  const page = await context.newPage()
  await page.goto(`${server.url}/dashboard.action`)
  await page.waitForTimeout(500)
  await expect(page.locator('.fab')).toHaveCount(0)
})
