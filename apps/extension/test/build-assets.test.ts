import { describe, expect, it } from 'vitest'
import { bareImports, buildManifest } from '../scripts/build-assets.js'

const template = {
  manifest_version: 3,
  content_scripts: [{ js: ['content.js'], matches: [] as string[] }],
  host_permissions: [] as string[],
}

const origins = { confluenceOrigins: ['https://wiki.test/*'], backendOrigins: ['https://api.test/*'] }

describe('buildManifest', () => {
  it('content script는 Confluence origin에만 붙인다', () => {
    expect(buildManifest(template, origins)).toMatchObject({
      content_scripts: [{ matches: ['https://wiki.test/*'] }],
    })
  })

  it('host 권한에는 백엔드 origin도 넣는다', () => {
    // service worker가 백엔드를 부르려면 host 권한이 있어야 한다.
    expect(buildManifest(template, origins)).toMatchObject({
      host_permissions: ['https://wiki.test/*', 'https://api.test/*'],
    })
  })

  it('같은 origin이 겹치면 한 번만 넣는다', () => {
    const manifest = buildManifest(template, {
      confluenceOrigins: ['http://localhost:4181/*'],
      backendOrigins: ['http://localhost:4181/*'],
    })
    expect(manifest).toMatchObject({ host_permissions: ['http://localhost:4181/*'] })
  })

  it('Confluence origin이 비면 거부한다', () => {
    expect(() => buildManifest(template, { confluenceOrigins: [], backendOrigins: ['https://api.test/*'] })).toThrow(
      'confluenceOrigins',
    )
  })

  it('백엔드 origin이 비면 거부한다', () => {
    expect(() => buildManifest(template, { confluenceOrigins: ['https://wiki.test/*'], backendOrigins: [] })).toThrow(
      'backendOrigins',
    )
  })

  it('와일드카드 전체 권한은 거부한다', () => {
    expect(() => buildManifest(template, { ...origins, backendOrigins: ['<all_urls>'] })).toThrow('<all_urls>')
  })

  it('템플릿을 변형하지 않는다', () => {
    buildManifest(template, origins)
    expect(template.host_permissions).toEqual([])
  })
})

describe('bareImports', () => {
  it('번들되지 않고 남은 워크스페이스 import를 찾는다', () => {
    expect(bareImports('import { isConfigured } from "@ai-lint/backend-client";')).toEqual(['@ai-lint/backend-client'])
  })

  it('re-export도 잡는다', () => {
    expect(bareImports("export { x } from 'fflate'")).toEqual(['fflate'])
  })

  it('같은 모듈은 한 번만 보고한다', () => {
    expect(bareImports('import a from "zod";\nimport b from "zod";')).toEqual(['zod'])
  })

  it('상대 경로와 확장 내부 경로는 통과시킨다', () => {
    expect(bareImports('import a from "./x.js";\nimport b from "../y.js";\nimport c from "/z.js";')).toEqual([])
  })

  it('번들된 코드에는 남는 것이 없다', () => {
    expect(bareImports('var a = 1;\nfunction from(x) { return x }\n')).toEqual([])
  })
})
