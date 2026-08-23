import { Resvg } from '@resvg/resvg-js'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'assets/logo.svg')

/**
 * 아이콘은 전부 `assets/logo.svg` 하나에서 나온다. 로고를 고치면 이 스크립트를 다시 돌린다.
 *
 * 데스크톱 앱의 `src-tauri/icons/`는 여기서 만든 1024px PNG를 `tauri icon`이 다시 씹어
 * .ico와 플랫폼별 크기를 만들어낸다.
 */
const PNG_TARGETS: Array<{ path: string; size: number }> = [
  { path: 'apps/extension/src/icons/16.png', size: 16 },
  { path: 'apps/extension/src/icons/32.png', size: 32 },
  { path: 'apps/extension/src/icons/48.png', size: 48 },
  { path: 'apps/extension/src/icons/128.png', size: 128 },
  { path: 'website/public/favicon-32.png', size: 32 },
  { path: 'website/public/apple-touch-icon.png', size: 180 },
  { path: 'apps/desktop/src-tauri/app-icon.png', size: 1024 },
]

const SVG_TARGETS = ['website/public/favicon.svg', 'apps/desktop/public/logo.svg', 'apps/extension/src/icons/logo.svg']

async function main(): Promise<void> {
  const svg = await readFile(source)

  for (const { path, size } of PNG_TARGETS) {
    const out = resolve(root, path)
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng())
    console.log(`${path} (${size}px)`)
  }

  for (const path of SVG_TARGETS) {
    const out = resolve(root, path)
    await mkdir(dirname(out), { recursive: true })
    await copyFile(source, out)
    console.log(path)
  }

  console.log('\n데스크톱 아이콘은 이어서: pnpm --filter @ai-lint/desktop exec tauri icon src-tauri/app-icon.png')
}

await main()
