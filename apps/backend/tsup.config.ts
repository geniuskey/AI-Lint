import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  // 런타임 이미지에 node_modules를 두지 않으려고 전부 번들한다. pg-native는 선택적 네이티브 모듈이라 제외한다.
  noExternal: [/.*/],
  external: ['pg-native'],
  // 청크를 나누면 아래 require 셰임이 진입 파일에만 붙어 CJS 의존성이 깨진다.
  splitting: false,
  // yaml·pg 같은 CJS 의존성이 런타임에 require를 부른다. ESM 번들에는 require가 없으므로 만들어 준다.
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module';\nconst require = __createRequire(import.meta.url);",
  },
})
