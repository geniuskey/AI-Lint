# Windows 문서 검사 앱 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PPTX·DOCX·XLSX·PDF 파일을 IR로 변환해 기존 lint 백엔드로 검사하고 결과를 보여주는 Tauri 데스크톱 앱을 만든다.

**Architecture:** 파싱은 전부 순수 TypeScript다. OOXML은 `fflate`로 압축을 풀고 `DOMParser`로 파싱하며, PDF는 `pdfjs-dist`를 쓴다. 이 코드는 WebView2 안에서 그대로 돌기 때문에 Node 사이드카가 없다. Tauri 셸은 파일 읽기·설정 저장·토큰 보관만 Rust 커맨드로 담당하고, 검사 요청은 기존 `/v1/lint` 백엔드로 보낸다.

**Tech Stack:** Tauri v2 (Rust) + React 19 + Vite 7, TypeScript strict ESM, fflate, pdfjs-dist, vitest 3 + happy-dom, pnpm workspace + Turborepo.

## Global Constraints

- 모든 새 패키지는 `"type": "module"`, ESM only. TypeScript strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` 기준을 지킨다.
- XML 파싱은 **`text/html` 모드로 통일**한다. `application/xml`은 happy-dom이 HTML 파서로 우회시켜 `localName`에 접두사가 남으므로 테스트와 WebView2 동작이 갈린다.
- 태그 매칭은 **접두사 무시(local name) 기준**이다. 쿼리에 콜론이 있으면 전체 이름 일치, 없으면 local name 일치. 쿼리는 소문자로 비교한다.
- 서비스 토큰은 평문 파일에 두지 않고 Windows 자격 증명 관리자(`keyring`)에 넣는다.
- Tauri HTTP 스코프는 `http://localhost:*/*`, `http://127.0.0.1:*/*`, `https://*/v1/*`로 제한한다. 파일 접근은 `tauri-plugin-fs` 대신 직접 만든 Rust 커맨드로 처리한다.
- 폴더 일괄 검사는 LLM 기본 OFF, 단일 파일 검사는 LLM 기본 ON. 검사 동시 실행은 3개로 제한한다.
- UI 문구는 한국어. 이모지를 쓰지 않는다.
- 커밋 메시지는 영어 `type: description` 형식이며 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`로 끝난다.
- 각 태스크는 `pnpm test`(전체 스위트)와 `pnpm typecheck`가 통과한 상태로 끝낸다. 시작 시점 기준선은 **37개 테스트 파일, 419 passed / 1 skipped**이다.

## File Structure

**새 패키지**

| 경로 | 책임 |
|---|---|
| `packages/xml` | `text/html` 파싱과 접두사 무시 DOM 순회 헬퍼. 의존성 없음 |
| `packages/adapter-office` | zip 열기·파트 파싱·relationships, 그리고 PPTX·DOCX·XLSX → IR |
| `packages/adapter-pdf` | pdfjs로 PDF → IR |
| `packages/labels` | 심각도·축·문서유형 한국어 라벨. 의존성 없음 |
| `packages/backend-client` | `/v1/lint` 호출과 `BackendError`. 확장과 데스크톱이 공유 |
| `apps/desktop` | Tauri 셸 + React UI |

**수정하는 기존 파일**

| 경로 | 변경 |
|---|---|
| `packages/ir/src/schema.ts` | `sheet` 블록 제거, `slide.title` 제거, `paragraph.emphasizedAsHeading` 추가 |
| `packages/ir/src/build.ts` | 신규. 어댑터 공용 `BlockList` 빌더 |
| `packages/adapter-confluence/src/dom.ts` | `parseStorage`만 남기고 헬퍼는 `@ai-lint/xml`로 이전 |
| `packages/rules/src/catalog/structure/` | `str013`, `str014` 추가 |
| `apps/extension/src/shared/labels.ts` | `@ai-lint/labels` 재export로 축소 |
| `apps/extension/src/background/backend-client.ts` | `@ai-lint/backend-client` 재export로 축소 |
| `vitest.config.ts` | `apps/*/test/**/*.test.{ts,tsx}` 로 확장 |

---

### Task 1: `packages/xml` 승격

`adapter-confluence`의 DOM 헬퍼를 의존성 없는 패키지로 빼고, 접두사 있는 태그를 다루는 규칙을 한 곳으로 모은다. 자기 닫힘 태그 확장도 `ac|ri` 전용에서 일반 태그로 넓힌다 — OOXML은 `<w:br/>`, `<a:buChar .../>` 같은 자기 닫힘 태그가 널려 있다.

**Files:**
- Create: `packages/xml/package.json`, `packages/xml/tsconfig.json`, `packages/xml/src/index.ts`, `packages/xml/src/parse.ts`, `packages/xml/src/traverse.ts`
- Create: `packages/xml/test/parse.test.ts`, `packages/xml/test/traverse.test.ts`
- Modify: `packages/adapter-confluence/src/dom.ts` (전체 교체), `packages/adapter-confluence/src/normalize.ts`, `packages/adapter-confluence/src/blocks.ts`, `packages/adapter-confluence/src/anchor.ts`, `packages/adapter-confluence/src/links.ts`, `packages/adapter-confluence/src/index.ts`, `packages/adapter-confluence/package.json`
- Delete: `packages/adapter-confluence/test/dom.test.ts`

**Interfaces:**
- Produces (`@ai-lint/xml`):
  - `expandSelfClosing(xml: string): string` — HTML void 요소를 뺀 모든 자기 닫힘 태그를 여는 태그 + 닫는 태그로 편다
  - `parseFragment(xml: string): Element` — `text/html`로 파싱해 `document.body`를 돌려준다
  - `tagOf(el: Element): string` — 소문자 전체 이름 (`p:sld`)
  - `localOf(el: Element): string` — 접두사를 뗀 소문자 이름 (`sld`)
  - `matches(el: Element, query: string): boolean`
  - `childrenOf(el: Element, query: string): Element[]`
  - `childOf(el: Element, query: string): Element | null`
  - `findDescendants(root: Element, query: string): Element[]`
  - `findDescendant(root: Element, query: string): Element | null`
  - `textOf(node: Node): string` — 연속 공백을 하나로 접고 trim
  - `attr(el: Element, name: string): string | null` — 원래 이름으로 못 찾으면 소문자 이름으로 재시도

- [ ] **Step 1: 패키지 뼈대 만들기**

`packages/xml/package.json`:

```json
{
  "name": "@ai-lint/xml",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/xml/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM"]
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 2: 파싱 실패 테스트 작성**

`packages/xml/test/parse.test.ts`:

```typescript
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { expandSelfClosing, parseFragment } from '../src/parse.js'

describe('expandSelfClosing', () => {
  it('접두사 있는 자기 닫힘 태그를 편다', () => {
    expect(expandSelfClosing('<a:buChar char="-"/>')).toBe('<a:buChar char="-"></a:buChar>')
  })

  it('접두사 없는 태그도 편다', () => {
    expect(expandSelfClosing('<pPr/>')).toBe('<pPr></pPr>')
  })

  it('HTML void 요소는 건드리지 않는다', () => {
    expect(expandSelfClosing('<br/><img src="x"/>')).toBe('<br/><img src="x"/>')
  })

  it('속성 안의 슬래시에 속지 않는다', () => {
    expect(expandSelfClosing('<r:x t="a/b"/>')).toBe('<r:x t="a/b"></r:x>')
  })
})

describe('parseFragment', () => {
  it('자기 닫힘 태그의 형제를 자식으로 만들지 않는다', () => {
    const root = parseFragment('<p:sp><p:nvSpPr/><p:txBody/></p:sp>')
    const sp = root.children[0]
    expect(sp?.children).toHaveLength(2)
  })

  it('중첩 구조를 유지한다', () => {
    const root = parseFragment('<w:body><w:p><w:r><w:t>안녕</w:t></w:r></w:p></w:body>')
    expect(root.textContent).toBe('안녕')
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run packages/xml/test/parse.test.ts`
Expected: FAIL — `Failed to resolve import "../src/parse.js"`

- [ ] **Step 4: `parse.ts` 구현**

`packages/xml/src/parse.ts`:

```typescript
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

const SELF_CLOSING = /<([\w-]+(?::[\w-]+)?)((?:[^>"']|"[^"]*"|'[^']*')*?)\/>/g

export function expandSelfClosing(xml: string): string {
  return xml.replace(SELF_CLOSING, (match, tag: string, attrs: string) =>
    VOID_TAGS.has(tag.toLowerCase()) ? match : `<${tag}${attrs}></${tag}>`,
  )
}

export function parseFragment(xml: string): Element {
  const parsed = new DOMParser().parseFromString(expandSelfClosing(xml), 'text/html')
  return parsed.body
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run packages/xml/test/parse.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: 순회 헬퍼 실패 테스트 작성**

`packages/xml/test/traverse.test.ts`:

```typescript
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { parseFragment } from '../src/parse.js'
import {
  attr, childOf, childrenOf, findDescendant, findDescendants, localOf, matches, tagOf, textOf,
} from '../src/traverse.js'

const root = (xml: string): Element => parseFragment(xml)

describe('tagOf / localOf', () => {
  it('전체 이름과 지역 이름을 구분한다', () => {
    const el = root('<p:sld/>').children[0]!
    expect(tagOf(el)).toBe('p:sld')
    expect(localOf(el)).toBe('sld')
  })
})

describe('matches', () => {
  it('콜론이 있으면 전체 이름으로 맞춘다', () => {
    const el = root('<ac:link/>').children[0]!
    expect(matches(el, 'ac:link')).toBe(true)
    expect(matches(el, 'ri:link')).toBe(false)
  })

  it('콜론이 없으면 지역 이름으로 맞춘다', () => {
    const el = root('<w:tbl/>').children[0]!
    expect(matches(el, 'tbl')).toBe(true)
    expect(matches(el, 'w:tbl')).toBe(true)
  })
})

describe('childrenOf / childOf', () => {
  it('직계 자식만 고른다', () => {
    const el = root('<w:p><w:r><w:t>a</w:t></w:r><w:r><w:t>b</w:t></w:r></w:p>').children[0]!
    expect(childrenOf(el, 'r')).toHaveLength(2)
    expect(childrenOf(el, 't')).toHaveLength(0)
    expect(childOf(el, 'r')).toBe(el.children[0])
  })

  it('없으면 null을 준다', () => {
    expect(childOf(root('<w:p/>').children[0]!, 'r')).toBeNull()
  })
})

describe('findDescendants', () => {
  it('깊이에 상관없이 모은다', () => {
    const el = root('<w:body><w:p><w:r><w:t>a</w:t></w:r></w:p><w:p><w:r><w:t>b</w:t></w:r></w:p></w:body>')
    expect(findDescendants(el, 't')).toHaveLength(2)
    expect(textOf(findDescendant(el, 't')!)).toBe('a')
  })
})

describe('textOf', () => {
  it('공백을 접는다', () => {
    expect(textOf(root('<w:t>  안녕\n  하세요  </w:t>'))).toBe('안녕 하세요')
  })
})

describe('attr', () => {
  it('대문자가 섞인 속성을 소문자로 다시 찾는다', () => {
    const el = root('<Relationship Id="rId1" Target="slide1.xml"/>').children[0]!
    expect(attr(el, 'Id')).toBe('rId1')
    expect(attr(el, 'Target')).toBe('slide1.xml')
  })

  it('없으면 null을 준다', () => {
    expect(attr(root('<w:p/>').children[0]!, 'w:val')).toBeNull()
  })
})
```

- [ ] **Step 7: 테스트 실패 확인**

Run: `pnpm vitest run packages/xml/test/traverse.test.ts`
Expected: FAIL — `Failed to resolve import "../src/traverse.js"`

- [ ] **Step 8: `traverse.ts` 구현**

`packages/xml/src/traverse.ts`:

```typescript
export const tagOf = (el: Element): string => el.localName.toLowerCase()

export const localOf = (el: Element): string => {
  const tag = tagOf(el)
  const colon = tag.indexOf(':')
  return colon === -1 ? tag : tag.slice(colon + 1)
}

export function matches(el: Element, query: string): boolean {
  const wanted = query.toLowerCase()
  return wanted.includes(':') ? tagOf(el) === wanted : localOf(el) === wanted
}

export const childrenOf = (el: Element, query: string): Element[] =>
  Array.from(el.children).filter((child) => matches(child, query))

export const childOf = (el: Element, query: string): Element | null => childrenOf(el, query)[0] ?? null

export function findDescendants(root: Element, query: string): Element[] {
  const found: Element[] = []
  const walk = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      if (matches(child, query)) found.push(child)
      walk(child)
    }
  }
  walk(root)
  return found
}

export const findDescendant = (root: Element, query: string): Element | null =>
  findDescendants(root, query)[0] ?? null

export const textOf = (node: Node): string => (node.textContent ?? '').replace(/\s+/g, ' ').trim()

export const attr = (el: Element, name: string): string | null =>
  el.getAttribute(name) ?? el.getAttribute(name.toLowerCase())
```

`packages/xml/src/index.ts`:

```typescript
export * from './parse.js'
export * from './traverse.js'
```

- [ ] **Step 9: 테스트 통과 확인**

Run: `pnpm vitest run packages/xml/test/traverse.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 10: `adapter-confluence`를 새 패키지로 돌리기**

`packages/adapter-confluence/package.json`의 `dependencies`에 `"@ai-lint/xml": "workspace:*"`를 추가한다.

`packages/adapter-confluence/src/dom.ts` 전체를 다음으로 바꾼다:

```typescript
import { parseFragment } from '@ai-lint/xml'
import { normalizeStorage } from './normalize.js'

export function parseStorage(xhtml: string): Element {
  return parseFragment(normalizeStorage(xhtml))
}
```

`packages/adapter-confluence/src/normalize.ts`에서 자기 닫힘 확장을 뺀다 — `parseFragment`가 대신 한다:

```typescript
const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g

const escapeText = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function normalizeStorage(xhtml: string): string {
  return xhtml.replace(CDATA, (_match, text: string) => escapeText(text))
}
```

`blocks.ts`, `anchor.ts`, `links.ts`에서 `from './dom.js'`로 가져오던 `tagOf`, `childrenOf`, `childOf`, `findDescendants`, `findDescendant`, `textOf`를 `from '@ai-lint/xml'`로 옮긴다. `parseStorage`만 `./dom.js`에 남는다.

`packages/adapter-confluence/src/index.ts`는 그대로 둔다 (`export { parseStorage } from './dom.js'`).

`packages/adapter-confluence/test/dom.test.ts`를 지운다 — 대상 함수가 `packages/xml/test/traverse.test.ts`로 옮겨갔다.

- [ ] **Step 11: `normalize.test.ts` 손보기**

`packages/adapter-confluence/test/normalize.test.ts`에서 자기 닫힘 확장을 검사하던 케이스는 이제 `normalizeStorage`의 책임이 아니다. 해당 `it(...)` 블록을 지우고 CDATA 케이스만 남긴다. 자기 닫힘 동작은 `packages/xml/test/parse.test.ts`가 덮는다.

- [ ] **Step 12: 전체 스위트 통과 확인**

Run: `pnpm install && pnpm test`
Expected: PASS — `packages/xml`의 2개 파일이 늘고 `adapter-confluence/test/dom.test.ts`가 빠져 **38 files**, 통과 수는 419 이상

Run: `pnpm typecheck`
Expected: 오류 없음

- [ ] **Step 13: 커밋**

```bash
git add packages/xml packages/adapter-confluence pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
refactor: promote DOM helpers to @ai-lint/xml

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: OOXML 기반과 공용 블록 빌더

세 OOXML 포맷이 공유하는 것 — zip 열기, 파트 파싱, `.rels` 해석, `docProps/core.xml` — 을 먼저 만든다. 동시에 어댑터 세 개가 반복할 블록 id·path 부여 로직을 `packages/ir/src/build.ts`로 뽑는다.

**Files:**
- Create: `packages/ir/src/build.ts`, `packages/ir/test/build.test.ts`
- Create: `packages/adapter-office/package.json`, `packages/adapter-office/tsconfig.json`, `packages/adapter-office/src/index.ts`, `packages/adapter-office/src/ooxml.ts`, `packages/adapter-office/test/ooxml.test.ts`
- Modify: `packages/ir/src/index.ts`

**Interfaces:**
- Consumes: `@ai-lint/xml`의 `parseFragment`, `attr`, `findDescendant`, `findDescendants`, `textOf`
- Produces (`@ai-lint/ir`):
  - `type BlockBody` — `Block`에서 `id`/`path`/`anchor`를 뺀 유니온
  - `class BlockList` — `add(body: BlockBody, anchor: SourceAnchor): Block`, `all(): Block[]`
  - `interface FileContext { uri: string; modifiedAt?: string; author?: string }`
  - `fileNameOf(uri: string): string`
  - `titleFrom(candidate: string | null | undefined, ctx: FileContext): string`
  - `makeDocument(kind: SourceKind, ctx: FileContext, title: string, blocks: Block[]): Document`
- Produces (`@ai-lint/adapter-office`):
  - `interface Package { entry(path: string): string | null; bytes(path: string): Uint8Array | null; paths(prefix: string): string[] }`
  - `openPackage(bytes: Uint8Array): Package`
  - `parsePart(pkg: Package, path: string): Element | null`
  - `relsPathFor(partPath: string): string`
  - `resolveTarget(partPath: string, target: string): string`
  - `relationships(pkg: Package, partPath: string): Map<string, string>`
  - `interface CoreProperties { title?: string; creator?: string; modified?: string }`
  - `coreProperties(pkg: Package): CoreProperties`
  - `compareNatural(a: string, b: string): number`

- [ ] **Step 1: 블록 빌더 실패 테스트 작성**

`packages/ir/test/build.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { BlockList, fileNameOf, makeDocument, titleFrom } from '../src/build.js'
import { DocumentSchema } from '../src/schema.js'

const anchor = { kind: 'docx', paragraphIndex: 0 } as const

describe('BlockList', () => {
  it('블록마다 순번 id를 준다', () => {
    const list = new BlockList()
    list.add({ kind: 'paragraph', text: '가' }, anchor)
    list.add({ kind: 'paragraph', text: '나' }, anchor)
    expect(list.all().map((b) => b.id)).toEqual(['b1', 'b2'])
  })

  it('제목이 나올 때마다 경로를 올린다', () => {
    const list = new BlockList()
    list.add({ kind: 'heading', level: 1, text: '개요' }, anchor)
    list.add({ kind: 'paragraph', text: '본문' }, anchor)
    list.add({ kind: 'heading', level: 2, text: '세부' }, anchor)
    list.add({ kind: 'paragraph', text: '본문' }, anchor)
    list.add({ kind: 'heading', level: 1, text: '결론' }, anchor)
    expect(list.all().map((b) => b.path)).toEqual([[1], [1], [1, 1], [1, 1], [2]])
  })

  it('건너뛴 제목 단계를 0으로 채운다', () => {
    const list = new BlockList()
    list.add({ kind: 'heading', level: 3, text: '깊은 제목' }, anchor)
    expect(list.all()[0]?.path).toEqual([0, 0, 1])
  })
})

describe('fileNameOf / titleFrom', () => {
  it('윈도 경로에서 파일명을 뽑는다', () => {
    expect(fileNameOf('C:\\docs\\보고서.docx')).toBe('보고서.docx')
    expect(fileNameOf('/home/u/보고서.docx')).toBe('보고서.docx')
  })

  it('후보가 비면 확장자 뗀 파일명을 쓴다', () => {
    const ctx = { uri: 'C:\\docs\\보고서.docx' }
    expect(titleFrom('  ', ctx)).toBe('보고서')
    expect(titleFrom('실제 제목', ctx)).toBe('실제 제목')
  })
})

describe('makeDocument', () => {
  it('스키마를 만족하는 문서를 만든다', () => {
    const doc = makeDocument('docx', { uri: 'C:\\a.docx', author: '홍길동' }, '제목', [])
    expect(() => DocumentSchema.parse(doc)).not.toThrow()
    expect(doc.source.author).toBe('홍길동')
    expect(doc.docType.value).toBe('unknown')
  })

  it('없는 메타데이터 키는 아예 넣지 않는다', () => {
    const doc = makeDocument('pdf', { uri: 'C:\\a.pdf' }, '제목', [])
    expect('author' in doc.source).toBe(false)
    expect('modifiedAt' in doc.source).toBe(false)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run packages/ir/test/build.test.ts`
Expected: FAIL — `Failed to resolve import "../src/build.js"`

- [ ] **Step 3: `build.ts` 구현**

`packages/ir/src/build.ts`:

```typescript
import type { SourceAnchor } from './anchor.js'
import type { Block, Document, SourceKind } from './schema.js'

export type BlockBody = {
  [K in Block['kind']]: Omit<Extract<Block, { kind: K }>, 'id' | 'path' | 'anchor'>
}[Block['kind']]

export class BlockList {
  private readonly blocks: Block[] = []
  private readonly counters: number[] = []
  private seq = 0

  add(body: BlockBody, anchor: SourceAnchor): Block {
    if (body.kind === 'heading') this.bump(body.level)
    this.seq += 1
    const block = { ...body, id: `b${this.seq}`, path: [...this.counters], anchor } as Block
    this.blocks.push(block)
    return block
  }

  all(): Block[] {
    return this.blocks
  }

  private bump(level: number): void {
    while (this.counters.length < level) this.counters.push(0)
    this.counters.length = level
    this.counters[level - 1] = (this.counters[level - 1] ?? 0) + 1
  }
}

export interface FileContext {
  uri: string
  modifiedAt?: string
  author?: string
}

export const fileNameOf = (uri: string): string => {
  const parts = uri.split(/[\\/]/)
  return parts[parts.length - 1] ?? uri
}

export function titleFrom(candidate: string | null | undefined, ctx: FileContext): string {
  const trimmed = (candidate ?? '').trim()
  if (trimmed.length > 0) return trimmed
  return fileNameOf(ctx.uri).replace(/\.[^.]+$/, '')
}

export function makeDocument(
  kind: SourceKind,
  ctx: FileContext,
  title: string,
  blocks: Block[],
): Document {
  return {
    schemaVersion: 1,
    source: {
      kind,
      uri: ctx.uri,
      ...(ctx.modifiedAt ? { modifiedAt: ctx.modifiedAt } : {}),
      ...(ctx.author ? { author: ctx.author } : {}),
    },
    title,
    // 파일에는 라벨이 없다. 유형 분류는 백엔드 LLM이 맡는다.
    docType: { value: 'unknown', confidence: 0, origin: 'template' },
    blocks,
    links: [],
    metadata: { labels: [] },
  }
}
```

`packages/ir/src/index.ts`에 `export * from './build.js'`를 추가한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run packages/ir/test/build.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: `adapter-office` 뼈대 만들기**

`packages/adapter-office/package.json`:

```json
{
  "name": "@ai-lint/adapter-office",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ai-lint/ir": "workspace:*",
    "@ai-lint/xml": "workspace:*",
    "fflate": "^0.8.2"
  }
}
```

`packages/adapter-office/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM"]
  },
  "include": ["src", "test"]
}
```

Run: `pnpm install`

- [ ] **Step 6: OOXML 실패 테스트 작성**

`packages/adapter-office/test/ooxml.test.ts`:

```typescript
// @vitest-environment happy-dom
import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  compareNatural, coreProperties, openPackage, parsePart, relationships, relsPathFor, resolveTarget,
} from '../src/ooxml.js'

const CORE = `<?xml version="1.0"?>
<cp:coreProperties xmlns:cp="c" xmlns:dc="d" xmlns:dcterms="t">
  <dc:title>분기 보고서</dc:title>
  <dc:creator>홍길동</dc:creator>
  <dcterms:modified>2026-08-01T09:00:00Z</dcterms:modified>
</cp:coreProperties>`

const RELS = `<?xml version="1.0"?>
<Relationships xmlns="r">
  <Relationship Id="rId1" Type="t/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="t/link" Target="https://example.com" TargetMode="External"/>
  <Relationship Id="rId3" Type="t/theme" Target="../theme/theme1.xml"/>
</Relationships>`

const build = (): Uint8Array =>
  zipSync({
    'docProps/core.xml': strToU8(CORE),
    'ppt/_rels/presentation.xml.rels': strToU8(RELS),
    'ppt/slides/slide1.xml': strToU8('<p:sld><p:cSld/></p:sld>'),
    'ppt/slides/slide2.xml': strToU8('<p:sld/>'),
    'ppt/slides/slide10.xml': strToU8('<p:sld/>'),
  })

describe('openPackage', () => {
  it('경로로 텍스트를 꺼낸다', () => {
    const pkg = openPackage(build())
    expect(pkg.entry('ppt/slides/slide1.xml')).toContain('p:cSld')
    expect(pkg.entry('없는/파일.xml')).toBeNull()
  })

  it('접두사로 거른 경로를 자연 정렬로 준다', () => {
    const pkg = openPackage(build())
    expect(pkg.paths('ppt/slides/')).toEqual([
      'ppt/slides/slide1.xml',
      'ppt/slides/slide2.xml',
      'ppt/slides/slide10.xml',
    ])
  })
})

describe('compareNatural', () => {
  it('숫자를 값으로 비교한다', () => {
    expect(compareNatural('slide2.xml', 'slide10.xml')).toBeLessThan(0)
  })
})

describe('parsePart', () => {
  it('없는 파트는 null이다', () => {
    expect(parsePart(openPackage(build()), '없는/파일.xml')).toBeNull()
  })

  it('있는 파트는 Element를 준다', () => {
    const root = parsePart(openPackage(build()), 'ppt/slides/slide1.xml')
    expect(root?.children[0]?.localName.toLowerCase()).toBe('p:sld')
  })
})

describe('relsPathFor / resolveTarget', () => {
  it('_rels 경로를 만든다', () => {
    expect(relsPathFor('ppt/presentation.xml')).toBe('ppt/_rels/presentation.xml.rels')
    expect(relsPathFor('[Content_Types].xml')).toBe('_rels/[Content_Types].xml.rels')
  })

  it('상대 경로를 파트 기준으로 푼다', () => {
    expect(resolveTarget('ppt/presentation.xml', 'slides/slide1.xml')).toBe('ppt/slides/slide1.xml')
    expect(resolveTarget('ppt/slides/slide1.xml', '../media/image1.png')).toBe('ppt/media/image1.png')
    expect(resolveTarget('ppt/presentation.xml', '/docProps/core.xml')).toBe('docProps/core.xml')
  })
})

describe('relationships', () => {
  it('내부 대상은 절대 경로로, 외부 대상은 그대로 준다', () => {
    const rels = relationships(openPackage(build()), 'ppt/presentation.xml')
    expect(rels.get('rId1')).toBe('ppt/slides/slide1.xml')
    expect(rels.get('rId2')).toBe('https://example.com')
    expect(rels.get('rId3')).toBe('ppt/theme/theme1.xml')
  })

  it('rels 파트가 없으면 빈 맵이다', () => {
    expect(relationships(openPackage(build()), 'word/document.xml').size).toBe(0)
  })
})

describe('coreProperties', () => {
  it('제목·작성자·수정시각을 읽는다', () => {
    expect(coreProperties(openPackage(build()))).toEqual({
      title: '분기 보고서',
      creator: '홍길동',
      modified: '2026-08-01T09:00:00Z',
    })
  })
})
```

- [ ] **Step 7: 테스트 실패 확인**

Run: `pnpm vitest run packages/adapter-office/test/ooxml.test.ts`
Expected: FAIL — `Failed to resolve import "../src/ooxml.js"`

- [ ] **Step 8: `ooxml.ts` 구현**

`packages/adapter-office/src/ooxml.ts`:

```typescript
import { attr, findDescendant, findDescendants, parseFragment, textOf } from '@ai-lint/xml'
import { strFromU8, unzipSync } from 'fflate'

export interface Package {
  entry(path: string): string | null
  bytes(path: string): Uint8Array | null
  paths(prefix: string): string[]
}

export function compareNatural(a: string, b: string): number {
  const left = a.split(/(\d+)/)
  const right = b.split(/(\d+)/)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i] ?? ''
    const y = right[i] ?? ''
    if (x === y) continue
    if (/^\d+$/.test(x) && /^\d+$/.test(y)) return Number(x) - Number(y)
    return x < y ? -1 : 1
  }
  return 0
}

export function openPackage(bytes: Uint8Array): Package {
  const files = unzipSync(bytes)
  return {
    entry(path) {
      const found = files[path]
      return found === undefined ? null : strFromU8(found)
    },
    bytes(path) {
      return files[path] ?? null
    },
    paths(prefix) {
      return Object.keys(files)
        .filter((path) => path.startsWith(prefix))
        .sort(compareNatural)
    },
  }
}

export function parsePart(pkg: Package, path: string): Element | null {
  const xml = pkg.entry(path)
  return xml === null ? null : parseFragment(xml)
}

export function relsPathFor(partPath: string): string {
  const slash = partPath.lastIndexOf('/')
  const dir = slash === -1 ? '' : partPath.slice(0, slash + 1)
  return `${dir}_rels/${partPath.slice(slash + 1)}.rels`
}

export function resolveTarget(partPath: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const slash = partPath.lastIndexOf('/')
  const segments = (slash === -1 ? '' : partPath.slice(0, slash)).split('/').filter(Boolean)
  for (const part of target.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  return segments.join('/')
}

export function relationships(pkg: Package, partPath: string): Map<string, string> {
  const map = new Map<string, string>()
  const root = parsePart(pkg, relsPathFor(partPath))
  if (root === null) return map
  for (const rel of findDescendants(root, 'relationship')) {
    const id = attr(rel, 'Id')
    const target = attr(rel, 'Target')
    if (id === null || target === null) continue
    const external = attr(rel, 'TargetMode') === 'External'
    map.set(id, external ? target : resolveTarget(partPath, target))
  }
  return map
}

export interface CoreProperties {
  title?: string
  creator?: string
  modified?: string
}

export function coreProperties(pkg: Package): CoreProperties {
  const root = parsePart(pkg, 'docProps/core.xml')
  if (root === null) return {}
  const pick = (query: string): string | undefined => {
    const el = findDescendant(root, query)
    const text = el === null ? '' : textOf(el)
    return text.length > 0 ? text : undefined
  }
  const title = pick('title')
  const creator = pick('creator')
  const modified = pick('modified')
  return {
    ...(title ? { title } : {}),
    ...(creator ? { creator } : {}),
    ...(modified ? { modified } : {}),
  }
}
```

`packages/adapter-office/src/index.ts`:

```typescript
export * from './ooxml.js'
```

- [ ] **Step 9: 테스트 통과 확인**

Run: `pnpm vitest run packages/adapter-office/test/ooxml.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 10: 전체 확인과 커밋**

Run: `pnpm test && pnpm typecheck`
Expected: 모두 통과

```bash
git add packages/ir packages/adapter-office pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat: add OOXML package reader and shared block builder

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: XLSX 어댑터

세 OOXML 포맷 중 구조가 가장 단순해서 먼저 한다. 시트 하나가 제목 블록 + 표 블록이 된다.

먼저 쓰지 않는 `sheet` 블록 종류를 지운다. 스키마에 남아 있지만 만드는 쪽이 없고, 시트는 `heading` + `table`로 표현하는 편이 규칙(STR009 등)이 그대로 걸린다.

**Files:**
- Modify: `packages/ir/src/schema.ts:83-88` (`sheet` 블록 제거), `packages/ir/src/walk.ts:34-35`, `packages/ir/src/serialize.ts:50-51`
- Create: `packages/adapter-office/src/xlsx.ts`, `packages/adapter-office/test/xlsx.test.ts`
- Create: `packages/adapter-office/test/fixtures/make/xlsx.ps1`, `packages/adapter-office/test/fixtures/report.xlsx` (스크립트로 생성)
- Modify: `packages/adapter-office/src/index.ts`

**Interfaces:**
- Consumes: Task 2의 `openPackage`, `parsePart`, `relationships`, `coreProperties`; `@ai-lint/ir`의 `BlockList`, `makeDocument`, `titleFrom`, `FileContext`
- Produces (`@ai-lint/adapter-office`):
  - `xlsxToDocument(bytes: Uint8Array, ctx: FileContext): Document`
  - `colIndexOf(ref: string): number` — `'A1'` → 0, `'AA3'` → 26

- [ ] **Step 1: `sheet` 블록 종류 제거**

`packages/ir/src/schema.ts`에서 다음 항목을 통째로 지운다:

```typescript
  withBase({
    kind: z.literal('sheet'),
    name: z.string(),
    headers: z.array(z.string()),
    usedRange: z.string(),
  }),
```

`packages/ir/src/walk.ts`에서:

```typescript
    case 'sheet':
      return [block.name, ...block.headers].join(' ')
```

`packages/ir/src/serialize.ts`에서:

```typescript
    case 'sheet':
      return `## 시트 ${block.name} (${block.usedRange})\n열: ${block.headers.join(', ')}`
```

Run: `pnpm test && pnpm typecheck`
Expected: 모두 통과 — 이 블록 종류를 쓰는 곳이 없다

- [ ] **Step 2: 픽스처 생성 스크립트 작성**

`packages/adapter-office/test/fixtures/make/xlsx.ps1`:

```powershell
# report.xlsx 생성. 실행: pwsh -File xlsx.ps1
$ErrorActionPreference = 'Stop'
$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'report.xlsx'
if (Test-Path $out) { Remove-Item $out }

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$book = $excel.Workbooks.Add()
while ($book.Worksheets.Count -gt 1) { $book.Worksheets.Item($book.Worksheets.Count).Delete() }

$req = $book.Worksheets.Item(1)
$req.Name = '요구사항'
$rows = @(
  @('요구사항 ID', '설명', '우선순위'),
  @('REQ-001', '로그인 실패 시 사유를 표시한다', 1),
  @('REQ-002', '세션은 30분 뒤 만료된다', 2),
  @('REQ-003', '비밀번호는 12자 이상이다', 1)
)
for ($r = 0; $r -lt $rows.Count; $r++) {
  for ($c = 0; $c -lt $rows[$r].Count; $c++) {
    $req.Cells.Item($r + 1, $c + 1).Value2 = $rows[$r][$c]
  }
}

$sum = $book.Worksheets.Add([System.Reflection.Missing]::Value, $req)
$sum.Name = '집계'
$sum.Range('A1:B1').Merge()
$sum.Range('A1').Value2 = '분기 집계'
$sum.Cells.Item(2, 1).Value2 = '1분기'
$sum.Cells.Item(2, 2).Value2 = 120
$sum.Cells.Item(3, 1).Value2 = '2분기'
$sum.Cells.Item(3, 2).Value2 = 143

$empty = $book.Worksheets.Add([System.Reflection.Missing]::Value, $sum)
$empty.Name = '빈시트'

$book.Worksheets.Item('요구사항').Activate()
$book.SaveAs($out, 51)
$book.Close($false)
$excel.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
Write-Host "생성 완료: $out"
```

Run: `pwsh -File packages/adapter-office/test/fixtures/make/xlsx.ps1`
Expected: `packages/adapter-office/test/fixtures/report.xlsx` 생성

- [ ] **Step 3: 실패 테스트 작성**

`packages/adapter-office/test/xlsx.test.ts`:

```typescript
// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Block, BlockOfKind, Document } from '@ai-lint/ir'
import { beforeAll, describe, expect, it } from 'vitest'
import { colIndexOf, xlsxToDocument } from '../src/xlsx.js'

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))))

const tablesOf = (doc: Document): Array<BlockOfKind<'table'>> =>
  doc.blocks.filter((b): b is BlockOfKind<'table'> => b.kind === 'table')

const headingsOf = (doc: Document): Array<BlockOfKind<'heading'>> =>
  doc.blocks.filter((b): b is BlockOfKind<'heading'> => b.kind === 'heading')

describe('colIndexOf', () => {
  it('열 문자를 0 기준 번호로 바꾼다', () => {
    expect(colIndexOf('A1')).toBe(0)
    expect(colIndexOf('C12')).toBe(2)
    expect(colIndexOf('AA3')).toBe(26)
  })
})

describe('xlsxToDocument', () => {
  let doc: Document

  beforeAll(() => {
    doc = xlsxToDocument(fixture('report.xlsx'), { uri: 'C:\\docs\\report.xlsx' })
  })

  it('시트마다 1단계 제목을 만든다', () => {
    expect(headingsOf(doc).map((h) => h.text)).toEqual(['요구사항', '집계'])
    expect(headingsOf(doc).every((h) => h.level === 1)).toBe(true)
  })

  it('빈 시트는 건너뛴다', () => {
    expect(doc.blocks.some((b) => b.kind === 'heading' && b.text === '빈시트')).toBe(false)
  })

  it('첫 행이 전부 문자열이고 아래에 숫자가 있으면 헤더로 본다', () => {
    const table = tablesOf(doc)[0]!
    expect(table.headers).toEqual(['요구사항 ID', '설명', '우선순위'])
    expect(table.rows).toHaveLength(3)
    expect(table.rows[0]).toEqual(['REQ-001', '로그인 실패 시 사유를 표시한다', '1'])
  })

  it('헤더 행이 병합되면 헤더를 못 만든다', () => {
    const table = tablesOf(doc)[1]!
    expect(table.headers).toEqual([])
    expect(table.rows[0]).toEqual(['분기 집계', ''])
  })

  it('앵커에 시트 이름과 범위를 담는다', () => {
    const table = tablesOf(doc)[0]!
    expect(table.anchor).toEqual({ kind: 'xlsx', sheet: '요구사항', range: 'A1:C4' })
    expect(headingsOf(doc)[0]!.anchor).toEqual({ kind: 'xlsx', sheet: '요구사항' })
  })

  it('표는 레이아웃 표가 아니다', () => {
    expect(tablesOf(doc).every((t) => t.isLayoutTable)).toBe(false)
  })

  it('문서 제목과 출처를 채운다', () => {
    expect(doc.source.kind).toBe('xlsx')
    expect(doc.source.uri).toBe('C:\\docs\\report.xlsx')
    expect(doc.title.length).toBeGreaterThan(0)
  })

  it('블록 경로가 시트마다 올라간다', () => {
    const paths = doc.blocks.map((b: Block) => b.path)
    expect(paths[0]).toEqual([1])
    expect(paths[2]).toEqual([2])
  })
})
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `pnpm vitest run packages/adapter-office/test/xlsx.test.ts`
Expected: FAIL — `Failed to resolve import "../src/xlsx.js"`

- [ ] **Step 5: `xlsx.ts` 구현**

`packages/adapter-office/src/xlsx.ts`:

```typescript
import {
  BlockList, makeDocument, titleFrom, type Document, type FileContext,
} from '@ai-lint/ir'
import { attr, childOf, childrenOf, findDescendants, textOf } from '@ai-lint/xml'
import { coreProperties, openPackage, parsePart, relationships, type Package } from './ooxml.js'

export function colIndexOf(ref: string): number {
  const letters = ref.replace(/\d+$/, '').toUpperCase()
  let index = 0
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64)
  return index - 1
}

const colNameOf = (index: number): string => {
  let name = ''
  let n = index + 1
  while (n > 0) {
    const rest = (n - 1) % 26
    name = String.fromCharCode(65 + rest) + name
    n = Math.floor((n - 1) / 26)
  }
  return name
}

function siText(si: Element): string {
  const direct = childOf(si, 't')
  if (direct !== null) return textOf(direct)
  return childrenOf(si, 'r')
    .map((run) => textOf(childOf(run, 't') ?? run))
    .join('')
}

function sharedStringsOf(pkg: Package): string[] {
  const root = parsePart(pkg, 'xl/sharedStrings.xml')
  return root === null ? [] : findDescendants(root, 'si').map(siText)
}

interface CellValue {
  text: string
  numeric: boolean
}

function cellValue(cell: Element, shared: string[]): CellValue {
  const type = attr(cell, 't')
  if (type === 'inlineStr') {
    const inline = childOf(cell, 'is')
    return { text: inline === null ? '' : siText(inline), numeric: false }
  }
  const value = childOf(cell, 'v')
  const raw = value === null ? '' : textOf(value)
  if (type === 's') return { text: shared[Number(raw)] ?? '', numeric: false }
  if (type === 'b') return { text: raw === '1' ? 'TRUE' : 'FALSE', numeric: false }
  if (type === 'str' || type === 'e') return { text: raw, numeric: false }
  return { text: raw, numeric: raw.length > 0 && Number.isFinite(Number(raw)) }
}

type Grid = CellValue[][]

const EMPTY: CellValue = { text: '', numeric: false }

function gridOf(sheet: Element, shared: string[]): Grid {
  const rows: Grid = []
  for (const row of findDescendants(sheet, 'row')) {
    const cells: CellValue[] = []
    for (const cell of childrenOf(row, 'c')) {
      const ref = attr(cell, 'r')
      const at = ref === null ? cells.length : colIndexOf(ref)
      while (cells.length < at) cells.push(EMPTY)
      cells[at] = cellValue(cell, shared)
    }
    rows.push(cells)
  }
  while (rows.length > 0 && rows[rows.length - 1]!.every((c) => c.text === '')) rows.pop()
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  return rows.map((row) => {
    const filled = [...row]
    while (filled.length < width) filled.push(EMPTY)
    return filled
  })
}

interface TableShape {
  headers: string[]
  rows: string[][]
}

function shapeOf(grid: Grid): TableShape {
  const start = grid.findIndex((row) => row.some((cell) => cell.text !== ''))
  if (start === -1) return { headers: [], rows: [] }
  const body = grid.slice(start)
  const first = body[0]!
  // 헤더로 인정하는 조건: 첫 행이 빈칸 없이 전부 문자열이고, 아래에 숫자 셀이 있다.
  // 병합된 헤더는 좌상단 말고는 빈칸이 되므로 여기서 걸러진다.
  const looksLikeHeader =
    first.every((cell) => cell.text !== '' && !cell.numeric) &&
    body.slice(1).some((row) => row.some((cell) => cell.numeric))

  if (!looksLikeHeader) return { headers: [], rows: body.map((row) => row.map((c) => c.text)) }
  return { headers: first.map((c) => c.text), rows: body.slice(1).map((row) => row.map((c) => c.text)) }
}

const rangeOf = (grid: Grid): string =>
  grid.length === 0 ? 'A1' : `A1:${colNameOf(grid[0]!.length - 1)}${grid.length}`

export function xlsxToDocument(bytes: Uint8Array, ctx: FileContext): Document {
  const pkg = openPackage(bytes)
  const shared = sharedStringsOf(pkg)
  const rels = relationships(pkg, 'xl/workbook.xml')
  const workbook = parsePart(pkg, 'xl/workbook.xml')
  const list = new BlockList()

  for (const entry of workbook === null ? [] : findDescendants(workbook, 'sheet')) {
    const name = attr(entry, 'name')
    const relId = attr(entry, 'r:id')
    if (name === null || relId === null) continue
    const partPath = rels.get(relId)
    // 차트 시트는 worksheets 밑에 있지 않다. 텍스트가 없으니 건너뛴다.
    if (partPath === undefined || !partPath.startsWith('xl/worksheets/')) continue

    const sheet = parsePart(pkg, partPath)
    if (sheet === null) continue
    const grid = gridOf(sheet, shared)
    if (grid.length === 0) continue

    list.add({ kind: 'heading', level: 1, text: name }, { kind: 'xlsx', sheet: name })
    const shape = shapeOf(grid)
    list.add(
      { kind: 'table', headers: shape.headers, rows: shape.rows, isLayoutTable: false },
      { kind: 'xlsx', sheet: name, range: rangeOf(grid) },
    )
  }

  const core = coreProperties(pkg)
  return makeDocument('xlsx', { ...ctx, ...(core.creator ? { author: core.creator } : {}) },
    titleFrom(core.title, ctx), list.all())
}
```

`packages/adapter-office/src/index.ts`에 `export * from './xlsx.js'`를 추가한다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm vitest run packages/adapter-office/test/xlsx.test.ts`
Expected: PASS (11 tests)

만약 `range`가 `A1:C4`가 아니면 픽스처의 실제 사용 범위에 맞춰 테스트 기대값을 고친다 — 계산식이 아니라 픽스처가 진실이다.

- [ ] **Step 7: 전체 확인과 커밋**

Run: `pnpm test && pnpm typecheck`

```bash
git add packages/ir packages/adapter-office
git commit -m "$(cat <<'EOF'
feat: add xlsx adapter and drop unused sheet block kind

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: DOCX 어댑터와 STR013

Word 문서에서 가장 흔한 AI 비친화 패턴은 "제목 스타일 없이 굵게 키운 글씨로 제목 흉내내기"다. 이걸 잡으려면 어댑터가 그 사실을 IR에 남겨야 하므로 `paragraph` 블록에 `emphasizedAsHeading` 플래그를 붙이고 새 규칙 STR013을 만든다.

**Files:**
- Modify: `packages/ir/src/schema.ts` (`paragraph` 블록에 `emphasizedAsHeading` 추가)
- Create: `packages/adapter-office/src/docx.ts`, `packages/adapter-office/test/docx.test.ts`
- Create: `packages/adapter-office/test/fixtures/make/docx.ps1`, `packages/adapter-office/test/fixtures/guide.docx` (스크립트로 생성)
- Modify: `packages/adapter-office/src/index.ts`
- Create: `packages/rules/src/catalog/structure/str013-emphasis-as-heading.ts`
- Modify: `packages/rules/src/catalog/meta.ts:109` 뒤, `packages/rules/src/catalog/structure/index.ts`
- Modify: `packages/rules/test/helpers.ts:19` (`para` 팩토리에 플래그 옵션)
- Modify: `packages/rules/test/catalog/structure.test.ts` (STR013 describe 블록 추가)

**Interfaces:**
- Consumes: Task 2의 `openPackage`, `parsePart`, `relationships`, `coreProperties`; `@ai-lint/ir`의 `BlockList`, `makeDocument`, `titleFrom`
- Produces (`@ai-lint/adapter-office`): `docxToDocument(bytes: Uint8Array, ctx: FileContext): Document`
- Produces (`@ai-lint/rules`): `str013` — `STRUCTURE_RULES`에 포함
- Produces (`@ai-lint/ir`): `BlockOfKind<'paragraph'>`에 `emphasizedAsHeading?: boolean`

- [ ] **Step 1: 스키마에 플래그 추가**

`packages/ir/src/schema.ts`의 `paragraph` 항목을 다음으로 바꾼다:

```typescript
  withBase({
    kind: z.literal('paragraph'),
    text: z.string(),
    /** 제목 스타일 없이 굵게·크게로 제목을 흉내낸 문단 (STR013) */
    emphasizedAsHeading: z.boolean().optional(),
  }),
```

- [ ] **Step 2: STR013 실패 테스트 작성**

`packages/rules/test/helpers.ts:19`의 `para`를 옵션 인자를 받도록 바꾼다. 인자 두 개로 부르던 기존 호출부는 그대로 동작한다:

```typescript
export const para = (
  id: string,
  text: string,
  opts: { emphasizedAsHeading?: boolean } = {},
): Block => ({
  ...base(id, text),
  kind: 'paragraph',
  text,
  ...(opts.emphasizedAsHeading ? { emphasizedAsHeading: true } : {}),
})
```

`packages/rules/test/catalog/structure.test.ts` 끝에 describe 블록을 붙인다. 이 파일 맨 위의 `fire`/`findingsFor` 헬퍼를 그대로 쓴다:

```typescript
describe('STR013 emphasis-as-heading', () => {
  it('굵고 크게 흉내낸 제목이면 위반', () => {
    const doc = makeDoc([para('a', '사전 준비물', { emphasizedAsHeading: true })])
    expect(fire(doc)).toContain('STR013')
  })

  it('평범한 문단은 정상', () => {
    expect(fire(makeDoc([para('a', '먼저 설치 파일을 내려받습니다.')]))).not.toContain('STR013')
  })

  it('해당 문단을 지목한다', () => {
    const doc = makeDoc([para('a', '본문'), para('b', '사전 준비물', { emphasizedAsHeading: true })])
    expect(findingsFor(doc, 'STR013')[0]?.blockId).toBe('b')
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run packages/rules/test/catalog/structure.test.ts`
Expected: FAIL — `카탈로그에 없는 룰 ID입니다: STR013` 또는 STR013이 결과에 없다

- [ ] **Step 4: STR013 구현**

`packages/rules/src/catalog/meta.ts`의 STR012 항목 바로 뒤(줄 109 다음)에 넣는다:

```typescript
    meta({
      id: 'STR013',
      name: 'emphasis-as-heading',
      axis: 'structure',
      defaultSeverity: 'warning',
      description: '제목 스타일 대신 굵게·큰 글씨로 제목을 표현했습니다.',
    }),
```

`packages/rules/src/catalog/structure/str013-emphasis-as-heading.ts`:

```typescript
import { defineRule } from '../define.js'

export const str013 = defineRule('STR013', (ctx) =>
  ctx.doc.blocks.flatMap((block) => {
    if (block.kind !== 'paragraph' || block.emphasizedAsHeading !== true) return []

    return [
      {
        blockId: block.id,
        message: '제목 스타일 없이 굵게·크게로 제목을 흉내냈습니다',
        why: '글자 모양만 바꾼 제목은 문서 구조에 남지 않습니다. 추출 도구가 섹션 경계를 찾지 못해 여러 주제가 한 청크로 묶이고, 인용할 때 어느 절의 내용인지 붙일 수 없습니다.',
        evidence: block.text.slice(0, 60),
        suggestion: {
          before: block.text,
          after: '제목 1~3 스타일을 적용하세요.',
        },
      },
    ]
  }),
)
```

`packages/rules/src/catalog/structure/index.ts`에 import와 `STRUCTURE_RULES` 배열 항목을 추가한다.

Run: `pnpm vitest run packages/rules/test/catalog/structure.test.ts`
Expected: PASS — STR013 describe 3개 포함

- [ ] **Step 5: DOCX 픽스처 생성 스크립트 작성**

`packages/adapter-office/test/fixtures/make/docx.ps1`:

```powershell
# guide.docx 생성. 실행: pwsh -File docx.ps1
$ErrorActionPreference = 'Stop'
$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'guide.docx'
if (Test-Path $out) { Remove-Item $out }

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$doc = $word.Documents.Add()
$sel = $word.Selection

$sel.Style = $doc.Styles.Item(-2)   # wdStyleHeading1
$sel.TypeText('설치 가이드')
$sel.TypeParagraph()

$sel.Style = $doc.Styles.Item(-1)   # wdStyleNormal
$sel.TypeText('이 문서는 사내 배포 도구 설치 절차를 설명합니다.')
$sel.TypeParagraph()

# 스타일 없이 굵게·크게만 준 가짜 제목 — STR013 대상
$sel.Style = $doc.Styles.Item(-1)
$sel.Font.Bold = $true
$sel.Font.Size = 16
$sel.TypeText('사전 준비물')
$sel.TypeParagraph()
$sel.Font.Bold = $false
$sel.Font.Size = 10

$sel.TypeText('관리자 권한 계정')
$sel.TypeParagraph()
$sel.TypeText('사내 네트워크 접속')
$sel.TypeParagraph()
$start = $doc.Paragraphs.Item($doc.Paragraphs.Count - 2).Range.Start
$end = $doc.Paragraphs.Item($doc.Paragraphs.Count - 1).Range.End
$doc.Range($start, $end).ListFormat.ApplyBulletDefault()

$sel.EndKey(6) | Out-Null   # wdStory
$sel.Style = $doc.Styles.Item(-1)
$table = $doc.Tables.Add($sel.Range, 3, 2)
$table.Cell(1, 1).Range.Text = '항목'
$table.Cell(1, 2).Range.Text = '값'
$table.Cell(2, 1).Range.Text = '최소 메모리'
$table.Cell(2, 2).Range.Text = '8GB'
$table.Cell(3, 1).Range.Text = '디스크'
$table.Cell(3, 2).Range.Text = '2GB'
$table.Rows.Item(1).Range.Font.Bold = $true
$table.Rows.Item(1).HeadingFormat = $true

$doc.BuiltInDocumentProperties.Item('Title').Value = '설치 가이드'
$doc.BuiltInDocumentProperties.Item('Author').Value = '홍길동'
$doc.SaveAs2($out, 16)   # wdFormatDocumentDefault
$doc.Close($false)
$word.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
Write-Host "생성 완료: $out"
```

Run: `pwsh -File packages/adapter-office/test/fixtures/make/docx.ps1`

- [ ] **Step 6: DOCX 실패 테스트 작성**

`packages/adapter-office/test/docx.test.ts`:

```typescript
// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BlockOfKind, Document } from '@ai-lint/ir'
import { beforeAll, describe, expect, it } from 'vitest'
import { docxToDocument } from '../src/docx.js'

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))))

describe('docxToDocument', () => {
  let doc: Document

  beforeAll(() => {
    doc = docxToDocument(fixture('guide.docx'), { uri: 'C:\\docs\\guide.docx' })
  })

  it('제목 스타일을 heading 블록으로 만든다', () => {
    const heading = doc.blocks.find((b): b is BlockOfKind<'heading'> => b.kind === 'heading')
    expect(heading?.level).toBe(1)
    expect(heading?.text).toBe('설치 가이드')
  })

  it('굵고 큰 가짜 제목은 문단으로 두되 표시를 남긴다', () => {
    const fake = doc.blocks.find(
      (b): b is BlockOfKind<'paragraph'> => b.kind === 'paragraph' && b.text === '사전 준비물',
    )
    expect(fake?.emphasizedAsHeading).toBe(true)
  })

  it('평범한 문단에는 표시를 남기지 않는다', () => {
    const normal = doc.blocks.find(
      (b): b is BlockOfKind<'paragraph'> => b.kind === 'paragraph' && b.text.startsWith('이 문서는'),
    )
    expect(normal?.emphasizedAsHeading).toBeUndefined()
  })

  it('연속된 글머리 기호 문단을 한 목록으로 묶는다', () => {
    const list = doc.blocks.find((b): b is BlockOfKind<'list'> => b.kind === 'list')
    expect(list?.ordered).toBe(false)
    expect(list?.items).toEqual(['관리자 권한 계정', '사내 네트워크 접속'])
    expect(list?.depth).toBe(0)
  })

  it('머리글 행이 지정된 표는 헤더를 가진다', () => {
    const table = doc.blocks.find((b): b is BlockOfKind<'table'> => b.kind === 'table')
    expect(table?.headers).toEqual(['항목', '값'])
    expect(table?.rows).toEqual([['최소 메모리', '8GB'], ['디스크', '2GB']])
  })

  it('앵커에 본문 문단 번호를 담는다', () => {
    const anchors = doc.blocks.map((b) => b.anchor)
    expect(anchors[0]).toEqual({ kind: 'docx', paragraphIndex: 0 })
    expect(anchors.every((a) => a.kind === 'docx')).toBe(true)
  })

  it('문서 속성에서 제목과 작성자를 읽는다', () => {
    expect(doc.title).toBe('설치 가이드')
    expect(doc.source.author).toBe('홍길동')
    expect(doc.source.kind).toBe('docx')
  })
})
```

- [ ] **Step 7: 테스트 실패 확인**

Run: `pnpm vitest run packages/adapter-office/test/docx.test.ts`
Expected: FAIL — `Failed to resolve import "../src/docx.js"`

- [ ] **Step 8: `docx.ts` 구현**

`packages/adapter-office/src/docx.ts`:

```typescript
import {
  BlockList, makeDocument, titleFrom, type BlockBody, type Document, type FileContext, type SourceAnchor,
} from '@ai-lint/ir'
import { attr, childOf, childrenOf, findDescendant, findDescendants, localOf, textOf } from '@ai-lint/xml'
import { coreProperties, openPackage, parsePart, relationships, type Package } from './ooxml.js'

const DEFAULT_SIZE = 22

const numberOf = (el: Element | null, name: string): number | null => {
  const raw = el === null ? null : attr(el, name)
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

const isOn = (el: Element | null): boolean => {
  if (el === null) return false
  const val = attr(el, 'w:val')
  return val === null || !['0', 'false', 'off'].includes(val)
}

function median(values: number[]): number {
  if (values.length === 0) return DEFAULT_SIZE
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

/** styleId → 제목 단계. Word가 스타일 ID를 지역화해도 w:name이나 outlineLvl로 잡는다. */
function headingLevels(pkg: Package): Map<string, number> {
  const levels = new Map<string, number>()
  const styles = parsePart(pkg, 'word/styles.xml')
  if (styles === null) return levels
  for (const style of findDescendants(styles, 'style')) {
    const id = attr(style, 'w:styleId')
    if (id === null) continue
    const name = attr(childOf(style, 'name'), 'w:val') ?? ''
    const byName = /^heading\s*([1-6])$/i.exec(name)
    if (byName) {
      levels.set(id, Number(byName[1]))
      continue
    }
    const outline = numberOf(findDescendant(style, 'outlineLvl'), 'w:val')
    if (outline !== null && outline >= 0 && outline <= 5) levels.set(id, outline + 1)
  }
  return levels
}

function defaultSizeOf(pkg: Package): number {
  const styles = parsePart(pkg, 'word/styles.xml')
  const defaults = styles === null ? null : findDescendant(styles, 'docDefaults')
  const rPr = defaults === null ? null : findDescendant(defaults, 'rPrDefault')
  return numberOf(rPr === null ? null : findDescendant(rPr, 'sz'), 'w:val') ?? DEFAULT_SIZE
}

/** numId → 번호 목록 여부. 없으면 글머리 기호로 본다. */
function orderedByNumId(pkg: Package): Map<string, boolean> {
  const result = new Map<string, boolean>()
  const root = parsePart(pkg, 'word/numbering.xml')
  if (root === null) return result
  const formats = new Map<string, boolean>()
  for (const abstract of findDescendants(root, 'abstractNum')) {
    const id = attr(abstract, 'w:abstractNumId')
    if (id === null) continue
    const lvl = childOf(abstract, 'lvl')
    const fmt = attr(lvl === null ? null : childOf(lvl, 'numFmt'), 'w:val')
    formats.set(id, fmt !== 'bullet' && fmt !== 'none')
  }
  for (const num of findDescendants(root, 'num')) {
    const numId = attr(num, 'w:numId')
    const abstractId = attr(childOf(num, 'abstractNumId'), 'w:val')
    if (numId === null || abstractId === null) continue
    result.set(numId, formats.get(abstractId) ?? false)
  }
  return result
}

interface Para {
  index: number
  text: string
  styleId: string | null
  level: number | null
  numId: string | null
  ilvl: number
  allBold: boolean
  maxSize: number
  sizes: number[]
}

function readPara(el: Element, index: number, levels: Map<string, number>, fallbackSize: number): Para {
  const pPr = childOf(el, 'pPr')
  const styleId = attr(pPr === null ? null : childOf(pPr, 'pStyle'), 'w:val')
  const numPr = pPr === null ? null : childOf(pPr, 'numPr')
  const paraBold = pPr !== null && isOn(childOf(childOf(pPr, 'rPr'), 'b'))
  const paraSize = numberOf(childOf(childOf(pPr, 'rPr'), 'sz'), 'w:val')

  const runs = childrenOf(el, 'r')
  const sizes: number[] = []
  let allBold = runs.length > 0
  let maxSize = 0
  let text = ''
  for (const run of runs) {
    const rPr = childOf(run, 'rPr')
    const bold = isOn(rPr === null ? null : childOf(rPr, 'b')) || paraBold
    const size = numberOf(rPr === null ? null : childOf(rPr, 'sz'), 'w:val') ?? paraSize ?? fallbackSize
    const runText = childrenOf(run, 't').map((t) => t.textContent ?? '').join('')
    if (runText.length === 0) continue
    if (!bold) allBold = false
    sizes.push(size)
    maxSize = Math.max(maxSize, size)
    text += runText
  }
  if (text.length === 0) allBold = false

  return {
    index,
    text: text.replace(/\s+/g, ' ').trim(),
    styleId,
    level: styleId === null ? null : levels.get(styleId) ?? null,
    numId: attr(numPr === null ? null : childOf(numPr, 'numId'), 'w:val'),
    ilvl: numberOf(numPr === null ? null : childOf(numPr, 'ilvl'), 'w:val') ?? 0,
    allBold,
    maxSize: maxSize === 0 ? fallbackSize : maxSize,
    sizes,
  }
}

function tableBody(el: Element): BlockBody {
  const rows = childrenOf(el, 'tr').map((row) =>
    childrenOf(row, 'tc').map((cell) =>
      childrenOf(cell, 'p').map((p) => textOf(p)).join(' ').replace(/\s+/g, ' ').trim(),
    ),
  )
  const first = rows[0]
  const trPr = childrenOf(el, 'tr')[0]
  const marked = trPr !== undefined && isOn(childOf(childOf(trPr, 'trPr'), 'tblHeader'))
  const allBold =
    trPr !== undefined &&
    findDescendants(trPr, 'r').length > 0 &&
    findDescendants(trPr, 'r').every((run) => isOn(childOf(childOf(run, 'rPr'), 'b')))
  const hasHeader =
    first !== undefined && rows.length > 1 && first.every((c) => c.length > 0) && (marked || allBold)

  return hasHeader
    ? { kind: 'table', headers: first!, rows: rows.slice(1), isLayoutTable: false }
    : { kind: 'table', headers: [], rows, isLayoutTable: false }
}

export function docxToDocument(bytes: Uint8Array, ctx: FileContext): Document {
  const pkg = openPackage(bytes)
  const document = parsePart(pkg, 'word/document.xml')
  const body = document === null ? null : findDescendant(document, 'body')
  const list = new BlockList()

  if (body !== null) {
    const levels = headingLevels(pkg)
    const fallbackSize = defaultSizeOf(pkg)
    const ordered = orderedByNumId(pkg)
    const children = Array.from(body.children)

    const paras = children.map((el, index) =>
      localOf(el) === 'p' ? readPara(el, index, levels, fallbackSize) : null,
    )
    // 본문 글자 크기 중앙값. 제목 스타일 문단은 기준에서 뺀다.
    const bodySize = median(
      paras.flatMap((p) => (p !== null && p.level === null ? p.sizes : [])),
    )

    const rels = relationships(pkg, 'word/document.xml')
    let cursor = 0
    while (cursor < children.length) {
      const el = children[cursor]!
      const anchor: SourceAnchor = { kind: 'docx', paragraphIndex: cursor }

      if (localOf(el) === 'tbl') {
        list.add(tableBody(el), anchor)
        cursor += 1
        continue
      }

      const para = paras[cursor]
      if (para === null || para === undefined) {
        cursor += 1
        continue
      }

      const drawing = findDescendant(el, 'docPr')
      if (drawing !== null) {
        const alt = attr(drawing, 'descr') ?? ''
        const blip = findDescendant(el, 'blip')
        const embed = attr(blip, 'r:embed')
        list.add(
          {
            kind: 'image',
            assetRef: (embed === null ? null : rels.get(embed)) ?? attr(drawing, 'name') ?? 'image',
            ...(alt.trim().length > 0 ? { alt: alt.trim() } : {}),
          },
          anchor,
        )
        cursor += 1
        continue
      }

      if (para.text.length === 0) {
        cursor += 1
        continue
      }

      if (para.level !== null) {
        list.add({ kind: 'heading', level: para.level, text: para.text }, anchor)
        cursor += 1
        continue
      }

      if (para.numId !== null) {
        const items: string[] = []
        let end = cursor
        while (end < children.length) {
          const next = paras[end]
          if (!next || next.numId !== para.numId || next.ilvl !== para.ilvl || next.text.length === 0) break
          items.push(next.text)
          end += 1
        }
        list.add({ kind: 'list', ordered: ordered.get(para.numId) ?? false, items, depth: para.ilvl }, anchor)
        cursor = end
        continue
      }

      // 가짜 제목: 스타일 없음 + 모든 런이 굵게 + 본문보다 2pt(4 half-point) 이상 큼 + 짧음
      const fake = para.allBold && para.maxSize >= bodySize + 4 && para.text.length < 80
      list.add(
        { kind: 'paragraph', text: para.text, ...(fake ? { emphasizedAsHeading: true } : {}) },
        anchor,
      )
      cursor += 1
    }
  }

  const core = coreProperties(pkg)
  return makeDocument('docx', { ...ctx, ...(core.creator ? { author: core.creator } : {}) },
    titleFrom(core.title, ctx), list.all())
}
```

`packages/adapter-office/src/index.ts`에 `export * from './docx.js'`를 추가한다.

- [ ] **Step 9: 테스트 통과 확인**

Run: `pnpm vitest run packages/adapter-office/test/docx.test.ts`
Expected: PASS (7 tests)

픽스처의 실제 XML과 어긋나면 `console.log(pkg.entry('word/document.xml'))`로 확인해서 구현을 고친다. 기대값을 낮추는 방향으로 고치지 않는다.

- [ ] **Step 10: 전체 확인과 커밋**

Run: `pnpm test && pnpm typecheck`

```bash
git add packages/ir packages/rules packages/adapter-office
git commit -m "$(cat <<'EOF'
feat: add docx adapter and STR013 emphasis-as-heading rule

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: PPTX 어댑터

셋 중 가장 까다롭다. 도형이 그룹으로 중첩되고, 슬라이드 순서가 파일명이 아니라 `p:sldIdLst`에 있으며, 발표자 노트가 별도 파트에 있다.

슬라이드 제목은 `heading` 블록으로 내보내므로 `slide` 블록의 `title` 필드는 같은 글자를 두 번 저장하게 된다. 지운다.

**Files:**
- Modify: `packages/ir/src/schema.ts` (`slide` 블록에서 `title` 제거), `packages/ir/src/walk.ts:32-33`, `packages/ir/src/serialize.ts:45-48`
- Create: `packages/adapter-office/src/pptx.ts`, `packages/adapter-office/test/pptx.test.ts`
- Create: `packages/adapter-office/test/fixtures/make/pptx.ps1`, `packages/adapter-office/test/fixtures/deck.pptx` (스크립트로 생성)
- Modify: `packages/adapter-office/src/index.ts`

**Interfaces:**
- Consumes: Task 2의 `openPackage`, `parsePart`, `relationships`, `coreProperties`, `compareNatural`
- Produces (`@ai-lint/adapter-office`): `pptxToDocument(bytes: Uint8Array, ctx: FileContext): Document`

- [ ] **Step 1: `slide.title` 제거**

`packages/ir/src/schema.ts`의 `slide` 항목을 다음으로 바꾼다:

```typescript
  withBase({
    kind: z.literal('slide'),
    index: z.number().int().positive(),
    notes: z.string().optional(),
  }),
```

`packages/ir/src/walk.ts`:

```typescript
    case 'slide':
      return block.notes ?? ''
```

`packages/ir/src/serialize.ts`:

```typescript
    case 'slide':
      return block.notes
        ? `## 슬라이드 ${block.index}\n발표자 노트: ${block.notes}`
        : `## 슬라이드 ${block.index}`
```

Run: `pnpm test && pnpm typecheck`
Expected: 모두 통과

- [ ] **Step 2: 픽스처 생성 스크립트 작성**

`packages/adapter-office/test/fixtures/make/pptx.ps1`:

```powershell
# deck.pptx 생성. 실행: pwsh -File pptx.ps1
$ErrorActionPreference = 'Stop'
$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'deck.pptx'
if (Test-Path $out) { Remove-Item $out }

$ppt = New-Object -ComObject PowerPoint.Application
$pres = $ppt.Presentations.Add(1)

# 1번: 제목 + 글머리 기호 본문 + 발표자 노트
$s1 = $pres.Slides.Add(1, 2)   # ppLayoutText
$s1.Shapes.Item(1).TextFrame.TextRange.Text = '분기 리뷰'
$s1.Shapes.Item(2).TextFrame.TextRange.Text = "매출 12% 증가`r월간 활성 사용자 3만명`r이탈률 4%p 감소"
$s1.NotesPage.Shapes.Item(2).TextFrame.TextRange.Text = '수치는 8월 1일 기준입니다.'

# 2번: 제목 없음 + 그룹 도형 안에 텍스트 두 개
$s2 = $pres.Slides.Add(2, 12)  # ppLayoutBlank
$a = $s2.Shapes.AddTextbox(1, 60, 60, 300, 40)
$a.TextFrame.TextRange.Text = '왼쪽 상자 내용'
$b = $s2.Shapes.AddTextbox(1, 60, 140, 300, 40)
$b.TextFrame.TextRange.Text = '오른쪽 상자 내용'
$s2.Shapes.Range(@($a.Name, $b.Name)).Group() | Out-Null

# 3번: 제목 + 표
$s3 = $pres.Slides.Add(3, 11)  # ppLayoutTitleOnly
$s3.Shapes.Item(1).TextFrame.TextRange.Text = '지표 요약'
$table = $s3.Shapes.AddTable(3, 2).Table
$table.Cell(1, 1).Shape.TextFrame.TextRange.Text = '지표'
$table.Cell(1, 2).Shape.TextFrame.TextRange.Text = '값'
$table.Cell(2, 1).Shape.TextFrame.TextRange.Text = '매출'
$table.Cell(2, 2).Shape.TextFrame.TextRange.Text = '12억'
$table.Cell(3, 1).Shape.TextFrame.TextRange.Text = 'MAU'
$table.Cell(3, 2).Shape.TextFrame.TextRange.Text = '3만'

$pres.BuiltInDocumentProperties.Item('Title').Value = '분기 리뷰'
$pres.BuiltInDocumentProperties.Item('Author').Value = '홍길동'
$pres.SaveAs($out, 24)   # ppSaveAsOpenXMLPresentation
$pres.Close()
$ppt.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
Write-Host "생성 완료: $out"
```

Run: `pwsh -File packages/adapter-office/test/fixtures/make/pptx.ps1`

- [ ] **Step 3: 실패 테스트 작성**

`packages/adapter-office/test/pptx.test.ts`:

```typescript
// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BlockOfKind, Document } from '@ai-lint/ir'
import { beforeAll, describe, expect, it } from 'vitest'
import { pptxToDocument } from '../src/pptx.js'

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))))

describe('pptxToDocument', () => {
  let doc: Document

  beforeAll(() => {
    doc = pptxToDocument(fixture('deck.pptx'), { uri: 'C:\\docs\\deck.pptx' })
  })

  it('제목 자리표시자를 1단계 제목으로 만든다', () => {
    const headings = doc.blocks.filter((b): b is BlockOfKind<'heading'> => b.kind === 'heading')
    expect(headings.map((h) => h.text)).toEqual(['분기 리뷰', '지표 요약'])
    expect(headings.every((h) => h.level === 1)).toBe(true)
  })

  it('제목 없는 슬라이드에 제목을 지어내지 않는다', () => {
    const slides = doc.blocks.filter((b): b is BlockOfKind<'slide'> => b.kind === 'slide')
    expect(slides.map((s) => s.index)).toEqual([1, 2, 3])
  })

  it('발표자 노트를 슬라이드 블록에 담는다', () => {
    const first = doc.blocks.find((b): b is BlockOfKind<'slide'> => b.kind === 'slide')
    expect(first?.notes).toBe('수치는 8월 1일 기준입니다.')
  })

  it('본문 자리표시자의 여러 문단을 목록으로 묶는다', () => {
    const list = doc.blocks.find((b): b is BlockOfKind<'list'> => b.kind === 'list')
    expect(list?.items).toEqual(['매출 12% 증가', '월간 활성 사용자 3만명', '이탈률 4%p 감소'])
    expect(list?.depth).toBe(0)
  })

  it('그룹 도형 안의 텍스트도 꺼낸다', () => {
    const texts = doc.blocks
      .filter((b): b is BlockOfKind<'paragraph'> => b.kind === 'paragraph')
      .map((b) => b.text)
    expect(texts).toContain('왼쪽 상자 내용')
    expect(texts).toContain('오른쪽 상자 내용')
  })

  it('표를 표 블록으로 만든다', () => {
    const table = doc.blocks.find((b): b is BlockOfKind<'table'> => b.kind === 'table')
    expect(table?.headers).toEqual(['지표', '값'])
    expect(table?.rows).toEqual([['매출', '12억'], ['MAU', '3만']])
  })

  it('앵커에 슬라이드 번호와 도형 id를 담는다', () => {
    const heading = doc.blocks.find((b) => b.kind === 'heading')!
    expect(heading.anchor.kind).toBe('pptx')
    if (heading.anchor.kind !== 'pptx') throw new Error('앵커 종류가 다릅니다')
    expect(heading.anchor.slide).toBe(1)
    expect(heading.anchor.shapeId).toBeTypeOf('string')
  })

  it('문서 속성에서 제목과 작성자를 읽는다', () => {
    expect(doc.title).toBe('분기 리뷰')
    expect(doc.source.author).toBe('홍길동')
    expect(doc.source.kind).toBe('pptx')
  })
})
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `pnpm vitest run packages/adapter-office/test/pptx.test.ts`
Expected: FAIL — `Failed to resolve import "../src/pptx.js"`

- [ ] **Step 5: `pptx.ts` 구현**

`packages/adapter-office/src/pptx.ts`:

```typescript
import {
  BlockList, makeDocument, titleFrom, type BlockBody, type Document, type FileContext,
} from '@ai-lint/ir'
import { attr, childOf, childrenOf, findDescendant, findDescendants, localOf, textOf } from '@ai-lint/xml'
import { coreProperties, openPackage, parsePart, relationships, type Package } from './ooxml.js'

type Bullet = 'none' | 'char' | 'auto' | 'inherit'

interface ParaInfo {
  text: string
  level: number
  bullet: Bullet
}

function bulletOf(pPr: Element | null): Bullet {
  if (pPr === null) return 'inherit'
  if (childOf(pPr, 'buNone') !== null) return 'none'
  if (childOf(pPr, 'buAutoNum') !== null) return 'auto'
  if (childOf(pPr, 'buChar') !== null) return 'char'
  return 'inherit'
}

function parasOf(txBody: Element): ParaInfo[] {
  return childrenOf(txBody, 'p')
    .map((p) => {
      const pPr = childOf(p, 'pPr')
      const level = Number(attr(pPr, 'lvl') ?? '0')
      const text = findDescendants(p, 't')
        .map((t) => t.textContent ?? '')
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
      return { text, level: Number.isFinite(level) ? level : 0, bullet: bulletOf(pPr) }
    })
    .filter((para) => para.text.length > 0)
}

function textBlocks(paras: ParaInfo[], isBodyPlaceholder: boolean): BlockBody[] {
  const listed = (para: ParaInfo): false | { ordered: boolean } => {
    if (para.bullet === 'auto') return { ordered: true }
    if (para.bullet === 'char') return { ordered: false }
    // 자리표시자 본문은 마스터에서 글머리 기호를 물려받는다. 문단이 둘 이상이면 목록으로 본다.
    if (para.bullet === 'inherit' && isBodyPlaceholder && paras.length > 1) return { ordered: false }
    return false
  }

  const blocks: BlockBody[] = []
  let cursor = 0
  while (cursor < paras.length) {
    const para = paras[cursor]!
    const mark = listed(para)
    if (mark === false) {
      blocks.push({ kind: 'paragraph', text: para.text })
      cursor += 1
      continue
    }
    const items: string[] = []
    while (cursor < paras.length) {
      const next = paras[cursor]!
      const nextMark = listed(next)
      if (nextMark === false || nextMark.ordered !== mark.ordered || next.level !== para.level) break
      items.push(next.text)
      cursor += 1
    }
    blocks.push({ kind: 'list', ordered: mark.ordered, items, depth: para.level })
  }
  return blocks
}

interface Shape {
  id: string
  placeholder: string | null
  blocks: BlockBody[]
  titleText: string | null
}

function readShape(el: Element, rels: Map<string, string>): Shape | null {
  const name = localOf(el)

  if (name === 'sp') {
    const cNvPr = findDescendant(el, 'cNvPr')
    const id = attr(cNvPr, 'id') ?? ''
    const ph = findDescendant(el, 'ph')
    const type = ph === null ? null : attr(ph, 'type')
    const txBody = childOf(el, 'txBody')
    if (txBody === null) return null
    const paras = parasOf(txBody)
    if (paras.length === 0) return null

    if (type === 'title' || type === 'ctrTitle') {
      return { id, placeholder: type, blocks: [], titleText: paras.map((p) => p.text).join(' ') }
    }
    const isBody = type === 'body' || type === 'subTitle' || type === 'outline'
    return { id, placeholder: type, blocks: textBlocks(paras, isBody), titleText: null }
  }

  if (name === 'graphicframe') {
    const cNvPr = findDescendant(el, 'cNvPr')
    const id = attr(cNvPr, 'id') ?? ''
    const tbl = findDescendant(el, 'tbl')
    if (tbl === null) return null
    const rows = childrenOf(tbl, 'tr').map((row) =>
      childrenOf(row, 'tc').map((cell) => textOf(cell)),
    )
    const first = rows[0]
    const hasHeader = first !== undefined && rows.length > 1 && first.every((c) => c.length > 0)
    return {
      id,
      placeholder: null,
      titleText: null,
      blocks: [
        hasHeader
          ? { kind: 'table', headers: first!, rows: rows.slice(1), isLayoutTable: false }
          : { kind: 'table', headers: [], rows, isLayoutTable: false },
      ],
    }
  }

  if (name === 'pic') {
    const cNvPr = findDescendant(el, 'cNvPr')
    const id = attr(cNvPr, 'id') ?? ''
    const alt = (attr(cNvPr, 'descr') ?? '').trim()
    const embed = attr(findDescendant(el, 'blip'), 'r:embed')
    return {
      id,
      placeholder: null,
      titleText: null,
      blocks: [
        {
          kind: 'image',
          assetRef: (embed === null ? null : rels.get(embed)) ?? attr(cNvPr, 'name') ?? 'image',
          ...(alt.length > 0 ? { alt } : {}),
        },
      ],
    }
  }

  return null
}

function collectShapes(tree: Element, rels: Map<string, string>): Shape[] {
  const shapes: Shape[] = []
  for (const child of Array.from(tree.children)) {
    if (localOf(child) === 'grpsp') {
      shapes.push(...collectShapes(child, rels))
      continue
    }
    const shape = readShape(child, rels)
    if (shape !== null) shapes.push(shape)
  }
  return shapes
}

function notesOf(pkg: Package, slidePath: string): string {
  const rels = relationships(pkg, slidePath)
  const notesPath = [...rels.values()].find((path) => path.startsWith('ppt/notesSlides/'))
  if (notesPath === undefined) return ''
  const notes = parsePart(pkg, notesPath)
  if (notes === null) return ''
  const tree = findDescendant(notes, 'spTree')
  if (tree === null) return ''
  for (const sp of findDescendants(tree, 'sp')) {
    const ph = findDescendant(sp, 'ph')
    if (ph === null || attr(ph, 'type') !== 'body') continue
    const txBody = childOf(sp, 'txBody')
    if (txBody === null) continue
    return parasOf(txBody)
      .map((p) => p.text)
      .join('\n')
  }
  return ''
}

function slidePathsOf(pkg: Package): string[] {
  const presentation = parsePart(pkg, 'ppt/presentation.xml')
  const rels = relationships(pkg, 'ppt/presentation.xml')
  if (presentation === null) return pkg.paths('ppt/slides/slide')
  const paths: string[] = []
  for (const sldId of findDescendants(presentation, 'sldId')) {
    const relId = attr(sldId, 'r:id')
    const path = relId === null ? undefined : rels.get(relId)
    if (path !== undefined) paths.push(path)
  }
  return paths
}

export function pptxToDocument(bytes: Uint8Array, ctx: FileContext): Document {
  const pkg = openPackage(bytes)
  const list = new BlockList()

  slidePathsOf(pkg).forEach((slidePath, offset) => {
    const index = offset + 1
    const slide = parsePart(pkg, slidePath)
    if (slide === null) return
    const tree = findDescendant(slide, 'spTree')
    const shapes = tree === null ? [] : collectShapes(tree, relationships(pkg, slidePath))

    const title = shapes.find((shape) => shape.titleText !== null)
    if (title !== undefined) {
      list.add(
        { kind: 'heading', level: 1, text: title.titleText! },
        { kind: 'pptx', slide: index, shapeId: title.id },
      )
    }

    const notes = notesOf(pkg, slidePath)
    list.add(
      { kind: 'slide', index, ...(notes.length > 0 ? { notes } : {}) },
      { kind: 'pptx', slide: index },
    )

    for (const shape of shapes) {
      for (const body of shape.blocks) {
        list.add(body, { kind: 'pptx', slide: index, shapeId: shape.id })
      }
    }
  })

  const core = coreProperties(pkg)
  return makeDocument('pptx', { ...ctx, ...(core.creator ? { author: core.creator } : {}) },
    titleFrom(core.title, ctx), list.all())
}
```

`packages/adapter-office/src/index.ts`에 `export * from './pptx.js'`를 추가한다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm vitest run packages/adapter-office/test/pptx.test.ts`
Expected: PASS (8 tests)

목록 항목이 하나씩 떨어져 나오면 픽스처의 `ppt/slides/slide1.xml`을 출력해 `a:pPr`가 실제로 어떻게 쓰였는지 확인하고 `textBlocks`의 판정을 고친다.

- [ ] **Step 7: 전체 확인과 커밋**

Run: `pnpm test && pnpm typecheck`

```bash
git add packages/ir packages/adapter-office
git commit -m "$(cat <<'EOF'
feat: add pptx adapter with group shape traversal

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: PDF 어댑터와 STR014

PDF에는 구조 정보가 없다. 글자 크기로 제목을 추정한다. 텍스트 레이어가 아예 없는 스캔 PDF는 파싱을 계속할 이유가 없으므로 블록 없이 끝내고 STR014가 잡는다.

스펙 §5.4은 굵은 글꼴을 제목 판정에 가산하라고 했지만 pdf.js의 `textContent.styles`는 PostScript 이름이 아니라 `sans-serif` 같은 일반 계열만 준다. 굵기를 구분할 수 없으므로 크기만으로 판정한다.

**Files:**
- Create: `packages/adapter-pdf/package.json`, `packages/adapter-pdf/tsconfig.json`, `packages/adapter-pdf/src/index.ts`, `packages/adapter-pdf/src/pdf.ts`, `packages/adapter-pdf/test/pdf.test.ts`
- Create: `packages/adapter-pdf/test/fixtures/make/pdf.ps1`, `packages/adapter-pdf/test/fixtures/guide.pdf`, `packages/adapter-pdf/test/fixtures/scanned.pdf` (스크립트로 생성)
- Create: `packages/rules/src/catalog/structure/str014-scanned-pdf.ts`
- Modify: `packages/rules/src/catalog/meta.ts` (STR013 뒤), `packages/rules/src/catalog/structure/index.ts`
- Modify: `packages/rules/test/helpers.ts` (`makeDoc`에 `sourceKind` 옵션), `packages/rules/test/catalog/structure.test.ts`

**Interfaces:**
- Produces (`@ai-lint/adapter-pdf`):
  - `pdfToDocument(bytes: Uint8Array, ctx: FileContext): Promise<Document>` — 비동기다. 다른 어댑터와 다르다.
  - `setPdfWorkerSrc(src: string): void` — 브라우저에서만 필요하다. Node에서는 부르지 않는다.
- Produces (`@ai-lint/rules`): `str014`

- [ ] **Step 1: STR014 실패 테스트 작성**

`packages/rules/test/helpers.ts`의 `MakeDocOptions`와 `makeDoc`을 고친다:

```typescript
export interface MakeDocOptions {
  docType?: DocType
  links?: Link[]
  title?: string
  modifiedAt?: string
  labels?: string[]
  owner?: string
  sourceKind?: SourceKind
}

export function makeDoc(blocks: Block[], opts: MakeDocOptions = {}): Document {
  return {
    schemaVersion: 1,
    source: {
      kind: opts.sourceKind ?? 'confluence',
      uri: 'https://wiki.example.com/pages/1',
      ...(opts.modifiedAt !== undefined ? { modifiedAt: opts.modifiedAt } : {}),
    },
    ...
  }
}
```

맨 위 import에 `SourceKind`를 더한다: `import type { Block, DocType, Document, Link, SourceAnchor, SourceKind } from '@ai-lint/ir'`

`packages/rules/test/catalog/structure.test.ts` 끝에 붙인다:

```typescript
describe('STR014 scanned-pdf', () => {
  it('블록이 하나도 없는 PDF면 위반', () => {
    expect(fire(makeDoc([], { sourceKind: 'pdf' }))).toContain('STR014')
  })

  it('텍스트가 있는 PDF는 정상', () => {
    expect(fire(makeDoc([para('a', '본문')], { sourceKind: 'pdf' }))).not.toContain('STR014')
  })

  it('PDF가 아닌 빈 문서는 대상이 아니다', () => {
    expect(fire(makeDoc([]))).not.toContain('STR014')
  })
})
```

Run: `pnpm vitest run packages/rules/test/catalog/structure.test.ts`
Expected: FAIL — STR014가 결과에 없다

- [ ] **Step 2: STR014 구현**

`packages/rules/src/catalog/meta.ts`의 STR013 항목 바로 뒤에:

```typescript
    meta({
      id: 'STR014',
      name: 'scanned-pdf',
      axis: 'structure',
      defaultSeverity: 'error',
      description: 'PDF에 텍스트 레이어가 없어 내용을 추출할 수 없습니다.',
    }),
```

`packages/rules/src/catalog/structure/str014-scanned-pdf.ts`:

```typescript
import { defineRule } from '../define.js'

export const str014 = defineRule('STR014', (ctx) => {
  if (ctx.doc.source.kind !== 'pdf' || ctx.doc.blocks.length > 0) return []

  return [
    {
      blockId: null,
      message: '텍스트 레이어가 없는 스캔 PDF입니다',
      why: '그림만 있는 PDF는 검색도 인용도 되지 않습니다. AI는 이 문서의 내용을 한 글자도 읽지 못합니다.',
      suggestion: {
        before: ctx.doc.title,
        after: 'OCR로 텍스트 레이어를 넣거나, 원본 문서를 PDF로 다시 내보내세요.',
      },
    },
  ]
})
```

`packages/rules/src/catalog/structure/index.ts`에 import와 배열 항목을 추가한다.

Run: `pnpm vitest run packages/rules/test/catalog/structure.test.ts`
Expected: PASS

- [ ] **Step 3: 픽스처 생성 스크립트 작성**

`packages/adapter-pdf/test/fixtures/make/pdf.ps1`:

```powershell
# guide.pdf, scanned.pdf 생성. 실행: pwsh -File pdf.ps1
$ErrorActionPreference = 'Stop'
$dir = Split-Path $PSScriptRoot -Parent
$word = New-Object -ComObject Word.Application
$word.Visible = $false

# 1) 텍스트 PDF
$doc = $word.Documents.Add()
$sel = $word.Selection
$sel.Style = $doc.Styles.Item(-1)
$sel.Font.Size = 24
$sel.TypeText('배포 절차')
$sel.TypeParagraph()
$sel.Font.Size = 11
$sel.TypeText('이 문서는 사내 배포 도구의 실행 절차를 설명합니다. 각 단계는 순서대로 수행합니다.')
$sel.TypeParagraph()
$sel.Font.Size = 24
$sel.TypeText('사전 확인')
$sel.TypeParagraph()
$sel.Font.Size = 11
$sel.TypeText('배포 대상 서버 목록과 접근 권한을 먼저 확인합니다.')
$sel.TypeParagraph()
$doc.ExportAsFixedFormat((Join-Path $dir 'guide.pdf'), 17)   # wdExportFormatPDF
$doc.Close($false)

# 2) 이미지만 있는 스캔 PDF
Add-Type -AssemblyName System.Drawing
$png = Join-Path $env:TEMP 'ai-lint-scan.png'
$bmp = New-Object System.Drawing.Bitmap 800, 300
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font 'Malgun Gothic', 28
$g.DrawString('스캔된 문서입니다', $font, [System.Drawing.Brushes]::Black, 40, 100)
$g.Dispose()
$bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$doc2 = $word.Documents.Add()
$word.Selection.InlineShapes.AddPicture($png) | Out-Null
$doc2.ExportAsFixedFormat((Join-Path $dir 'scanned.pdf'), 17)
$doc2.Close($false)
Remove-Item $png

$word.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
Write-Host "생성 완료: $dir"
```

Run: `pwsh -File packages/adapter-pdf/test/fixtures/make/pdf.ps1`

`scanned.pdf`를 만든 뒤 텍스트가 정말 없는지 확인한다. Word가 빈 문단을 함께 내보내면 공백만 남으므로 어댑터의 "텍스트 항목 0개" 판정이 공백을 걸러야 한다 — 아래 구현이 그렇게 되어 있다.

- [ ] **Step 4: 패키지 뼈대 만들기**

`packages/adapter-pdf/package.json`:

```json
{
  "name": "@ai-lint/adapter-pdf",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ai-lint/ir": "workspace:*",
    "pdfjs-dist": "^4.10.38"
  }
}
```

`packages/adapter-pdf/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM"]
  },
  "include": ["src", "test"]
}
```

Run: `pnpm install`

- [ ] **Step 5: 실패 테스트 작성**

`packages/adapter-pdf/test/pdf.test.ts`:

```typescript
// @vitest-environment node
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BlockOfKind, Document } from '@ai-lint/ir'
import { beforeAll, describe, expect, it } from 'vitest'
import { pdfToDocument } from '../src/pdf.js'

const fixture = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))))

describe('pdfToDocument', () => {
  let doc: Document

  beforeAll(async () => {
    doc = await pdfToDocument(fixture('guide.pdf'), { uri: 'C:\\docs\\guide.pdf' })
  })

  it('본문보다 큰 짧은 줄을 제목으로 본다', () => {
    const headings = doc.blocks.filter((b): b is BlockOfKind<'heading'> => b.kind === 'heading')
    expect(headings.map((h) => h.text)).toEqual(['배포 절차', '사전 확인'])
  })

  it('본문은 문단으로 남긴다', () => {
    const paras = doc.blocks.filter((b): b is BlockOfKind<'paragraph'> => b.kind === 'paragraph')
    expect(paras[0]?.text).toContain('사내 배포 도구의 실행 절차')
  })

  it('앵커에 쪽 번호와 좌표를 담는다', () => {
    const anchor = doc.blocks[0]!.anchor
    expect(anchor.kind).toBe('pdf')
    if (anchor.kind !== 'pdf') throw new Error('앵커 종류가 다릅니다')
    expect(anchor.page).toBe(1)
    expect(anchor.bbox).toHaveLength(4)
  })

  it('출처를 pdf로 표시한다', () => {
    expect(doc.source.kind).toBe('pdf')
    expect(doc.source.uri).toBe('C:\\docs\\guide.pdf')
  })

  it('제목이 없으면 파일명에서 만든다', () => {
    expect(doc.title.length).toBeGreaterThan(0)
  })
})

describe('스캔 PDF', () => {
  it('텍스트가 없으면 블록 없이 끝낸다', async () => {
    const doc = await pdfToDocument(fixture('scanned.pdf'), { uri: 'C:\\docs\\scanned.pdf' })
    expect(doc.blocks).toEqual([])
    expect(doc.source.kind).toBe('pdf')
  })
})
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `pnpm vitest run packages/adapter-pdf/test/pdf.test.ts`
Expected: FAIL — `Failed to resolve import "../src/pdf.js"`

- [ ] **Step 7: `pdf.ts` 구현**

`packages/adapter-pdf/src/pdf.ts`:

```typescript
import {
  BlockList, makeDocument, titleFrom, type BlockBody, type Document, type FileContext, type SourceAnchor,
} from '@ai-lint/ir'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

/** 브라우저에서만 필요하다. Node는 pdf.js가 알아서 워커 없이 돈다. */
export function setPdfWorkerSrc(src: string): void {
  GlobalWorkerOptions.workerSrc = src
}

interface Line {
  text: string
  size: number
  x: number
  y: number
  width: number
}

function linesOf(items: Array<{ str: string; transform: number[]; width: number }>): Line[] {
  const lines: Line[] = []
  for (const item of items) {
    const text = item.str
    if (text.trim().length === 0) continue
    const size = Math.hypot(item.transform[1] ?? 0, item.transform[3] ?? 0) || 1
    const x = item.transform[4] ?? 0
    const y = item.transform[5] ?? 0
    const last = lines[lines.length - 1]
    // 같은 줄로 볼 기준: 기준선 차이가 글자 크기의 절반 이내
    if (last !== undefined && Math.abs(last.y - y) <= last.size * 0.5) {
      last.text += text
      last.width = Math.max(last.width, x + item.width - last.x)
      last.size = Math.max(last.size, size)
      continue
    }
    lines.push({ text, size, x, y, width: item.width })
  }
  return lines.map((line) => ({ ...line, text: line.text.replace(/\s+/g, ' ').trim() }))
    .filter((line) => line.text.length > 0)
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

function headingLevel(size: number, body: number): number | null {
  if (body === 0) return null
  const ratio = size / body
  if (ratio >= 1.6) return 1
  if (ratio >= 1.35) return 2
  if (ratio >= 1.2) return 3
  return null
}

export async function pdfToDocument(bytes: Uint8Array, ctx: FileContext): Promise<Document> {
  const pdf = await getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false }).promise

  const pages: Line[][] = []
  for (let page = 1; page <= pdf.numPages; page += 1) {
    const content = await (await pdf.getPage(page)).getTextContent()
    pages.push(linesOf(content.items as Array<{ str: string; transform: number[]; width: number }>))
  }

  const list = new BlockList()
  const bodySize = median(pages.flat().map((line) => line.size))

  pages.forEach((lines, offset) => {
    const page = offset + 1
    let buffer: Line[] = []

    const flush = (): void => {
      if (buffer.length === 0) return
      const first = buffer[0]!
      const body: BlockBody = { kind: 'paragraph', text: buffer.map((l) => l.text).join(' ') }
      list.add(body, anchorFor(page, first))
      buffer = []
    }

    for (const line of lines) {
      const level = line.text.length < 80 ? headingLevel(line.size, bodySize) : null
      if (level !== null) {
        flush()
        list.add({ kind: 'heading', level, text: line.text }, anchorFor(page, line))
        continue
      }
      buffer.push(line)
    }
    flush()
  })

  return makeDocument('pdf', ctx, titleFrom(null, ctx), list.all())
}

/** bbox는 PDF 사용자 좌표계의 [x, 기준선 y, 너비, 글자 높이]다. */
const anchorFor = (page: number, line: Line): SourceAnchor => ({
  kind: 'pdf',
  page,
  bbox: [line.x, line.y, line.width, line.size],
})
```

`packages/adapter-pdf/src/index.ts`:

```typescript
export * from './pdf.js'
```

타입 해석이 안 되면 `packages/adapter-pdf/src/pdfjs.d.ts`를 만든다:

```typescript
declare module 'pdfjs-dist/legacy/build/pdf.mjs' {
  export * from 'pdfjs-dist'
}
```

- [ ] **Step 8: 테스트 통과 확인**

Run: `pnpm vitest run packages/adapter-pdf/test/pdf.test.ts`
Expected: PASS (6 tests)

제목 판정 비율이 픽스처와 안 맞으면 `console.log`로 각 줄의 `size`를 찍어 실제 값을 보고 임계값을 고친다.

- [ ] **Step 9: 전체 확인과 커밋**

Run: `pnpm test && pnpm typecheck`

```bash
git add packages/adapter-pdf packages/rules pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat: add pdf adapter and STR014 scanned-pdf rule

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 라벨과 백엔드 클라이언트 공유

데스크톱 앱도 확장과 똑같이 `/v1/lint`를 부르고 똑같은 한국어 라벨을 쓴다. 복사하지 않고 패키지로 뺀다.

확장의 `Settings`에는 `autoRun`, `useLlm`처럼 확장에서만 쓰는 항목이 있으므로 공유 패키지는 호출에 실제로 필요한 네 개만 요구하는 `BackendSettings`를 정의한다. 확장의 `Settings`는 그 형태를 포함하므로 그대로 넘어간다.

**Files:**
- Create: `packages/labels/package.json`, `packages/labels/tsconfig.json`, `packages/labels/src/index.ts`
- Create: `packages/backend-client/package.json`, `packages/backend-client/tsconfig.json`, `packages/backend-client/src/index.ts`, `packages/backend-client/src/errors.ts`, `packages/backend-client/src/client.ts`
- Modify: `apps/extension/src/shared/labels.ts`, `apps/extension/src/shared/messages.ts`, `apps/extension/src/shared/settings.ts`, `apps/extension/src/background/backend-client.ts`, `apps/extension/package.json`
- Modify: `apps/extension/test/backend-client.test.ts` (import 경로만)

**Interfaces:**
- Produces (`@ai-lint/labels`): `DOC_TYPE_LABELS`, `DOC_TYPES`, `SEVERITY_LABELS`, `AXIS_LABELS`, `SEVERITY_ORDER: Severity[]`
- Produces (`@ai-lint/backend-client`):
  - `type BackendErrorKind = 'unconfigured' | 'unauthorized' | 'forbidden' | 'quota' | 'offline' | 'server'`
  - `class BackendError extends Error { readonly kind: BackendErrorKind }`
  - `kindOfStatus(status: number): BackendErrorKind`
  - `interface BackendSettings { backendUrl: string; serviceToken: string; userId: string; rulesetId: string }`
  - `isConfigured(settings: BackendSettings): boolean`
  - `requestLint(document: Document, options: Partial<LintOptions>, settings: BackendSettings, fetchImpl?: typeof fetch): Promise<LintReport>`
  - `saveDocTypeOverride(uri: string, docType: DocType, settings: BackendSettings, fetchImpl?: typeof fetch): Promise<void>`

- [ ] **Step 1: `packages/labels` 만들기**

`packages/labels/package.json`:

```json
{
  "name": "@ai-lint/labels",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": { "@ai-lint/ir": "workspace:*" }
}
```

`packages/labels/tsconfig.json`은 `packages/xml/tsconfig.json`과 같되 `lib`은 기본값을 쓴다:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

`packages/labels/src/index.ts` — 확장의 `apps/extension/src/shared/labels.ts` 내용을 그대로 옮기고 정렬 순서를 더한다:

```typescript
import type { Axis, DocType, Severity } from '@ai-lint/ir'

/** IR의 DocTypeSchema는 zod 값이라 UI에서 못 쓴다. 표시 이름과 함께 여기서 나열한다. */
export const DOC_TYPE_LABELS: Record<DocType, string> = {
  'meeting-notes': '회의록',
  requirement: '요구사항',
  design: '설계',
  guide: '가이드',
  'api-doc': 'API 문서',
  troubleshooting: '트러블슈팅',
  reference: '레퍼런스',
  unknown: '미분류',
}

export const DOC_TYPES = Object.keys(DOC_TYPE_LABELS) as DocType[]

export const SEVERITY_LABELS: Record<Severity, string> = {
  error: '오류',
  warning: '경고',
  info: '참고',
}

/** 지적 목록을 묶는 순서. 확장 패널과 데스크톱 결과 뷰가 같은 순서를 쓴다. */
export const SEVERITY_ORDER: Severity[] = ['error', 'warning', 'info']

export const AXIS_LABELS: Record<Axis, string> = {
  structure: '구조',
  context: '맥락',
  metadata: '메타데이터',
}
```

`apps/extension/src/shared/labels.ts` 전체를 다음으로 바꾼다:

```typescript
export { AXIS_LABELS, DOC_TYPES, DOC_TYPE_LABELS, SEVERITY_LABELS, SEVERITY_ORDER } from '@ai-lint/labels'
```

`apps/extension/src/content/panel/render.ts`의 `const ORDER: Severity[] = ['error', 'warning', 'info']`를 지우고 `SEVERITY_ORDER`를 쓰도록 고친다.

`apps/extension/package.json` 의존성에 `"@ai-lint/labels": "workspace:*"`를 더한다.

Run: `pnpm install && pnpm test`
Expected: 전부 통과

- [ ] **Step 2: `packages/backend-client` 만들기**

`packages/backend-client/package.json`:

```json
{
  "name": "@ai-lint/backend-client",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": {
    "@ai-lint/contract": "workspace:*",
    "@ai-lint/ir": "workspace:*"
  }
}
```

`packages/backend-client/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM"]
  },
  "include": ["src"]
}
```

`packages/backend-client/src/errors.ts`:

```typescript
export type BackendErrorKind =
  | 'unconfigured'
  | 'unauthorized'
  | 'forbidden'
  | 'quota'
  | 'offline'
  | 'server'

export const BACKEND_ERROR_MESSAGES: Record<BackendErrorKind, string> = {
  unconfigured: '옵션에서 백엔드 주소와 서비스 토큰을 먼저 설정하세요.',
  unauthorized: '서비스 토큰이 올바르지 않습니다. 옵션에서 다시 확인하세요.',
  forbidden: '이 문서를 검사할 권한이 없습니다.',
  quota: '오늘 AI 검사 한도를 다 썼습니다. 규칙 검사 결과만 표시합니다.',
  offline: '백엔드에 연결하지 못했습니다.',
  server: '백엔드에서 오류가 발생했습니다.',
}

export class BackendError extends Error {
  readonly kind: BackendErrorKind

  constructor(kind: BackendErrorKind, message: string = BACKEND_ERROR_MESSAGES[kind]) {
    super(message)
    this.name = 'BackendError'
    this.kind = kind
  }
}

export function kindOfStatus(status: number): BackendErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'quota'
  return 'server'
}
```

`packages/backend-client/src/client.ts` — 확장의 `backend-client.ts`에서 `Settings` 자리를 `BackendSettings`로 바꾼 것 외에는 같다:

```typescript
import type { LintOptions, LintReport } from '@ai-lint/contract'
import type { DocType, Document } from '@ai-lint/ir'
import { BACKEND_ERROR_MESSAGES, BackendError, kindOfStatus } from './errors.js'

export interface BackendSettings {
  backendUrl: string
  serviceToken: string
  /** 백엔드 쿼터 집계 단위. 비우면 anonymous로 집계된다. */
  userId: string
  rulesetId: string
}

export const isConfigured = (settings: BackendSettings): boolean =>
  settings.backendUrl.length > 0 && settings.serviceToken.length > 0

function headersFor(settings: BackendSettings): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-AI-Lint-Token': settings.serviceToken,
    ...(settings.userId ? { 'X-AI-Lint-User': settings.userId } : {}),
  }
}

/** 백엔드는 오류를 `{ error }`로 준다. 사용자에게는 그 문장이 기본 안내보다 훨씬 쓸모 있다. */
async function detailOf(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : null
  } catch {
    return null
  }
}

async function post(
  path: string,
  body: unknown,
  settings: BackendSettings,
  fetchImpl: typeof fetch,
): Promise<Response> {
  if (!isConfigured(settings)) throw new BackendError('unconfigured')

  let response: Response
  try {
    response = await fetchImpl(`${settings.backendUrl}${path}`, {
      method: 'POST',
      headers: headersFor(settings),
      body: JSON.stringify(body),
    })
  } catch {
    throw new BackendError('offline')
  }

  if (!response.ok) {
    const kind = kindOfStatus(response.status)
    throw new BackendError(kind, (await detailOf(response)) ?? BACKEND_ERROR_MESSAGES[kind])
  }
  return response
}

export async function requestLint(
  document: Document,
  options: Partial<LintOptions>,
  settings: BackendSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<LintReport> {
  const response = await post(
    '/v1/lint',
    { document, options: { rulesetId: settings.rulesetId, ...options } },
    settings,
    fetchImpl,
  )
  return (await response.json()) as LintReport
}

export async function saveDocTypeOverride(
  uri: string,
  docType: DocType,
  settings: BackendSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await post('/v1/doctype-overrides', { uri, docType }, settings, fetchImpl)
}
```

`packages/backend-client/src/index.ts`:

```typescript
export * from './client.js'
export * from './errors.js'
```

- [ ] **Step 3: 확장을 새 패키지로 돌리기**

`apps/extension/src/background/backend-client.ts` 전체를 다음으로 바꾼다:

```typescript
export { BackendError, kindOfStatus, requestLint, saveDocTypeOverride } from '@ai-lint/backend-client'
```

`apps/extension/src/shared/messages.ts`에서 `BackendErrorKind` 정의를 지우고 재export로 바꾼다:

```typescript
export type { BackendErrorKind } from '@ai-lint/backend-client'
```

`apps/extension/src/shared/settings.ts`의 `isConfigured` 정의를 지우고 재export한다. `Settings` 인터페이스는 그대로 둔다 — `BackendSettings`의 네 필드를 모두 갖고 있어 그대로 넘길 수 있다:

```typescript
export { isConfigured } from '@ai-lint/backend-client'
```

`apps/extension/package.json` 의존성에 `"@ai-lint/backend-client": "workspace:*"`를 더한다.

- [ ] **Step 4: 전체 확인**

Run: `pnpm install && pnpm test && pnpm typecheck`
Expected: 전부 통과. `apps/extension/test/backend-client.test.ts`가 확장 경로로 import하고 있으면 그대로 둔다 — 재export라 동작한다.

- [ ] **Step 5: 커밋**

```bash
git add packages/labels packages/backend-client apps/extension pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
refactor: share labels and backend client across apps

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Tauri 셸, 설정, 파일·폴더 선택

`tauri-plugin-fs` 대신 직접 만든 Rust 커맨드를 쓴다. 플러그인은 접근 가능한 경로를 설정 파일에 미리 적어야 하는데, 사용자가 아무 폴더나 고르는 앱에서는 그 스코프를 미리 못 적는다.

TypeScript 쪽은 포트 인터페이스만 알고 Tauri를 모른다. 그래야 순수 로직을 vitest로 덮을 수 있다.

**Files:**
- Create: `apps/desktop/package.json`, `apps/desktop/tsconfig.json`, `apps/desktop/vite.config.ts`, `apps/desktop/index.html`, `apps/desktop/src/main.tsx`, `apps/desktop/src/App.tsx`, `apps/desktop/src/styles.css`
- Create: `apps/desktop/src/core/settings.ts`, `apps/desktop/src/core/collect.ts`
- Create: `apps/desktop/src/platform/tauri.ts`
- Create: `apps/desktop/test/settings.test.ts`, `apps/desktop/test/collect.test.ts`
- Create: `apps/desktop/src-tauri/Cargo.toml`, `apps/desktop/src-tauri/build.rs`, `apps/desktop/src-tauri/tauri.conf.json`, `apps/desktop/src-tauri/src/main.rs`, `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src-tauri/capabilities/default.json`, `apps/desktop/src-tauri/.gitignore`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `@ai-lint/backend-client`의 `BackendSettings`
- Produces (`apps/desktop/src/core/settings.ts`):
  - `interface DesktopSettings { backendUrl: string; userId: string; rulesetId: string; concurrency: number }`
  - `DEFAULT_DESKTOP_SETTINGS: DesktopSettings`
  - `interface JsonStore { read(): Promise<string | null>; write(json: string): Promise<void> }`
  - `interface TokenStore { read(): Promise<string | null>; write(token: string): Promise<void> }`
  - `loadSettings(store: JsonStore): Promise<DesktopSettings>`
  - `saveSettings(store: JsonStore, patch: Partial<DesktopSettings>): Promise<DesktopSettings>`
  - `toBackendSettings(settings: DesktopSettings, token: string): BackendSettings`
- Produces (`apps/desktop/src/core/collect.ts`):
  - `type DocExt = 'pptx' | 'docx' | 'xlsx' | 'pdf'`
  - `interface RawEntry { name: string; path: string; isDir: boolean; modifiedMs: number | null }`
  - `interface FileSystem { listDir(path: string): Promise<RawEntry[]> }`
  - `interface DocumentFile { path: string; name: string; ext: DocExt; modifiedAt?: string }`
  - `extOf(name: string): DocExt | null`
  - `isCollectible(name: string): boolean`
  - `collectDocuments(fs: FileSystem, root: string, maxDepth?: number): Promise<DocumentFile[]>`
- Produces (`apps/desktop/src/platform/tauri.ts`): `fileSystem: FileSystem`, `settingsStore: JsonStore`, `tokenStore: TokenStore`, `readDocument(path: string): Promise<Uint8Array>`, `pickFiles(): Promise<string[]>`, `pickFolder(): Promise<string | null>`, `saveFile(path: string, bytes: Uint8Array): Promise<void>`, `pickSavePath(defaultName: string): Promise<string | null>`

- [ ] **Step 1: 앱 뼈대와 vitest 설정**

`apps/desktop/package.json`:

```json
{
  "name": "@ai-lint/desktop",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "tauri dev",
    "dev:vite": "vite",
    "build:vite": "vite build",
    "build": "tauri build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ai-lint/adapter-office": "workspace:*",
    "@ai-lint/adapter-pdf": "workspace:*",
    "@ai-lint/backend-client": "workspace:*",
    "@ai-lint/contract": "workspace:*",
    "@ai-lint/ir": "workspace:*",
    "@ai-lint/labels": "workspace:*",
    "@tauri-apps/api": "^2.1.1",
    "@tauri-apps/plugin-dialog": "^2.2.0",
    "@tauri-apps/plugin-http": "^2.2.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.1.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "vite": "^7.0.0"
  }
}
```

`apps/desktop/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["node"]
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

`apps/desktop/vite.config.ts`:

```typescript
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5174, strictPort: true },
  build: { target: 'chrome110', emptyOutDir: true },
})
```

`apps/desktop/index.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>AI Lint</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

루트 `vitest.config.ts`의 `include`를 고친다:

```typescript
include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.{ts,tsx}'],
```

- [ ] **Step 2: 설정 실패 테스트 작성**

`apps/desktop/test/settings.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESKTOP_SETTINGS, loadSettings, saveSettings, toBackendSettings, type JsonStore,
} from '../src/core/settings.js'

const store = (initial: string | null = null): JsonStore & { value: string | null } => ({
  value: initial,
  async read() {
    return this.value
  },
  async write(json: string) {
    this.value = json
  },
})

describe('loadSettings', () => {
  it('파일이 없으면 기본값을 준다', async () => {
    expect(await loadSettings(store())).toEqual(DEFAULT_DESKTOP_SETTINGS)
  })

  it('망가진 JSON이면 기본값으로 돌아간다', async () => {
    expect(await loadSettings(store('{ 이건 JSON이 아님'))).toEqual(DEFAULT_DESKTOP_SETTINGS)
  })

  it('알 수 없는 타입의 값은 기본값으로 채운다', async () => {
    const loaded = await loadSettings(store('{"backendUrl": 3, "concurrency": "많이"}'))
    expect(loaded.backendUrl).toBe(DEFAULT_DESKTOP_SETTINGS.backendUrl)
    expect(loaded.concurrency).toBe(DEFAULT_DESKTOP_SETTINGS.concurrency)
  })

  it('주소 끝의 슬래시를 떼어낸다', async () => {
    const loaded = await loadSettings(store('{"backendUrl": "http://localhost:3000///"}'))
    expect(loaded.backendUrl).toBe('http://localhost:3000')
  })
})

describe('saveSettings', () => {
  it('일부만 바꿔도 나머지를 유지한다', async () => {
    const s = store('{"userId": "hong"}')
    const saved = await saveSettings(s, { rulesetId: 'team-a' })
    expect(saved.userId).toBe('hong')
    expect(saved.rulesetId).toBe('team-a')
    expect(JSON.parse(s.value!).userId).toBe('hong')
  })
})

describe('toBackendSettings', () => {
  it('토큰을 합쳐 호출용 설정을 만든다', () => {
    const backend = toBackendSettings(
      { ...DEFAULT_DESKTOP_SETTINGS, backendUrl: 'http://localhost:3000', userId: 'hong' },
      'tok',
    )
    expect(backend).toEqual({
      backendUrl: 'http://localhost:3000',
      serviceToken: 'tok',
      userId: 'hong',
      rulesetId: 'default',
    })
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run apps/desktop/test/settings.test.ts`
Expected: FAIL — `Failed to resolve import "../src/core/settings.js"`

- [ ] **Step 4: `settings.ts` 구현**

`apps/desktop/src/core/settings.ts`:

```typescript
import type { BackendSettings } from '@ai-lint/backend-client'

export interface DesktopSettings {
  backendUrl: string
  /** 백엔드 쿼터 집계 단위. 비우면 anonymous로 집계된다. */
  userId: string
  rulesetId: string
  /** 동시에 검사할 파일 수 */
  concurrency: number
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  backendUrl: '',
  userId: '',
  rulesetId: 'default',
  concurrency: 3,
}

export interface JsonStore {
  read(): Promise<string | null>
  write(json: string): Promise<void>
}

export interface TokenStore {
  read(): Promise<string | null>
  write(token: string): Promise<void>
}

const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)
const int = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback
const trimUrl = (url: string): string => url.trim().replace(/\/+$/, '')

function parse(raw: string | null): DesktopSettings {
  let stored: Record<string, unknown> = {}
  if (raw !== null) {
    try {
      const value: unknown = JSON.parse(raw)
      if (typeof value === 'object' && value !== null) stored = value as Record<string, unknown>
    } catch {
      stored = {}
    }
  }
  return {
    backendUrl: trimUrl(str(stored['backendUrl'], DEFAULT_DESKTOP_SETTINGS.backendUrl)),
    userId: str(stored['userId'], DEFAULT_DESKTOP_SETTINGS.userId),
    rulesetId: str(stored['rulesetId'], DEFAULT_DESKTOP_SETTINGS.rulesetId),
    concurrency: int(stored['concurrency'], DEFAULT_DESKTOP_SETTINGS.concurrency),
  }
}

export async function loadSettings(store: JsonStore): Promise<DesktopSettings> {
  return parse(await store.read())
}

export async function saveSettings(
  store: JsonStore,
  patch: Partial<DesktopSettings>,
): Promise<DesktopSettings> {
  const next = parse(JSON.stringify({ ...(await loadSettings(store)), ...patch }))
  await store.write(JSON.stringify(next, null, 2))
  return next
}

export const toBackendSettings = (settings: DesktopSettings, token: string): BackendSettings => ({
  backendUrl: settings.backendUrl,
  serviceToken: token,
  userId: settings.userId,
  rulesetId: settings.rulesetId,
})
```

Run: `pnpm vitest run apps/desktop/test/settings.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 파일 수집 실패 테스트 작성**

`apps/desktop/test/collect.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { collectDocuments, extOf, isCollectible, type FileSystem, type RawEntry } from '../src/core/collect.js'

const dir = (name: string, path: string): RawEntry => ({ name, path, isDir: true, modifiedMs: null })
const file = (name: string, path: string, modifiedMs: number | null = 0): RawEntry => ({
  name, path, isDir: false, modifiedMs,
})

const fsOf = (tree: Record<string, RawEntry[]>): FileSystem => ({
  async listDir(path) {
    return tree[path] ?? []
  },
})

describe('extOf / isCollectible', () => {
  it('지원 확장자만 인식한다', () => {
    expect(extOf('보고서.docx')).toBe('docx')
    expect(extOf('보고서.DOCX')).toBe('docx')
    expect(extOf('보고서.hwp')).toBeNull()
    expect(extOf('확장자없음')).toBeNull()
  })

  it('Office 임시 파일은 거른다', () => {
    expect(isCollectible('~$보고서.docx')).toBe(false)
    expect(isCollectible('보고서.docx')).toBe(true)
  })
})

describe('collectDocuments', () => {
  it('하위 폴더까지 재귀로 모은다', async () => {
    const fs = fsOf({
      'C:\\d': [file('a.docx', 'C:\\d\\a.docx'), dir('sub', 'C:\\d\\sub'), file('메모.txt', 'C:\\d\\메모.txt')],
      'C:\\d\\sub': [file('b.pdf', 'C:\\d\\sub\\b.pdf'), file('~$c.xlsx', 'C:\\d\\sub\\~$c.xlsx')],
    })
    const found = await collectDocuments(fs, 'C:\\d')
    expect(found.map((f) => f.path)).toEqual(['C:\\d\\a.docx', 'C:\\d\\sub\\b.pdf'])
    expect(found[0]?.ext).toBe('docx')
  })

  it('수정 시각을 ISO 문자열로 바꾼다', async () => {
    const fs = fsOf({ 'C:\\d': [file('a.docx', 'C:\\d\\a.docx', 1_700_000_000_000)] })
    const found = await collectDocuments(fs, 'C:\\d')
    expect(found[0]?.modifiedAt).toBe(new Date(1_700_000_000_000).toISOString())
  })

  it('수정 시각이 없으면 키를 넣지 않는다', async () => {
    const fs = fsOf({ 'C:\\d': [file('a.docx', 'C:\\d\\a.docx', null)] })
    expect('modifiedAt' in (await collectDocuments(fs, 'C:\\d'))[0]!).toBe(false)
  })

  it('깊이 제한을 넘으면 내려가지 않는다', async () => {
    const fs = fsOf({
      'C:\\d': [dir('1', 'C:\\d\\1')],
      'C:\\d\\1': [file('a.docx', 'C:\\d\\1\\a.docx')],
    })
    expect(await collectDocuments(fs, 'C:\\d', 0)).toEqual([])
  })

  it('읽을 수 없는 폴더는 건너뛰고 계속한다', async () => {
    const fs: FileSystem = {
      async listDir(path) {
        if (path === 'C:\\d\\deny') throw new Error('접근 거부')
        if (path === 'C:\\d') return [dir('deny', 'C:\\d\\deny'), file('a.pdf', 'C:\\d\\a.pdf')]
        return []
      },
    }
    expect((await collectDocuments(fs, 'C:\\d')).map((f) => f.name)).toEqual(['a.pdf'])
  })
})
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `pnpm vitest run apps/desktop/test/collect.test.ts`
Expected: FAIL — `Failed to resolve import "../src/core/collect.js"`

- [ ] **Step 7: `collect.ts` 구현**

`apps/desktop/src/core/collect.ts`:

```typescript
export type DocExt = 'pptx' | 'docx' | 'xlsx' | 'pdf'

const EXTS: DocExt[] = ['pptx', 'docx', 'xlsx', 'pdf']

export interface RawEntry {
  name: string
  path: string
  isDir: boolean
  modifiedMs: number | null
}

export interface FileSystem {
  listDir(path: string): Promise<RawEntry[]>
}

export interface DocumentFile {
  path: string
  name: string
  ext: DocExt
  modifiedAt?: string
}

export function extOf(name: string): DocExt | null {
  const dot = name.lastIndexOf('.')
  if (dot === -1) return null
  const ext = name.slice(dot + 1).toLowerCase()
  return EXTS.find((candidate) => candidate === ext) ?? null
}

/** `~$`로 시작하는 것은 Office가 문서를 열어둘 때 만드는 잠금 파일이다. */
export const isCollectible = (name: string): boolean => !name.startsWith('~$') && extOf(name) !== null

const fileOf = (entry: RawEntry, ext: DocExt): DocumentFile => ({
  path: entry.path,
  name: entry.name,
  ext,
  ...(entry.modifiedMs === null ? {} : { modifiedAt: new Date(entry.modifiedMs).toISOString() }),
})

export async function collectDocuments(
  fs: FileSystem,
  root: string,
  maxDepth = 8,
): Promise<DocumentFile[]> {
  if (maxDepth < 0) return []

  let entries: RawEntry[]
  try {
    entries = await fs.listDir(root)
  } catch {
    // 접근 권한이 없는 폴더 하나 때문에 수집 전체를 멈추지 않는다.
    return []
  }

  const found: DocumentFile[] = []
  for (const entry of entries) {
    if (entry.isDir) {
      found.push(...(await collectDocuments(fs, entry.path, maxDepth - 1)))
      continue
    }
    const ext = extOf(entry.name)
    if (ext === null || !isCollectible(entry.name)) continue
    found.push(fileOf(entry, ext))
  }
  return found
}
```

Run: `pnpm vitest run apps/desktop/test/collect.test.ts`
Expected: PASS (7 tests)

`maxDepth`가 0일 때 루트 파일은 모으고 하위 폴더로는 안 내려가야 한다. 테스트의 기대값(`[]`)은 루트에 파일이 없는 트리이므로 맞다.

- [ ] **Step 8: Rust 커맨드 작성**

`apps/desktop/src-tauri/Cargo.toml`:

```toml
[package]
name = "ai-lint-desktop"
version = "0.1.0"
edition = "2021"

[lib]
name = "ai_lint_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
tauri-plugin-http = "2"
serde = { version = "1", features = ["derive"] }
keyring = { version = "3", features = ["windows-native"] }
```

`apps/desktop/src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

`apps/desktop/src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ai_lint_desktop_lib::run()
}
```

`apps/desktop/src-tauri/src/lib.rs`:

```rust
use std::fs;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

use serde::Serialize;
use tauri::Manager;

const KEYRING_SERVICE: &str = "ai-lint";
const KEYRING_ACCOUNT: &str = "backend-token";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DirEntry {
    name: String,
    path: String,
    is_dir: bool,
    modified_ms: Option<u64>,
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let mut out = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: meta.is_dir(),
            modified_ms: meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64),
        });
    }
    Ok(out)
}

#[tauri::command]
fn read_document(path: String) -> Result<tauri::ipc::Response, String> {
    fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| e.to_string())
}

/// 설정은 %APPDATA%/ai-lint/settings.json에 둔다.
fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().data_dir().map_err(|e| e.to_string())?.join("ai-lint");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

#[tauri::command]
fn read_settings(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_settings(app: tauri::AppHandle, json: String) -> Result<(), String> {
    fs::write(settings_path(&app)?, json).map_err(|e| e.to_string())
}

/// 서비스 토큰은 평문 파일에 두지 않고 Windows 자격 증명 관리자에 넣는다.
#[tauri::command]
fn read_token() -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn write_token(token: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_ACCOUNT).map_err(|e| e.to_string())?;
    if token.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        };
    }
    entry.set_password(&token).map_err(|e| e.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            list_dir,
            read_document,
            save_file,
            read_settings,
            write_settings,
            read_token,
            write_token
        ])
        .run(tauri::generate_context!())
        .expect("Tauri 앱을 시작하지 못했습니다");
}
```

`apps/desktop/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "데스크톱 창의 기본 권한",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "dialog:allow-open",
    "dialog:allow-save",
    {
      "identifier": "http:default",
      "allow": [
        { "url": "http://localhost:*/*" },
        { "url": "http://127.0.0.1:*/*" },
        { "url": "https://*/v1/*" }
      ]
    }
  ]
}
```

`apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "AI Lint",
  "version": "0.1.0",
  "identifier": "com.geniuskey.ai-lint",
  "build": {
    "beforeDevCommand": "pnpm dev:vite",
    "devUrl": "http://localhost:5174",
    "beforeBuildCommand": "pnpm build:vite",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [{ "label": "main", "title": "AI Lint", "width": 1100, "height": 760 }],
    "security": { "csp": "default-src 'self'; style-src 'self' 'unsafe-inline'" }
  },
  "bundle": {
    "active": true,
    "targets": ["msi"],
    "icon": ["icons/icon.ico"]
  }
}
```

`apps/desktop/src-tauri/.gitignore`:

```
/target
/gen
```

아이콘을 만든다:

```powershell
Add-Type -AssemblyName System.Drawing
$bmp = New-Object System.Drawing.Bitmap 512, 512
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::FromArgb(255, 24, 61, 122))
$font = New-Object System.Drawing.Font 'Segoe UI', 180, ([System.Drawing.FontStyle]::Bold)
$g.DrawString('AL', $font, [System.Drawing.Brushes]::White, 60, 140)
$g.Dispose()
$bmp.Save('apps/desktop/src-tauri/app-icon.png', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
```

Run: `pnpm --filter @ai-lint/desktop exec tauri icon src-tauri/app-icon.png`
Expected: `apps/desktop/src-tauri/icons/`에 `icon.ico`를 포함한 아이콘 생성

- [ ] **Step 9: 플랫폼 어댑터 작성**

`apps/desktop/src/platform/tauri.ts`:

```typescript
import { invoke } from '@tauri-apps/api/core'
import { open, save } from '@tauri-apps/plugin-dialog'
import type { FileSystem, RawEntry } from '../core/collect.js'
import type { JsonStore, TokenStore } from '../core/settings.js'

export const fileSystem: FileSystem = {
  listDir: (path) => invoke<RawEntry[]>('list_dir', { path }),
}

export const settingsStore: JsonStore = {
  read: () => invoke<string | null>('read_settings'),
  write: (json) => invoke<void>('write_settings', { json }),
}

export const tokenStore: TokenStore = {
  read: () => invoke<string | null>('read_token'),
  write: (token) => invoke<void>('write_token', { token }),
}

export async function readDocument(path: string): Promise<Uint8Array> {
  return new Uint8Array(await invoke<ArrayBuffer>('read_document', { path }))
}

export const saveFile = (path: string, bytes: Uint8Array): Promise<void> =>
  invoke<void>('save_file', { path, contents: Array.from(bytes) })

export async function pickFiles(): Promise<string[]> {
  const picked = await open({
    multiple: true,
    filters: [{ name: '문서', extensions: ['pptx', 'docx', 'xlsx', 'pdf'] }],
  })
  if (picked === null) return []
  return Array.isArray(picked) ? picked : [picked]
}

export async function pickFolder(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false })
  return typeof picked === 'string' ? picked : null
}

export const pickSavePath = (defaultName: string): Promise<string | null> =>
  save({ defaultPath: defaultName })
```

- [ ] **Step 10: 최소 화면과 실행 확인**

`apps/desktop/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`apps/desktop/src/App.tsx` — 이 단계에서는 설정 화면과 파일 선택까지만 만든다. 검사 실행은 Task 9에서 붙인다:

```tsx
import { useEffect, useState } from 'react'
import { collectDocuments, type DocumentFile } from './core/collect.js'
import {
  DEFAULT_DESKTOP_SETTINGS, loadSettings, saveSettings, type DesktopSettings,
} from './core/settings.js'
import { fileSystem, pickFiles, pickFolder, settingsStore, tokenStore } from './platform/tauri.js'

export function App(): JSX.Element {
  const [settings, setSettings] = useState<DesktopSettings>(DEFAULT_DESKTOP_SETTINGS)
  const [token, setToken] = useState('')
  const [files, setFiles] = useState<DocumentFile[]>([])

  useEffect(() => {
    void (async () => {
      setSettings(await loadSettings(settingsStore))
      setToken((await tokenStore.read()) ?? '')
    })()
  }, [])

  const onPickFolder = async (): Promise<void> => {
    const folder = await pickFolder()
    if (folder === null) return
    setFiles(await collectDocuments(fileSystem, folder))
  }

  const onPickFiles = async (): Promise<void> => {
    const paths = await pickFiles()
    setFiles(
      paths.map((path) => {
        const name = path.split(/[\\/]/).pop() ?? path
        return { path, name, ext: name.slice(name.lastIndexOf('.') + 1).toLowerCase() as DocumentFile['ext'] }
      }),
    )
  }

  return (
    <main className="app">
      <h1>AI Lint</h1>

      <section className="settings">
        <label>
          백엔드 주소
          <input
            value={settings.backendUrl}
            onChange={(e) => setSettings({ ...settings, backendUrl: e.target.value })}
            onBlur={() => void saveSettings(settingsStore, { backendUrl: settings.backendUrl }).then(setSettings)}
            placeholder="http://localhost:3000"
          />
        </label>
        <label>
          서비스 토큰
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onBlur={() => void tokenStore.write(token)}
          />
        </label>
      </section>

      <section className="actions">
        <button type="button" onClick={() => void onPickFiles()}>파일 선택</button>
        <button type="button" onClick={() => void onPickFolder()}>폴더 선택</button>
      </section>

      <p>{files.length}개 파일</p>
      <ul>
        {files.map((file) => (
          <li key={file.path}>{file.name}</li>
        ))}
      </ul>
    </main>
  )
}
```

`apps/desktop/src/styles.css`:

```css
:root { font-family: 'Malgun Gothic', system-ui, sans-serif; font-size: 14px; color: #1a1a1a; }
body { margin: 0; background: #f6f7f9; }
.app { max-width: 1000px; margin: 0 auto; padding: 24px; }
.settings { display: grid; gap: 12px; grid-template-columns: 1fr 1fr; margin-bottom: 16px; }
.settings label { display: grid; gap: 4px; }
input, select { padding: 6px 8px; border: 1px solid #c7cbd1; border-radius: 4px; font: inherit; }
.actions { display: flex; gap: 8px; margin-bottom: 16px; }
button { padding: 6px 14px; border: 1px solid #c7cbd1; border-radius: 4px; background: #fff; font: inherit; cursor: pointer; }
button:hover { background: #eef1f5; }
```

Run: `pnpm install && pnpm --filter @ai-lint/desktop dev`
Expected: 창이 뜨고, 백엔드 주소를 입력하고 다른 곳을 클릭한 뒤 앱을 껐다 켜면 값이 남아 있다. 폴더 선택 시 하위 문서 개수가 뜬다.

Run: `pnpm test && pnpm typecheck`
Expected: 전부 통과

- [ ] **Step 11: 커밋**

```bash
git add apps/desktop vitest.config.ts pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat: add Tauri desktop shell with settings and file collection

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 검사 큐

파일 여러 개를 동시에 3개씩 검사한다. 하나가 실패해도 큐는 계속 돌아야 한다. 파싱 실패(암호 걸린 파일, 깨진 zip)와 백엔드 실패(토큰 오류, 쿼터)는 둘 다 그 파일만 실패로 표시하고 넘어간다.

`runQueue`는 도메인을 모르는 순수 함수로 두고, `runLintQueue`는 파싱 함수를 주입받는다. 그래야 큐 테스트에 실제 문서 파일이 필요 없다.

**Files:**
- Create: `apps/desktop/src/core/queue.ts`, `apps/desktop/src/core/parse-file.ts`, `apps/desktop/src/core/lint-file.ts`
- Create: `apps/desktop/test/queue.test.ts`, `apps/desktop/test/lint-file.test.ts`
- Modify: `apps/desktop/src/App.tsx`

**Interfaces:**
- Consumes: `collectDocuments`/`DocumentFile` (Task 8), `pptxToDocument`/`docxToDocument`/`xlsxToDocument` (Task 3·4·5), `pdfToDocument` (Task 6), `requestLint`/`BackendSettings` (Task 7), `makeDocument` (Task 2)
- Produces (`queue.ts`):
  - `CANCELLED: string`
  - `interface QueueOutcome<I, O> { item: I; output: O | null; error: string | null }`
  - `interface QueueOptions<I, O> { concurrency: number; onStart?: (item: I, index: number) => void; onSettled?: (outcome: QueueOutcome<I, O>, index: number) => void; cancelled?: () => boolean }`
  - `messageOf(cause: unknown): string`
  - `runQueue<I, O>(items: readonly I[], worker: (item: I, index: number) => Promise<O>, options: QueueOptions<I, O>): Promise<QueueOutcome<I, O>[]>`
- Produces (`parse-file.ts`): `interface DocReader { read(path: string): Promise<Uint8Array> }`, `parseDocument(reader: DocReader, file: DocumentFile): Promise<Document>`
- Produces (`lint-file.ts`):
  - `type JobPhase = 'pending' | 'parsing' | 'linting' | 'done' | 'failed'`
  - `interface JobState { file: DocumentFile; phase: JobPhase; report: LintReport | null; error: string | null }`
  - `interface LintDeps { parse(file: DocumentFile): Promise<Document>; fetchImpl: typeof fetch }`
  - `interface RunOptions { useLlm: boolean; concurrency: number; onChange(index: number, state: JobState): void; cancelled?: () => boolean }`
  - `initialJobs(files: readonly DocumentFile[]): JobState[]`
  - `defaultUseLlm(fileCount: number): boolean`
  - `runLintQueue(deps: LintDeps, files: readonly DocumentFile[], settings: BackendSettings, options: RunOptions): Promise<JobState[]>`

- [ ] **Step 1: 큐 실패 테스트 작성**

`apps/desktop/test/queue.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { CANCELLED, messageOf, runQueue } from '../src/core/queue.js'

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('runQueue', () => {
  it('결과를 입력 순서대로 돌려준다', async () => {
    const outcomes = await runQueue(
      [30, 5, 15],
      async (ms) => {
        await wait(ms)
        return ms
      },
      { concurrency: 3 },
    )
    expect(outcomes.map((o) => o.output)).toEqual([30, 5, 15])
  })

  it('동시 실행 수를 넘지 않는다', async () => {
    let running = 0
    let peak = 0
    await runQueue(
      Array.from({ length: 8 }, (_, i) => i),
      async (n) => {
        running += 1
        peak = Math.max(peak, running)
        await wait(5)
        running -= 1
        return n
      },
      { concurrency: 3 },
    )
    expect(peak).toBe(3)
  })

  it('하나가 실패해도 나머지를 끝까지 처리한다', async () => {
    const outcomes = await runQueue(
      ['a', 'b', 'c'],
      async (name) => {
        if (name === 'b') throw new Error('열 수 없는 파일입니다')
        return name.toUpperCase()
      },
      { concurrency: 2 },
    )
    expect(outcomes.map((o) => o.output)).toEqual(['A', null, 'C'])
    expect(outcomes[1]?.error).toBe('열 수 없는 파일입니다')
  })

  it('취소하면 남은 작업을 시작하지 않는다', async () => {
    let started = 0
    let cancel = false
    const outcomes = await runQueue(
      [1, 2, 3, 4],
      async (n) => {
        started += 1
        if (started === 2) cancel = true
        return n
      },
      { concurrency: 1, cancelled: () => cancel },
    )
    expect(started).toBe(2)
    expect(outcomes.slice(2).map((o) => o.error)).toEqual([CANCELLED, CANCELLED])
  })

  it('시작과 완료를 알린다', async () => {
    const log: string[] = []
    await runQueue([1, 2], async (n) => n * 2, {
      concurrency: 1,
      onStart: (item) => log.push(`시작 ${item}`),
      onSettled: (outcome) => log.push(`완료 ${outcome.output}`),
    })
    expect(log).toEqual(['시작 1', '완료 2', '시작 2', '완료 4'])
  })

  it('빈 목록이면 아무것도 하지 않는다', async () => {
    expect(await runQueue([], async () => 1, { concurrency: 3 })).toEqual([])
  })
})

describe('messageOf', () => {
  it('Error가 아닌 것도 문자열로 만든다', () => {
    expect(messageOf(new Error('망함'))).toBe('망함')
    expect(messageOf('문자열 예외')).toBe('문자열 예외')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run apps/desktop/test/queue.test.ts`
Expected: FAIL — `Failed to resolve import "../src/core/queue.js"`

- [ ] **Step 3: `queue.ts` 구현**

`apps/desktop/src/core/queue.ts`:

```typescript
export const CANCELLED = '취소됨'

export interface QueueOutcome<I, O> {
  item: I
  output: O | null
  error: string | null
}

export interface QueueOptions<I, O> {
  concurrency: number
  onStart?: (item: I, index: number) => void
  onSettled?: (outcome: QueueOutcome<I, O>, index: number) => void
  cancelled?: () => boolean
}

export const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

export async function runQueue<I, O>(
  items: readonly I[],
  worker: (item: I, index: number) => Promise<O>,
  options: QueueOptions<I, O>,
): Promise<QueueOutcome<I, O>[]> {
  const outcomes: QueueOutcome<I, O>[] = new Array<QueueOutcome<I, O>>(items.length)
  let cursor = 0

  const pump = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return

      const item = items[index]!
      if (options.cancelled?.() === true) {
        outcomes[index] = { item, output: null, error: CANCELLED }
        continue
      }

      options.onStart?.(item, index)
      let outcome: QueueOutcome<I, O>
      try {
        outcome = { item, output: await worker(item, index), error: null }
      } catch (cause) {
        // 파일 하나가 깨졌다고 나머지 검사를 버리지 않는다.
        outcome = { item, output: null, error: messageOf(cause) }
      }
      outcomes[index] = outcome
      options.onSettled?.(outcome, index)
    }
  }

  const width = Math.max(1, Math.min(options.concurrency, items.length))
  await Promise.all(Array.from({ length: width }, () => pump()))
  return outcomes
}
```

Run: `pnpm vitest run apps/desktop/test/queue.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 4: 검사 큐 실패 테스트 작성**

`apps/desktop/test/lint-file.test.ts`:

```typescript
import { makeDocument } from '@ai-lint/ir'
import { describe, expect, it } from 'vitest'
import type { DocumentFile } from '../src/core/collect.js'
import { defaultUseLlm, initialJobs, runLintQueue, type JobState } from '../src/core/lint-file.js'

const fileOf = (name: string): DocumentFile => ({
  path: `C:\\d\\${name}`, name, ext: 'docx',
})

const okFetch: typeof fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as { document: { source: { uri: string } } }
  return new Response(JSON.stringify({ reportId: `r-${body.document.source.uri}` }), { status: 200 })
}

const parseOf = (broken: string[] = []) => async (file: DocumentFile) => {
  if (broken.includes(file.name)) throw new Error('암호가 걸린 파일입니다')
  return makeDocument('docx', { uri: file.path }, file.name, [])
}

const settings = {
  backendUrl: 'http://localhost:3000', serviceToken: 'tok', userId: '', rulesetId: 'default',
}

const collect = (): { jobs: JobState[]; onChange: (i: number, s: JobState) => void } => {
  const jobs: JobState[] = []
  return { jobs, onChange: (_i, state) => jobs.push(state) }
}

describe('defaultUseLlm', () => {
  it('파일이 하나면 켜고 여러 개면 끈다', () => {
    expect(defaultUseLlm(1)).toBe(true)
    expect(defaultUseLlm(2)).toBe(false)
    expect(defaultUseLlm(0)).toBe(false)
  })
})

describe('initialJobs', () => {
  it('모든 파일을 대기 상태로 만든다', () => {
    expect(initialJobs([fileOf('a.docx')])[0]).toEqual({
      file: fileOf('a.docx'), phase: 'pending', report: null, error: null,
    })
  })
})

describe('runLintQueue', () => {
  it('파싱과 검사 단계를 순서대로 알린다', async () => {
    const { jobs, onChange } = collect()
    const final = await runLintQueue(
      { parse: parseOf(), fetchImpl: okFetch }, [fileOf('a.docx')], settings,
      { useLlm: true, concurrency: 1, onChange },
    )
    expect(jobs.map((j) => j.phase)).toEqual(['parsing', 'linting', 'done'])
    expect(final[0]?.report?.reportId).toBe('r-C:\\d\\a.docx')
  })

  it('파싱이 실패해도 다음 파일을 계속 검사한다', async () => {
    const { onChange } = collect()
    const final = await runLintQueue(
      { parse: parseOf(['a.docx']), fetchImpl: okFetch },
      [fileOf('a.docx'), fileOf('b.docx')], settings,
      { useLlm: false, concurrency: 1, onChange },
    )
    expect(final[0]).toMatchObject({ phase: 'failed', error: '암호가 걸린 파일입니다', report: null })
    expect(final[1]?.phase).toBe('done')
  })

  it('백엔드 오류 문구를 그대로 담는다', async () => {
    const failFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ error: '오늘 한도를 다 썼습니다' }), { status: 429 })
    const { onChange } = collect()
    const final = await runLintQueue(
      { parse: parseOf(), fetchImpl: failFetch }, [fileOf('a.docx')], settings,
      { useLlm: true, concurrency: 1, onChange },
    )
    expect(final[0]).toMatchObject({ phase: 'failed', error: '오늘 한도를 다 썼습니다' })
  })

  it('LLM 사용 여부를 요청에 실어 보낸다', async () => {
    const sent: unknown[] = []
    const spyFetch: typeof fetch = async (_input, init) => {
      sent.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ reportId: 'r1' }), { status: 200 })
    }
    const { onChange } = collect()
    await runLintQueue({ parse: parseOf(), fetchImpl: spyFetch }, [fileOf('a.docx')], settings, {
      useLlm: false, concurrency: 1, onChange,
    })
    expect(sent[0]).toMatchObject({ options: { useLlm: false, rulesetId: 'default' } })
  })
})
```

- [ ] **Step 5: 테스트 실패 확인**

Run: `pnpm vitest run apps/desktop/test/lint-file.test.ts`
Expected: FAIL — `Failed to resolve import "../src/core/lint-file.js"`

- [ ] **Step 6: `parse-file.ts`와 `lint-file.ts` 구현**

`apps/desktop/src/core/parse-file.ts`:

```typescript
import { docxToDocument, pptxToDocument, xlsxToDocument } from '@ai-lint/adapter-office'
import { pdfToDocument } from '@ai-lint/adapter-pdf'
import type { FileContext } from '@ai-lint/ir'
import type { Document } from '@ai-lint/ir'
import type { DocumentFile } from './collect.js'

export interface DocReader {
  read(path: string): Promise<Uint8Array>
}

export async function parseDocument(reader: DocReader, file: DocumentFile): Promise<Document> {
  const bytes = await reader.read(file.path)
  const ctx: FileContext = {
    uri: file.path,
    ...(file.modifiedAt === undefined ? {} : { modifiedAt: file.modifiedAt }),
  }
  switch (file.ext) {
    case 'pptx':
      return pptxToDocument(bytes, ctx)
    case 'docx':
      return docxToDocument(bytes, ctx)
    case 'xlsx':
      return xlsxToDocument(bytes, ctx)
    case 'pdf':
      return pdfToDocument(bytes, ctx)
  }
}
```

`apps/desktop/src/core/lint-file.ts`:

```typescript
import { requestLint, type BackendSettings } from '@ai-lint/backend-client'
import type { LintReport } from '@ai-lint/contract'
import type { Document } from '@ai-lint/ir'
import type { DocumentFile } from './collect.js'
import { runQueue } from './queue.js'

export type JobPhase = 'pending' | 'parsing' | 'linting' | 'done' | 'failed'

export interface JobState {
  file: DocumentFile
  phase: JobPhase
  report: LintReport | null
  error: string | null
}

export interface LintDeps {
  parse(file: DocumentFile): Promise<Document>
  fetchImpl: typeof fetch
}

export interface RunOptions {
  useLlm: boolean
  concurrency: number
  onChange(index: number, state: JobState): void
  cancelled?: () => boolean
}

export const initialJobs = (files: readonly DocumentFile[]): JobState[] =>
  files.map((file) => ({ file, phase: 'pending', report: null, error: null }))

/** 폴더 하나를 통째로 검사하면 수십 건이 되므로 LLM 쿼터가 금방 마른다. 파일 하나일 때만 켠다. */
export const defaultUseLlm = (fileCount: number): boolean => fileCount === 1

export async function runLintQueue(
  deps: LintDeps,
  files: readonly DocumentFile[],
  settings: BackendSettings,
  options: RunOptions,
): Promise<JobState[]> {
  const jobs = initialJobs(files)

  const move = (index: number, patch: Partial<JobState>): void => {
    const next = { ...jobs[index]!, ...patch }
    jobs[index] = next
    options.onChange(index, next)
  }

  await runQueue(
    files,
    async (file, index) => {
      move(index, { phase: 'parsing' })
      const document = await deps.parse(file)
      move(index, { phase: 'linting' })
      const report = await requestLint(document, { useLlm: options.useLlm }, settings, deps.fetchImpl)
      move(index, { phase: 'done', report })
      return report
    },
    {
      concurrency: options.concurrency,
      ...(options.cancelled === undefined ? {} : { cancelled: options.cancelled }),
      onSettled: (outcome, index) => {
        if (outcome.error !== null) move(index, { phase: 'failed', error: outcome.error })
      },
    },
  )

  return jobs
}
```

Run: `pnpm vitest run apps/desktop/test/lint-file.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 7: 화면에 검사 실행 붙이기**

`apps/desktop/src/App.tsx`에서 Task 8의 파일 목록 아래에 검사 버튼과 진행 상태를 붙인다. import를 다음으로 바꾼다:

```tsx
import { useEffect, useRef, useState } from 'react'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { collectDocuments, type DocumentFile } from './core/collect.js'
import { defaultUseLlm, initialJobs, runLintQueue, type JobState } from './core/lint-file.js'
import { parseDocument } from './core/parse-file.js'
import {
  DEFAULT_DESKTOP_SETTINGS, loadSettings, saveSettings, toBackendSettings, type DesktopSettings,
} from './core/settings.js'
import {
  fileSystem, pickFiles, pickFolder, readDocument, settingsStore, tokenStore,
} from './platform/tauri.js'
```

`App` 안에 상태와 실행 함수를 더한다:

```tsx
const [jobs, setJobs] = useState<JobState[]>([])
const [running, setRunning] = useState(false)
const [useLlm, setUseLlm] = useState(true)
const cancelRef = useRef(false)

const loadFiles = (found: DocumentFile[]): void => {
  setFiles(found)
  setJobs(initialJobs(found))
  setUseLlm(defaultUseLlm(found.length))
}

const onRun = async (): Promise<void> => {
  cancelRef.current = false
  setRunning(true)
  setJobs(initialJobs(files))
  try {
    await runLintQueue(
      { parse: (file) => parseDocument({ read: readDocument }, file), fetchImpl: tauriFetch },
      files,
      toBackendSettings(settings, token),
      {
        useLlm,
        concurrency: settings.concurrency,
        cancelled: () => cancelRef.current,
        onChange: (index, state) =>
          setJobs((prev) => prev.map((job, i) => (i === index ? state : job))),
      },
    )
  } finally {
    setRunning(false)
  }
}
```

`onPickFiles`/`onPickFolder`가 `setFiles` 대신 `loadFiles`를 부르게 고치고, 파일 목록 렌더링을 진행 상태로 바꾼다:

```tsx
const PHASE_LABELS: Record<JobState['phase'], string> = {
  pending: '대기', parsing: '읽는 중', linting: '검사 중', done: '완료', failed: '실패',
}
```

```tsx
<section className="actions">
  <button type="button" onClick={() => void onPickFiles()} disabled={running}>파일 선택</button>
  <button type="button" onClick={() => void onPickFolder()} disabled={running}>폴더 선택</button>
  <label className="inline">
    <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} disabled={running} />
    AI 검사 사용
  </label>
  <button type="button" onClick={() => void onRun()} disabled={running || files.length === 0}>
    검사 시작
  </button>
  {running ? (
    <button type="button" onClick={() => { cancelRef.current = true }}>취소</button>
  ) : null}
</section>

<ul className="jobs">
  {jobs.map((job) => (
    <li key={job.file.path}>
      <span>{job.file.name}</span>
      <span>{PHASE_LABELS[job.phase]}</span>
      {job.error === null ? null : <span className="error">{job.error}</span>}
    </li>
  ))}
</ul>
```

`styles.css`에 더한다:

```css
.inline { display: flex; align-items: center; gap: 4px; }
.jobs { list-style: none; padding: 0; }
.jobs li { display: grid; grid-template-columns: 1fr 80px 2fr; gap: 8px; padding: 6px 0; border-bottom: 1px solid #e3e6ea; }
.error { color: #b3261e; }
```

Run: `pnpm test && pnpm typecheck`
Expected: 전부 통과

Run: `pnpm --filter @ai-lint/backend dev` (다른 터미널) 후 `pnpm --filter @ai-lint/desktop dev`
Expected: 폴더를 고르고 검사 시작을 누르면 목록이 대기 → 읽는 중 → 검사 중 → 완료로 바뀐다. 백엔드를 끈 채로 누르면 모든 줄이 실패로 바뀌고 "백엔드에 연결하지 못했습니다"가 뜬다.

- [ ] **Step 8: 커밋**

```bash
git add apps/desktop
git commit -m "$(cat <<'EOF'
feat: add concurrent lint queue to desktop app

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 결과 표와 상세 뷰

왼쪽에 파일 표, 오른쪽에 선택한 파일의 검사 결과를 둔다. 원본 문서의 해당 위치로 뛰는 기능은 넣지 않는다. 다른 프로그램이 연 파일의 특정 슬라이드로 이동시키려면 COM 자동화가 필요한데, 이 앱이 감당할 범위가 아니다. 대신 `describeAnchor`가 "12쪽", "3번 슬라이드"처럼 사람이 직접 찾아갈 수 있는 문장을 만든다.

규칙 문서 링크(`docsUrl`)는 표시하지 않는다. WebView2는 새 창 요청을 막기 때문에 `<a target="_blank">`가 아무 일도 하지 않고, 링크를 열려면 플러그인을 하나 더 붙여야 한다. 규칙 ID를 그대로 보여주는 것으로 갈음한다.

**Files:**
- Create: `apps/desktop/src/core/describe.ts`
- Create: `apps/desktop/src/ui/JobTable.tsx`, `apps/desktop/src/ui/ReportView.tsx`
- Create: `apps/desktop/test/describe.test.ts`
- Modify: `apps/desktop/src/App.tsx`, `apps/desktop/src/styles.css`

**Interfaces:**
- Consumes: `JobState`/`JobPhase` (Task 9), `SEVERITY_LABELS`/`SEVERITY_ORDER`/`AXIS_LABELS`/`DOC_TYPE_LABELS` (Task 7), `Finding`/`Score` (`@ai-lint/rules`), `SourceAnchor` (`@ai-lint/ir`)
- Produces (`describe.ts`):
  - `describeAnchor(anchor: SourceAnchor | null): string`
  - `sortFindings(findings: readonly Finding[]): Finding[]`
  - `countBySeverity(findings: readonly Finding[]): Record<Severity, number>`
- Produces (`JobTable.tsx`): `JobTable(props: { jobs: readonly JobState[]; selected: number; onSelect(index: number): void }): JSX.Element`
- Produces (`ReportView.tsx`): `ReportView(props: { job: JobState | undefined }): JSX.Element`

- [ ] **Step 1: 실패 테스트 작성**

`apps/desktop/test/describe.test.ts`:

```typescript
import type { Finding } from '@ai-lint/rules'
import { describe, expect, it } from 'vitest'
import { countBySeverity, describeAnchor, sortFindings } from '../src/core/describe.js'

const finding = (id: string, severity: Finding['severity'], axis: Finding['axis']): Finding => ({
  id, ruleId: 'STR001', axis, severity, blockId: null, anchor: null,
  message: '메시지', why: '이유', evidence: null, suggestion: null,
  source: 'rule', confidence: 1, docsUrl: '',
})

describe('describeAnchor', () => {
  it('PDF는 쪽 번호로 말한다', () => {
    expect(describeAnchor({ kind: 'pdf', page: 12 })).toBe('12쪽')
  })

  it('슬라이드는 번호로 말한다', () => {
    expect(describeAnchor({ kind: 'pptx', slide: 3 })).toBe('3번 슬라이드')
  })

  it('시트는 이름과 범위를 함께 말한다', () => {
    expect(describeAnchor({ kind: 'xlsx', sheet: '요구사항', range: 'A1:C9' }))
      .toBe('요구사항 시트 A1:C9')
    expect(describeAnchor({ kind: 'xlsx', sheet: '요구사항' })).toBe('요구사항 시트')
  })

  it('문단 번호는 1부터 센다', () => {
    expect(describeAnchor({ kind: 'docx', paragraphIndex: 0 })).toBe('1번째 문단')
  })

  it('Confluence는 인용문을 보여준다', () => {
    expect(describeAnchor({ kind: 'confluence', xpath: '/x', textQuote: { exact: '결제 모듈' } }))
      .toBe('"결제 모듈"')
  })

  it('앵커가 없으면 문서 전체로 본다', () => {
    expect(describeAnchor(null)).toBe('문서 전체')
  })
})

describe('sortFindings', () => {
  it('심각한 것부터 놓는다', () => {
    const sorted = sortFindings([
      finding('a', 'info', 'structure'),
      finding('b', 'error', 'context'),
      finding('c', 'warning', 'metadata'),
    ])
    expect(sorted.map((f) => f.id)).toEqual(['b', 'c', 'a'])
  })

  it('같은 심각도면 축 순서를 따른다', () => {
    const sorted = sortFindings([
      finding('a', 'error', 'metadata'),
      finding('b', 'error', 'structure'),
      finding('c', 'error', 'context'),
    ])
    expect(sorted.map((f) => f.id)).toEqual(['b', 'c', 'a'])
  })

  it('원본 배열을 건드리지 않는다', () => {
    const input = [finding('a', 'info', 'structure'), finding('b', 'error', 'structure')]
    sortFindings(input)
    expect(input.map((f) => f.id)).toEqual(['a', 'b'])
  })
})

describe('countBySeverity', () => {
  it('심각도별로 센다', () => {
    expect(countBySeverity([
      finding('a', 'error', 'structure'),
      finding('b', 'error', 'context'),
      finding('c', 'info', 'metadata'),
    ])).toEqual({ error: 2, warning: 0, info: 1 })
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run apps/desktop/test/describe.test.ts`
Expected: FAIL — `Failed to resolve import "../src/core/describe.js"`

- [ ] **Step 3: `describe.ts` 구현**

`apps/desktop/src/core/describe.ts`:

```typescript
import type { SourceAnchor } from '@ai-lint/ir'
import { SEVERITY_ORDER } from '@ai-lint/labels'
import type { Axis, Finding, Severity } from '@ai-lint/rules'

const AXIS_ORDER: Axis[] = ['structure', 'context', 'metadata']

/** 원본 위치로 자동 이동하지 않는 대신, 사람이 직접 찾아갈 수 있는 문장을 만든다. */
export function describeAnchor(anchor: SourceAnchor | null): string {
  if (anchor === null) return '문서 전체'
  switch (anchor.kind) {
    case 'pdf':
      return `${anchor.page}쪽`
    case 'pptx':
      return `${anchor.slide}번 슬라이드`
    case 'xlsx':
      return anchor.range === undefined ? `${anchor.sheet} 시트` : `${anchor.sheet} 시트 ${anchor.range}`
    case 'docx':
      return `${anchor.paragraphIndex + 1}번째 문단`
    case 'confluence':
      return `"${anchor.textQuote.exact}"`
  }
}

export const sortFindings = (findings: readonly Finding[]): Finding[] =>
  [...findings].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      AXIS_ORDER.indexOf(a.axis) - AXIS_ORDER.indexOf(b.axis),
  )

export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 }
  for (const finding of findings) counts[finding.severity] += 1
  return counts
}
```

Run: `pnpm vitest run apps/desktop/test/describe.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 4: 표 컴포넌트 작성**

`apps/desktop/src/ui/JobTable.tsx`:

```tsx
import { countBySeverity } from '../core/describe.js'
import type { JobState } from '../core/lint-file.js'

const PHASE_LABELS: Record<JobState['phase'], string> = {
  pending: '대기',
  parsing: '읽는 중',
  linting: '검사 중',
  done: '완료',
  failed: '실패',
}

function Counts({ job }: { job: JobState }): JSX.Element {
  if (job.report === null) return <span className="muted">-</span>
  const counts = countBySeverity(job.report.findings)
  return (
    <span className="counts">
      <span className="sev-error">{counts.error}</span>
      <span className="sev-warning">{counts.warning}</span>
      <span className="sev-info">{counts.info}</span>
    </span>
  )
}

export function JobTable({
  jobs,
  selected,
  onSelect,
}: {
  jobs: readonly JobState[]
  selected: number
  onSelect(index: number): void
}): JSX.Element {
  if (jobs.length === 0) return <p className="muted">파일이나 폴더를 선택하세요.</p>

  return (
    <table className="jobs">
      <thead>
        <tr>
          <th>파일</th>
          <th>상태</th>
          <th>점수</th>
          <th>오류·경고·정보</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job, index) => (
          <tr
            key={job.file.path}
            className={index === selected ? 'selected' : undefined}
            onClick={() => onSelect(index)}
          >
            <td title={job.file.path}>{job.file.name}</td>
            <td>{job.error === null ? PHASE_LABELS[job.phase] : job.error}</td>
            <td>
              {job.report === null
                ? '-'
                : `${job.report.score.total} (${job.report.score.grade})`}
            </td>
            <td>
              <Counts job={job} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 5: 상세 뷰 작성**

`apps/desktop/src/ui/ReportView.tsx`:

```tsx
import { AXIS_LABELS, DOC_TYPE_LABELS, SEVERITY_LABELS } from '@ai-lint/labels'
import type { Finding } from '@ai-lint/rules'
import { describeAnchor, sortFindings } from '../core/describe.js'
import type { JobState } from '../core/lint-file.js'

function FindingCard({ finding }: { finding: Finding }): JSX.Element {
  return (
    <li className="finding">
      <div className="finding-head">
        <span className={`badge sev-${finding.severity}`}>{SEVERITY_LABELS[finding.severity]}</span>
        <span className="muted">{finding.ruleId}</span>
        <span className="muted">{AXIS_LABELS[finding.axis]}</span>
        <span className="muted">{describeAnchor(finding.anchor)}</span>
        {finding.source === 'llm' ? <span className="badge llm">AI</span> : null}
      </div>
      <p className="finding-message">{finding.message}</p>
      <p className="muted">{finding.why}</p>
      {finding.evidence === null ? null : <pre className="evidence">{finding.evidence}</pre>}
      {finding.suggestion === null ? null : (
        <div className="suggestion">
          <pre className="before">{finding.suggestion.before}</pre>
          <pre className="after">{finding.suggestion.after}</pre>
        </div>
      )}
    </li>
  )
}

const LLM_NOTES: Record<string, string> = {
  skipped: 'AI 검사를 건너뛰었습니다. 규칙 검사 결과만 표시합니다.',
  partial: 'AI 검사 일부가 실패했습니다.',
  failed: 'AI 검사가 실패했습니다. 규칙 검사 결과만 표시합니다.',
}

export function ReportView({ job }: { job: JobState | undefined }): JSX.Element {
  if (job === undefined) return <p className="muted">왼쪽에서 파일을 고르세요.</p>
  if (job.error !== null) return <p className="error">{job.error}</p>
  if (job.report === null) return <p className="muted">아직 검사하지 않았습니다.</p>

  const { report } = job
  const note = LLM_NOTES[report.llmStatus]

  return (
    <div className="report">
      <div className="score">
        <span className={`grade grade-${report.score.grade}`}>{report.score.grade}</span>
        <strong>{report.score.total}점</strong>
        <span className="muted">{DOC_TYPE_LABELS[report.docType.value]}</span>
      </div>

      <ul className="axes">
        {(['structure', 'context', 'metadata'] as const).map((axis) => (
          <li key={axis}>
            {AXIS_LABELS[axis]} <strong>{report.score.axes[axis]}</strong>
          </li>
        ))}
      </ul>

      {note === undefined ? null : <p className="note">{note}</p>}
      {report.truncated ? <p className="note">문서가 길어 앞부분만 검사했습니다.</p> : null}

      <ul className="findings">
        {sortFindings(report.findings).map((finding) => (
          <FindingCard key={finding.id} finding={finding} />
        ))}
      </ul>

      {report.findings.length === 0 ? <p className="muted">지적할 내용이 없습니다.</p> : null}
    </div>
  )
}
```

`LLM_NOTES`에 `ok`가 없으므로 정상일 때는 `note`가 `undefined`가 되어 아무것도 그리지 않는다.

- [ ] **Step 6: 화면 조립**

`apps/desktop/src/App.tsx`에서 Task 9의 `<ul className="jobs">` 블록을 표와 상세 뷰로 바꾼다. import에 다음을 더한다:

```tsx
import { JobTable } from './ui/JobTable.js'
import { ReportView } from './ui/ReportView.js'
```

상태에 선택 인덱스를 더한다:

```tsx
const [selected, setSelected] = useState(0)
```

`loadFiles`에서 `setSelected(0)`을 함께 부르고, 목록 자리를 바꾼다:

```tsx
<section className="split">
  <JobTable jobs={jobs} selected={selected} onSelect={setSelected} />
  <ReportView job={jobs[selected]} />
</section>
```

Task 9에서 `App.tsx`에 두었던 `PHASE_LABELS`는 `JobTable.tsx`로 옮겨갔으므로 `App.tsx`에서 지운다.

`styles.css`의 `.jobs` 규칙을 표에 맞게 바꾸고 나머지를 더한다:

```css
.split { display: grid; grid-template-columns: minmax(320px, 2fr) 3fr; gap: 16px; align-items: start; }
table.jobs { width: 100%; border-collapse: collapse; background: #fff; }
table.jobs th, table.jobs td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e3e6ea; }
table.jobs th { font-weight: 600; color: #5a6270; }
table.jobs tbody tr { cursor: pointer; }
table.jobs tbody tr:hover { background: #f0f3f7; }
table.jobs tr.selected { background: #e4ecf9; }
.muted { color: #6b7280; }
.counts { display: flex; gap: 8px; }
.report { background: #fff; padding: 16px; border: 1px solid #e3e6ea; border-radius: 6px; }
.score { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.grade { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 50%; color: #fff; font-weight: 700; }
.grade-A { background: #1f7a3f; } .grade-B { background: #3f7ac2; }
.grade-C { background: #c98a1a; } .grade-D { background: #b3261e; }
.axes { display: flex; gap: 16px; list-style: none; padding: 0; margin: 0 0 12px; }
.note { background: #fdf6e3; border: 1px solid #e8d9a8; border-radius: 4px; padding: 8px; }
.findings { list-style: none; padding: 0; display: grid; gap: 12px; }
.finding { border-top: 1px solid #e3e6ea; padding-top: 12px; }
.finding-head { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; flex-wrap: wrap; }
.finding-message { margin: 0 0 4px; font-weight: 600; }
.badge { padding: 1px 6px; border-radius: 3px; color: #fff; font-size: 12px; }
.badge.llm { background: #6b4fbb; }
.sev-error { color: #b3261e; } .badge.sev-error { background: #b3261e; color: #fff; }
.sev-warning { color: #c98a1a; } .badge.sev-warning { background: #c98a1a; color: #fff; }
.sev-info { color: #3f7ac2; } .badge.sev-info { background: #3f7ac2; color: #fff; }
.evidence, .suggestion pre { background: #f6f7f9; padding: 8px; border-radius: 4px; white-space: pre-wrap; margin: 4px 0; }
.suggestion .before { border-left: 3px solid #b3261e; }
.suggestion .after { border-left: 3px solid #1f7a3f; }
```

Run: `pnpm test && pnpm typecheck`
Expected: 전부 통과

Run: `pnpm --filter @ai-lint/desktop dev`
Expected: 검사가 끝난 파일을 클릭하면 오른쪽에 점수·등급·축별 점수와 지적 목록이 뜬다. 지적마다 "12쪽" 같은 위치 문장이 붙는다.

- [ ] **Step 7: 커밋**

```bash
git add apps/desktop
git commit -m "$(cat <<'EOF'
feat: add result table and report detail view

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: HTML·Excel 내보내기

검사 결과를 팀에 돌리려면 앱 밖으로 꺼낼 수 있어야 한다. HTML은 한 파일에 스타일까지 담아 그대로 열리게 만들고, Excel은 `fflate`로 xlsx를 직접 쓴다.

CSV가 아니라 xlsx인 이유는 인코딩이다. 한국어 Windows의 Excel은 UTF-8 CSV를 cp949로 읽어 한글을 깨뜨린다. xlsx는 내부가 UTF-8 XML이라 그 문제가 없다.

`sharedStrings.xml` 없이 `t="inlineStr"`로만 쓴다. 문자열 사전을 관리할 이유가 없고, 파일 크기 차이는 이 규모에서 의미가 없다.

**Files:**
- Create: `apps/desktop/src/core/export-html.ts`, `apps/desktop/src/core/export-xlsx.ts`
- Create: `apps/desktop/test/export.test.ts`
- Modify: `apps/desktop/src/App.tsx`

**Interfaces:**
- Consumes: `JobState` (Task 9), `describeAnchor`/`countBySeverity`/`sortFindings` (Task 10), `SEVERITY_LABELS`/`AXIS_LABELS`/`DOC_TYPE_LABELS` (Task 7), `xlsxToDocument` (Task 3, 테스트에서만), `pickSavePath`/`saveFile` (Task 8)
- Produces (`export-html.ts`): `escapeHtml(text: string): string`, `toHtml(jobs: readonly JobState[], generatedAt: string): string`
- Produces (`export-xlsx.ts`): `toXlsx(jobs: readonly JobState[]): Uint8Array`

- [ ] **Step 1: 실패 테스트 작성**

`apps/desktop/test/export.test.ts`:

```typescript
import { xlsxToDocument } from '@ai-lint/adapter-office'
import type { LintReport } from '@ai-lint/contract'
import type { Finding } from '@ai-lint/rules'
import { describe, expect, it } from 'vitest'
import type { JobState } from '../src/core/lint-file.js'
import { escapeHtml, toHtml } from '../src/core/export-html.js'
import { toXlsx } from '../src/core/export-xlsx.js'

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'f1', ruleId: 'STR001', axis: 'structure', severity: 'error',
  blockId: 'b1', anchor: { kind: 'pdf', page: 12 },
  message: '제목이 없습니다', why: '청킹 기준이 사라집니다',
  evidence: null, suggestion: null, source: 'rule', confidence: 1, docsUrl: '',
  ...over,
})

const reportOf = (over: Partial<LintReport> = {}): LintReport => ({
  reportId: 'r1', documentUri: 'C:\\d\\a.pdf', documentHash: 'h1',
  docType: { value: 'design', confidence: 0.9, origin: 'llm' },
  rulesetId: 'default', rulesetVersion: 1,
  score: { total: 72, grade: 'C', axes: { structure: 70, context: 60, metadata: 90 } },
  findings: [finding()],
  stats: { rulesEvaluated: 20, llmFindingsRejected: 0, durationMs: 100 },
  llmStatus: 'ok', truncated: false, cached: false, createdAt: '2026-08-22T00:00:00.000Z',
  ...over,
})

const jobOf = (name: string, report: LintReport | null, error: string | null = null): JobState => ({
  file: { path: `C:\\d\\${name}`, name, ext: 'pdf' },
  phase: report === null ? 'failed' : 'done',
  report,
  error,
})

describe('escapeHtml', () => {
  it('꺾쇠와 따옴표를 막는다', () => {
    expect(escapeHtml('<script>"a" & \'b\'</script>'))
      .toBe('&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;')
  })
})

describe('toHtml', () => {
  it('파일마다 점수와 지적을 담는다', () => {
    const html = toHtml([jobOf('a.pdf', reportOf())], '2026-08-22T00:00:00.000Z')
    expect(html).toContain('a.pdf')
    expect(html).toContain('72')
    expect(html).toContain('제목이 없습니다')
    expect(html).toContain('12쪽')
  })

  it('실패한 파일도 이유와 함께 남긴다', () => {
    const html = toHtml([jobOf('b.pdf', null, '암호가 걸린 파일입니다')], '2026-08-22T00:00:00.000Z')
    expect(html).toContain('암호가 걸린 파일입니다')
  })

  it('문서 내용이 태그로 살아나지 않는다', () => {
    const html = toHtml(
      [jobOf('c.pdf', reportOf({ findings: [finding({ message: '<img onerror=x>' })] }))],
      '2026-08-22T00:00:00.000Z',
    )
    expect(html).not.toContain('<img onerror=x>')
    expect(html).toContain('&lt;img onerror=x&gt;')
  })

  it('바깥 파일을 하나도 부르지 않는다', () => {
    const html = toHtml([jobOf('a.pdf', reportOf())], '2026-08-22T00:00:00.000Z')
    expect(html).not.toMatch(/<(script|link|img)\b/)
  })
})

describe('toXlsx', () => {
  it('다시 읽어보면 요약과 지적이 그대로 있다', () => {
    const bytes = toXlsx([jobOf('a.pdf', reportOf()), jobOf('b.pdf', null, '열 수 없습니다')])
    const doc = xlsxToDocument(bytes, { uri: 'C:\\out.xlsx' })
    const text = doc.blocks.map((block) => JSON.stringify(block)).join('\n')

    expect(text).toContain('a.pdf')
    expect(text).toContain('72')
    expect(text).toContain('열 수 없습니다')
    expect(text).toContain('제목이 없습니다')
    expect(text).toContain('12쪽')
  })

  it('두 시트로 나눈다', () => {
    const doc = xlsxToDocument(toXlsx([jobOf('a.pdf', reportOf())]), { uri: 'C:\\out.xlsx' })
    const sheets = doc.blocks
      .filter((block) => block.anchor.kind === 'xlsx')
      .map((block) => (block.anchor.kind === 'xlsx' ? block.anchor.sheet : ''))
    expect(new Set(sheets)).toEqual(new Set(['요약', '지적']))
  })

  it('지적이 하나도 없어도 읽히는 파일을 만든다', () => {
    const doc = xlsxToDocument(
      toXlsx([jobOf('a.pdf', reportOf({ findings: [] }))]),
      { uri: 'C:\\out.xlsx' },
    )
    expect(doc.blocks.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run apps/desktop/test/export.test.ts`
Expected: FAIL — `Failed to resolve import "../src/core/export-html.js"`

- [ ] **Step 3: `export-html.ts` 구현**

`apps/desktop/src/core/export-html.ts`:

```typescript
import { AXIS_LABELS, DOC_TYPE_LABELS, SEVERITY_LABELS } from '@ai-lint/labels'
import { countBySeverity, describeAnchor, sortFindings } from './describe.js'
import type { JobState } from './lint-file.js'

const ENTITIES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}

export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (ch) => ENTITIES[ch]!)

const STYLE = `
body { font-family: 'Malgun Gothic', system-ui, sans-serif; margin: 24px; color: #1a1a1a; }
h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 28px; }
table { border-collapse: collapse; margin-bottom: 16px; }
th, td { border: 1px solid #d0d4da; padding: 4px 8px; text-align: left; }
th { background: #f0f3f7; }
.finding { border-top: 1px solid #e3e6ea; padding: 8px 0; }
.where { color: #6b7280; }
.error { color: #b3261e; } .warning { color: #c98a1a; } .info { color: #3f7ac2; }
pre { background: #f6f7f9; padding: 8px; white-space: pre-wrap; }
`

function summaryRow(job: JobState): string {
  if (job.report === null) {
    return `<tr><td>${escapeHtml(job.file.name)}</td><td colspan="5" class="error">${escapeHtml(job.error ?? '실패')}</td></tr>`
  }
  const counts = countBySeverity(job.report.findings)
  return `<tr><td>${escapeHtml(job.file.name)}</td><td>${job.report.score.total}</td><td>${job.report.score.grade}</td><td>${counts.error}</td><td>${counts.warning}</td><td>${counts.info}</td></tr>`
}

function findingHtml(finding: ReturnType<typeof sortFindings>[number]): string {
  const suggestion =
    finding.suggestion === null
      ? ''
      : `<pre>${escapeHtml(finding.suggestion.before)}</pre><pre>${escapeHtml(finding.suggestion.after)}</pre>`
  const evidence = finding.evidence === null ? '' : `<pre>${escapeHtml(finding.evidence)}</pre>`
  return `<div class="finding">
<p><span class="${finding.severity}">${SEVERITY_LABELS[finding.severity]}</span>
${escapeHtml(finding.ruleId)} · ${AXIS_LABELS[finding.axis]}
<span class="where">${escapeHtml(describeAnchor(finding.anchor))}</span></p>
<p><strong>${escapeHtml(finding.message)}</strong></p>
<p>${escapeHtml(finding.why)}</p>${evidence}${suggestion}</div>`
}

function detailHtml(job: JobState): string {
  if (job.report === null) {
    return `<h2>${escapeHtml(job.file.name)}</h2><p class="error">${escapeHtml(job.error ?? '실패')}</p>`
  }
  const { report } = job
  const axes = (['structure', 'context', 'metadata'] as const)
    .map((axis) => `${AXIS_LABELS[axis]} ${report.score.axes[axis]}`)
    .join(' · ')
  return `<h2>${escapeHtml(job.file.name)}</h2>
<p>${escapeHtml(job.file.path)}</p>
<p>${report.score.total}점 (${report.score.grade}) · ${DOC_TYPE_LABELS[report.docType.value]} · ${axes}</p>
${sortFindings(report.findings).map(findingHtml).join('\n')}`
}

export function toHtml(jobs: readonly JobState[], generatedAt: string): string {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>AI Lint 검사 결과</title>
<style>${STYLE}</style></head><body>
<h1>AI Lint 검사 결과</h1>
<p>${escapeHtml(generatedAt)} · 파일 ${jobs.length}개</p>
<table><thead><tr><th>파일</th><th>점수</th><th>등급</th><th>오류</th><th>경고</th><th>정보</th></tr></thead>
<tbody>${jobs.map(summaryRow).join('')}</tbody></table>
${jobs.map(detailHtml).join('\n')}
</body></html>`
}
```

- [ ] **Step 4: `export-xlsx.ts` 구현**

`apps/desktop/src/core/export-xlsx.ts`:

```typescript
import { AXIS_LABELS, SEVERITY_LABELS } from '@ai-lint/labels'
import { strToU8, zipSync } from 'fflate'
import { countBySeverity, describeAnchor, sortFindings } from './describe.js'
import type { JobState } from './lint-file.js'

const XML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

/** XML 1.0이 허용하지 않는 제어 문자는 Excel이 파일 전체를 거부하게 만든다. */
const escapeXml = (text: string): string =>
  text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, (ch) => XML_ENTITIES[ch]!)

const COLUMNS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const colNameOf = (index: number): string => {
  let name = ''
  let n = index
  do {
    name = COLUMNS[n % 26]! + name
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return name
}

type CellValue = string | number

const cellXml = (value: CellValue, ref: string): string =>
  typeof value === 'number'
    ? `<c r="${ref}"><v>${value}</v></c>`
    : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`

const sheetXml = (rows: readonly CellValue[][]): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
    .map(
      (cells, r) =>
        `<row r="${r + 1}">${cells.map((cell, c) => cellXml(cell, `${colNameOf(c)}${r + 1}`)).join('')}</row>`,
    )
    .join('')}</sheetData></worksheet>`

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function summaryRows(jobs: readonly JobState[]): CellValue[][] {
  const rows: CellValue[][] = [['파일', '경로', '점수', '등급', '오류', '경고', '정보', '상태']]
  for (const job of jobs) {
    if (job.report === null) {
      rows.push([job.file.name, job.file.path, 0, '-', 0, 0, 0, job.error ?? '실패'])
      continue
    }
    const counts = countBySeverity(job.report.findings)
    rows.push([
      job.file.name, job.file.path, job.report.score.total, job.report.score.grade,
      counts.error, counts.warning, counts.info, '완료',
    ])
  }
  return rows
}

function findingRows(jobs: readonly JobState[]): CellValue[][] {
  const rows: CellValue[][] = [['파일', '심각도', '규칙', '축', '위치', '내용', '이유', '수정 제안']]
  for (const job of jobs) {
    if (job.report === null) continue
    for (const finding of sortFindings(job.report.findings)) {
      rows.push([
        job.file.name, SEVERITY_LABELS[finding.severity], finding.ruleId, AXIS_LABELS[finding.axis],
        describeAnchor(finding.anchor), finding.message, finding.why,
        finding.suggestion === null ? '' : finding.suggestion.after,
      ])
    }
  }
  return rows
}

export function toXlsx(jobs: readonly JobState[]): Uint8Array {
  const sheets = [
    { name: '요약', rows: summaryRows(jobs) },
    { name: '지적', rows: findingRows(jobs) },
  ]

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets
  .map(
    (_sheet, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('')}
</Types>`),

    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),

    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL_NS}">
<sheets>${sheets
      .map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets>
</workbook>`),

    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_sheet, i) =>
      `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('')}
</Relationships>`),
  }

  for (const [i, sheet] of sheets.entries()) {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet.rows))
  }

  return zipSync(files, { level: 6 })
}
```

`fflate`를 `apps/desktop/package.json`의 `dependencies`에 더한다 (`"fflate": "^0.8.2"`).

Run: `pnpm install && pnpm vitest run apps/desktop/test/export.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 내보내기 버튼 붙이기**

`apps/desktop/src/App.tsx`의 import에 더한다:

```tsx
import { toHtml } from './core/export-html.js'
import { toXlsx } from './core/export-xlsx.js'
import { pickSavePath, saveFile } from './platform/tauri.js'
```

`App` 안에 내보내기 함수를 더한다:

```tsx
const stamp = (): string => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

const onExportHtml = async (): Promise<void> => {
  const path = await pickSavePath(`ai-lint-${stamp()}.html`)
  if (path === null) return
  await saveFile(path, new TextEncoder().encode(toHtml(jobs, new Date().toLocaleString('ko-KR'))))
}

const onExportXlsx = async (): Promise<void> => {
  const path = await pickSavePath(`ai-lint-${stamp()}.xlsx`)
  if (path === null) return
  await saveFile(path, toXlsx(jobs))
}
```

`stamp`는 컴포넌트 밖에 둔다.

`<section className="actions">` 안에 버튼 두 개를 더한다:

```tsx
<button type="button" onClick={() => void onExportHtml()} disabled={running || jobs.length === 0}>
  HTML 저장
</button>
<button type="button" onClick={() => void onExportXlsx()} disabled={running || jobs.length === 0}>
  Excel 저장
</button>
```

Run: `pnpm test && pnpm typecheck`
Expected: 전부 통과

Run: `pnpm --filter @ai-lint/desktop dev`
Expected: 검사 후 Excel 저장을 누르면 저장 대화상자가 뜨고, 저장된 파일을 Excel에서 열면 요약·지적 두 시트가 한글이 깨지지 않은 채 보인다. HTML 저장은 브라우저에서 바로 열린다.

- [ ] **Step 6: 릴리스 빌드 확인**

Run: `pnpm --filter @ai-lint/desktop build`
Expected: `apps/desktop/src-tauri/target/release/bundle/msi/`에 msi가 생긴다

- [ ] **Step 7: 커밋과 PR**

```bash
git add apps/desktop pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat: export lint results to HTML and Excel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
git push -u origin feat/desktop-app
gh pr create --title "feat: Windows document lint desktop app" --body "$(cat <<'EOF'
PPTX·DOCX·XLSX·PDF 파일을 IR로 바꿔 기존 lint 백엔드로 검사하는 Tauri 데스크톱 앱.

- `packages/xml`: 확장·데스크톱이 함께 쓰는 XML 파싱 유틸
- `packages/adapter-office`, `packages/adapter-pdf`: 문서 → IR 변환
- `packages/labels`, `packages/backend-client`: 확장과 공유하는 라벨·백엔드 호출
- `apps/desktop`: Tauri 셸, 동시 3건 검사 큐, 결과 표·상세 뷰, HTML·Excel 내보내기
- 새 규칙 STR013(강조를 제목처럼 쓴 문단), STR014(텍스트 없는 스캔 PDF)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --squash --delete-branch
```

---

## Self-Review

**스펙 대비 빠진 것:** 없음. 스펙 §3(IR 매핑)은 Task 3·4·5·6, §4(앵커)는 Task 3~6과 Task 10의 `describeAnchor`, §5(새 규칙)는 Task 4·6, §6(공유 패키지)은 Task 1·7, §7(수집·큐)은 Task 8·9, §8(설정·보안)은 Task 8, §9(결과 화면·내보내기)는 Task 10·11이 받는다.

**스펙에서 의도적으로 뺀 것 두 가지:**
- §5.4의 PDF 굵기 신호. pdf.js는 `textContent.styles[fontName].fontFamily`만 주고 PostScript 이름을 주지 않아 굵기를 알 수 없다. 제목 판정은 글자 크기 비율만 쓴다.
- §9의 규칙 문서 링크. WebView2가 새 창을 막아 링크가 동작하지 않으므로 규칙 ID만 표시한다.

**타입 일관성:** `FileContext`(Task 2)는 Task 3~6의 어댑터와 Task 9의 `parseDocument`가 같은 이름·같은 필드로 쓴다. `BackendSettings`(Task 7)는 Task 8의 `toBackendSettings`가 만들고 Task 9의 `runLintQueue`가 받는다. `JobState`(Task 9)는 Task 10의 두 컴포넌트와 Task 11의 두 내보내기 함수가 그대로 받는다. `describeAnchor`/`sortFindings`/`countBySeverity`(Task 10)는 Task 11이 재사용한다.
