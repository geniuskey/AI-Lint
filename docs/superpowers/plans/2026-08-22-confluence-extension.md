# Confluence 크롬 확장 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confluence 페이지 좌하단 버튼 하나로 그 페이지를 Document IR로 바꿔 백엔드에 보내고, 점수·지적·수정 제안을 페이지 위에서 바로 보여준다.

**Architecture:** `packages/adapter-confluence`는 Confluence REST 응답(storage XHTML 포함)을 Document IR로 바꾸는 순수 함수만 담는다 — 브라우저 API도 chrome API도 쓰지 않고, DOM 파싱은 `DOMParser` 전역만 쓴다. `apps/extension`은 MV3 확장이다. content script가 사용자 세션 쿠키로 REST를 읽어 IR을 만들고, service worker가 백엔드를 호출하며, 결과는 Shadow DOM 패널에 그린다. 백엔드 응답 타입은 `packages/contract`로 빼내 백엔드와 클라이언트가 같은 정의를 본다.

**Tech Stack:** TypeScript strict ESM, zod(백엔드/계약만), tsup(esbuild) 번들, vitest + happy-dom(단위), Playwright(E2E), Chrome MV3.

## Global Constraints

- pnpm workspace + Turborepo. 새 패키지는 `packages/*` 또는 `apps/*`에 두고 `pnpm-workspace.yaml` 수정은 필요 없다.
- 내부 패키지는 빌드 산출물이 아니라 `"exports": { ".": "./src/index.ts" }`로 소스를 직접 노출한다.
- `tsconfig.json`은 `{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }` 형태. `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noEmit`이 켜져 있다 — 타입 전용 import는 반드시 `import type`.
- 상대 import는 확장자 `.js`를 붙인다 (`./blocks.js`).
- 테스트는 `packages/*/test/**/*.test.ts`, `apps/*/test/**/*.test.ts`만 vitest가 수집한다. E2E는 `apps/extension/e2e/`에 두어 vitest에서 제외한다.
- **확장 번들에는 npm 런타임 의존성이 없다.** `packages/adapter-confluence`와 `apps/extension`이 `@ai-lint/ir`·`@ai-lint/contract`에서 가져오는 것은 전부 `import type`이어야 한다. 이 두 패키지의 index는 zod 스키마를 최상위에서 초기화하므로 값 하나만 가져와도 zod 전체가 번들에 들어온다. 테스트 파일에서는 값 import를 써도 된다 (번들되지 않는다).
- 사용자에게 보이는 문자열은 한국어. 코드 주석은 "왜"만 적는다.
- 커밋 메시지는 영어 `type: description` + `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- 목록 블록 `depth`는 **최상위가 1**이다 (STR010이 `depth > 3`에서 발동한다).
- `Link.status`는 어댑터가 채우지 않는다. 어댑터는 `'unchecked'`를 넣고, 실제 확인은 content script가 사용자 권한으로 한다 (META006이 `status === 'broken'`만 본다).

---

## 파일 구조

```
packages/contract/                    # 백엔드 API 계약 (신규)
  src/report.ts                       # LintReport, LintOptionsSchema, LintRequestSchema
  src/index.ts

packages/adapter-confluence/          # storage XHTML → Document IR (신규)
  src/normalize.ts                    # CDATA·self-closing 정규화 (HTML 파서 대비)
  src/dom.ts                          # DOMParser 래퍼 + 태그 헬퍼
  src/blocks.ts                       # Element → Block[]
  src/anchor.ts                       # xpath + textQuote 생성
  src/links.ts                        # a·ac:link → Link[]
  src/doctype.ts                      # 라벨·블루프린트 → DocType
  src/rest.ts                         # REST v1 응답 타입 + expand 문자열
  src/document.ts                     # ConfluenceContent → Document
  src/index.ts
  test/fixtures/*.xhtml, *.json

apps/extension/                       # MV3 확장 (신규)
  src/manifest.template.json
  src/shared/settings.ts              # chrome.storage 래퍼
  src/shared/messages.ts              # content ↔ sw 메시지 타입
  src/shared/report-cache.ts          # 마지막 리포트 로컬 캐시
  src/background/backend-client.ts    # fetch → LintReport, 에러 분류
  src/background/lint-runner.ts       # 2단계(룰 → LLM) 실행
  src/background/sw.ts                # 포트 배선
  src/content/page-reader.ts          # pageId 추출 + REST 조회
  src/content/link-check.ts           # 내부 링크 상태 확인
  src/content/anchor-locator.ts       # 앵커 → 렌더된 DOM 요소
  src/content/highlight.ts            # 스크롤 + 강조
  src/content/panel/render.ts         # 리포트 → HTML
  src/content/panel/styles.ts
  src/content/panel/panel.ts          # Shadow DOM 호스트 + FAB + 상태
  src/content/index.ts                # 배선
  src/options/options.html, options.ts
  scripts/build-assets.ts             # manifest 생성 + html 복사
  extension.config.json               # 사내 Confluence origin 목록
  e2e/                                # Playwright
```

---

### Task 1: `@ai-lint/contract` 패키지 추출

백엔드에만 있던 `LintReport`를 확장과 공유해야 한다. 확장이 앱 패키지(`@ai-lint/backend`)에 의존하는 것은 방향이 잘못됐으므로 계약만 따로 뺀다. 서브프로젝트 3(데스크톱 앱)도 같은 타입을 쓴다.

**Files:**
- Create: `packages/contract/package.json`, `packages/contract/tsconfig.json`, `packages/contract/src/report.ts`, `packages/contract/src/index.ts`
- Modify: `apps/backend/package.json`, `apps/backend/src/services/lint-service.ts`, `apps/backend/src/services/report-store.ts`, `apps/backend/src/routes/lint.ts`, `apps/backend/test/report-store.test.ts`
- Test: 기존 백엔드 테스트가 그대로 통과하면 된다 (계약 이동은 동작 변경이 아니다)

**Interfaces:**
- Consumes: `@ai-lint/ir`의 `DocumentSchema`, `DocType`; `@ai-lint/rules`의 `Finding`, `Score`
- Produces: `LintOptionsSchema`, `LintOptions`, `LintRequestSchema`, `LintRequest`, `LintReport`, `LlmStatus`, `LlmSkipReason`, 그리고 `Finding`/`Score`/`Grade`/`Severity`/`Axis` 타입 재수출

- [ ] **Step 1: 패키지 스캐폴드**

`packages/contract/package.json`:

```json
{
  "name": "@ai-lint/contract",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@ai-lint/ir": "workspace:*",
    "@ai-lint/rules": "workspace:*",
    "zod": "^3.24.0"
  }
}
```

`packages/contract/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

- [ ] **Step 2: 계약 정의를 옮긴다**

`packages/contract/src/report.ts` — `apps/backend/src/services/lint-service.ts` 상단에서 잘라 온다 (원본에서는 삭제):

```typescript
import { DocumentSchema, type DocType } from '@ai-lint/ir'
import type { Finding, Score } from '@ai-lint/rules'
import { z } from 'zod'

export const LintOptionsSchema = z
  .object({
    useLlm: z.boolean().default(true),
    rulesetId: z.string().min(1).default('default'),
    save: z.boolean().default(true),
  })
  .default({})

export type LintOptions = z.infer<typeof LintOptionsSchema>

export const LintRequestSchema = z.object({
  document: DocumentSchema,
  options: LintOptionsSchema,
})

export type LintRequest = z.infer<typeof LintRequestSchema>

export type LlmStatus = 'ok' | 'partial' | 'skipped' | 'failed'
export type LlmSkipReason = 'disabled' | 'quota' | 'too-large'

export interface LintReport {
  reportId: string
  documentUri: string
  documentHash: string
  docType: DocType
  rulesetId: string
  rulesetVersion: number
  score: Score
  findings: Finding[]
  stats: {
    rulesEvaluated: number
    llmFindingsRejected: number
    durationMs: number
  }
  llmStatus: LlmStatus
  llmSkipReason?: LlmSkipReason
  /** 블록 수 상한을 넘어 잘라서 검사했다 */
  truncated: boolean
  /** 같은 해시의 기존 리포트를 재사용했다 */
  cached: boolean
  createdAt: string
}
```

`packages/contract/src/index.ts`:

```typescript
export * from './report.js'
export type { Axis, DocType, Document, Finding, Grade, Score, Severity, SourceAnchor } from '@ai-lint/rules'
```

- [ ] **Step 3: 백엔드가 계약을 참조하게 고친다**

`apps/backend/package.json` dependencies에 `"@ai-lint/contract": "workspace:*"` 추가.

`apps/backend/src/services/lint-service.ts`: 옮긴 정의를 지우고 상단 import를 바꾼다.

```typescript
import type { LintOptions, LintReport, LlmSkipReason } from '@ai-lint/contract'
```

`LintRequestSchema`는 이 파일에서 쓰지 않으므로 import하지 않는다 — `routes/lint.ts`가 `@ai-lint/contract`에서 직접 가져오게 고친다:

```typescript
import { LintRequestSchema } from '@ai-lint/contract'
import { lintDocument, type LintDeps } from '../services/lint-service.js'
```

`apps/backend/src/services/report-store.ts`: `import type { LintReport } from './lint-service.js'` → `import type { LintReport } from '@ai-lint/contract'`.

`apps/backend/test/report-store.test.ts`: `import type { LintReport } from '../src/services/lint-service.js'` → `import type { LintReport } from '@ai-lint/contract'`.

- [ ] **Step 4: 설치와 검증**

```bash
pnpm install
pnpm vitest run
pnpm turbo typecheck
```

Expected: 기존 289개 테스트 전부 통과, typecheck 5개 태스크 성공(contract 추가).

- [ ] **Step 5: 커밋**

```bash
git add packages/contract apps/backend package.json pnpm-lock.yaml
git commit -m "refactor: extract lint API contract into shared package

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: storage XHTML 정규화와 DOM 헬퍼

Confluence storage format을 HTML 파서로 읽을 때 두 가지가 조용히 깨진다. 하나는 `<![CDATA[...]]>` — HTML 파서는 이걸 주석으로 버려서 코드 매크로 본문이 통째로 사라진다. 다른 하나는 `<ri:attachment ... />` 같은 self-closing 커스텀 태그 — HTML에는 self-closing 개념이 없어서 뒤따르는 형제 요소를 자식으로 삼켜버린다. 파싱 전에 문자열 단계에서 둘 다 없앤다.

**Files:**
- Create: `packages/adapter-confluence/package.json`, `tsconfig.json`, `src/normalize.ts`, `src/dom.ts`
- Test: `packages/adapter-confluence/test/normalize.test.ts`, `packages/adapter-confluence/test/dom.test.ts`

**Interfaces:**
- Produces: `normalizeStorage(xhtml: string): string`, `parseStorage(xhtml: string): Element`, `tagOf(el: Element): string`, `childrenOf(el: Element, tag: string): Element[]`, `childOf(el: Element, tag: string): Element | null`, `findDescendants(root: Element, tag: string): Element[]`, `findDescendant(root: Element, tag: string): Element | null`, `textOf(node: Node): string`

- [ ] **Step 1: 패키지 스캐폴드**

`packages/adapter-confluence/package.json`:

```json
{
  "name": "@ai-lint/adapter-confluence",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@ai-lint/ir": "workspace:*"
  },
  "devDependencies": {
    "happy-dom": "^15.11.0"
  }
}
```

`packages/adapter-confluence/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM"]
  },
  "include": ["src", "test"]
}
```

`pnpm install`

- [ ] **Step 2: 정규화 테스트를 쓴다**

`packages/adapter-confluence/test/normalize.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { normalizeStorage } from '../src/normalize.js'

describe('normalizeStorage', () => {
  it('CDATA 본문을 텍스트로 바꾼다', () => {
    const out = normalizeStorage('<ac:plain-text-body><![CDATA[const a = 1 < 2]]></ac:plain-text-body>')
    expect(out).toBe('<ac:plain-text-body>const a = 1 &lt; 2</ac:plain-text-body>')
  })

  it('self-closing 커스텀 태그를 짝 있는 태그로 편다', () => {
    const out = normalizeStorage('<ac:image><ri:attachment ri:filename="a.png"/></ac:image>')
    expect(out).toBe('<ac:image><ri:attachment ri:filename="a.png"></ri:attachment></ac:image>')
  })

  it('속성값 안의 슬래시를 태그 끝으로 오인하지 않는다', () => {
    const out = normalizeStorage('<ri:url ri:value="https://x.test/a"/>')
    expect(out).toBe('<ri:url ri:value="https://x.test/a"></ri:url>')
  })

  it('CDATA 안의 마크업은 건드리지 않는다', () => {
    const out = normalizeStorage('<ac:plain-text-body><![CDATA[<ri:x/>]]></ac:plain-text-body>')
    expect(out).toBe('<ac:plain-text-body>&lt;ri:x/&gt;</ac:plain-text-body>')
  })

  it('일반 XHTML은 그대로 둔다', () => {
    const input = '<p>안녕</p><br/>'
    expect(normalizeStorage(input)).toBe(input)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm vitest run packages/adapter-confluence`
Expected: FAIL — `Cannot find module '../src/normalize.js'`

- [ ] **Step 4: 정규화를 구현한다**

`packages/adapter-confluence/src/normalize.ts`:

```typescript
/** 속성값 안의 따옴표를 건너뛰며 `/>`까지 읽는다. ac:·ri: 네임스페이스 태그만 대상으로 한다. */
const SELF_CLOSING = /<((?:ac|ri):[\w-]+)((?:[^>"']|"[^"]*"|'[^']*')*?)\/>/g
const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g

const escapeText = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * storage format을 HTML 파서에 넣기 전에 손본다.
 * CDATA는 HTML 파서가 주석으로 버리고, self-closing 커스텀 태그는 뒤 형제를 자식으로 삼킨다.
 * 먼저 CDATA를 처리해야 그 안의 마크업이 두 번째 치환에 걸리지 않는다.
 */
export function normalizeStorage(xhtml: string): string {
  return xhtml
    .replace(CDATA, (_match, text: string) => escapeText(text))
    .replace(SELF_CLOSING, (_match, tag: string, attrs: string) => `<${tag}${attrs}></${tag}>`)
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm vitest run packages/adapter-confluence`
Expected: PASS (5 tests)

- [ ] **Step 6: DOM 헬퍼 테스트를 쓴다**

`packages/adapter-confluence/test/dom.test.ts` — 첫 줄 docblock이 happy-dom 환경을 켠다:

```typescript
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { childOf, childrenOf, findDescendant, parseStorage, tagOf, textOf } from '../src/dom.js'

describe('parseStorage', () => {
  it('네임스페이스 태그 이름을 소문자 콜론 형태로 유지한다', () => {
    const root = parseStorage('<ac:structured-macro ac:name="info"></ac:structured-macro>')
    const first = root.children[0]!
    expect(tagOf(first)).toBe('ac:structured-macro')
    expect(first.getAttribute('ac:name')).toBe('info')
  })

  it('self-closing 태그가 형제를 삼키지 않는다', () => {
    const root = parseStorage('<ac:link><ri:page ri:content-title="대상"/><ac:link-body>본문</ac:link-body></ac:link>')
    const link = root.children[0]!
    expect(childrenOf(link, 'ri:page')).toHaveLength(1)
    expect(childOf(link, 'ac:link-body')?.textContent).toBe('본문')
  })

  it('findDescendant는 중첩된 요소를 찾는다', () => {
    const root = parseStorage('<div><section><table><tr><td>값</td></tr></table></section></div>')
    expect(findDescendant(root, 'td')?.textContent).toBe('값')
  })

  it('textOf는 공백을 접고 다듬는다', () => {
    const root = parseStorage('<p>  여러   줄\n  텍스트 </p>')
    expect(textOf(root.children[0]!)).toBe('여러 줄 텍스트')
  })
})
```

- [ ] **Step 7: 실패 확인**

Run: `pnpm vitest run packages/adapter-confluence/test/dom.test.ts`
Expected: FAIL — `Cannot find module '../src/dom.js'`

- [ ] **Step 8: DOM 헬퍼를 구현한다**

`packages/adapter-confluence/src/dom.ts`:

```typescript
import { normalizeStorage } from './normalize.js'

/**
 * storage format을 text/html로 읽는다.
 * XML 파서를 쓰면 ac:·ri: 접두사가 선언되지 않아서, `&nbsp;` 같은 엔티티에서도 통째로 실패한다.
 * HTML 파서는 관대하고 태그 이름에 콜론을 그대로 둔다.
 */
export function parseStorage(xhtml: string): Element {
  const parsed = new DOMParser().parseFromString(normalizeStorage(xhtml), 'text/html')
  return parsed.body
}

export const tagOf = (el: Element): string => el.localName.toLowerCase()

export const childrenOf = (el: Element, tag: string): Element[] =>
  Array.from(el.children).filter((child) => tagOf(child) === tag)

export const childOf = (el: Element, tag: string): Element | null => childrenOf(el, tag)[0] ?? null

/** querySelector는 `ac:image` 같은 이름을 셀렉터로 못 받으므로 직접 훑는다. */
export function findDescendants(root: Element, tag: string): Element[] {
  const found: Element[] = []
  const visit = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      if (tagOf(child) === tag) found.push(child)
      visit(child)
    }
  }
  visit(root)
  return found
}

export const findDescendant = (root: Element, tag: string): Element | null => findDescendants(root, tag)[0] ?? null

export const textOf = (node: Node): string => (node.textContent ?? '').replace(/\s+/g, ' ').trim()
```

- [ ] **Step 9: 통과 확인**

Run: `pnpm vitest run packages/adapter-confluence`
Expected: PASS (9 tests)

- [ ] **Step 10: 커밋**

```bash
git add packages/adapter-confluence pnpm-lock.yaml
git commit -m "feat(adapter-confluence): add storage format normalizer and DOM helpers

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 블록 추출

storage XHTML의 요소를 IR 블록으로 옮긴다. 이 단계에서는 앵커를 채우지 않는다 — 앵커는 앞뒤 블록 텍스트가 필요해서 Task 4에서 두 번째 패스로 채운다.

**Files:**
- Create: `packages/adapter-confluence/src/blocks.ts`
- Test: `packages/adapter-confluence/test/blocks.test.ts`

**Interfaces:**
- Consumes: `dom.ts`의 헬퍼 전부
- Produces: `extractBlocks(root: Element): Extracted` where `interface Extracted { blocks: Block[]; elements: Element[] }` — `blocks[i]`와 `elements[i]`가 같은 대상을 가리킨다. 이 시점의 `block.anchor`는 자리표시자다.

- [ ] **Step 1: 테스트를 쓴다**

`packages/adapter-confluence/test/blocks.test.ts`:

```typescript
// @vitest-environment happy-dom
import type { BlockOfKind } from '@ai-lint/ir'
import { describe, expect, it } from 'vitest'
import { extractBlocks } from '../src/blocks.js'
import { parseStorage } from '../src/dom.js'

const blocksOf = (xhtml: string) => extractBlocks(parseStorage(xhtml)).blocks
const kindOf = <K extends string>(xhtml: string, index: number) => blocksOf(xhtml)[index] as BlockOfKind<K & never>

describe('extractBlocks', () => {
  it('제목과 문단을 순서대로 뽑는다', () => {
    const blocks = blocksOf('<h1>배경</h1><p>본문입니다</p>')
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph'])
    expect(blocks[0]).toMatchObject({ id: 'b1', kind: 'heading', level: 1, text: '배경' })
    expect(blocks[1]).toMatchObject({ id: 'b2', kind: 'paragraph', text: '본문입니다' })
  })

  it('빈 문단은 버린다', () => {
    expect(blocksOf('<p>&nbsp;</p><p></p><p>내용</p>')).toHaveLength(1)
  })

  it('제목 계층으로 path를 매긴다', () => {
    const blocks = blocksOf('<h1>가</h1><p>1</p><h2>나</h2><p>2</p><h1>다</h1><p>3</p>')
    expect(blocks.map((b) => b.path)).toEqual([[1], [1], [1, 1], [1, 1], [2], [2]])
  })

  it('건너뛴 제목 레벨에도 path를 만든다', () => {
    const blocks = blocksOf('<h2>가</h2><h4>나</h4>')
    expect(blocks.map((b) => b.path)).toEqual([[0, 1], [0, 1, 0, 1]])
  })

  it('중첩 목록을 depth가 다른 별도 블록으로 나눈다', () => {
    const blocks = blocksOf('<ul><li>상위<ul><li>하위</li></ul></li></ul>')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: false, items: ['상위'], depth: 1 })
    expect(blocks[1]).toMatchObject({ kind: 'list', items: ['하위'], depth: 2 })
  })

  it('표에서 헤더 행과 본문 행을 나눈다', () => {
    const blocks = blocksOf('<table><tbody><tr><th>이름</th><th>값</th></tr><tr><td>a</td><td>1</td></tr></tbody></table>')
    expect(blocks[0]).toMatchObject({
      kind: 'table',
      headers: ['이름', '값'],
      rows: [['a', '1']],
      isLayoutTable: false,
    })
  })

  it('헤더 없이 셀이 둘뿐인 표를 레이아웃 표로 표시한다', () => {
    const blocks = blocksOf('<table><tbody><tr><td>왼쪽</td><td>오른쪽</td></tr></tbody></table>')
    expect(blocks[0]).toMatchObject({ kind: 'table', headers: [], isLayoutTable: true })
  })

  it('code 매크로를 언어와 함께 코드 블록으로 바꾼다', () => {
    const blocks = blocksOf(
      '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">java</ac:parameter><ac:plain-text-body><![CDATA[int a = 1;]]></ac:plain-text-body></ac:structured-macro>',
    )
    expect(blocks[0]).toMatchObject({ kind: 'code', lang: 'java', text: 'int a = 1;' })
  })

  it('info 매크로를 callout으로 바꾼다', () => {
    const blocks = blocksOf(
      '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>주의사항</p></ac:rich-text-body></ac:structured-macro>',
    )
    expect(blocks[0]).toMatchObject({ kind: 'callout', variant: 'info', text: '주의사항' })
  })

  it('expand 매크로는 껍데기를 벗기고 안쪽을 그대로 올린다', () => {
    const blocks = blocksOf(
      '<ac:structured-macro ac:name="expand"><ac:rich-text-body><h2>안쪽</h2><p>내용</p></ac:rich-text-body></ac:structured-macro>',
    )
    expect(blocks.map((b) => b.kind)).toEqual(['heading', 'paragraph'])
  })

  it('본문을 추출하지 못한 매크로는 renderedText 없이 macro 블록으로 남긴다', () => {
    const blocks = blocksOf('<ac:structured-macro ac:name="drawio"><ac:parameter ac:name="diagramName">arch</ac:parameter></ac:structured-macro>')
    expect(blocks[0]).toMatchObject({ kind: 'macro', name: 'drawio', params: { diagramName: 'arch' } })
    expect(blocks[0]).not.toHaveProperty('renderedText')
  })

  it('첨부 이미지의 파일명과 alt를 가져온다', () => {
    const blocks = blocksOf('<p><ac:image ac:alt="구성도"><ri:attachment ri:filename="arch.png"/></ac:image></p>')
    expect(blocks[0]).toMatchObject({ kind: 'image', assetRef: 'arch.png', alt: '구성도' })
  })

  it('문단 안의 텍스트와 이미지를 둘 다 남긴다', () => {
    const blocks = blocksOf('<p>설명<ac:image><ri:url ri:value="https://x.test/a.png"/></ac:image></p>')
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'image'])
    expect(blocks[1]).toMatchObject({ assetRef: 'https://x.test/a.png' })
  })

  it('레이아웃 div는 껍데기만 벗기고 안쪽을 올린다', () => {
    const blocks = blocksOf('<div class="contentLayout"><div class="columnMacro"><p>안쪽</p></div></div>')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ kind: 'paragraph', text: '안쪽' })
  })

  it('elements와 blocks가 같은 순서로 짝지어진다', () => {
    const { blocks, elements } = extractBlocks(parseStorage('<h1>가</h1><p>나</p>'))
    expect(elements).toHaveLength(blocks.length)
    expect(elements[1]?.textContent).toBe('나')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/adapter-confluence/test/blocks.test.ts`
Expected: FAIL — `Cannot find module '../src/blocks.js'`

- [ ] **Step 3: 구현한다**

`packages/adapter-confluence/src/blocks.ts`:

```typescript
import type { Block, SourceAnchor } from '@ai-lint/ir'
import { childOf, childrenOf, findDescendants, tagOf, textOf } from './dom.js'

export interface Extracted {
  blocks: Block[]
  /** blocks[i]를 만들어낸 요소. 앵커 계산에 쓴다. */
  elements: Element[]
}

/** Omit을 그냥 쓰면 판별 유니온이 공통 필드만 남기고 뭉개진다. 각 갈래에 따로 적용한다. */
type BlockBody = Block extends infer B ? (B extends Block ? Omit<B, 'id' | 'path' | 'anchor'> : never) : never

/** 앵커는 앞뒤 블록 텍스트가 있어야 만들 수 있어서 두 번째 패스에서 채운다. */
const PLACEHOLDER: SourceAnchor = { kind: 'confluence', xpath: '', textQuote: { exact: '?' } }

const HEADINGS: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 }
const CALLOUT_MACROS = new Set(['info', 'note', 'warning', 'tip', 'panel'])
/** 내용을 감싸기만 하는 매크로. 껍데기를 벗기고 안쪽을 문서 본문으로 취급한다. */
const CONTAINER_MACROS = new Set(['expand', 'section', 'column', 'div', 'align'])

interface Walker {
  blocks: Block[]
  elements: Element[]
  /** 제목 레벨별 등장 순번. path 계산용 */
  counters: number[]
}

export function extractBlocks(root: Element): Extracted {
  const walker: Walker = { blocks: [], elements: [], counters: [] }
  walkChildren(root, walker, 1)
  return { blocks: walker.blocks, elements: walker.elements }
}

function add(walker: Walker, el: Element, body: BlockBody): void {
  walker.blocks.push({
    ...body,
    id: `b${walker.blocks.length + 1}`,
    path: [...walker.counters],
    anchor: PLACEHOLDER,
  } as Block)
  walker.elements.push(el)
}

function walkChildren(parent: Element, walker: Walker, listDepth: number): void {
  for (const el of Array.from(parent.children)) visit(el, walker, listDepth)
}

function visit(el: Element, walker: Walker, listDepth: number): void {
  const tag = tagOf(el)
  const level = HEADINGS[tag]
  if (level !== undefined) {
    addHeading(walker, el, level)
    return
  }

  switch (tag) {
    case 'p':
      addParagraph(walker, el)
      return
    case 'ul':
    case 'ol':
      addList(walker, el, tag === 'ol', listDepth)
      return
    case 'table':
      addTable(walker, el)
      return
    case 'pre': {
      const text = el.textContent ?? ''
      if (text.trim()) add(walker, el, { kind: 'code', text })
      return
    }
    case 'blockquote': {
      const text = textOf(el)
      if (text) add(walker, el, { kind: 'callout', variant: 'quote', text })
      return
    }
    case 'ac:structured-macro':
      addMacro(walker, el, listDepth)
      return
    case 'ac:image':
      addImage(walker, el)
      return
    case 'img':
      add(walker, el, {
        kind: 'image',
        assetRef: el.getAttribute('src') ?? '(알 수 없는 이미지)',
        ...optional('alt', el.getAttribute('alt')),
      })
      return
    case 'hr':
    case 'br':
      return
    default:
      walkChildren(el, walker, listDepth)
  }
}

const optional = <K extends string>(key: K, value: string | null | undefined): Record<K, string> | Record<never, never> =>
  value ? ({ [key]: value } as Record<K, string>) : {}

function addHeading(walker: Walker, el: Element, level: 1 | 2 | 3 | 4 | 5 | 6): void {
  while (walker.counters.length < level) walker.counters.push(0)
  walker.counters.length = level
  walker.counters[level - 1] = (walker.counters[level - 1] ?? 0) + 1
  add(walker, el, { kind: 'heading', level, text: textOf(el) })
}

/**
 * 본문이 없는 ac:link를 Confluence는 대상 제목으로 렌더한다.
 * storage의 textContent만 보면 그런 문단이 통째로 사라진다.
 */
function linkLabelsOf(el: Element): string {
  return findDescendants(el, 'ac:link')
    .map((link) => {
      const page = childOf(link, 'ri:page')
      const attachment = childOf(link, 'ri:attachment')
      return page?.getAttribute('ri:content-title') ?? attachment?.getAttribute('ri:filename') ?? ''
    })
    .filter(Boolean)
    .join(' ')
}

function addParagraph(walker: Walker, el: Element): void {
  const images = findDescendants(el, 'ac:image')
  const text = textOf(el) || linkLabelsOf(el)
  if (text) add(walker, el, { kind: 'paragraph', text })
  for (const image of images) addImage(walker, image)
}

function addList(walker: Walker, el: Element, ordered: boolean, depth: number): void {
  const items: string[] = []
  const nested: Element[] = []

  for (const li of childrenOf(el, 'li')) {
    const sublists = Array.from(li.children).filter((child) => tagOf(child) === 'ul' || tagOf(child) === 'ol')
    nested.push(...sublists)
    const clone = li.cloneNode(true) as Element
    for (const child of Array.from(clone.children)) {
      if (tagOf(child) === 'ul' || tagOf(child) === 'ol') child.remove()
    }
    const text = textOf(clone)
    if (text) items.push(text)
  }

  if (items.length > 0) add(walker, el, { kind: 'list', ordered, items, depth })
  for (const sublist of nested) addList(walker, sublist, tagOf(sublist) === 'ol', depth + 1)
}

function addTable(walker: Walker, el: Element): void {
  const headers: string[] = []
  const rows: string[][] = []

  findDescendants(el, 'tr').forEach((tr, index) => {
    const cells = Array.from(tr.children).filter((cell) => tagOf(cell) === 'th' || tagOf(cell) === 'td')
    if (cells.length === 0) return
    const values = cells.map(textOf)
    if (index === 0 && cells.every((cell) => tagOf(cell) === 'th')) headers.push(...values)
    else rows.push(values)
  })

  const width = Math.max(headers.length, ...rows.map((row) => row.length), 0)
  const caption = childOf(el, 'caption')

  add(walker, el, {
    kind: 'table',
    headers,
    rows,
    isLayoutTable: headers.length === 0 && width <= 2 && rows.length <= 2,
    ...optional('caption', caption ? textOf(caption) : null),
  })
}

function addMacro(walker: Walker, el: Element, listDepth: number): void {
  const name = (el.getAttribute('ac:name') ?? '').toLowerCase()
  const params: Record<string, string> = {}
  for (const param of childrenOf(el, 'ac:parameter')) {
    const key = param.getAttribute('ac:name')
    if (key) params[key] = textOf(param)
  }

  const plain = childOf(el, 'ac:plain-text-body')
  const rich = childOf(el, 'ac:rich-text-body')

  if (name === 'code') {
    const text = plain?.textContent ?? ''
    if (text.trim()) add(walker, el, { kind: 'code', text, ...optional('lang', params['language']) })
    return
  }

  if (rich && CONTAINER_MACROS.has(name)) {
    walkChildren(rich, walker, listDepth)
    return
  }

  if (rich && CALLOUT_MACROS.has(name)) {
    const text = textOf(rich)
    if (text) add(walker, el, { kind: 'callout', variant: name, text })
    return
  }

  // 본문 요소가 없으면 렌더 텍스트도 없다. el을 그대로 읽으면 파라미터 값이 본문으로 둔갑한다.
  const body = rich ?? plain
  add(walker, el, { kind: 'macro', name, params, ...optional('renderedText', body ? textOf(body) : null) })
}

function addImage(walker: Walker, el: Element): void {
  const attachment = childOf(el, 'ri:attachment')
  const url = childOf(el, 'ri:url')
  const caption = childOf(el, 'ac:caption')

  add(walker, el, {
    kind: 'image',
    assetRef: attachment?.getAttribute('ri:filename') ?? url?.getAttribute('ri:value') ?? '(알 수 없는 이미지)',
    ...optional('alt', el.getAttribute('ac:alt')),
    ...optional('caption', caption ? textOf(caption) : null),
  })
}
```

`add()`의 `as Block`은 분해된 유니온을 다시 합칠 때 TypeScript가 판별자를 잃기 때문에 필요하다. 다른 곳에서는 캐스트를 쓰지 않는다.

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run packages/adapter-confluence/test/blocks.test.ts`
Expected: PASS (15 tests)

`kindOf` 헬퍼를 테스트에서 쓰지 않았다면 지운다 — 쓰지 않는 코드는 남기지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add packages/adapter-confluence
git commit -m "feat(adapter-confluence): extract IR blocks from storage XHTML

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 앵커 생성

블록마다 원본 위치를 되짚을 수 있는 `SourceAnchor`를 만든다. xpath는 렌더된 DOM이 storage와 구조가 같을 때만 맞으므로 **네임스페이스 태그가 경로에 끼면 xpath를 포기하고 빈 문자열을 넣는다**. 그 경우 확장은 textQuote로만 찾는다.

**Files:**
- Create: `packages/adapter-confluence/src/anchor.ts`
- Test: `packages/adapter-confluence/test/anchor.test.ts`

**Interfaces:**
- Consumes: `extractBlocks`의 `Extracted`
- Produces: `attachAnchors(blocks: Block[], elements: Element[], root: Element): void` (제자리 수정), `xpathOf(el: Element, root: Element): string`, `quoteTextFor(block: Block): string`

- [ ] **Step 1: 테스트를 쓴다**

`packages/adapter-confluence/test/anchor.test.ts`:

```typescript
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { attachAnchors, xpathOf } from '../src/anchor.js'
import { extractBlocks } from '../src/blocks.js'
import { parseStorage } from '../src/dom.js'

const anchored = (xhtml: string) => {
  const root = parseStorage(xhtml)
  const { blocks, elements } = extractBlocks(root)
  attachAnchors(blocks, elements, root)
  return blocks
}

describe('xpathOf', () => {
  it('같은 태그가 하나뿐이면 인덱스를 붙이지 않는다', () => {
    const root = parseStorage('<h1>가</h1><p>나</p>')
    expect(xpathOf(root.children[0]!, root)).toBe('./h1')
  })

  it('같은 태그가 여럿이면 1부터 세는 인덱스를 붙인다', () => {
    const root = parseStorage('<p>가</p><p>나</p>')
    expect(xpathOf(root.children[1]!, root)).toBe('./p[2]')
  })

  it('중첩 경로를 이어 붙인다', () => {
    const root = parseStorage('<div><p>가</p><p>나</p></div>')
    const target = root.children[0]!.children[1]!
    expect(xpathOf(target, root)).toBe('./div/p[2]')
  })

  it('네임스페이스 태그가 끼면 xpath를 포기한다', () => {
    const root = parseStorage('<ac:structured-macro ac:name="info"><ac:rich-text-body><p>가</p></ac:rich-text-body></ac:structured-macro>')
    const target = root.children[0]!.children[0]!.children[0]!
    expect(xpathOf(target, root)).toBe('')
  })
})

describe('attachAnchors', () => {
  it('블록 텍스트를 exact로 쓰고 앞뒤 블록을 문맥으로 붙인다', () => {
    const blocks = anchored('<h1>배경</h1><p>본문입니다</p><h2>결정</h2>')
    const anchor = blocks[1]!.anchor
    expect(anchor.kind).toBe('confluence')
    if (anchor.kind !== 'confluence') throw new Error('unreachable')
    expect(anchor.textQuote.exact).toBe('본문입니다')
    expect(anchor.textQuote.prefix).toBe('배경')
    expect(anchor.textQuote.suffix).toBe('결정')
    expect(anchor.xpath).toBe('./p')
  })

  it('긴 문단은 exact를 잘라 담는다', () => {
    const long = '가'.repeat(300)
    const blocks = anchored(`<p>${long}</p>`)
    const anchor = blocks[0]!.anchor
    if (anchor.kind !== 'confluence') throw new Error('unreachable')
    expect(anchor.textQuote.exact).toHaveLength(120)
  })

  it('텍스트가 없는 블록도 exact를 비우지 않는다', () => {
    const blocks = anchored('<p><ac:image><ri:attachment ri:filename="arch.png"/></ac:image></p>')
    const anchor = blocks[0]!.anchor
    if (anchor.kind !== 'confluence') throw new Error('unreachable')
    expect(anchor.textQuote.exact).toBe('arch.png')
  })

  it('첫 블록에는 prefix가 없다', () => {
    const blocks = anchored('<p>처음</p><p>다음</p>')
    const anchor = blocks[0]!.anchor
    if (anchor.kind !== 'confluence') throw new Error('unreachable')
    expect(anchor.textQuote.prefix).toBeUndefined()
    expect(anchor.textQuote.suffix).toBe('다음')
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/adapter-confluence/test/anchor.test.ts`
Expected: FAIL — `Cannot find module '../src/anchor.js'`

- [ ] **Step 3: 구현한다**

`packages/adapter-confluence/src/anchor.ts`:

```typescript
import type { Block, TextQuote } from '@ai-lint/ir'
import { tagOf } from './dom.js'

const QUOTE_MAX = 120
const CONTEXT_MAX = 30

/**
 * 렌더된 DOM에서 되찾기 위한 상대 xpath.
 * 네임스페이스 접두사가 붙은 스텝은 xpath 평가에서 접두사 미해석으로 예외가 나므로 아예 만들지 않는다.
 * 그런 블록은 textQuote 검색으로만 찾는다.
 */
export function xpathOf(el: Element, root: Element): string {
  const steps: string[] = []
  let current: Element | null = el

  while (current !== null && current !== root) {
    const parent: Element | null = current.parentElement
    if (parent === null) break
    const tag = tagOf(current)
    if (tag.includes(':')) return ''
    const siblings = Array.from(parent.children).filter((child) => tagOf(child) === tag)
    const index = siblings.indexOf(current) + 1
    steps.unshift(siblings.length > 1 ? `${tag}[${index}]` : tag)
    current = parent
  }

  return steps.length > 0 ? `./${steps.join('/')}` : ''
}

/**
 * 블록에서 인용할 텍스트. 본문이 없는 블록도 빈 문자열을 내면 안 된다 (스키마가 1자 이상을 요구한다).
 * `@ai-lint/ir`의 blockText를 쓰지 않는다 — 값 import는 zod를 확장 번들로 끌고 들어온다.
 */
export function quoteTextFor(block: Block): string {
  const raw = ((): string => {
    switch (block.kind) {
      case 'heading':
      case 'paragraph':
      case 'code':
      case 'callout':
        return block.text
      case 'list':
        return block.items.join(' ')
      case 'table':
        return [...block.headers, ...block.rows.flat()].join(' ')
      case 'image':
        return block.alt ?? block.caption ?? block.assetRef
      case 'macro':
        return block.renderedText ?? block.name
      default:
        return block.kind
    }
  })()

  return raw.replace(/\s+/g, ' ').trim() || block.kind
}

const quoteOf = (block: Block | undefined): string => (block ? quoteTextFor(block) : '')

function textQuoteFor(blocks: Block[], index: number): TextQuote {
  const exact = quoteTextFor(blocks[index]!).slice(0, QUOTE_MAX)
  const prefix = quoteOf(blocks[index - 1]).slice(-CONTEXT_MAX)
  const suffix = quoteOf(blocks[index + 1]).slice(0, CONTEXT_MAX)
  return {
    exact,
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  }
}

export function attachAnchors(blocks: Block[], elements: Element[], root: Element): void {
  blocks.forEach((block, index) => {
    const el = elements[index]
    block.anchor = {
      kind: 'confluence',
      xpath: el ? xpathOf(el, root) : '',
      textQuote: textQuoteFor(blocks, index),
    }
  })
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run packages/adapter-confluence/test/anchor.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/adapter-confluence
git commit -m "feat(adapter-confluence): build source anchors with xpath and text quote

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 링크 추출과 문서 유형 판정

**Files:**
- Create: `packages/adapter-confluence/src/links.ts`, `packages/adapter-confluence/src/doctype.ts`
- Test: `packages/adapter-confluence/test/links.test.ts`, `packages/adapter-confluence/test/doctype.test.ts`

**Interfaces:**
- Produces:
  - `extractLinks(blocks: Block[], elements: Element[], ctx: LinkContext): Link[]` where `interface LinkContext { baseUrl: string; pageId: string; spaceKey?: string }`
  - `detectDocType(labels: string[], properties: Record<string, unknown>): Document['docType']`

- [ ] **Step 1: 링크 테스트를 쓴다**

`packages/adapter-confluence/test/links.test.ts`:

```typescript
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { extractBlocks } from '../src/blocks.js'
import { parseStorage } from '../src/dom.js'
import { extractLinks } from '../src/links.js'

const ctx = { baseUrl: 'https://wiki.test', pageId: '123', spaceKey: 'ENG' }

const linksOf = (xhtml: string) => {
  const root = parseStorage(xhtml)
  const { blocks, elements } = extractBlocks(root)
  return extractLinks(blocks, elements, ctx)
}

describe('extractLinks', () => {
  it('앵커 태그를 블록에 묶어 뽑는다', () => {
    const links = linksOf('<p>본문 <a href="https://external.test/a">외부 문서</a></p>')
    expect(links).toEqual([
      { blockId: 'b1', text: '외부 문서', href: 'https://external.test/a', target: 'external', status: 'unchecked' },
    ])
  })

  it('같은 위키 주소와 상대 경로를 내부로 분류한다', () => {
    const links = linksOf('<p><a href="/display/ENG/Home">홈</a><a href="https://wiki.test/x">엑스</a></p>')
    expect(links.map((l) => l.target)).toEqual(['internal', 'internal'])
  })

  it('첨부 다운로드 경로를 attachment로 분류한다', () => {
    const links = linksOf('<p><a href="/download/attachments/123/spec.pptx">스펙</a></p>')
    expect(links[0]?.target).toBe('attachment')
  })

  it('문서 내 앵커를 anchor로 분류한다', () => {
    expect(linksOf('<p><a href="#section-2">아래</a></p>')[0]?.target).toBe('anchor')
  })

  it('ac:link의 대상 페이지 제목을 resolvedTitle로 남긴다', () => {
    const links = linksOf(
      '<p><ac:link><ri:page ri:content-title="결제 설계"/><ac:plain-text-link-body>설계 문서</ac:plain-text-link-body></ac:link></p>',
    )
    expect(links[0]).toMatchObject({
      text: '설계 문서',
      target: 'internal',
      resolvedTitle: '결제 설계',
      href: '/display/ENG/%EA%B2%B0%EC%A0%9C%20%EC%84%A4%EA%B3%84',
    })
  })

  it('링크 본문이 없으면 대상 제목을 텍스트로 쓴다', () => {
    const links = linksOf('<p><ac:link><ri:page ri:content-title="결제 설계"/></ac:link></p>')
    expect(links[0]?.text).toBe('결제 설계')
  })

  it('ac:link의 첨부 참조를 첨부 링크로 만든다', () => {
    const links = linksOf('<p><ac:link><ri:attachment ri:filename="회의록.pptx"/></ac:link></p>')
    expect(links[0]).toMatchObject({
      target: 'attachment',
      text: '회의록.pptx',
      href: '/download/attachments/123/%ED%9A%8C%EC%9D%98%EB%A1%9D.pptx',
    })
  })

  it('사용자 멘션은 링크로 세지 않는다', () => {
    expect(linksOf('<p><ac:link><ri:user ri:userkey="abc"/></ac:link></p>')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run packages/adapter-confluence/test/links.test.ts`
Expected: FAIL — `Cannot find module '../src/links.js'`

- [ ] **Step 3: 링크 추출을 구현한다**

`packages/adapter-confluence/src/links.ts`:

```typescript
import type { Block, Link } from '@ai-lint/ir'
import { childOf, findDescendants, textOf } from './dom.js'

export interface LinkContext {
  baseUrl: string
  pageId: string
  spaceKey?: string
}

const ATTACHMENT_PATH = /\/download\/(attachments|thumbnails)\//

function classify(href: string, baseUrl: string): Link['target'] {
  if (href.startsWith('#')) return 'anchor'
  if (ATTACHMENT_PATH.test(href)) return 'attachment'
  if (href.startsWith('/')) return 'internal'
  if (baseUrl && href.startsWith(baseUrl)) return 'internal'
  return 'external'
}

const attachmentHref = (ctx: LinkContext, filename: string): string =>
  `/download/attachments/${ctx.pageId}/${encodeURIComponent(filename)}`

const pageHref = (ctx: LinkContext, space: string, title: string): string =>
  `/display/${space}/${encodeURIComponent(title)}`

function fromAnchorTag(el: Element, blockId: string, ctx: LinkContext): Link | null {
  const href = el.getAttribute('href')
  if (!href) return null
  return {
    blockId,
    text: textOf(el),
    href,
    target: classify(href, ctx.baseUrl),
    status: 'unchecked',
  }
}

/** ac:link는 href가 없다. 참조 대상(ri:page·ri:attachment)에서 주소를 만들어 낸다. */
function fromAcLink(el: Element, blockId: string, ctx: LinkContext): Link | null {
  const body = childOf(el, 'ac:plain-text-link-body') ?? childOf(el, 'ac:link-body')
  const bodyText = body ? textOf(body) : ''

  const page = childOf(el, 'ri:page')
  if (page) {
    const title = page.getAttribute('ri:content-title') ?? ''
    const space = page.getAttribute('ri:space-key') ?? ctx.spaceKey ?? ''
    return {
      blockId,
      text: bodyText || title,
      href: pageHref(ctx, space, title),
      target: 'internal',
      ...(title ? { resolvedTitle: title } : {}),
      status: 'unchecked',
    }
  }

  const attachment = childOf(el, 'ri:attachment')
  if (attachment) {
    const filename = attachment.getAttribute('ri:filename') ?? ''
    return {
      blockId,
      text: bodyText || filename,
      href: attachmentHref(ctx, filename),
      target: 'attachment',
      status: 'unchecked',
    }
  }

  return null
}

export function extractLinks(blocks: Block[], elements: Element[], ctx: LinkContext): Link[] {
  const links: Link[] = []

  blocks.forEach((block, index) => {
    const el = elements[index]
    if (!el) return
    for (const tag of findDescendants(el, 'a')) {
      const link = fromAnchorTag(tag, block.id, ctx)
      if (link) links.push(link)
    }
    for (const tag of findDescendants(el, 'ac:link')) {
      const link = fromAcLink(tag, block.id, ctx)
      if (link) links.push(link)
    }
  })

  return links
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run packages/adapter-confluence/test/links.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: 문서 유형 테스트를 쓴다**

`packages/adapter-confluence/test/doctype.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { detectDocType } from '../src/doctype.js'

describe('detectDocType', () => {
  it('라벨이 매핑에 있으면 그 유형을 쓴다', () => {
    expect(detectDocType(['meeting-notes'], {})).toEqual({ value: 'meeting-notes', confidence: 0.9, origin: 'label' })
  })

  it('한글 라벨도 인식한다', () => {
    expect(detectDocType(['설계'], {}).value).toBe('design')
  })

  it('라벨 대소문자와 공백을 무시한다', () => {
    expect(detectDocType(['API Doc'], {}).value).toBe('api-doc')
  })

  it('라벨이 없으면 블루프린트 키에서 찾는다', () => {
    const properties = { blueprint: { key: 'com.atlassian.confluence.plugins:meeting-notes-blueprint' } }
    expect(detectDocType([], properties)).toEqual({ value: 'meeting-notes', confidence: 0.8, origin: 'template' })
  })

  it('라벨이 블루프린트보다 우선한다', () => {
    const properties = { blueprint: { key: 'meeting-notes-blueprint' } }
    expect(detectDocType(['설계'], properties).origin).toBe('label')
  })

  it('아무 단서도 없으면 LLM 추론에 맡긴다', () => {
    expect(detectDocType([], {})).toEqual({ value: 'unknown', confidence: 0, origin: 'llm' })
  })

  it('매핑에 없는 라벨은 무시한다', () => {
    expect(detectDocType(['2026', 'team-a'], {}).origin).toBe('llm')
  })
})
```

- [ ] **Step 6: 실패 확인**

Run: `pnpm vitest run packages/adapter-confluence/test/doctype.test.ts`
Expected: FAIL — `Cannot find module '../src/doctype.js'`

- [ ] **Step 7: 문서 유형 판정을 구현한다**

`packages/adapter-confluence/src/doctype.ts`:

```typescript
import type { DocType, Document } from '@ai-lint/ir'

/** 스펙 5.2절 2번. 사내에서 실제로 쓰는 라벨을 추가할 자리다. */
const LABEL_DOCTYPES: Record<string, DocType> = {
  'meeting-notes': 'meeting-notes',
  meetingnotes: 'meeting-notes',
  minutes: 'meeting-notes',
  retrospective: 'meeting-notes',
  회의록: 'meeting-notes',
  회의: 'meeting-notes',
  requirement: 'requirement',
  requirements: 'requirement',
  prd: 'requirement',
  요구사항: 'requirement',
  design: 'design',
  adr: 'design',
  architecture: 'design',
  설계: 'design',
  guide: 'guide',
  howto: 'guide',
  manual: 'guide',
  runbook: 'guide',
  가이드: 'guide',
  api: 'api-doc',
  'api-doc': 'api-doc',
  apidoc: 'api-doc',
  troubleshooting: 'troubleshooting',
  postmortem: 'troubleshooting',
  incident: 'troubleshooting',
  장애: 'troubleshooting',
  reference: 'reference',
  glossary: 'reference',
  policy: 'reference',
  용어집: 'reference',
}

/** 스펙 5.2절 3번. 블루프린트 키는 모듈 전체 경로로 오므로 부분 일치로 본다. */
const BLUEPRINT_DOCTYPES: Array<[string, DocType]> = [
  ['meeting-notes', 'meeting-notes'],
  ['retrospective', 'meeting-notes'],
  ['requirements', 'requirement'],
  ['decision', 'design'],
  ['how-to-article', 'guide'],
  ['troubleshooting-article', 'troubleshooting'],
]

const normalize = (label: string): string => label.trim().toLowerCase().replace(/\s+/g, '-')

export function detectDocType(labels: string[], properties: Record<string, unknown>): Document['docType'] {
  for (const label of labels) {
    const matched = LABEL_DOCTYPES[normalize(label)]
    if (matched) return { value: matched, confidence: 0.9, origin: 'label' }
  }

  const serialized = JSON.stringify(properties).toLowerCase()
  for (const [key, value] of BLUEPRINT_DOCTYPES) {
    if (serialized.includes(key)) return { value, confidence: 0.8, origin: 'template' }
  }

  // origin을 llm으로 두면 백엔드가 LLM 추론을 돌린다 (스펙 5.2절 4번).
  return { value: 'unknown', confidence: 0, origin: 'llm' }
}
```

- [ ] **Step 8: 통과 확인**

Run: `pnpm vitest run packages/adapter-confluence`
Expected: PASS (전체 38 tests)

- [ ] **Step 9: 커밋**

```bash
git add packages/adapter-confluence
git commit -m "feat(adapter-confluence): extract links and detect doc type from labels

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: REST 응답 → Document 조립

**Files:**
- Create: `packages/adapter-confluence/src/rest.ts`, `packages/adapter-confluence/src/document.ts`, `packages/adapter-confluence/src/index.ts`
- Test: `packages/adapter-confluence/test/document.test.ts`, `packages/adapter-confluence/test/fixtures/design-page.json`

**Interfaces:**
- Consumes: `extractBlocks`, `attachAnchors`, `extractLinks`, `detectDocType`
- Produces:
  - `CONTENT_EXPAND: string`
  - `interface ConfluenceContent { ... }`
  - `contentToDocument(content: ConfluenceContent, ctx: DocumentContext): Document` where `interface DocumentContext { baseUrl: string; pageUrl: string }`

- [ ] **Step 1: 픽스처를 만든다**

`packages/adapter-confluence/test/fixtures/design-page.json` — 실제 Confluence DC 응답의 축약본. 매크로·중첩표·첨부·링크를 모두 담는다:

```json
{
  "id": "789",
  "type": "page",
  "title": "결제 모듈 개편 설계",
  "space": { "key": "ENG" },
  "version": { "number": 7, "when": "2026-07-15T02:00:00.000Z", "by": { "displayName": "김편집" } },
  "history": { "createdBy": { "displayName": "박작성" } },
  "metadata": {
    "labels": { "results": [{ "name": "설계" }, { "name": "payment" }] },
    "properties": {}
  },
  "ancestors": [{ "title": "엔지니어링" }, { "title": "결제" }],
  "body": {
    "storage": {
      "value": "<h1>배경</h1><p>지난번 논의대로 3단계로 나눠서 진행하기로 했습니다.</p><ac:structured-macro ac:name=\"info\"><ac:rich-text-body><p>이 문서는 초안입니다</p></ac:rich-text-body></ac:structured-macro><h2>결정</h2><table><tbody><tr><th>단계</th><th>내용</th></tr><tr><td>1</td><td>승인 분리</td></tr></tbody></table><p>자세한 내용은 <a href=\"/display/ENG/Payment\">결제 홈</a> 참고</p><p><ac:image ac:alt=\"구성도\"><ri:attachment ri:filename=\"arch.png\"/></ac:image></p><ac:structured-macro ac:name=\"code\"><ac:parameter ac:name=\"language\">json</ac:parameter><ac:plain-text-body><![CDATA[{\"a\": 1}]]></ac:plain-text-body></ac:structured-macro>"
    }
  }
}
```

- [ ] **Step 2: 테스트를 쓴다**

`packages/adapter-confluence/test/document.test.ts`:

```typescript
// @vitest-environment happy-dom
import { DocumentSchema } from '@ai-lint/ir'
import { describe, expect, it } from 'vitest'
import { contentToDocument, type ConfluenceContent } from '../src/document.js'
import fixture from './fixtures/design-page.json' with { type: 'json' }

const content = fixture as ConfluenceContent
const ctx = { baseUrl: 'https://wiki.test', pageUrl: 'https://wiki.test/pages/viewpage.action?pageId=789' }
const doc = contentToDocument(content, ctx)

describe('contentToDocument', () => {
  it('IR 스키마를 통과한다', () => {
    expect(() => DocumentSchema.parse(doc)).not.toThrow()
  })

  it('출처와 버전 정보를 옮긴다', () => {
    expect(doc.source).toEqual({
      kind: 'confluence',
      uri: ctx.pageUrl,
      version: '7',
      modifiedAt: '2026-07-15T02:00:00.000Z',
      author: '박작성',
      space: 'ENG',
    })
  })

  it('라벨과 상위 페이지 경로를 메타데이터에 담는다', () => {
    expect(doc.metadata.labels).toEqual(['설계', 'payment'])
    expect(doc.metadata.ancestors).toEqual(['엔지니어링', '결제'])
  })

  it('라벨로 문서 유형을 판정한다', () => {
    expect(doc.docType).toEqual({ value: 'design', confidence: 0.9, origin: 'label' })
  })

  it('본문 블록을 순서대로 만든다', () => {
    expect(doc.blocks.map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'callout',
      'heading',
      'table',
      'paragraph',
      'image',
      'code',
    ])
  })

  it('모든 블록에 confluence 앵커가 붙는다', () => {
    expect(doc.blocks.every((b) => b.anchor.kind === 'confluence')).toBe(true)
  })

  it('링크를 뽑아 블록에 묶는다', () => {
    expect(doc.links).toEqual([
      { blockId: 'b6', text: '결제 홈', href: '/display/ENG/Payment', target: 'internal', status: 'unchecked' },
    ])
  })

  it('CDATA 코드 본문을 보존한다', () => {
    const code = doc.blocks.find((b) => b.kind === 'code')
    expect(code).toMatchObject({ lang: 'json', text: '{"a": 1}' })
  })

  it('본문이 비어도 문서를 만든다', () => {
    const empty = contentToDocument({ ...content, body: { storage: { value: '' } } }, ctx)
    expect(empty.blocks).toEqual([])
    expect(empty.links).toEqual([])
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm vitest run packages/adapter-confluence/test/document.test.ts`
Expected: FAIL — `Cannot find module '../src/document.js'`

- [ ] **Step 4: REST 타입을 정의한다**

`packages/adapter-confluence/src/rest.ts`:

```typescript
/** 스펙 9.2절. 이 확장 문자열이 있어야 아래 타입의 필드가 채워져 온다. */
export const CONTENT_EXPAND =
  'body.storage,version,metadata.labels,metadata.properties,ancestors,history,space'

export interface ConfluenceUser {
  displayName?: string
}

export interface ConfluenceContent {
  id: string
  title: string
  space?: { key?: string }
  version?: { number?: number; when?: string; by?: ConfluenceUser }
  history?: { createdBy?: ConfluenceUser }
  metadata?: {
    labels?: { results?: Array<{ name?: string }> }
    properties?: Record<string, unknown>
  }
  ancestors?: Array<{ title?: string }>
  body?: { storage?: { value?: string } }
}

export const contentPath = (pageId: string): string =>
  `/rest/api/content/${encodeURIComponent(pageId)}?expand=${CONTENT_EXPAND}`
```

- [ ] **Step 5: 조립을 구현한다**

`packages/adapter-confluence/src/document.ts`:

```typescript
import type { Document } from '@ai-lint/ir'
import { attachAnchors } from './anchor.js'
import { extractBlocks } from './blocks.js'
import { parseStorage } from './dom.js'
import { detectDocType } from './doctype.js'
import { extractLinks } from './links.js'
import type { ConfluenceContent } from './rest.js'

export type { ConfluenceContent }

export interface DocumentContext {
  /** Confluence 기본 주소. 링크 분류에 쓴다. */
  baseUrl: string
  /** 사용자가 보고 있는 페이지 주소. 리포트 식별자가 된다. */
  pageUrl: string
}

const compact = (values: Array<string | undefined>): string[] => values.filter((v): v is string => Boolean(v))

export function contentToDocument(content: ConfluenceContent, ctx: DocumentContext): Document {
  const root = parseStorage(content.body?.storage?.value ?? '')
  const { blocks, elements } = extractBlocks(root)
  attachAnchors(blocks, elements, root)

  const spaceKey = content.space?.key
  const links = extractLinks(blocks, elements, {
    baseUrl: ctx.baseUrl,
    pageId: content.id,
    ...(spaceKey ? { spaceKey } : {}),
  })

  const labels = compact((content.metadata?.labels?.results ?? []).map((label) => label.name))
  const ancestors = compact((content.ancestors ?? []).map((ancestor) => ancestor.title))
  const version = content.version?.number
  const modifiedAt = content.version?.when
  // 마지막 편집자가 아니라 최초 작성자를 남긴다. 오타 수정 한 번으로 담당자가 바뀌면 안 된다.
  const author = content.history?.createdBy?.displayName

  return {
    schemaVersion: 1,
    source: {
      kind: 'confluence',
      uri: ctx.pageUrl,
      ...(version !== undefined ? { version: String(version) } : {}),
      ...(modifiedAt ? { modifiedAt } : {}),
      ...(author ? { author } : {}),
      ...(spaceKey ? { space: spaceKey } : {}),
    },
    title: content.title,
    docType: detectDocType(labels, content.metadata?.properties ?? {}),
    blocks,
    links,
    metadata: {
      labels,
      ...(ancestors.length > 0 ? { ancestors } : {}),
    },
  }
}
```

- [ ] **Step 6: 진입점을 만든다**

`packages/adapter-confluence/src/index.ts`:

```typescript
export * from './document.js'
export * from './rest.js'
export { parseStorage } from './dom.js'
```

- [ ] **Step 7: 통과 확인**

Run: `pnpm vitest run packages/adapter-confluence && pnpm turbo typecheck`
Expected: PASS (47 tests), typecheck 6개 태스크 성공

- [ ] **Step 8: 커밋**

```bash
git add packages/adapter-confluence
git commit -m "feat(adapter-confluence): assemble Document IR from REST content

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 확장 스캐폴드 — 빌드, 매니페스트, 설정

확장의 뼈대를 세운다. 이 태스크가 끝나면 `dist/`를 크롬에 로드할 수 있고 옵션 페이지에서 백엔드 주소와 토큰을 저장할 수 있다.

**Files:**
- Create: `apps/extension/package.json`, `tsconfig.json`, `tsup.config.ts`, `extension.config.json`, `scripts/build-assets.ts`, `src/manifest.template.json`, `src/shared/settings.ts`, `src/options/options.html`, `src/options/options.ts`
- Test: `apps/extension/test/settings.test.ts`, `apps/extension/test/build-assets.test.ts`

**Interfaces:**
- Produces:
  - `interface Settings { backendUrl: string; serviceToken: string; userId: string; useLlm: boolean; rulesetId: string; autoRun: boolean }`
  - `DEFAULT_SETTINGS: Settings`, `loadSettings(area: SettingsArea): Promise<Settings>`, `saveSettings(area: SettingsArea, patch: Partial<Settings>): Promise<void>`, `isConfigured(settings: Settings): boolean`
  - `interface SettingsArea { get(keys: null): Promise<Record<string, unknown>>; set(items: Record<string, unknown>): Promise<void> }`
  - `buildManifest(template: object, origins: OriginConfig): object` where `interface OriginConfig { confluenceOrigins: string[]; backendOrigins: string[] }`

- [ ] **Step 1: 패키지 스캐폴드**

`apps/extension/package.json`:

```json
{
  "name": "@ai-lint/extension",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsup && tsx scripts/build-assets.ts",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@ai-lint/adapter-confluence": "workspace:*",
    "@ai-lint/contract": "workspace:*",
    "@ai-lint/ir": "workspace:*"
  },
  "devDependencies": {
    "@types/chrome": "^0.0.287",
    "happy-dom": "^15.11.0",
    "tsup": "^8.3.0"
  }
}
```

`apps/extension/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM"],
    "types": ["node", "chrome"]
  },
  "include": ["src", "test", "scripts"]
}
```

`pnpm install`

- [ ] **Step 2: 매니페스트 템플릿과 origin 설정**

`apps/extension/extension.config.json`:

```json
{
  "confluenceOrigins": ["https://confluence.example.com/*"],
  "backendOrigins": ["https://ai-lint.example.com/*"]
}
```

백엔드 origin도 `host_permissions`에 있어야 한다. MV3에서 service worker와 옵션 페이지의 cross-origin fetch는 host 권한 없이는 막힌다. 백엔드 주소는 옵션에서 바꿀 수 있지만, 사내 배포판은 패키징 시점에 도메인이 정해져 있으므로 빌드 때 박아 넣는다.

`apps/extension/src/manifest.template.json`:

```json
{
  "manifest_version": 3,
  "name": "AI-Lint for Confluence",
  "description": "Confluence 페이지가 AI에게 읽히는지 검사합니다",
  "version": "0.1.0",
  "minimum_chrome_version": "116",
  "background": { "service_worker": "sw.js", "type": "module" },
  "content_scripts": [{ "js": ["content.js"], "matches": [], "run_at": "document_idle" }],
  "options_page": "options.html",
  "permissions": ["storage", "activeTab"],
  "host_permissions": []
}
```

- [ ] **Step 3: 빌드 스크립트 테스트를 쓴다**

`apps/extension/test/build-assets.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { buildManifest } from '../scripts/build-assets.js'

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
```

- [ ] **Step 4: 실패 확인**

Run: `pnpm vitest run apps/extension`
Expected: FAIL — `Cannot find module '../scripts/build-assets.js'`

- [ ] **Step 5: 빌드 스크립트를 구현한다**

`apps/extension/scripts/build-assets.ts`:

```typescript
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

  await mkdir(resolve(root, 'dist'), { recursive: true })
  await writeFile(resolve(root, 'dist/manifest.json'), `${JSON.stringify(buildManifest(template, origins), null, 2)}\n`)
  await copyFile(resolve(root, 'src/options/options.html'), resolve(root, 'dist/options.html'))
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  await main()
}
```

- [ ] **Step 6: tsup 설정**

`apps/extension/tsup.config.ts`:

```typescript
import { defineConfig } from 'tsup'

const common = {
  target: 'chrome116',
  platform: 'browser' as const,
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
```

- [ ] **Step 7: 설정 저장소 테스트를 쓴다**

`apps/extension/test/settings.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, isConfigured, loadSettings, saveSettings, type SettingsArea } from '../src/shared/settings.js'

const fakeArea = (initial: Record<string, unknown> = {}): SettingsArea & { data: Record<string, unknown> } => ({
  data: { ...initial },
  async get() {
    return { ...this.data }
  },
  async set(items) {
    Object.assign(this.data, items)
  },
})

describe('settings', () => {
  it('저장된 값이 없으면 기본값을 준다', async () => {
    expect(await loadSettings(fakeArea())).toEqual(DEFAULT_SETTINGS)
  })

  it('저장된 값으로 기본값을 덮어쓴다', async () => {
    const area = fakeArea({ backendUrl: 'https://api.test', useLlm: false })
    const settings = await loadSettings(area)
    expect(settings.backendUrl).toBe('https://api.test')
    expect(settings.useLlm).toBe(false)
    expect(settings.rulesetId).toBe('default')
  })

  it('타입이 다른 저장값은 무시한다', async () => {
    const settings = await loadSettings(fakeArea({ useLlm: 'yes', backendUrl: 42 }))
    expect(settings.useLlm).toBe(true)
    expect(settings.backendUrl).toBe('')
  })

  it('백엔드 주소 끝의 슬래시를 떼고 저장한다', async () => {
    const area = fakeArea()
    await saveSettings(area, { backendUrl: 'https://api.test/' })
    expect(area.data['backendUrl']).toBe('https://api.test')
  })

  it('주소와 토큰이 모두 있어야 설정 완료로 본다', () => {
    expect(isConfigured(DEFAULT_SETTINGS)).toBe(false)
    expect(isConfigured({ ...DEFAULT_SETTINGS, backendUrl: 'https://api.test' })).toBe(false)
    expect(isConfigured({ ...DEFAULT_SETTINGS, backendUrl: 'https://api.test', serviceToken: 't' })).toBe(true)
  })
})
```

- [ ] **Step 8: 실패 확인**

Run: `pnpm vitest run apps/extension/test/settings.test.ts`
Expected: FAIL — `Cannot find module '../src/shared/settings.js'`

- [ ] **Step 9: 설정 저장소를 구현한다**

`apps/extension/src/shared/settings.ts`:

```typescript
export interface Settings {
  backendUrl: string
  serviceToken: string
  /** 백엔드 쿼터 집계 단위. 비우면 anonymous로 집계된다. */
  userId: string
  useLlm: boolean
  rulesetId: string
  autoRun: boolean
}

/** chrome.storage.sync에서 필요한 부분만 추린 인터페이스. 테스트에서 가짜를 넣기 위한 것이다. */
export interface SettingsArea {
  get(keys: null): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

export const DEFAULT_SETTINGS: Settings = {
  backendUrl: '',
  serviceToken: '',
  userId: '',
  useLlm: true,
  rulesetId: 'default',
  autoRun: false,
}

const str = (value: unknown, fallback: string): string => (typeof value === 'string' ? value : fallback)
const bool = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
const trimUrl = (url: string): string => url.trim().replace(/\/+$/, '')

export async function loadSettings(area: SettingsArea): Promise<Settings> {
  const stored = await area.get(null)
  return {
    backendUrl: trimUrl(str(stored['backendUrl'], DEFAULT_SETTINGS.backendUrl)),
    serviceToken: str(stored['serviceToken'], DEFAULT_SETTINGS.serviceToken),
    userId: str(stored['userId'], DEFAULT_SETTINGS.userId),
    useLlm: bool(stored['useLlm'], DEFAULT_SETTINGS.useLlm),
    rulesetId: str(stored['rulesetId'], DEFAULT_SETTINGS.rulesetId),
    autoRun: bool(stored['autoRun'], DEFAULT_SETTINGS.autoRun),
  }
}

export async function saveSettings(area: SettingsArea, patch: Partial<Settings>): Promise<void> {
  const next = { ...patch }
  if (next.backendUrl !== undefined) next.backendUrl = trimUrl(next.backendUrl)
  await area.set(next)
}

export const isConfigured = (settings: Settings): boolean =>
  settings.backendUrl.length > 0 && settings.serviceToken.length > 0
```

- [ ] **Step 10: 옵션 페이지를 만든다**

`apps/extension/src/options/options.html`:

```html
<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <title>AI-Lint 설정</title>
    <style>
      body { font: 14px/1.6 system-ui, sans-serif; max-width: 560px; margin: 32px auto; padding: 0 16px; }
      label { display: block; margin: 16px 0 4px; font-weight: 600; }
      input[type='text'], input[type='password'], select { width: 100%; padding: 8px; box-sizing: border-box; }
      .row { display: flex; align-items: center; gap: 8px; margin-top: 16px; }
      .row label { margin: 0; font-weight: 400; }
      button { margin-top: 24px; padding: 8px 20px; }
      #status { margin-left: 12px; color: #16a34a; }
      .hint { color: #64748b; font-size: 12px; margin-top: 4px; }
    </style>
  </head>
  <body>
    <h1>AI-Lint 설정</h1>
    <label for="backendUrl">백엔드 주소</label>
    <input id="backendUrl" type="text" placeholder="https://ai-lint.example.com" />
    <label for="serviceToken">서비스 토큰</label>
    <input id="serviceToken" type="password" />
    <label for="userId">사용자 ID</label>
    <input id="userId" type="text" placeholder="사번 또는 계정" />
    <p class="hint">LLM 호출량을 사용자별로 집계할 때 씁니다.</p>
    <label for="rulesetId">규칙셋</label>
    <select id="rulesetId"></select>
    <div class="row"><input id="useLlm" type="checkbox" /><label for="useLlm">AI 맥락 검사 사용</label></div>
    <div class="row"><input id="autoRun" type="checkbox" /><label for="autoRun">페이지를 열면 자동 검사</label></div>
    <button id="save">저장</button><span id="status"></span>
    <script type="module" src="options.js"></script>
  </body>
</html>
```

`apps/extension/src/options/options.ts`:

```typescript
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from '../shared/settings.js'

const el = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!found) throw new Error(`요소를 찾지 못했습니다: ${id}`)
  return found as T
}

const area = chrome.storage.sync

async function fillRulesets(selected: string): Promise<void> {
  const select = el<HTMLSelectElement>('rulesetId')
  select.replaceChildren(new Option(selected, selected, true, true))

  const settings = await loadSettings(area)
  if (!settings.backendUrl || !settings.serviceToken) return

  try {
    const response = await fetch(`${settings.backendUrl}/v1/rulesets`, {
      headers: { 'X-AI-Lint-Token': settings.serviceToken },
    })
    if (!response.ok) return
    const { rulesets } = (await response.json()) as { rulesets: Array<{ id: string; name: string }> }
    select.replaceChildren(
      ...rulesets.map((ruleset) => new Option(ruleset.name, ruleset.id, false, ruleset.id === selected)),
    )
  } catch {
    // 백엔드가 아직 설정되지 않았을 뿐이다. 저장된 값만 보여준다.
  }
}

async function init(): Promise<void> {
  const settings = await loadSettings(area)
  el<HTMLInputElement>('backendUrl').value = settings.backendUrl
  el<HTMLInputElement>('serviceToken').value = settings.serviceToken
  el<HTMLInputElement>('userId').value = settings.userId
  el<HTMLInputElement>('useLlm').checked = settings.useLlm
  el<HTMLInputElement>('autoRun').checked = settings.autoRun
  await fillRulesets(settings.rulesetId || DEFAULT_SETTINGS.rulesetId)

  el('save').addEventListener('click', () => {
    void saveSettings(area, {
      backendUrl: el<HTMLInputElement>('backendUrl').value,
      serviceToken: el<HTMLInputElement>('serviceToken').value,
      userId: el<HTMLInputElement>('userId').value,
      useLlm: el<HTMLInputElement>('useLlm').checked,
      autoRun: el<HTMLInputElement>('autoRun').checked,
      rulesetId: el<HTMLSelectElement>('rulesetId').value,
    }).then(() => {
      const status = el('status')
      status.textContent = '저장했습니다'
      setTimeout(() => (status.textContent = ''), 2000)
    })
  })
}

void init()
```

- [ ] **Step 11: 통과 확인**

Run: `pnpm vitest run apps/extension`
Expected: PASS (12 tests). content/sw 진입점이 아직 없으므로 `pnpm --filter @ai-lint/extension build`는 Task 10까지 미룬다.

- [ ] **Step 12: 커밋**

```bash
git add apps/extension pnpm-lock.yaml
git commit -m "feat(extension): scaffold MV3 build, manifest generator, and options page

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

### Task 8: 백엔드 클라이언트와 2단계 검사 러너

백엔드 호출은 반드시 service worker에서 한다. content script의 fetch는 Confluence 페이지의 CSP에 걸린다.

백엔드 `/v1/lint`는 동기 호출 하나뿐이라 "룰 먼저, LLM 나중"을 서버가 나눠주지 않는다. 클라이언트가 두 번 부른다 — 1단계는 `{useLlm:false, save:false}`로 빠르게, 2단계는 `{useLlm:true, save:true}`로. 2단계가 실패해도 1단계 결과는 이미 화면에 있다.

**Files:**
- Create: `apps/extension/src/shared/messages.ts`, `src/background/backend-client.ts`, `src/background/lint-runner.ts`, `src/background/sw.ts`
- Test: `apps/extension/test/backend-client.test.ts`, `apps/extension/test/lint-runner.test.ts`

**Interfaces:**
- Consumes: `Settings`, `isConfigured`
- Produces:
  - `PORT_NAME`, `ContentMessage`, `WorkerMessage`, `LintPhase`, `BackendErrorKind`
  - `class BackendError extends Error { readonly kind: BackendErrorKind }`, `kindOfStatus(status: number): BackendErrorKind`
  - `requestLint(document: Document, options: Partial<LintOptions>, settings: Settings, fetchImpl?: typeof fetch): Promise<LintReport>`
  - `saveDocTypeOverride(uri: string, docType: DocType, settings: Settings, fetchImpl?: typeof fetch): Promise<void>`
  - `runLint(document: Document, deps: RunnerDeps, emit: (message: WorkerMessage) => void): Promise<void>` where `interface RunnerDeps { settings: Settings; request(document: Document, options: Partial<LintOptions>): Promise<LintReport> }`

- [ ] **Step 1: 메시지 타입을 정의한다**

`apps/extension/src/shared/messages.ts`:

```typescript
import type { LintReport } from '@ai-lint/contract'
import type { DocType, Document } from '@ai-lint/ir'

export const PORT_NAME = 'ai-lint'

export type LintPhase = 'rules' | 'llm'

export type BackendErrorKind = 'unconfigured' | 'unauthorized' | 'forbidden' | 'quota' | 'offline' | 'server'

export type ContentMessage =
  | { type: 'lint'; document: Document }
  | { type: 'set-doctype'; uri: string; docType: DocType }

export type WorkerMessage =
  | { type: 'progress'; phase: LintPhase }
  | { type: 'report'; phase: LintPhase; report: LintReport }
  | { type: 'error'; phase: LintPhase; kind: BackendErrorKind; message: string }
  | { type: 'doctype-saved' }
  | { type: 'done' }
```

- [ ] **Step 2: 백엔드 클라이언트 테스트를 쓴다**

`apps/extension/test/backend-client.test.ts`:

```typescript
import type { Document } from '@ai-lint/ir'
import { describe, expect, it, vi } from 'vitest'
import { BackendError, kindOfStatus, requestLint, saveDocTypeOverride } from '../src/background/backend-client.js'
import { DEFAULT_SETTINGS } from '../src/shared/settings.js'

const settings = { ...DEFAULT_SETTINGS, backendUrl: 'https://api.test', serviceToken: 'tok', userId: 'kim' }
const doc = { title: '테스트' } as unknown as Document

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('kindOfStatus', () => {
  it('상태코드를 오류 종류로 옮긴다', () => {
    expect(kindOfStatus(401)).toBe('unauthorized')
    expect(kindOfStatus(403)).toBe('forbidden')
    expect(kindOfStatus(429)).toBe('quota')
    expect(kindOfStatus(500)).toBe('server')
  })
})

describe('requestLint', () => {
  it('설정이 비어 있으면 부르지 않고 안내한다', async () => {
    const fetchImpl = vi.fn()
    await expect(requestLint(doc, {}, DEFAULT_SETTINGS, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      kind: 'unconfigured',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('토큰과 사용자 헤더를 붙여 문서를 보낸다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ reportId: 'r1' }))
    const report = await requestLint(doc, { useLlm: false, save: false }, settings, fetchImpl as unknown as typeof fetch)

    expect(report).toEqual({ reportId: 'r1' })
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.test/v1/lint')
    expect(init.headers).toMatchObject({ 'X-AI-Lint-Token': 'tok', 'X-AI-Lint-User': 'kim' })
    expect(JSON.parse(init.body as string)).toEqual({
      document: doc,
      options: { useLlm: false, save: false, rulesetId: 'default' },
    })
  })

  it('사용자 ID가 비면 헤더를 붙이지 않는다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}))
    await requestLint(doc, {}, { ...settings, userId: '' }, fetchImpl as unknown as typeof fetch)
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.headers).not.toHaveProperty('X-AI-Lint-User')
  })

  it('네트워크가 끊기면 offline으로 알린다', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(requestLint(doc, {}, settings, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      kind: 'offline',
    })
  })

  it('백엔드가 준 오류 메시지를 그대로 보여준다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: '알 수 없는 규칙셋입니다: x' }, 404))
    await expect(requestLint(doc, {}, settings, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      kind: 'server',
      message: '알 수 없는 규칙셋입니다: x',
    })
  })

  it('본문이 없는 오류에는 기본 안내를 쓴다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 429 }))
    const error = await requestLint(doc, {}, settings, fetchImpl as unknown as typeof fetch).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(BackendError)
    expect((error as BackendError).message).toContain('한도')
  })
})

describe('saveDocTypeOverride', () => {
  it('문서 유형 재지정을 저장한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 201))
    await saveDocTypeOverride('https://wiki.test/x', 'design', settings, fetchImpl as unknown as typeof fetch)

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.test/v1/doctype-overrides')
    expect(JSON.parse(init.body as string)).toEqual({ uri: 'https://wiki.test/x', docType: 'design' })
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm vitest run apps/extension/test/backend-client.test.ts`
Expected: FAIL — `Cannot find module '../src/background/backend-client.js'`

- [ ] **Step 4: 백엔드 클라이언트를 구현한다**

`apps/extension/src/background/backend-client.ts`:

```typescript
import type { LintOptions, LintReport } from '@ai-lint/contract'
import type { DocType, Document } from '@ai-lint/ir'
import type { BackendErrorKind } from '../shared/messages.js'
import { isConfigured, type Settings } from '../shared/settings.js'

const MESSAGES: Record<BackendErrorKind, string> = {
  unconfigured: '옵션에서 백엔드 주소와 서비스 토큰을 먼저 설정하세요.',
  unauthorized: '서비스 토큰이 올바르지 않습니다. 옵션에서 다시 확인하세요.',
  forbidden: '이 문서를 검사할 권한이 없습니다.',
  quota: '오늘 AI 검사 한도를 다 썼습니다. 규칙 검사 결과만 표시합니다.',
  offline: '백엔드에 연결하지 못했습니다.',
  server: '백엔드에서 오류가 발생했습니다.',
}

export class BackendError extends Error {
  readonly kind: BackendErrorKind

  constructor(kind: BackendErrorKind, message: string = MESSAGES[kind]) {
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

function headersFor(settings: Settings): Record<string, string> {
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

async function post(path: string, body: unknown, settings: Settings, fetchImpl: typeof fetch): Promise<Response> {
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
    throw new BackendError(kind, (await detailOf(response)) ?? MESSAGES[kind])
  }
  return response
}

export async function requestLint(
  document: Document,
  options: Partial<LintOptions>,
  settings: Settings,
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
  settings: Settings,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await post('/v1/doctype-overrides', { uri, docType }, settings, fetchImpl)
}
```

- [ ] **Step 5: 통과 확인**

Run: `pnpm vitest run apps/extension/test/backend-client.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: 러너 테스트를 쓴다**

`apps/extension/test/lint-runner.test.ts`:

```typescript
import type { LintOptions, LintReport } from '@ai-lint/contract'
import type { Document } from '@ai-lint/ir'
import { describe, expect, it, vi } from 'vitest'
import { BackendError } from '../src/background/backend-client.js'
import { runLint } from '../src/background/lint-runner.js'
import type { WorkerMessage } from '../src/shared/messages.js'
import { DEFAULT_SETTINGS } from '../src/shared/settings.js'

const doc = { title: '테스트' } as unknown as Document
const report = (id: string): LintReport => ({ reportId: id }) as LintReport

const collect = async (
  request: (document: Document, options: Partial<LintOptions>) => Promise<LintReport>,
  useLlm = true,
): Promise<WorkerMessage[]> => {
  const messages: WorkerMessage[] = []
  await runLint(doc, { settings: { ...DEFAULT_SETTINGS, useLlm }, request }, (m) => messages.push(m))
  return messages
}

describe('runLint', () => {
  it('룰 결과를 먼저 내보내고 LLM 결과로 덮어쓴다', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(report('rules'))
      .mockResolvedValueOnce(report('llm'))

    const messages = await collect(request)

    expect(messages.map((m) => m.type)).toEqual(['progress', 'report', 'progress', 'report', 'done'])
    expect(request.mock.calls[0]?.[1]).toEqual({ useLlm: false, save: false })
    expect(request.mock.calls[1]?.[1]).toEqual({ useLlm: true, save: true })
    expect(messages[1]).toMatchObject({ phase: 'rules', report: { reportId: 'rules' } })
    expect(messages[3]).toMatchObject({ phase: 'llm', report: { reportId: 'llm' } })
  })

  it('AI 검사를 껐으면 두 번째 호출을 하지 않는다', async () => {
    const request = vi.fn().mockResolvedValue(report('rules'))
    const messages = await collect(request, false)

    expect(request).toHaveBeenCalledTimes(1)
    expect(messages.map((m) => m.type)).toEqual(['progress', 'report', 'done'])
  })

  it('LLM 단계가 실패해도 룰 결과는 남기고 배너만 띄운다', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(report('rules'))
      .mockRejectedValueOnce(new BackendError('quota'))

    const messages = await collect(request)

    expect(messages.map((m) => m.type)).toEqual(['progress', 'report', 'progress', 'error', 'done'])
    expect(messages[3]).toMatchObject({ phase: 'llm', kind: 'quota' })
  })

  it('룰 단계가 실패하면 LLM 단계로 넘어가지 않는다', async () => {
    const request = vi.fn().mockRejectedValue(new BackendError('offline'))
    const messages = await collect(request)

    expect(request).toHaveBeenCalledTimes(1)
    expect(messages.map((m) => m.type)).toEqual(['progress', 'error', 'done'])
    expect(messages[1]).toMatchObject({ phase: 'rules', kind: 'offline' })
  })

  it('예상 못 한 예외도 server 오류로 감싼다', async () => {
    const request = vi.fn().mockRejectedValue(new Error('boom'))
    const messages = await collect(request)
    expect(messages[1]).toMatchObject({ kind: 'server', message: 'boom' })
  })
})
```

- [ ] **Step 7: 실패 확인**

Run: `pnpm vitest run apps/extension/test/lint-runner.test.ts`
Expected: FAIL — `Cannot find module '../src/background/lint-runner.js'`

- [ ] **Step 8: 러너를 구현한다**

`apps/extension/src/background/lint-runner.ts`:

```typescript
import type { LintOptions, LintReport } from '@ai-lint/contract'
import type { Document } from '@ai-lint/ir'
import type { LintPhase, WorkerMessage } from '../shared/messages.js'
import type { Settings } from '../shared/settings.js'
import { BackendError } from './backend-client.js'

export interface RunnerDeps {
  settings: Settings
  request(document: Document, options: Partial<LintOptions>): Promise<LintReport>
}

const errorOf = (phase: LintPhase, error: unknown): WorkerMessage =>
  error instanceof BackendError
    ? { type: 'error', phase, kind: error.kind, message: error.message }
    : { type: 'error', phase, kind: 'server', message: error instanceof Error ? error.message : '검사에 실패했습니다.' }

export async function runLint(
  document: Document,
  deps: RunnerDeps,
  emit: (message: WorkerMessage) => void,
): Promise<void> {
  emit({ type: 'progress', phase: 'rules' })
  try {
    emit({ type: 'report', phase: 'rules', report: await deps.request(document, { useLlm: false, save: false }) })
  } catch (error) {
    emit(errorOf('rules', error))
    emit({ type: 'done' })
    return
  }

  if (!deps.settings.useLlm) {
    emit({ type: 'done' })
    return
  }

  emit({ type: 'progress', phase: 'llm' })
  try {
    emit({ type: 'report', phase: 'llm', report: await deps.request(document, { useLlm: true, save: true }) })
  } catch (error) {
    emit(errorOf('llm', error))
  }
  emit({ type: 'done' })
}
```

- [ ] **Step 9: 통과 확인**

Run: `pnpm vitest run apps/extension/test/lint-runner.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 10: 서비스 워커를 배선한다**

`apps/extension/src/background/sw.ts`:

```typescript
import { PORT_NAME, type ContentMessage, type WorkerMessage } from '../shared/messages.js'
import { loadSettings } from '../shared/settings.js'
import { requestLint, saveDocTypeOverride } from './backend-client.js'
import { runLint } from './lint-runner.js'

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return

  // 사용자가 패널을 닫거나 페이지를 떠나면 포트가 끊긴다. 끊긴 포트에 쓰면 예외가 난다.
  let alive = true
  port.onDisconnect.addListener(() => {
    alive = false
  })
  const emit = (message: WorkerMessage): void => {
    if (alive) port.postMessage(message)
  }

  port.onMessage.addListener((message: ContentMessage) => {
    void handle(message, emit)
  })
})

async function handle(message: ContentMessage, emit: (message: WorkerMessage) => void): Promise<void> {
  const settings = await loadSettings(chrome.storage.sync)

  if (message.type === 'set-doctype') {
    try {
      await saveDocTypeOverride(message.uri, message.docType, settings)
      emit({ type: 'doctype-saved' })
    } catch (error) {
      emit({ type: 'error', phase: 'rules', kind: 'server', message: (error as Error).message })
      emit({ type: 'done' })
    }
    return
  }

  await runLint(
    message.document,
    { settings, request: (document, options) => requestLint(document, options, settings) },
    emit,
  )
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.runtime.openOptionsPage()
})
```

- [ ] **Step 11: 커밋**

```bash
git add apps/extension
git commit -m "feat(extension): add backend client and two-phase lint runner

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: 페이지 읽기와 링크 확인

content script가 사용자 세션 쿠키로 Confluence REST를 호출해 IR을 만든다. 백엔드는 Confluence 자격증명을 갖지 않는다 — 사용자가 볼 수 있는 것만 검사된다.

META006(깨진 링크)은 `link.status === 'broken'`만 본다. 그 상태를 채우는 것은 여기다.

**Files:**
- Create: `apps/extension/src/content/page-reader.ts`, `apps/extension/src/content/link-check.ts`
- Test: `apps/extension/test/page-reader.test.ts`, `apps/extension/test/link-check.test.ts`

**Interfaces:**
- Consumes: `@ai-lint/adapter-confluence`의 `contentPath`, `contentToDocument`, `ConfluenceContent`
- Produces:
  - `findPageId(dom: globalThis.Document): string | null`, `findBaseUrl(dom: globalThis.Document): string`
  - `class PageReadError extends Error { readonly kind: 'not-a-page' | 'forbidden' | 'failed' }`
  - `readPage(dom: globalThis.Document, fetchImpl?: typeof fetch): Promise<Document>`
  - `checkLinks(doc: Document, deps: LinkCheckDeps): Promise<Document>` where `interface LinkCheckDeps { baseUrl: string; fetchImpl?: typeof fetch; maxLinks?: number }`

- [ ] **Step 1: 페이지 리더 테스트를 쓴다**

`apps/extension/test/page-reader.test.ts`:

```typescript
// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { findBaseUrl, findPageId, PageReadError, readPage } from '../src/content/page-reader.js'

const setup = (html: string, href = 'https://wiki.test/pages/viewpage.action?pageId=789'): globalThis.Document => {
  const dom = document.implementation.createHTMLDocument('t')
  dom.head.innerHTML = html
  Object.defineProperty(dom, 'location', { value: new URL(href), configurable: true })
  return dom
}

const content = {
  id: '789',
  title: '결제 설계',
  space: { key: 'ENG' },
  metadata: { labels: { results: [{ name: '설계' }] } },
  body: { storage: { value: '<h1>배경</h1>' } },
}

describe('findPageId', () => {
  it('meta 태그에서 페이지 ID를 읽는다', () => {
    expect(findPageId(setup('<meta name="ajs-page-id" content="789">'))).toBe('789')
  })

  it('meta가 없으면 주소의 pageId를 쓴다', () => {
    expect(findPageId(setup(''))).toBe('789')
  })

  it('페이지가 아니면 null을 준다', () => {
    expect(findPageId(setup('', 'https://wiki.test/dashboard.action'))).toBeNull()
  })
})

describe('findBaseUrl', () => {
  it('meta의 base URL을 쓰고 끝 슬래시를 뗀다', () => {
    expect(findBaseUrl(setup('<meta name="ajs-base-url" content="https://wiki.test/confluence/">'))).toBe(
      'https://wiki.test/confluence',
    )
  })

  it('meta가 없으면 현재 origin을 쓴다', () => {
    expect(findBaseUrl(setup(''))).toBe('https://wiki.test')
  })
})

describe('readPage', () => {
  it('세션 쿠키로 REST를 부르고 IR을 만든다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(content), { status: 200, headers: { 'content-type': 'application/json' } }),
    )
    const doc = await readPage(setup('<meta name="ajs-page-id" content="789">'), fetchImpl as unknown as typeof fetch)

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/rest/api/content/789?expand=body.storage')
    expect(init.credentials).toBe('include')
    expect(doc.title).toBe('결제 설계')
    expect(doc.source.uri).toBe('https://wiki.test/pages/viewpage.action?pageId=789')
  })

  it('페이지가 아니면 not-a-page로 알린다', async () => {
    await expect(readPage(setup('', 'https://wiki.test/dashboard.action'))).rejects.toMatchObject({
      kind: 'not-a-page',
    })
  })

  it('403이면 권한 없음으로 알린다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 403 }))
    const error = await readPage(setup(''), fetchImpl as unknown as typeof fetch).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PageReadError)
    expect(error).toMatchObject({ kind: 'forbidden', message: '이 페이지를 볼 권한이 없습니다.' })
  })

  it('그 밖의 실패는 상태코드를 알려준다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 500 }))
    await expect(readPage(setup(''), fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      kind: 'failed',
      message: '페이지를 읽지 못했습니다 (HTTP 500).',
    })
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run apps/extension/test/page-reader.test.ts`
Expected: FAIL — `Cannot find module '../src/content/page-reader.js'`

- [ ] **Step 3: 페이지 리더를 구현한다**

`apps/extension/src/content/page-reader.ts`:

```typescript
import { contentPath, contentToDocument, type ConfluenceContent } from '@ai-lint/adapter-confluence'
import type { Document } from '@ai-lint/ir'

export type PageReadErrorKind = 'not-a-page' | 'forbidden' | 'failed'

export class PageReadError extends Error {
  readonly kind: PageReadErrorKind

  constructor(kind: PageReadErrorKind, message: string) {
    super(message)
    this.name = 'PageReadError'
    this.kind = kind
  }
}

const metaContent = (dom: globalThis.Document, name: string): string | null =>
  dom.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() || null

/**
 * content script는 isolated world라 페이지의 AJS 전역을 볼 수 없다.
 * Confluence가 심어 두는 meta 태그와 주소만으로 판단한다.
 */
export function findPageId(dom: globalThis.Document): string | null {
  return metaContent(dom, 'ajs-page-id') ?? new URL(dom.location.href).searchParams.get('pageId')
}

export function findBaseUrl(dom: globalThis.Document): string {
  const base = metaContent(dom, 'ajs-base-url') ?? new URL(dom.location.href).origin
  return base.replace(/\/+$/, '')
}

export async function readPage(dom: globalThis.Document, fetchImpl: typeof fetch = fetch): Promise<Document> {
  const pageId = findPageId(dom)
  if (!pageId) throw new PageReadError('not-a-page', '이 화면은 Confluence 페이지가 아닙니다.')

  const baseUrl = findBaseUrl(dom)
  // 사용자 세션 쿠키를 그대로 쓴다. 백엔드는 Confluence 자격증명을 갖지 않는다.
  const response = await fetchImpl(`${baseUrl}${contentPath(pageId)}`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })

  if (response.status === 401 || response.status === 403) {
    throw new PageReadError('forbidden', '이 페이지를 볼 권한이 없습니다.')
  }
  if (!response.ok) {
    throw new PageReadError('failed', `페이지를 읽지 못했습니다 (HTTP ${response.status}).`)
  }

  const content = (await response.json()) as ConfluenceContent
  return contentToDocument(content, { baseUrl, pageUrl: dom.location.href })
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run apps/extension/test/page-reader.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: 링크 확인 테스트를 쓴다**

`apps/extension/test/link-check.test.ts`:

```typescript
import type { Document, Link } from '@ai-lint/ir'
import { describe, expect, it, vi } from 'vitest'
import { checkLinks } from '../src/content/link-check.js'

const link = (href: string, target: Link['target']): Link => ({
  blockId: 'b1',
  text: href,
  href,
  target,
  status: 'unchecked',
})

const docWith = (links: Link[]): Document => ({ links, blocks: [] }) as unknown as Document

describe('checkLinks', () => {
  it('내부 링크와 첨부만 HEAD로 확인한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    const doc = await checkLinks(
      docWith([
        link('/display/ENG/Home', 'internal'),
        link('/download/attachments/1/a.pptx', 'attachment'),
        link('https://external.test/a', 'external'),
        link('#top', 'anchor'),
      ]),
      { baseUrl: 'https://wiki.test', fetchImpl: fetchImpl as unknown as typeof fetch },
    )

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(doc.links.map((l) => l.status)).toEqual(['ok', 'ok', 'unchecked', 'unchecked'])
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('HEAD')
    expect(init.credentials).toBe('include')
  })

  it('상대 경로를 base URL 기준으로 절대화한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    await checkLinks(docWith([link('/display/ENG/Home', 'internal')]), {
      baseUrl: 'https://wiki.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://wiki.test/display/ENG/Home')
  })

  it('404와 410만 깨진 링크로 본다', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('', { status: 403 }))
    const doc = await checkLinks(docWith([link('/a', 'internal'), link('/b', 'internal')]), {
      baseUrl: 'https://wiki.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    // 403은 권한 문제지 문서가 없는 것은 아니다. 깨졌다고 하면 거짓 지적이 된다.
    expect(doc.links.map((l) => l.status)).toEqual(['broken', 'ok'])
  })

  it('요청이 실패하면 unchecked로 남긴다', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const doc = await checkLinks(docWith([link('/a', 'internal')]), {
      baseUrl: 'https://wiki.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(doc.links[0]?.status).toBe('unchecked')
  })

  it('같은 주소는 한 번만 확인한다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
    const doc = await checkLinks(docWith([link('/a', 'internal'), link('/a', 'internal')]), {
      baseUrl: 'https://wiki.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(doc.links.map((l) => l.status)).toEqual(['broken', 'broken'])
  })

  it('상한을 넘는 링크는 건드리지 않는다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    const links = Array.from({ length: 5 }, (_, i) => link(`/a${i}`, 'internal'))
    const doc = await checkLinks(docWith(links), {
      baseUrl: 'https://wiki.test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxLinks: 2,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(doc.links.map((l) => l.status)).toEqual(['ok', 'ok', 'unchecked', 'unchecked', 'unchecked'])
  })
})
```

- [ ] **Step 6: 실패 확인**

Run: `pnpm vitest run apps/extension/test/link-check.test.ts`
Expected: FAIL — `Cannot find module '../src/content/link-check.js'`

- [ ] **Step 7: 링크 확인을 구현한다**

`apps/extension/src/content/link-check.ts`:

```typescript
import type { Document, Link } from '@ai-lint/ir'

/** 외부 링크는 CORS 때문에 브라우저에서 상태를 알 수 없다. 확인하지 않은 채로 둔다. */
const CHECKABLE: ReadonlyArray<Link['target']> = ['internal', 'attachment']
const MAX_LINKS = 40
const CONCURRENCY = 4

export interface LinkCheckDeps {
  baseUrl: string
  fetchImpl?: typeof fetch
  maxLinks?: number
}

async function statusOf(href: string, baseUrl: string, fetchImpl: typeof fetch): Promise<Link['status']> {
  try {
    const response = await fetchImpl(new URL(href, baseUrl).toString(), {
      method: 'HEAD',
      credentials: 'include',
      redirect: 'follow',
    })
    // 403은 볼 권한이 없는 것이지 문서가 사라진 것이 아니다.
    return response.status === 404 || response.status === 410 ? 'broken' : 'ok'
  } catch {
    return 'unchecked'
  }
}

export async function checkLinks(doc: Document, deps: LinkCheckDeps): Promise<Document> {
  const fetchImpl = deps.fetchImpl ?? fetch
  const hrefs = [...new Set(doc.links.filter((l) => CHECKABLE.includes(l.target)).map((l) => l.href))].slice(
    0,
    deps.maxLinks ?? MAX_LINKS,
  )

  const statuses = new Map<string, Link['status']>()
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (let href = hrefs[cursor++]; href !== undefined; href = hrefs[cursor++]) {
      statuses.set(href, await statusOf(href, deps.baseUrl, fetchImpl))
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, hrefs.length) }, worker))

  return { ...doc, links: doc.links.map((l) => ({ ...l, status: statuses.get(l.href) ?? l.status })) }
}
```

- [ ] **Step 8: 통과 확인**

Run: `pnpm vitest run apps/extension`
Expected: PASS (40 tests)

- [ ] **Step 9: 커밋**

```bash
git add apps/extension
git commit -m "feat(extension): read Confluence page into IR and verify internal links

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: FAB와 패널 셸

좌하단 버튼과 좌측 슬라이드인 패널. Shadow DOM에 넣어 Confluence CSS와 서로 간섭하지 않게 한다. 지적 목록 렌더링은 Task 11에서 `panel.body`에 채운다.

**Files:**
- Create: `apps/extension/src/shared/labels.ts`, `src/shared/report-cache.ts`, `src/content/panel/styles.ts`, `src/content/panel/panel.ts`, `src/content/index.ts`
- Test: `apps/extension/test/report-cache.test.ts`, `apps/extension/test/panel.test.ts`

**Interfaces:**
- Produces:
  - `DOC_TYPE_LABELS: Record<DocType, string>`, `DOC_TYPES: DocType[]`, `SEVERITY_LABELS: Record<Severity, string>`, `AXIS_LABELS: Record<Axis, string>`
  - `interface CachedReport { grade: Grade; total: number; createdAt: string }`, `readCached(area, uri)`, `writeCached(area, uri, entry)`, `daysAgo(createdAt: string, now: Date): number`
  - `mountPanel(container: HTMLElement, handlers: PanelHandlers): Panel`

- [ ] **Step 1: 표시용 이름표를 만든다**

`apps/extension/src/shared/labels.ts`:

```typescript
import type { Axis, DocType, Severity } from '@ai-lint/ir'

/** IR의 DocTypeSchema는 zod 값이라 확장에서 못 쓴다. 표시 이름과 함께 여기서 나열한다. */
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

export const AXIS_LABELS: Record<Axis, string> = {
  structure: '구조',
  context: '맥락',
  metadata: '메타데이터',
}
```

- [ ] **Step 2: 리포트 캐시 테스트를 쓴다**

`apps/extension/test/report-cache.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { daysAgo, readCached, writeCached, type CacheArea } from '../src/shared/report-cache.js'

const fakeArea = (initial: Record<string, unknown> = {}): CacheArea & { data: Record<string, unknown> } => ({
  data: { ...initial },
  async get() {
    return { ...this.data }
  },
  async set(items) {
    Object.assign(this.data, items)
  },
})

const entry = (createdAt: string) => ({ grade: 'B' as const, total: 78, createdAt })

describe('report cache', () => {
  it('저장한 적 없는 주소는 null을 준다', async () => {
    expect(await readCached(fakeArea(), 'https://wiki.test/a')).toBeNull()
  })

  it('주소별로 마지막 결과를 되돌려준다', async () => {
    const area = fakeArea()
    await writeCached(area, 'https://wiki.test/a', entry('2026-08-20T00:00:00.000Z'))
    expect(await readCached(area, 'https://wiki.test/a')).toEqual(entry('2026-08-20T00:00:00.000Z'))
    expect(await readCached(area, 'https://wiki.test/b')).toBeNull()
  })

  it('오래된 항목부터 버려 50개를 유지한다', async () => {
    const area = fakeArea()
    for (let i = 0; i < 55; i++) {
      await writeCached(area, `https://wiki.test/${i}`, entry(`2026-08-${String((i % 28) + 1).padStart(2, '0')}T00:00:00.000Z`))
    }
    const stored = area.data['lastReports'] as Record<string, unknown>
    expect(Object.keys(stored)).toHaveLength(50)
    expect(await readCached(area, 'https://wiki.test/54')).not.toBeNull()
  })

  it('망가진 저장값은 무시한다', async () => {
    expect(await readCached(fakeArea({ lastReports: 'garbage' }), 'https://wiki.test/a')).toBeNull()
  })

  it('며칠 전인지 센다', () => {
    expect(daysAgo('2026-08-20T00:00:00.000Z', new Date('2026-08-22T06:00:00.000Z'))).toBe(2)
    expect(daysAgo('2026-08-22T01:00:00.000Z', new Date('2026-08-22T06:00:00.000Z'))).toBe(0)
  })
})
```

- [ ] **Step 3: 실패 확인**

Run: `pnpm vitest run apps/extension/test/report-cache.test.ts`
Expected: FAIL — `Cannot find module '../src/shared/report-cache.js'`

- [ ] **Step 4: 리포트 캐시를 구현한다**

`apps/extension/src/shared/report-cache.ts`:

```typescript
import type { Grade } from '@ai-lint/contract'

export interface CachedReport {
  grade: Grade
  total: number
  createdAt: string
}

export interface CacheArea {
  get(keys: null): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

const KEY = 'lastReports'
/** 배지 하나 띄우자고 저장소를 무한히 늘릴 이유가 없다. */
const MAX_ENTRIES = 50

const isEntry = (value: unknown): value is CachedReport =>
  typeof value === 'object' && value !== null && 'grade' in value && 'createdAt' in value

async function readAll(area: CacheArea): Promise<Record<string, CachedReport>> {
  const stored = (await area.get(null))[KEY]
  if (typeof stored !== 'object' || stored === null) return {}
  return Object.fromEntries(Object.entries(stored as Record<string, unknown>).filter(([, v]) => isEntry(v))) as Record<
    string,
    CachedReport
  >
}

export async function readCached(area: CacheArea, uri: string): Promise<CachedReport | null> {
  return (await readAll(area))[uri] ?? null
}

export async function writeCached(area: CacheArea, uri: string, entry: CachedReport): Promise<void> {
  const all = { ...(await readAll(area)), [uri]: entry }
  const kept = Object.entries(all)
    .sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_ENTRIES)
  await area.set({ [KEY]: Object.fromEntries(kept) })
}

export function daysAgo(createdAt: string, now: Date): number {
  const elapsed = now.getTime() - new Date(createdAt).getTime()
  return Math.max(0, Math.floor(elapsed / 86_400_000))
}
```

- [ ] **Step 5: 패널 테스트를 쓴다**

`apps/extension/test/panel.test.ts`:

```typescript
// @vitest-environment happy-dom
import type { Score } from '@ai-lint/contract'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mountPanel, type Panel } from '../src/content/panel/panel.js'

const score: Score = { total: 78, grade: 'B', axes: { structure: 80, context: 75, metadata: 80 } }

let container: HTMLElement
let panel: Panel
let onRun: ReturnType<typeof vi.fn>
let onDocTypeChange: ReturnType<typeof vi.fn>

const query = (selector: string): HTMLElement | null => panel.root.querySelector(selector)

beforeEach(() => {
  document.body.replaceChildren()
  container = document.createElement('div')
  document.body.append(container)
  onRun = vi.fn()
  onDocTypeChange = vi.fn()
  panel = mountPanel(container, { onRun, onDocTypeChange })
})

describe('mountPanel', () => {
  it('좌하단 버튼을 shadow DOM 안에 만든다', () => {
    expect(container.querySelector('#ai-lint-root')?.shadowRoot).not.toBeNull()
    expect(query('.fab')?.textContent).toContain('AI Lint')
  })

  it('버튼을 누르면 패널을 열고 검사를 시작한다', () => {
    query('.fab')?.click()
    expect(query('.panel')?.classList.contains('open')).toBe(true)
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('닫기 버튼은 검사를 다시 돌리지 않는다', () => {
    query('.fab')?.click()
    query('.close')?.click()
    expect(query('.panel')?.classList.contains('open')).toBe(false)
    expect(onRun).toHaveBeenCalledTimes(1)
  })

  it('등급 배지를 버튼에 표시한다', () => {
    panel.setBadge('A')
    expect(query('.badge')?.textContent).toBe('A')
    panel.setBadge(null)
    expect(query('.badge')?.textContent).toBe('')
  })

  it('총점과 축별 점수를 보여준다', () => {
    panel.setScore(score)
    expect(query('.grade')?.textContent).toBe('B')
    expect(query('.total')?.textContent).toBe('78')
    expect(query('.axes')?.textContent).toContain('구조 80')
    expect(query('.axes')?.textContent).toContain('맥락 75')
  })

  it('배너를 띄우고 지운다', () => {
    panel.setBanner('한도를 다 썼습니다', 'warn')
    expect(query('.banner')?.hidden).toBe(false)
    expect(query('.banner')?.dataset['tone']).toBe('warn')
    panel.setBanner('', null)
    expect(query('.banner')?.hidden).toBe(true)
  })

  it('문서 유형을 고르면 알린다', () => {
    panel.setDocType('design')
    const select = query('.doctype') as HTMLSelectElement
    expect(select.value).toBe('design')
    select.value = 'guide'
    select.dispatchEvent(new Event('change'))
    expect(onDocTypeChange).toHaveBeenCalledWith('guide')
  })

  it('destroy는 호스트를 걷어낸다', () => {
    panel.destroy()
    expect(container.querySelector('#ai-lint-root')).toBeNull()
  })
})
```

- [ ] **Step 6: 실패 확인**

Run: `pnpm vitest run apps/extension/test/panel.test.ts`
Expected: FAIL — `Cannot find module '../src/content/panel/panel.js'`

- [ ] **Step 7: 스타일을 쓴다**

`apps/extension/src/content/panel/styles.ts`:

```typescript
export const PANEL_STYLES = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "Segoe UI", "Malgun Gothic", sans-serif; }

.fab {
  position: fixed; left: 20px; bottom: 20px; z-index: 2147483000;
  display: flex; align-items: center; gap: 8px;
  padding: 10px 16px; border: none; border-radius: 999px;
  background: #1e293b; color: #fff; font-size: 13px; font-weight: 600;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.3); cursor: pointer;
}
.fab:hover { background: #334155; }
.badge:empty { display: none; }
.badge {
  min-width: 20px; padding: 1px 6px; border-radius: 6px;
  background: #38bdf8; color: #0f172a; font-size: 12px;
}

.panel {
  position: fixed; left: 0; top: 0; bottom: 0; width: 420px; max-width: 100vw;
  z-index: 2147483001; display: flex; flex-direction: column;
  background: #fff; color: #0f172a; font-size: 13px; line-height: 1.6;
  border-right: 1px solid #e2e8f0; box-shadow: 4px 0 24px rgba(15, 23, 42, 0.12);
  transform: translateX(-100%); transition: transform 160ms ease-out;
}
.panel.open { transform: translateX(0); }

header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #e2e8f0; }
header h1 { margin: 0; font-size: 14px; }
.close { border: none; background: none; font-size: 13px; color: #64748b; cursor: pointer; }

.score { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #e2e8f0; }
.grade { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 10px; background: #0f172a; color: #fff; font-size: 20px; font-weight: 700; }
.grade[data-grade='A'] { background: #16a34a; }
.grade[data-grade='B'] { background: #0ea5e9; }
.grade[data-grade='C'] { background: #f59e0b; }
.grade[data-grade='D'] { background: #dc2626; }
.total { font-size: 20px; font-weight: 700; }
.axes { color: #64748b; font-size: 12px; }
.doctype { margin-left: auto; padding: 4px; font-size: 12px; }

.banner { padding: 10px 16px; font-size: 12px; }
.banner[data-tone='warn'] { background: #fef3c7; color: #92400e; }
.banner[data-tone='error'] { background: #fee2e2; color: #991b1b; }
.status { padding: 8px 16px; color: #64748b; font-size: 12px; }
.status:empty { display: none; }
.body { flex: 1; overflow-y: auto; padding: 0 16px 24px; }

.empty { padding: 24px 0; color: #64748b; text-align: center; }
.group { margin-top: 18px; }
.group h2 { margin: 0 0 8px; font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
.group ul { margin: 0; padding: 0; list-style: none; }

.finding { padding: 12px; margin-bottom: 8px; border: 1px solid #e2e8f0; border-left-width: 3px; border-radius: 8px; }
.finding[data-severity='error'] { border-left-color: #dc2626; }
.finding[data-severity='warning'] { border-left-color: #f59e0b; }
.finding[data-severity='info'] { border-left-color: #0ea5e9; }
.finding-head { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; font-size: 11px; color: #64748b; }
.rule { font-weight: 700; color: #0f172a; }
.src { padding: 0 5px; border-radius: 4px; background: #ede9fe; color: #6d28d9; }
.message { margin: 0 0 4px; font-weight: 600; }
.why { margin: 0; color: #475569; }
.evidence { margin: 6px 0 0; padding: 6px 8px; background: #f8fafc; border-radius: 6px; font-size: 12px; white-space: pre-wrap; word-break: break-word; }
.suggestion { margin-top: 8px; padding: 8px; background: #f1f5f9; border-radius: 6px; }
.suggestion del { display: block; background: #fee2e2; text-decoration: none; }
.suggestion ins { display: block; background: #dcfce7; text-decoration: none; }
.actions { display: flex; gap: 8px; margin-top: 8px; }
.actions button, .actions a { padding: 3px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #0f172a; font-size: 12px; text-decoration: none; cursor: pointer; }
`
```

- [ ] **Step 8: 패널을 구현한다**

`apps/extension/src/content/panel/panel.ts`:

```typescript
import type { Grade, Score } from '@ai-lint/contract'
import type { DocType } from '@ai-lint/ir'
import { AXIS_LABELS, DOC_TYPE_LABELS, DOC_TYPES } from '../../shared/labels.js'
import { PANEL_STYLES } from './styles.js'

export type BannerTone = 'warn' | 'error'

export interface PanelHandlers {
  onRun(): void
  onDocTypeChange(docType: DocType): void
}

export interface Panel {
  readonly root: ShadowRoot
  /** 지적 목록을 그려 넣을 자리 */
  readonly body: HTMLElement
  open(): void
  close(): void
  setBadge(grade: Grade | null): void
  setScore(score: Score | null): void
  setStatus(text: string): void
  setBanner(text: string, tone: BannerTone | null): void
  setDocType(docType: DocType): void
  destroy(): void
}

const HOST_ID = 'ai-lint-root'

const TEMPLATE = `
<button class="fab" type="button">AI Lint<span class="badge"></span></button>
<aside class="panel">
  <header>
    <h1>AI Lint</h1>
    <button class="close" type="button">닫기</button>
  </header>
  <div class="score">
    <div class="grade">-</div>
    <div>
      <div class="total">-</div>
      <div class="axes"></div>
    </div>
    <select class="doctype" title="문서 유형"></select>
  </div>
  <div class="banner" hidden></div>
  <div class="status"></div>
  <div class="body"></div>
</aside>
`

const need = <T extends HTMLElement>(root: ShadowRoot, selector: string): T => {
  const found = root.querySelector<T>(selector)
  if (!found) throw new Error(`패널 요소를 찾지 못했습니다: ${selector}`)
  return found
}

export function mountPanel(container: HTMLElement, handlers: PanelHandlers): Panel {
  container.querySelector(`#${HOST_ID}`)?.remove()

  const host = document.createElement('div')
  host.id = HOST_ID
  container.append(host)

  // Confluence의 전역 CSS가 패널을 망가뜨리지 않도록 shadow DOM에 가둔다.
  const root = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = PANEL_STYLES
  root.append(style)
  const holder = document.createElement('div')
  holder.innerHTML = TEMPLATE
  root.append(...Array.from(holder.childNodes))

  const fab = need<HTMLButtonElement>(root, '.fab')
  const badge = need(root, '.badge')
  const aside = need(root, '.panel')
  const grade = need(root, '.grade')
  const total = need(root, '.total')
  const axes = need(root, '.axes')
  const banner = need(root, '.banner')
  const status = need(root, '.status')
  const body = need(root, '.body')
  const doctype = need<HTMLSelectElement>(root, '.doctype')

  doctype.replaceChildren(
    ...DOC_TYPES.map((value) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = DOC_TYPE_LABELS[value]
      return option
    }),
  )
  doctype.addEventListener('change', () => handlers.onDocTypeChange(doctype.value as DocType))

  const open = (): void => aside.classList.add('open')
  const close = (): void => aside.classList.remove('open')

  fab.addEventListener('click', () => {
    open()
    handlers.onRun()
  })
  need(root, '.close').addEventListener('click', close)

  return {
    root,
    body,
    open,
    close,
    setBadge(value) {
      badge.textContent = value ?? ''
    },
    setScore(score) {
      grade.textContent = score?.grade ?? '-'
      if (score) grade.dataset['grade'] = score.grade
      else delete grade.dataset['grade']
      total.textContent = score ? String(score.total) : '-'
      axes.textContent = score
        ? (Object.keys(AXIS_LABELS) as Array<keyof typeof AXIS_LABELS>)
            .map((axis) => `${AXIS_LABELS[axis]} ${score.axes[axis]}`)
            .join(' · ')
        : ''
    },
    setStatus(text) {
      status.textContent = text
    },
    setBanner(text, tone) {
      banner.textContent = text
      banner.hidden = tone === null
      if (tone) banner.dataset['tone'] = tone
      else delete banner.dataset['tone']
    },
    setDocType(value) {
      doctype.value = value
    },
    destroy() {
      host.remove()
    },
  }
}
```

- [ ] **Step 9: 통과 확인**

Run: `pnpm vitest run apps/extension/test/panel.test.ts apps/extension/test/report-cache.test.ts`
Expected: PASS (13 tests)

- [ ] **Step 10: content script를 배선한다**

`apps/extension/src/content/index.ts`:

```typescript
import type { LintReport } from '@ai-lint/contract'
import type { DocType, Document } from '@ai-lint/ir'
import { PORT_NAME, type ContentMessage, type WorkerMessage } from '../shared/messages.js'
import { daysAgo, readCached, writeCached } from '../shared/report-cache.js'
import { loadSettings } from '../shared/settings.js'
import { checkLinks } from './link-check.js'
import { findBaseUrl, findPageId, PageReadError, readPage } from './page-reader.js'
import { mountPanel, type Panel } from './panel/panel.js'

const PHASE_STATUS = { rules: '규칙 검사 중…', llm: 'AI 맥락 검사 중…' } as const

let running = false

function send(panel: Panel, message: ContentMessage, onReport: (report: LintReport) => void): Promise<void> {
  return new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: PORT_NAME })
    port.onDisconnect.addListener(() => resolve())
    port.onMessage.addListener((incoming: WorkerMessage) => {
      switch (incoming.type) {
        case 'progress':
          panel.setStatus(PHASE_STATUS[incoming.phase])
          return
        case 'report':
          panel.setStatus('')
          onReport(incoming.report)
          return
        case 'error':
          panel.setBanner(incoming.message, incoming.kind === 'quota' ? 'warn' : 'error')
          panel.setStatus('')
          return
        case 'doctype-saved':
          port.disconnect()
          resolve()
          return
        case 'done':
          port.disconnect()
          resolve()
      }
    })
    port.postMessage(message)
  })
}

async function applyReport(panel: Panel, report: LintReport): Promise<void> {
  panel.setScore(report.score)
  panel.setDocType(report.docType)
  if (report.truncated) panel.setBanner('문서가 너무 커서 앞부분만 검사했습니다.', 'warn')
  await writeCached(chrome.storage.local, report.documentUri, {
    grade: report.score.grade,
    total: report.score.total,
    createdAt: report.createdAt,
  })
  panel.setBadge(report.score.grade)
}

async function run(panel: Panel): Promise<void> {
  if (running) return
  running = true
  panel.setBanner('', null)
  panel.setStatus('페이지를 읽는 중…')

  try {
    const raw = await readPage(document)
    const doc: Document = await checkLinks(raw, { baseUrl: findBaseUrl(document) })
    await send(panel, { type: 'lint', document: doc }, (report) => void applyReport(panel, report))
  } catch (error) {
    panel.setStatus('')
    panel.setBanner(error instanceof PageReadError ? error.message : '검사에 실패했습니다.', 'error')
  } finally {
    running = false
  }
}

async function changeDocType(panel: Panel, docType: DocType): Promise<void> {
  panel.setStatus('문서 유형을 저장하는 중…')
  await send(panel, { type: 'set-doctype', uri: location.href, docType }, () => {})
  panel.setStatus('')
  await run(panel)
}

async function init(): Promise<void> {
  if (!findPageId(document)) return

  const panel: Panel = mountPanel(document.body, {
    onRun: () => void run(panel),
    onDocTypeChange: (docType) => void changeDocType(panel, docType),
  })

  const cached = await readCached(chrome.storage.local, location.href)
  if (cached) {
    panel.setBadge(cached.grade)
    const days = daysAgo(cached.createdAt, new Date())
    panel.setStatus(days === 0 ? '오늘 검사한 결과가 있습니다.' : `${days}일 전 검사 결과가 있습니다.`)
  }

  const settings = await loadSettings(chrome.storage.sync)
  if (settings.autoRun) {
    panel.open()
    await run(panel)
  }
}

void init()
```

- [ ] **Step 11: 빌드가 되는지 확인한다**

```bash
pnpm --filter @ai-lint/extension build
pnpm turbo typecheck
```

Expected: `dist/content.js`, `dist/sw.js`, `dist/options.js`, `dist/options.html`, `dist/manifest.json`이 생긴다. typecheck 7개 태스크 성공.

번들에 zod가 섞여 들어가지 않았는지 확인한다:

```bash
grep -c "ZodError" apps/extension/dist/content.js || echo "zod 없음"
```

Expected: `zod 없음`. 나오면 `@ai-lint/ir` 또는 `@ai-lint/contract`에서 값을 import한 곳이 있다는 뜻이니 `import type`으로 고친다.

- [ ] **Step 12: dist를 git에서 제외한다**

`.gitignore`에 이미 `dist/`가 있으면 그대로 두고, 없으면 한 줄 추가한다.

- [ ] **Step 13: 커밋**

```bash
git add apps/extension .gitignore
git commit -m "feat(extension): add floating button and shadow DOM panel shell

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: 지적 목록과 위치 보기

**Files:**
- Create: `apps/extension/src/content/panel/render.ts`, `src/content/anchor-locator.ts`, `src/content/highlight.ts`
- Modify: `apps/extension/src/content/index.ts`
- Test: `apps/extension/test/render.test.ts`, `apps/extension/test/anchor-locator.test.ts`

**Interfaces:**
- Consumes: `Panel.body`, `Finding`
- Produces:
  - `renderFindings(body: HTMLElement, findings: Finding[], handlers: FindingHandlers): void` where `interface FindingHandlers { onLocate(finding: Finding): void; onCopy(text: string): void }`
  - `contentRoot(dom: globalThis.Document): Element`, `locate(anchor: SourceAnchor | null, dom: globalThis.Document): Element | null`
  - `highlight(el: Element, dom?: globalThis.Document): void`

- [ ] **Step 1: 렌더링 테스트를 쓴다**

`apps/extension/test/render.test.ts`:

```typescript
// @vitest-environment happy-dom
import type { Finding } from '@ai-lint/contract'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderFindings } from '../src/content/panel/render.js'

const finding = (patch: Partial<Finding>): Finding => ({
  id: 'f1',
  ruleId: 'STR001',
  axis: 'structure',
  severity: 'warning',
  blockId: 'b1',
  anchor: { kind: 'confluence', xpath: './p', textQuote: { exact: '본문' } },
  message: '제목이 없습니다',
  why: 'AI가 문서를 나눌 기준이 사라집니다',
  evidence: null,
  suggestion: null,
  source: 'rule',
  confidence: 1,
  docsUrl: 'https://docs.test/str001.md',
  ...patch,
})

let body: HTMLElement
let handlers: { onLocate: ReturnType<typeof vi.fn>; onCopy: ReturnType<typeof vi.fn> }

beforeEach(() => {
  body = document.createElement('div')
  handlers = { onLocate: vi.fn(), onCopy: vi.fn() }
})

describe('renderFindings', () => {
  it('지적이 없으면 안내만 보여준다', () => {
    renderFindings(body, [], handlers)
    expect(body.querySelector('.empty')?.textContent).toContain('지적할 내용이 없습니다')
  })

  it('심각도별로 묶고 오류를 먼저 둔다', () => {
    renderFindings(
      body,
      [finding({ id: 'a', severity: 'info' }), finding({ id: 'b', severity: 'error' }), finding({ id: 'c', severity: 'error' })],
      handlers,
    )
    const groups = Array.from(body.querySelectorAll('.group'))
    expect(groups.map((g) => g.getAttribute('data-severity'))).toEqual(['error', 'info'])
    expect(groups[0]?.querySelector('h2')?.textContent).toBe('오류 2')
  })

  it('룰 ID, 메시지, 근거를 보여준다', () => {
    renderFindings(body, [finding({ evidence: '세 번째 문단' })], handlers)
    expect(body.querySelector('.rule')?.textContent).toBe('STR001')
    expect(body.querySelector('.message')?.textContent).toBe('제목이 없습니다')
    expect(body.querySelector('.why')?.textContent).toBe('AI가 문서를 나눌 기준이 사라집니다')
    expect(body.querySelector('.evidence')?.textContent).toBe('세 번째 문단')
  })

  it('AI가 찾은 지적에 표식을 붙인다', () => {
    renderFindings(body, [finding({ source: 'llm' })], handlers)
    expect(body.querySelector('.src')?.textContent).toBe('AI')
  })

  it('룰이 찾은 지적에는 표식을 붙이지 않는다', () => {
    renderFindings(body, [finding({})], handlers)
    expect(body.querySelector('.src')).toBeNull()
  })

  it('수정 제안을 전후로 보여주고 복사를 넘긴다', () => {
    renderFindings(body, [finding({ suggestion: { before: '이것', after: '결제 승인 흐름' } })], handlers)
    expect(body.querySelector('.suggestion del')?.textContent).toBe('이것')
    expect(body.querySelector('.suggestion ins')?.textContent).toBe('결제 승인 흐름')

    body.querySelector<HTMLButtonElement>('.copy')?.click()
    expect(handlers.onCopy).toHaveBeenCalledWith('결제 승인 흐름')
  })

  it('위치 보기를 누르면 해당 지적을 넘긴다', () => {
    const target = finding({ id: 'x' })
    renderFindings(body, [target], handlers)
    body.querySelector<HTMLButtonElement>('.locate')?.click()
    expect(handlers.onLocate).toHaveBeenCalledWith(target)
  })

  it('앵커가 없으면 위치 보기 버튼을 만들지 않는다', () => {
    renderFindings(body, [finding({ anchor: null })], handlers)
    expect(body.querySelector('.locate')).toBeNull()
  })

  it('규칙 설명 링크를 새 탭으로 연다', () => {
    renderFindings(body, [finding({})], handlers)
    const docs = body.querySelector<HTMLAnchorElement>('.docs')
    expect(docs?.href).toBe('https://docs.test/str001.md')
    expect(docs?.target).toBe('_blank')
    expect(docs?.rel).toBe('noreferrer')
  })

  it('다시 그리면 이전 결과를 지운다', () => {
    renderFindings(body, [finding({}), finding({ id: 'f2' })], handlers)
    renderFindings(body, [finding({})], handlers)
    expect(body.querySelectorAll('.finding')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: 실패 확인**

Run: `pnpm vitest run apps/extension/test/render.test.ts`
Expected: FAIL — `Cannot find module '../src/content/panel/render.js'`

- [ ] **Step 3: 렌더링을 구현한다**

`apps/extension/src/content/panel/render.ts`:

```typescript
import type { Finding, Severity } from '@ai-lint/contract'
import { SEVERITY_LABELS } from '../../shared/labels.js'

export interface FindingHandlers {
  onLocate(finding: Finding): void
  onCopy(text: string): void
}

const ORDER: Severity[] = ['error', 'warning', 'info']

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function findingItem(finding: Finding, handlers: FindingHandlers): HTMLElement {
  const item = el('li', 'finding')
  item.dataset['severity'] = finding.severity

  const head = el('div', 'finding-head')
  head.append(el('span', 'rule', finding.ruleId))
  // LLM 판정은 확정이 아니다. 어느 쪽이 찾았는지 사용자가 알아야 판단할 수 있다.
  if (finding.source === 'llm') head.append(el('span', 'src', 'AI'))
  item.append(head, el('p', 'message', finding.message), el('p', 'why', finding.why))

  if (finding.evidence) item.append(el('pre', 'evidence', finding.evidence))

  if (finding.suggestion) {
    const box = el('div', 'suggestion')
    const before = document.createElement('del')
    before.textContent = finding.suggestion.before
    const after = document.createElement('ins')
    after.textContent = finding.suggestion.after
    box.append(before, after)
    item.append(box)
  }

  const actions = el('div', 'actions')
  if (finding.anchor) {
    const locate = el('button', 'locate', '위치 보기')
    locate.type = 'button'
    locate.addEventListener('click', () => handlers.onLocate(finding))
    actions.append(locate)
  }
  if (finding.suggestion) {
    const copy = el('button', 'copy', '수정안 복사')
    copy.type = 'button'
    const { after } = finding.suggestion
    copy.addEventListener('click', () => handlers.onCopy(after))
    actions.append(copy)
  }
  const docs = el('a', 'docs', '규칙 설명')
  docs.href = finding.docsUrl
  docs.target = '_blank'
  docs.rel = 'noreferrer'
  actions.append(docs)
  item.append(actions)

  return item
}

export function renderFindings(body: HTMLElement, findings: Finding[], handlers: FindingHandlers): void {
  body.replaceChildren()

  if (findings.length === 0) {
    body.append(el('p', 'empty', '지적할 내용이 없습니다.'))
    return
  }

  for (const severity of ORDER) {
    const group = findings.filter((f) => f.severity === severity)
    if (group.length === 0) continue

    const section = el('section', 'group')
    section.dataset['severity'] = severity
    section.append(el('h2', '', `${SEVERITY_LABELS[severity]} ${group.length}`))

    const list = document.createElement('ul')
    list.append(...group.map((finding) => findingItem(finding, handlers)))
    section.append(list)
    body.append(section)
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `pnpm vitest run apps/extension/test/render.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: 앵커 로케이터 테스트를 쓴다**

`apps/extension/test/anchor-locator.test.ts`:

```typescript
// @vitest-environment happy-dom
import type { SourceAnchor } from '@ai-lint/contract'
import { describe, expect, it } from 'vitest'
import { contentRoot, locate } from '../src/content/anchor-locator.js'

const setup = (html: string): globalThis.Document => {
  const dom = document.implementation.createHTMLDocument('t')
  dom.body.innerHTML = html
  return dom
}

const anchor = (xpath: string, exact: string): SourceAnchor => ({ kind: 'confluence', xpath, textQuote: { exact } })

describe('contentRoot', () => {
  it('본문 컨테이너를 찾는다', () => {
    const dom = setup('<div id="main-content"><p>본문</p></div>')
    expect(contentRoot(dom).id).toBe('main-content')
  })

  it('본문 컨테이너가 없으면 body를 쓴다', () => {
    expect(contentRoot(setup('<p>본문</p>')).tagName).toBe('BODY')
  })
})

describe('locate', () => {
  it('xpath로 찾은 요소가 인용문을 담고 있으면 그것을 쓴다', () => {
    const dom = setup('<div class="wiki-content"><p>첫째</p><p>둘째 문단</p></div>')
    expect(locate(anchor('./p[2]', '둘째 문단'), dom)?.textContent).toBe('둘째 문단')
  })

  it('xpath가 엉뚱한 곳을 짚으면 인용문으로 다시 찾는다', () => {
    const dom = setup('<div class="wiki-content"><p>첫째</p><p>둘째 문단</p></div>')
    // 렌더된 DOM은 storage와 구조가 달라 인덱스가 어긋날 수 있다.
    expect(locate(anchor('./p[1]', '둘째 문단'), dom)?.textContent).toBe('둘째 문단')
  })

  it('xpath가 비어 있어도 인용문으로 찾는다', () => {
    const dom = setup('<div class="wiki-content"><p>구성도 설명</p></div>')
    expect(locate(anchor('', '구성도 설명'), dom)?.textContent).toBe('구성도 설명')
  })

  it('망가진 xpath에도 죽지 않는다', () => {
    const dom = setup('<div class="wiki-content"><p>둘째 문단</p></div>')
    expect(locate(anchor('./ac:image[[', '둘째 문단'), dom)?.textContent).toBe('둘째 문단')
  })

  it('가장 안쪽 요소를 고른다', () => {
    const dom = setup('<div class="wiki-content"><div><section><p>깊은 문단</p></section></div></div>')
    expect(locate(anchor('', '깊은 문단'), dom)?.tagName).toBe('P')
  })

  it('공백 차이를 무시한다', () => {
    const dom = setup('<div class="wiki-content"><p>여러   줄\n  텍스트</p></div>')
    expect(locate(anchor('', '여러 줄 텍스트'), dom)).not.toBeNull()
  })

  it('찾지 못하면 null을 준다', () => {
    const dom = setup('<div class="wiki-content"><p>첫째</p></div>')
    expect(locate(anchor('', '없는 문장'), dom)).toBeNull()
  })

  it('confluence 앵커가 아니면 찾지 않는다', () => {
    const dom = setup('<div class="wiki-content"><p>첫째</p></div>')
    expect(locate({ kind: 'pptx', slide: 1 }, dom)).toBeNull()
    expect(locate(null, dom)).toBeNull()
  })
})
```

- [ ] **Step 6: 실패 확인**

Run: `pnpm vitest run apps/extension/test/anchor-locator.test.ts`
Expected: FAIL — `Cannot find module '../src/content/anchor-locator.js'`

- [ ] **Step 7: 로케이터와 하이라이트를 구현한다**

`apps/extension/src/content/anchor-locator.ts`:

```typescript
import type { SourceAnchor } from '@ai-lint/contract'

const CONTENT_SELECTORS = ['#main-content', '.wiki-content', '#content']
/** 인용문이 길수록 렌더 차이로 어긋날 확률이 높다. 앞부분만 본다. */
const NEEDLE_MAX = 40

const normalize = (text: string | null): string => (text ?? '').replace(/\s+/g, ' ').trim()

export function contentRoot(dom: globalThis.Document): Element {
  for (const selector of CONTENT_SELECTORS) {
    const found = dom.querySelector(selector)
    if (found) return found
  }
  return dom.body
}

function byXPath(xpath: string, root: Element, dom: globalThis.Document): Element | null {
  try {
    const result = dom.evaluate(xpath, root, null, 9 /* FIRST_ORDERED_NODE_TYPE */, null)
    const node = result.singleNodeValue
    return node instanceof Element ? node : null
  } catch {
    // 어댑터가 만든 xpath는 storage 기준이라 렌더된 DOM에서 문법 오류가 날 수 있다.
    return null
  }
}

function deepestMatch(el: Element, needle: string): Element | null {
  if (!normalize(el.textContent).includes(needle)) return null
  for (const child of Array.from(el.children)) {
    const found = deepestMatch(child, needle)
    if (found) return found
  }
  return el
}

export function locate(anchor: SourceAnchor | null, dom: globalThis.Document): Element | null {
  if (!anchor || anchor.kind !== 'confluence') return null

  const root = contentRoot(dom)
  const needle = normalize(anchor.textQuote.exact).slice(0, NEEDLE_MAX)
  if (!needle) return null

  // xpath는 storage 기준이라 렌더된 DOM에서 빗나갈 수 있다. 인용문으로 검증한 뒤에만 믿는다.
  const candidate = anchor.xpath ? byXPath(anchor.xpath, root, dom) : null
  if (candidate && normalize(candidate.textContent).includes(needle)) return candidate

  const found = deepestMatch(root, needle)
  return found === root ? null : found
}
```

`apps/extension/src/content/highlight.ts`:

```typescript
const CLASS = 'ai-lint-highlight'
const STYLE_ID = 'ai-lint-highlight-style'
const DURATION_MS = 2400

const STYLE = `
.${CLASS} {
  outline: 2px solid #f59e0b !important;
  outline-offset: 2px;
  background: rgba(245, 158, 11, 0.15) !important;
  transition: background 200ms ease-out;
}
`

/** 강조 대상은 페이지 본문이라 패널의 shadow DOM 스타일이 닿지 않는다. 문서에 한 번만 심는다. */
function ensureStyle(dom: globalThis.Document): void {
  if (dom.getElementById(STYLE_ID)) return
  const style = dom.createElement('style')
  style.id = STYLE_ID
  style.textContent = STYLE
  dom.head.append(style)
}

export function highlight(el: Element, dom: globalThis.Document = document): void {
  ensureStyle(dom)
  for (const previous of Array.from(dom.querySelectorAll(`.${CLASS}`))) previous.classList.remove(CLASS)

  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add(CLASS)
  setTimeout(() => el.classList.remove(CLASS), DURATION_MS)
}
```

- [ ] **Step 8: 통과 확인**

Run: `pnpm vitest run apps/extension/test/anchor-locator.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 9: content script에 연결한다**

`apps/extension/src/content/index.ts` — import 세 줄을 추가한다:

```typescript
import { locate } from './anchor-locator.js'
import { highlight } from './highlight.js'
import { renderFindings } from './panel/render.js'
```

`applyReport`의 마지막에 목록 렌더링을 붙인다:

```typescript
async function applyReport(panel: Panel, report: LintReport): Promise<void> {
  panel.setScore(report.score)
  panel.setDocType(report.docType)
  if (report.truncated) panel.setBanner('문서가 너무 커서 앞부분만 검사했습니다.', 'warn')
  renderFindings(panel.body, report.findings, {
    onLocate: (finding) => {
      const target = locate(finding.anchor, document)
      if (target) highlight(target)
      else panel.setStatus('본문에서 이 위치를 찾지 못했습니다.')
    },
    onCopy: (text) => void navigator.clipboard.writeText(text),
  })
  await writeCached(chrome.storage.local, report.documentUri, {
    grade: report.score.grade,
    total: report.score.total,
    createdAt: report.createdAt,
  })
  panel.setBadge(report.score.grade)
}
```

- [ ] **Step 10: 전체 확인**

```bash
pnpm vitest run
pnpm turbo typecheck
pnpm --filter @ai-lint/extension build
```

Expected: 전체 테스트 통과, typecheck 성공, `dist/` 생성.

- [ ] **Step 11: 커밋**

```bash
git add apps/extension
git commit -m "feat(extension): render findings and jump to source location

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: Playwright 종단 테스트

스펙 13장이 요구하는 확장 흐름 검증. 목 Confluence 페이지와 목 백엔드를 한 서버에 올려 확장을 실제 크롬에 로드한다.

**Files:**
- Create: `apps/extension/playwright.config.ts`, `apps/extension/e2e/mock-server.ts`, `apps/extension/e2e/fixtures/report.ts`, `apps/extension/e2e/lint.spec.ts`
- Modify: `apps/extension/package.json`, `apps/extension/tsconfig.json`

**Interfaces:**
- Produces: `startMockServer(port: number): Promise<MockServer>` where `interface MockServer { url: string; requests: string[]; close(): Promise<void> }`

- [ ] **Step 1: Playwright를 넣는다**

`apps/extension/package.json`에 스크립트와 개발 의존성을 추가한다:

```json
{
  "scripts": {
    "build": "tsup && tsx scripts/build-assets.ts",
    "typecheck": "tsc -p tsconfig.json",
    "test:e2e": "pnpm build && playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@types/chrome": "^0.0.287",
    "happy-dom": "^15.11.0",
    "tsup": "^8.3.0"
  }
}
```

`apps/extension/tsconfig.json`의 include에 `"e2e"`를 더한다:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM"],
    "types": ["node", "chrome"]
  },
  "include": ["src", "test", "scripts", "e2e"]
}
```

```bash
pnpm install
pnpm --filter @ai-lint/extension exec playwright install chromium
```

vitest는 `apps/*/test/**/*.test.ts`만 모으므로 `e2e/*.spec.ts`는 자동으로 빠진다.

- [ ] **Step 2: Playwright 설정**

`apps/extension/playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 30_000,
  // 확장은 하나의 브라우저 프로필을 공유한다. 병렬로 돌리면 서로의 설정을 덮어쓴다.
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
})
```

- [ ] **Step 3: 목 리포트를 만든다**

`apps/extension/e2e/fixtures/report.ts`:

```typescript
import type { LintReport } from '@ai-lint/contract'

const base = {
  documentUri: 'http://localhost:4181/pages/viewpage.action?pageId=789',
  documentHash: 'hash',
  docType: 'design' as const,
  rulesetId: 'default',
  rulesetVersion: 1,
  stats: { rulesEvaluated: 20, llmFindingsRejected: 0, durationMs: 12 },
  truncated: false,
  cached: false,
  createdAt: '2026-08-22T00:00:00.000Z',
}

const finding = (id: string, ruleId: string, severity: 'error' | 'warning', message: string, exact: string) => ({
  id,
  ruleId,
  axis: 'structure' as const,
  severity,
  blockId: 'b2',
  anchor: { kind: 'confluence' as const, xpath: './p', textQuote: { exact } },
  message,
  why: 'AI가 이 문서를 읽을 때 맥락을 잃습니다.',
  evidence: exact,
  suggestion: { before: '지난번 논의대로', after: '2026-07-10 결제 설계 리뷰에서' },
  source: 'rule' as const,
  confidence: 1,
  docsUrl: `https://docs.test/${ruleId.toLowerCase()}.md`,
})

export const RULES_REPORT: LintReport = {
  ...base,
  reportId: 'rules-1',
  score: { total: 82, grade: 'B', axes: { structure: 85, context: 100, metadata: 60 } },
  findings: [finding('f1', 'META004', 'warning', '담당자가 없습니다', '지난번 논의대로 3단계로 나눠서 진행하기로 했습니다.')],
  llmStatus: 'skipped',
  llmSkipReason: 'disabled',
}

export const LLM_REPORT: LintReport = {
  ...base,
  reportId: 'llm-1',
  score: { total: 68, grade: 'C', axes: { structure: 85, context: 55, metadata: 60 } },
  findings: [
    RULES_REPORT.findings[0]!,
    {
      ...finding('f2', 'CTX001', 'error', '앞선 논의를 가리키기만 합니다', '지난번 논의대로 3단계로 나눠서 진행하기로 했습니다.'),
      axis: 'context',
      source: 'llm',
      confidence: 0.82,
    },
  ],
  llmStatus: 'ok',
}
```

- [ ] **Step 4: 목 서버를 만든다**

`apps/extension/e2e/mock-server.ts`:

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { LLM_REPORT, RULES_REPORT } from './fixtures/report.js'

export interface MockServer {
  url: string
  /** 검사에 넘어온 요청 본문. 2단계 호출이 실제로 일어났는지 확인한다. */
  lintCalls: Array<{ useLlm: boolean }>
  close(): Promise<void>
}

const PAGE_HTML = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="ajs-page-id" content="789" />
    <title>결제 모듈 개편 설계</title>
  </head>
  <body>
    <div id="main-content" class="wiki-content">
      <h1>배경</h1>
      <p>지난번 논의대로 3단계로 나눠서 진행하기로 했습니다.</p>
      <h2>결정</h2>
      <p>승인 절차를 분리합니다.</p>
    </div>
  </body>
</html>`

const CONTENT_JSON = {
  id: '789',
  title: '결제 모듈 개편 설계',
  space: { key: 'ENG' },
  version: { number: 7, when: '2026-07-15T02:00:00.000Z' },
  history: { createdBy: { displayName: '박작성' } },
  metadata: { labels: { results: [{ name: '설계' }] }, properties: {} },
  ancestors: [{ title: '엔지니어링' }],
  body: {
    storage: {
      value:
        '<h1>배경</h1><p>지난번 논의대로 3단계로 나눠서 진행하기로 했습니다.</p><h2>결정</h2><p>승인 절차를 분리합니다.</p>',
    },
  },
}

const readBody = async (request: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const send = (response: ServerResponse, status: number, body: string, type: string): void => {
  response.writeHead(status, { 'content-type': type })
  response.end(body)
}

export async function startMockServer(port: number): Promise<MockServer> {
  const lintCalls: MockServer['lintCalls'] = []

  const server = createServer((request, response) => {
    const path = (request.url ?? '').split('?')[0] ?? ''

    if (request.method === 'OPTIONS') return send(response, 204, '', 'text/plain')
    if (path === '/pages/viewpage.action') return send(response, 200, PAGE_HTML, 'text/html; charset=utf-8')
    if (path === '/rest/api/content/789') return send(response, 200, JSON.stringify(CONTENT_JSON), 'application/json')

    if (path === '/v1/lint' && request.method === 'POST') {
      void readBody(request).then((raw) => {
        const { options } = JSON.parse(raw) as { options: { useLlm: boolean } }
        lintCalls.push({ useLlm: options.useLlm })
        send(response, 200, JSON.stringify(options.useLlm ? LLM_REPORT : RULES_REPORT), 'application/json')
      })
      return
    }

    if (path === '/v1/rulesets') {
      return send(response, 200, JSON.stringify({ rulesets: [{ id: 'default', name: '기본' }] }), 'application/json')
    }

    // 링크 확인용 HEAD 요청은 모두 살아 있다고 답한다.
    send(response, 200, '', 'text/plain')
  })

  await new Promise<void>((resolve) => server.listen(port, resolve))

  return {
    url: `http://localhost:${port}`,
    lintCalls,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  }
}
```

- [ ] **Step 5: 종단 테스트를 쓴다**

`apps/extension/e2e/lint.spec.ts`:

```typescript
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, test, type BrowserContext } from '@playwright/test'
import { startMockServer, type MockServer } from './mock-server.js'

const here = dirname(fileURLToPath(import.meta.url))
const distDir = resolve(here, '../dist')
const PORT = 4181

let server: MockServer
let context: BrowserContext
let profile: string

test.beforeAll(async () => {
  server = await startMockServer(PORT)
  profile = await mkdtemp(join(tmpdir(), 'ai-lint-'))
  context = await chromium.launchPersistentContext(profile, {
    // MV3 확장은 headed 크롬에서만 안정적으로 로드된다.
    headless: false,
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

  // 1단계: 룰 검사 결과
  await expect(page.locator('.grade')).toHaveText('B')
  await expect(page.locator('.finding')).toHaveCount(1)

  // 2단계: LLM 결과가 덮어쓴다
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
```

- [ ] **Step 6: 종단 테스트를 돌린다**

```bash
AI_LINT_ORIGINS="http://localhost:4181/*" pnpm --filter @ai-lint/extension test:e2e
```

PowerShell에서는:

```powershell
$env:AI_LINT_ORIGINS = "http://localhost:4181/*"; pnpm --filter @ai-lint/extension test:e2e
```

Expected: 3 passed.

- [ ] **Step 7: 전체 확인**

```bash
pnpm vitest run
pnpm turbo typecheck
```

Expected: 전체 통과.

- [ ] **Step 8: 커밋**

```bash
git add apps/extension pnpm-lock.yaml
git commit -m "test(extension): add Playwright end-to-end lint flow

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

- [ ] **Step 9: PR을 만들고 머지한다**

```bash
git push -u origin feat/confluence-extension
gh pr create --title "feat: Confluence Chrome extension" --body "$(cat <<'EOF'
## 요약
- `packages/contract`: 백엔드 lint API 계약을 공유 패키지로 분리
- `packages/adapter-confluence`: storage XHTML → Document IR 변환 (블록·앵커·링크·문서유형)
- `apps/extension`: MV3 크롬 확장 — 좌하단 FAB, Shadow DOM 패널, 2단계 검사(룰 → LLM), 위치 보기, 옵션 페이지

## 검증
- 단위 테스트 vitest 전체 통과
- Playwright 종단 테스트 3건 (목 Confluence + 목 백엔드)
- `pnpm turbo typecheck` 통과

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --squash --delete-branch
```

