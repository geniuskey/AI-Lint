import { mkdir } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SERVICE_TOKEN, startBackend } from './shots/backend.js'
import { captureDesktop } from './shots/desktop.js'
import { captureExtension } from './shots/extension.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'website/public/shots')

// 4190은 fetch 명세의 차단 포트 목록에 있다. 쓰면 요청이 "bad port"로 죽는다.
const BACKEND_PORT = 4390
const SITE_PORT = 4391

/**
 * 문서에 싣는 화면을 실제 앱에서 찍는다.
 * 백엔드는 진짜로 띄우고, 모델만 대본대로 답하는 것으로 갈아끼운다.
 * 손으로 그린 그림이 아니라 파이프라인이 실제로 내놓은 결과여야 문서가 오래 간다.
 */
async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true })

  const backend = await startBackend(BACKEND_PORT)
  const written: string[] = []
  try {
    written.push(...(await captureDesktop({ root, outDir, backendUrl: backend.url, token: SERVICE_TOKEN })))
    written.push(
      ...(await captureExtension({
        root,
        outDir,
        backendUrl: backend.url,
        token: SERVICE_TOKEN,
        port: SITE_PORT,
      })),
    )
  } finally {
    await backend.close()
  }

  for (const path of written) console.log(relative(root, path).replace(/\\/g, '/'))
}

await main()
