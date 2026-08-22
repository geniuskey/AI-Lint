import { parseFragment } from '@ai-lint/xml'
import { normalizeStorage } from './normalize.js'

/** CDATA를 먼저 텍스트로 바꿔야 그 안의 마크업이 self-closing 확장에 걸리지 않는다. */
export const parseStorage = (xhtml: string): Element => parseFragment(normalizeStorage(xhtml))
