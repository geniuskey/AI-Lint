import { defineConfig } from 'tsup'

const common = {
  target: 'chrome116',
  platform: 'browser' as const,
  // 로고를 문자열로 들여와 shadow DOM에 직접 심는다. 확장 파일을 페이지에 노출하지 않아도 된다.
  loader: { '.svg': 'text' },
  // 확장에는 node_modules도 import map도 없다. 워크스페이스 패키지를 external로 두면
  // esm 번들에 bare specifier가 그대로 남아 브라우저가 모듈 로드에 실패한다.
  noExternal: [/^@ai-lint\//],
  outDir: 'dist',
  outExtension: () => ({ js: '.js' }),
  splitting: false,
  clean: false,
}

export default defineConfig([
  // content script는 클래식 스크립트로 주입되므로 ESM을 쓸 수 없다.
  { ...common, entry: { content: 'src/content/index.ts' }, format: ['iife'], clean: true },
  { ...common, entry: { sw: 'src/background/sw.ts' }, format: ['esm'] },
  { ...common, entry: { options: 'src/options/options.ts' }, format: ['esm'] },
])
