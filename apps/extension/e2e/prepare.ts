import { writeAssets } from '../scripts/build-assets.js'
import { ORIGIN } from './origin.js'

// 사내 origin으로 빌드된 manifest를 목 서버 origin으로 갈아끼운다. tsup 산출물은 그대로 쓴다.
process.env['AI_LINT_ORIGINS'] = `${ORIGIN}/*`
await writeAssets()
