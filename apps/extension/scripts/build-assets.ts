import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export interface OriginConfig {
  confluenceOrigins: string[]
  backendOrigins: string[]
}

export function buildManifest(template: object, origins: OriginConfig): object {
  const groups: Array<[keyof OriginConfig, string[]]> = [
    ['confluenceOrigins', origins.confluenceOrigins],
    ['backendOrigins', origins.backendOrigins],
  ]
  for (const [key, list] of groups) {
    if (list.length === 0) throw new Error(`extension.config.json의 ${key}가 비어 있습니다`)
    if (list.some((origin) => origin.includes('<all_urls>'))) {
      throw new Error('<all_urls>는 쓰지 않습니다. 사내 도메인만 지정하세요')
    }
  }

  const manifest = structuredClone(template) as {
    content_scripts: Array<{ matches: string[] }>
    host_permissions: string[]
  }
  // content script는 Confluence 페이지에만 주입한다. 백엔드 origin은 fetch 권한으로만 필요하다.
  for (const script of manifest.content_scripts) script.matches = [...origins.confluenceOrigins]
  manifest.host_permissions = [...new Set([...origins.confluenceOrigins, ...origins.backendOrigins])]
  return manifest
}

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>

async function main(): Promise<void> {
  const config = await readJson(resolve(root, 'extension.config.json'))
  const template = await readJson(resolve(root, 'src/manifest.template.json'))
  // 로컬 목 서버를 상대로 E2E를 돌릴 때만 origin을 갈아끼운다. 목 서버가 Confluence와 백엔드를 겸한다.
  const override = process.env['AI_LINT_ORIGINS']?.split(',')
  const origins: OriginConfig = override
    ? { confluenceOrigins: override, backendOrigins: override }
    : {
        confluenceOrigins: (config['confluenceOrigins'] as string[] | undefined) ?? [],
        backendOrigins: (config['backendOrigins'] as string[] | undefined) ?? [],
      }

  await mkdir(resolve(root, 'dist/icons'), { recursive: true })
  await writeFile(resolve(root, 'dist/manifest.json'), `${JSON.stringify(buildManifest(template, origins), null, 2)}\n`)
  await copyFile(resolve(root, 'src/options/options.html'), resolve(root, 'dist/options.html'))
  // manifest의 icons 키와 같은 목록. `pnpm icons`가 assets/logo.svg에서 만든다.
  for (const size of [16, 32, 48, 128]) {
    await copyFile(resolve(root, `src/icons/${size}.png`), resolve(root, `dist/icons/${size}.png`))
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  await main()
}
