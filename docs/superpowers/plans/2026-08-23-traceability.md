# 문서간 추적성 검사 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 검사된 문서들의 식별자·링크 관계를 코퍼스 인덱스에 쌓고, 끊긴 참조·중복 정의·미검증 요구사항·상충 서술을 찾아 별도 리포트로 돌려준다.

**Architecture:** `packages/trace`가 순수 로직(식별자 추출 → 인덱스 엔트리 → 그래프 → 결정적 검사 → LLM 상충 대조)을 전부 갖는다. 백엔드는 `/v1/lint` 성공 시 인덱스에 부수 적재하고 `/v1/trace/analyze`로 그래프 판정을 노출한다. 데스크톱은 새 탭에서 그 결과를 표로 보여주고 HTML·Excel로 내보낸다.

**Tech Stack:** TypeScript strict ESM, pnpm workspace + Turborepo, Vitest 3, zod 3.24, Fastify 5, React 19 + Vite 7, fflate.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-08-23-traceability-design.md`
- 추적성 지적은 문서 점수에 들어가지 않는다. `RULE_META`, `resolveRuleset`, `scoreFindings`, 축 가중치는 건드리지 않는다.
- `TRC001`~`TRC006`은 `RULE_META`에 등록하지 않는다.
- 백엔드는 문서 원문을 보관하지 않는다. ID가 등장한 블록의 발췌만 저장하며 상한은 `TraceConfig.snippetChars`(기본 400)다.
- `Document.docType`은 `{ value, confidence, origin }` 객체이고 `LintReport.docType` / `DocIndexEntry.docType`은 평범한 `DocType` 문자열이다.
- `DocType`에 `test` 값은 없다. 테스트 유무는 test 종류 ID 보유로만 판정한다.
- 모든 LLM 경로는 예외를 밖으로 던지지 않는다. 실패하면 결정적 결과만 돌려준다.
- 데스크톱 번들은 `@ai-lint/trace`를 가져오지 않는다. `@ai-lint/contract`의 타입만 쓴다.
- 주석은 "왜"만 적는다. 코드가 스스로 설명하는 내용은 주석으로 쓰지 않는다.
- 커밋 메시지는 영어 `type: description` 형식이고 끝에 `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`를 넣는다.
- 테스트 실행: `pnpm test`(루트 vitest, `packages/*/test/**/*.test.ts` + `apps/*/test/**/*.test.{ts,tsx}`). 타입 검사: `pnpm typecheck`.

---

## 파일 구조

**신규 패키지 `packages/trace`** — 추적성 로직 전부. 의존: `@ai-lint/ir`, `@ai-lint/llm`, `@ai-lint/contract`, `zod`

| 파일 | 책임 |
|---|---|
| `src/config.ts` | `TraceConfig`, `DEFAULT_ID_PATTERNS`, `DEFAULT_TRACE_CONFIG` |
| `src/ids.ts` | 문서 → `IdMention[]` |
| `src/entry.ts` | 문서 → `DocIndexEntry`, URI 정규화 |
| `src/graph.ts` | 엔트리 목록 → `TraceGraph` |
| `src/checks.ts` | TRC001~005 결정적 판정 |
| `src/contradiction.ts` | 후보 쌍 선별 + TRC006 LLM 대조 |
| `src/index.ts` | 배럴 |

**기존 패키지 수정**

| 파일 | 변경 |
|---|---|
| `packages/contract/src/trace.ts` (신규) | `TraceFinding`, `TraceReport`, `TraceRequestSchema` |
| `packages/contract/src/index.ts` | 배럴에 추가 |
| `packages/backend-client/src/client.ts` | `requestTrace` |
| `apps/backend/src/services/counting-provider.ts` (신규) | `lint-service`에서 뽑아낸 호출 계수 래퍼 |
| `apps/backend/src/services/trace-index.ts` (신규) | `TraceIndexStore` 메모리·Postgres 구현 |
| `apps/backend/src/services/trace-service.ts` (신규) | `analyzeTrace` |
| `apps/backend/src/routes/trace.ts` (신규) | `POST /v1/trace/analyze` |
| `apps/backend/src/db/migrations/002_trace.sql` (신규) | `doc_index` 테이블 |
| `apps/backend/src/routes/lint.ts` | 인덱스 부수 적재 |
| `apps/backend/src/app.ts`, `src/index.ts` | 배선 |
| `apps/desktop/src/core/xlsx-writer.ts` (신규) | `export-xlsx.ts`에서 뽑아낸 xlsx 조립기 |
| `apps/desktop/src/core/export-trace.ts` (신규) | `toTraceHtml`, `toTraceXlsx` |
| `apps/desktop/src/ui/TraceTab.tsx` (신규) | 추적성 탭 |
| `apps/desktop/src/App.tsx`, `src/styles.css` | 탭 전환 |

---

### Task 1: `packages/trace` 스캐폴딩과 식별자 추출

**Files:**
- Create: `packages/trace/package.json`, `packages/trace/tsconfig.json`
- Create: `packages/trace/src/config.ts`, `packages/trace/src/ids.ts`, `packages/trace/src/index.ts`
- Test: `packages/trace/test/ids.test.ts`

**Interfaces:**
- Consumes: `Document`, `blockText` from `@ai-lint/ir`
- Produces: `TraceConfig`, `DEFAULT_TRACE_CONFIG`, `DEFAULT_ID_PATTERNS`, `IdKind`, `IdPattern`, `IdMention`, `extractIds(doc, config)`

- [ ] **Step 1: 패키지 뼈대를 만든다**

`packages/trace/package.json`:

```json
{
  "name": "@ai-lint/trace",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@ai-lint/contract": "workspace:*",
    "@ai-lint/ir": "workspace:*",
    "@ai-lint/llm": "workspace:*",
    "zod": "^3.24.0"
  }
}
```

`packages/trace/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "test"]
}
```

그다음 `pnpm install`을 돌려 워크스페이스에 등록한다. `pnpm-workspace.yaml`은 이미 `packages/*`를 잡으므로 수정할 것이 없다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`packages/trace/test/ids.test.ts`:

```typescript
import type { Block, Document } from '@ai-lint/ir'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TRACE_CONFIG } from '../src/config.js'
import { extractIds } from '../src/ids.js'

const heading = (id: string, text: string): Block =>
  ({ id, path: [0], anchor: ANCHOR, kind: 'heading', level: 1, text })

const para = (id: string, text: string): Block =>
  ({ id, path: [0], anchor: ANCHOR, kind: 'paragraph', text })

const docOf = (over: Partial<Document> = {}): Document => ({
  schemaVersion: 1,
  source: { kind: 'confluence', uri: 'https://wiki/a' },
  title: '결제 설계',
  docType: { value: 'design', confidence: 1, origin: 'label' },
  blocks: [],
  links: [],
  metadata: { labels: [] },
  ...over,
})

describe('extractIds', () => {
  it('제목에 있는 ID는 그 문서가 정의한 것으로 본다', () => {
    const mentions = extractIds(docOf({ title: 'REQ-101 결제 한도' }), DEFAULT_TRACE_CONFIG)
    expect(mentions).toEqual([
      { id: 'REQ-101', kind: 'requirement', blockId: null, defining: true, snippet: 'REQ-101 결제 한도' },
    ])
  })

  it('본문 문단의 ID는 참조로 본다', () => {
    const mentions = extractIds(docOf({ blocks: [para('b1', 'REQ-101을 따른다')] }), DEFAULT_TRACE_CONFIG)
    expect(mentions[0]).toMatchObject({ id: 'REQ-101', blockId: 'b1', defining: false })
  })

  it('제목 블록의 ID는 정의로 본다', () => {
    const mentions = extractIds(docOf({ blocks: [heading('b1', 'REQ-101 한도')] }), DEFAULT_TRACE_CONFIG)
    expect(mentions[0]).toMatchObject({ defining: true })
  })

  it('요구사항 문서에서는 본문 요구사항 ID도 정의로 본다', () => {
    const doc = docOf({
      docType: { value: 'requirement', confidence: 1, origin: 'label' },
      blocks: [para('b1', 'REQ-101 결제는 5초 안에 끝난다'), para('b2', 'PROJ-7 참고')],
    })
    const mentions = extractIds(doc, DEFAULT_TRACE_CONFIG)
    expect(mentions.find((m) => m.id === 'REQ-101')?.defining).toBe(true)
    expect(mentions.find((m) => m.id === 'PROJ-7')?.defining).toBe(false)
  })

  it('앞선 패턴이 이긴다', () => {
    const doc = docOf({ blocks: [para('b1', 'REQ-1 TC-2 PROJ-3')] })
    const kinds = Object.fromEntries(extractIds(doc, DEFAULT_TRACE_CONFIG).map((m) => [m.id, m.kind]))
    expect(kinds).toEqual({ 'REQ-1': 'requirement', 'TC-2': 'test', 'PROJ-3': 'ticket' })
  })

  it('발췌는 상한을 넘지 않는다', () => {
    const doc = docOf({ blocks: [para('b1', `REQ-1 ${'가'.repeat(1000)}`)] })
    const [mention] = extractIds(doc, { ...DEFAULT_TRACE_CONFIG, snippetChars: 20 })
    expect(mention?.snippet).toHaveLength(21)
  })

  it('같은 ID가 여러 블록에 있으면 블록마다 남긴다', () => {
    const doc = docOf({ blocks: [para('b1', 'REQ-1'), para('b2', 'REQ-1')] })
    expect(extractIds(doc, DEFAULT_TRACE_CONFIG).map((m) => m.blockId)).toEqual(['b1', 'b2'])
  })
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm vitest run packages/trace`
Expected: FAIL — `Cannot find module '../src/config.js'`

- [ ] **Step 4: `config.ts`를 쓴다**

```typescript
import type { IdPattern } from './ids.js'

export interface TraceConfig {
  patterns: IdPattern[]
  /** 상충 대조에 보낼 문서 쌍 상한 */
  maxPairs: number
  /** 발췌 길이 상한 */
  snippetChars: number
}

export const DEFAULT_ID_PATTERNS: IdPattern[] = [
  { kind: 'requirement', regex: 'REQ-\\d+' },
  { kind: 'test', regex: 'TC-\\d+' },
  { kind: 'ticket', regex: '[A-Z]{2,10}-\\d+' },
]

export const DEFAULT_TRACE_CONFIG: TraceConfig = {
  patterns: DEFAULT_ID_PATTERNS,
  maxPairs: 20,
  snippetChars: 400,
}
```

- [ ] **Step 5: `ids.ts`를 쓴다**

```typescript
import { blockText, type Document } from '@ai-lint/ir'
import type { TraceConfig } from './config.js'

export type IdKind = 'requirement' | 'test' | 'ticket'

export interface IdPattern {
  kind: IdKind
  /** 문자열로 둔다. 설정이 JSON 직렬화를 통과해야 한다. */
  regex: string
}

export interface IdMention {
  id: string
  kind: IdKind
  /** null이면 문서 제목에서 나왔다는 뜻 */
  blockId: string | null
  defining: boolean
  snippet: string
}

/** 앞선 패턴이 이긴다. REQ-1은 ticket 패턴에도 걸리지만 requirement로 남아야 한다. */
function matchIds(text: string, patterns: readonly IdPattern[]): Map<string, IdKind> {
  const found = new Map<string, IdKind>()
  for (const pattern of patterns) {
    for (const match of text.matchAll(new RegExp(pattern.regex, 'g'))) {
      if (!found.has(match[0])) found.set(match[0], pattern.kind)
    }
  }
  return found
}

const snippetOf = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit)}…`

export function extractIds(doc: Document, config: TraceConfig): IdMention[] {
  const mentions: IdMention[] = []
  const definesInBody = doc.docType.value === 'requirement'

  const titleSnippet = snippetOf(doc.title, config.snippetChars)
  for (const [id, kind] of matchIds(doc.title, config.patterns)) {
    mentions.push({ id, kind, blockId: null, defining: true, snippet: titleSnippet })
  }

  for (const block of doc.blocks) {
    const text = blockText(block)
    if (text.length === 0) continue
    const snippet = snippetOf(text, config.snippetChars)
    for (const [id, kind] of matchIds(text, config.patterns)) {
      const defining = block.kind === 'heading' || (definesInBody && kind === 'requirement')
      mentions.push({ id, kind, blockId: block.id, defining, snippet })
    }
  }

  return mentions
}
```

- [ ] **Step 6: `index.ts`를 쓴다**

```typescript
export * from './config.js'
export * from './ids.js'
```

- [ ] **Step 7: 테스트와 타입 검사를 돌린다**

Run: `pnpm vitest run packages/trace && pnpm typecheck`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add packages/trace pnpm-lock.yaml
git commit -m "feat: add trace package with identifier extraction

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: 인덱스 엔트리와 그래프

**Files:**
- Create: `packages/trace/src/entry.ts`, `packages/trace/src/graph.ts`
- Modify: `packages/trace/src/index.ts`
- Test: `packages/trace/test/graph.test.ts`

**Interfaces:**
- Consumes: `extractIds`, `IdMention`, `IdKind`, `TraceConfig` (Task 1)
- Produces: `DocIndexEntry`, `normalizeUri(href)`, `toIndexEntry(doc, documentHash, config)`, `TraceGraph`, `buildGraph(entries)`, `definedIds(entry)`, `referencedIds(entry)`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/trace/test/graph.test.ts`:

```typescript
import type { Block, Document } from '@ai-lint/ir'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TRACE_CONFIG } from '../src/config.js'
import { normalizeUri, referencedIds, toIndexEntry, type DocIndexEntry } from '../src/entry.js'
import { buildGraph } from '../src/graph.js'

const para = (id: string, text: string): Block =>
  ({ id, path: [0], anchor: ANCHOR, kind: 'paragraph', text })

const docOf = (over: Partial<Document> = {}): Document => ({
  schemaVersion: 1,
  source: { kind: 'confluence', uri: 'https://wiki/a' },
  title: '결제 설계',
  docType: { value: 'design', confidence: 1, origin: 'label' },
  blocks: [],
  links: [],
  metadata: { labels: [] },
  ...over,
})

describe('normalizeUri', () => {
  it('프래그먼트와 쿼리와 끝 슬래시를 떼낸다', () => {
    expect(normalizeUri('https://wiki/pages/12/?a=1#sec')).toBe('https://wiki/pages/12')
  })

  it('경로 없는 루트는 그대로 둔다', () => {
    expect(normalizeUri('/')).toBe('/')
  })
})

describe('toIndexEntry', () => {
  it('문서를 엔트리로 옮긴다', () => {
    const doc = docOf({
      source: { kind: 'confluence', uri: 'https://wiki/a', modifiedAt: '2026-08-01T00:00:00.000Z' },
      title: 'REQ-1 결제',
      blocks: [para('b1', 'TC-9로 검증한다')],
      links: [
        { blockId: 'b1', text: '요구사항', href: 'https://wiki/req#top', target: 'internal' },
        { blockId: 'b1', text: '구글', href: 'https://google.com', target: 'external' },
      ],
    })

    const entry = toIndexEntry(doc, 'h1', DEFAULT_TRACE_CONFIG)

    expect(entry).toMatchObject({
      uri: 'https://wiki/a',
      title: 'REQ-1 결제',
      docType: 'design',
      documentHash: 'h1',
      modifiedAt: '2026-08-01T00:00:00.000Z',
      linksTo: ['https://wiki/req'],
    })
  })

  it('modifiedAt이 없으면 null로 둔다', () => {
    expect(toIndexEntry(docOf(), 'h1', DEFAULT_TRACE_CONFIG).modifiedAt).toBeNull()
  })

  it('정의한 ID는 참조 목록에 넣지 않는다', () => {
    const doc = docOf({ title: 'REQ-1', blocks: [para('b1', 'REQ-1과 REQ-2')] })
    expect(referencedIds(toIndexEntry(doc, 'h1', DEFAULT_TRACE_CONFIG))).toEqual(['REQ-2'])
  })
})

const entryOf = (uri: string, over: Partial<DocIndexEntry> = {}): DocIndexEntry => ({
  uri,
  title: uri,
  docType: 'design',
  documentHash: 'h',
  modifiedAt: null,
  mentions: [],
  linksTo: [],
  ...over,
})

const mention = (id: string, defining: boolean, kind: 'requirement' | 'test' | 'ticket' = 'requirement') =>
  ({ id, kind, blockId: 'b1', defining, snippet: id })

describe('buildGraph', () => {
  it('정의와 참조를 ID별로 모은다', () => {
    const graph = buildGraph([
      entryOf('doc-a', { mentions: [mention('REQ-1', true)] }),
      entryOf('doc-b', { mentions: [mention('REQ-1', false)] }),
      entryOf('doc-c', { mentions: [mention('REQ-1', false)] }),
    ])

    expect(graph.definedBy.get('REQ-1')).toEqual(['doc-a'])
    expect(graph.referencedBy.get('REQ-1')).toEqual(['doc-b', 'doc-c'])
    expect(graph.byUri.get('doc-b')?.uri).toBe('doc-b')
  })

  it('ID 종류를 기억한다', () => {
    const graph = buildGraph([entryOf('doc-a', { mentions: [mention('TC-1', false, 'test')] })])
    expect(graph.kinds.get('TC-1')).toBe('test')
  })

  it('uri 목록을 정렬해 결정적으로 만든다', () => {
    const graph = buildGraph([
      entryOf('doc-z', { mentions: [mention('REQ-1', false)] }),
      entryOf('doc-a', { mentions: [mention('REQ-1', false)] }),
    ])
    expect(graph.referencedBy.get('REQ-1')).toEqual(['doc-a', 'doc-z'])
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run packages/trace/test/graph.test.ts`
Expected: FAIL — `Cannot find module '../src/entry.js'`

- [ ] **Step 3: `entry.ts`를 쓴다**

```typescript
import type { DocType, Document } from '@ai-lint/ir'
import type { TraceConfig } from './config.js'
import { extractIds, type IdMention } from './ids.js'

export interface DocIndexEntry {
  uri: string
  title: string
  docType: DocType
  documentHash: string
  modifiedAt: string | null
  mentions: IdMention[]
  linksTo: string[]
}

/** 같은 페이지를 가리키는 링크가 서로 다른 문자열로 갈라지지 않게 한다. */
export function normalizeUri(href: string): string {
  const base = href.split('#')[0]!.split('?')[0]!
  return base.length > 1 ? base.replace(/\/+$/, '') : base
}

const unique = (values: readonly string[]): string[] => [...new Set(values)]

export const definedIds = (entry: DocIndexEntry): string[] =>
  unique(entry.mentions.filter((m) => m.defining).map((m) => m.id))

/** 정의한 ID는 참조로 세지 않는다. 자기 문서를 자기가 참조한 것으로 잡히면 안 된다. */
export function referencedIds(entry: DocIndexEntry): string[] {
  const defined = new Set(definedIds(entry))
  return unique(entry.mentions.map((m) => m.id)).filter((id) => !defined.has(id))
}

/** 해시는 lint 리포트가 이미 계산해 두었다. 다시 재지 않는다. */
export function toIndexEntry(doc: Document, documentHash: string, config: TraceConfig): DocIndexEntry {
  return {
    uri: doc.source.uri,
    title: doc.title,
    docType: doc.docType.value,
    documentHash,
    modifiedAt: doc.source.modifiedAt ?? null,
    mentions: extractIds(doc, config),
    linksTo: unique(doc.links.filter((l) => l.target === 'internal').map((l) => normalizeUri(l.href))),
  }
}
```

- [ ] **Step 4: `graph.ts`를 쓴다**

```typescript
import { definedIds, referencedIds, type DocIndexEntry } from './entry.js'
import type { IdKind } from './ids.js'

export interface TraceGraph {
  entries: DocIndexEntry[]
  byUri: Map<string, DocIndexEntry>
  /** ID → 그 ID를 정의하는 문서 uri */
  definedBy: Map<string, string[]>
  /** ID → 그 ID를 참조하는 문서 uri */
  referencedBy: Map<string, string[]>
  kinds: Map<string, IdKind>
}

const push = (map: Map<string, string[]>, key: string, value: string): void => {
  const list = map.get(key)
  if (list === undefined) map.set(key, [value])
  else list.push(value)
}

export function buildGraph(entries: readonly DocIndexEntry[]): TraceGraph {
  const definedBy = new Map<string, string[]>()
  const referencedBy = new Map<string, string[]>()
  const kinds = new Map<string, IdKind>()

  for (const entry of entries) {
    for (const mention of entry.mentions) {
      if (!kinds.has(mention.id)) kinds.set(mention.id, mention.kind)
    }
    for (const id of definedIds(entry)) push(definedBy, id, entry.uri)
    for (const id of referencedIds(entry)) push(referencedBy, id, entry.uri)
  }

  // 판정 결과가 입력 순서에 흔들리지 않아야 같은 코퍼스에서 같은 리포트가 나온다.
  for (const list of [...definedBy.values(), ...referencedBy.values()]) list.sort()

  return {
    entries: [...entries].sort((a, b) => a.uri.localeCompare(b.uri)),
    byUri: new Map(entries.map((e) => [e.uri, e])),
    definedBy,
    referencedBy,
    kinds,
  }
}

export const allIds = (graph: TraceGraph): string[] => [...graph.kinds.keys()].sort()
```

- [ ] **Step 5: 배럴에 더한다**

`packages/trace/src/index.ts`:

```typescript
export * from './config.js'
export * from './ids.js'
export * from './entry.js'
export * from './graph.js'
```

- [ ] **Step 6: 테스트와 타입 검사를 돌린다**

Run: `pnpm vitest run packages/trace && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add packages/trace
git commit -m "feat: build traceability index entries and graph

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 계약 타입과 결정적 검사 TRC001~005

**Files:**
- Create: `packages/contract/src/trace.ts`, `packages/trace/src/checks.ts`
- Modify: `packages/contract/src/index.ts`, `packages/trace/src/index.ts`
- Test: `packages/trace/test/checks.test.ts`

**Interfaces:**
- Consumes: `TraceGraph`, `buildGraph`, `DocIndexEntry` (Task 2)
- Produces: `TraceFinding`, `TraceReport`, `TraceRequestSchema`, `TraceRequest`, `TRACE_RULES`, `runTraceChecks(graph)`

- [ ] **Step 1: 계약 타입을 쓴다**

`packages/contract/src/trace.ts`:

```typescript
import type { Severity } from '@ai-lint/rules'
import { z } from 'zod'
import type { LlmSkipReason, LlmStatus } from './report.js'

export const TraceRequestSchema = z.object({ useLlm: z.boolean().default(true) }).default({})
export type TraceRequest = z.infer<typeof TraceRequestSchema>

export interface TraceDocumentRef {
  uri: string
  title: string
}

export interface TraceFinding {
  id: string
  ruleId: string
  severity: Severity
  message: string
  why: string
  /** 이 지적에 걸린 문서들 */
  documents: TraceDocumentRef[]
  subjectId: string | null
  evidence: string | null
  source: 'rule' | 'llm'
  confidence: number
}

export interface TraceReport {
  reportId: string
  /** 인덱스에 쌓인 문서 수 */
  documentCount: number
  /** 그래프에 등장한 고유 ID 수 */
  idCount: number
  findings: TraceFinding[]
  stats: {
    pairsConsidered: number
    pairsAnalyzed: number
    llmFindingsRejected: number
    durationMs: number
  }
  llmStatus: LlmStatus
  llmSkipReason?: LlmSkipReason
  /** 후보 쌍 상한에 걸려 일부만 대조했다 */
  truncated: boolean
  createdAt: string
}
```

`packages/contract/src/index.ts`에 한 줄 더한다:

```typescript
export * from './report.js'
export * from './trace.js'
export type { Axis, DocType, Document, Finding, Grade, Score, Severity, SourceAnchor } from '@ai-lint/rules'
```

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`packages/trace/test/checks.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import type { DocIndexEntry } from '../src/entry.js'
import { buildGraph } from '../src/graph.js'
import type { IdKind } from '../src/ids.js'
import { runTraceChecks } from '../src/checks.js'

const mention = (id: string, defining: boolean, kind: IdKind = 'requirement') =>
  ({ id, kind, blockId: 'b1', defining, snippet: id })

const entryOf = (uri: string, over: Partial<DocIndexEntry> = {}): DocIndexEntry => ({
  uri,
  title: uri,
  docType: 'design',
  documentHash: 'h',
  modifiedAt: null,
  mentions: [],
  linksTo: [],
  ...over,
})

const rulesOf = (entries: DocIndexEntry[]): string[] =>
  runTraceChecks(buildGraph(entries)).map((f) => f.ruleId)

describe('TRC001 정의되지 않은 참조', () => {
  it('아무도 정의하지 않은 ID를 참조하면 걸린다', () => {
    const findings = runTraceChecks(buildGraph([entryOf('doc-a', { mentions: [mention('REQ-9', false)] })]))
    const trc001 = findings.find((f) => f.ruleId === 'TRC001')
    expect(trc001).toMatchObject({ severity: 'error', subjectId: 'REQ-9' })
    expect(trc001?.documents).toEqual([{ uri: 'doc-a', title: 'doc-a' }])
  })

  it('정의한 문서가 있으면 걸리지 않는다', () => {
    const rules = rulesOf([
      entryOf('doc-a', { mentions: [mention('REQ-9', false), mention('TC-1', false, 'test')] }),
      entryOf('req', { docType: 'requirement', mentions: [mention('REQ-9', true)] }),
    ])
    expect(rules).not.toContain('TRC001')
  })
})

describe('TRC002 요구사항을 참조하지 않는 설계', () => {
  it('설계 문서가 요구사항을 안 걸면 걸린다', () => {
    const findings = runTraceChecks(buildGraph([entryOf('doc-a', { docType: 'design' })]))
    expect(findings.find((f) => f.ruleId === 'TRC002')).toMatchObject({
      severity: 'warning',
      subjectId: null,
      documents: [{ uri: 'doc-a', title: 'doc-a' }],
    })
  })

  it('설계가 아니면 보지 않는다', () => {
    expect(rulesOf([entryOf('doc-a', { docType: 'guide' })])).not.toContain('TRC002')
  })
})

describe('TRC003 테스트 없는 요구사항', () => {
  it('참조 문서에 테스트 ID가 없으면 걸린다', () => {
    const rules = rulesOf([
      entryOf('req', { docType: 'requirement', mentions: [mention('REQ-1', true)] }),
      entryOf('doc-a', { mentions: [mention('REQ-1', false)] }),
    ])
    expect(rules).toContain('TRC003')
  })

  it('참조 문서 중 하나라도 테스트 ID를 가지면 걸리지 않는다', () => {
    const rules = rulesOf([
      entryOf('req', { docType: 'requirement', mentions: [mention('REQ-1', true)] }),
      entryOf('doc-a', { mentions: [mention('REQ-1', false), mention('TC-3', false, 'test')] }),
    ])
    expect(rules).not.toContain('TRC003')
  })

  it('요구사항이 아닌 ID는 보지 않는다', () => {
    const rules = rulesOf([entryOf('doc-a', { mentions: [mention('PROJ-1', true, 'ticket')] })])
    expect(rules).not.toContain('TRC003')
  })
})

describe('TRC004 중복 정의', () => {
  it('두 문서가 같은 ID를 정의하면 둘 다 담아 걸린다', () => {
    const findings = runTraceChecks(
      buildGraph([
        entryOf('doc-a', { mentions: [mention('REQ-1', true)] }),
        entryOf('doc-b', { mentions: [mention('REQ-1', true)] }),
      ]),
    )
    const trc004 = findings.find((f) => f.ruleId === 'TRC004')
    expect(trc004?.severity).toBe('error')
    expect(trc004?.documents.map((d) => d.uri)).toEqual(['doc-a', 'doc-b'])
  })
})

describe('TRC005 인덱스에 없는 링크 대상', () => {
  it('대상이 없으면 참고로 알린다', () => {
    const findings = runTraceChecks(buildGraph([entryOf('doc-a', { linksTo: ['doc-z'] })]))
    expect(findings.find((f) => f.ruleId === 'TRC005')).toMatchObject({ severity: 'info' })
  })

  it('대상이 인덱스에 있으면 걸리지 않는다', () => {
    const rules = rulesOf([entryOf('doc-a', { linksTo: ['doc-b'] }), entryOf('doc-b')])
    expect(rules).not.toContain('TRC005')
  })
})

describe('정렬', () => {
  it('심각도가 높은 것부터 놓는다', () => {
    const findings = runTraceChecks(
      buildGraph([
        entryOf('doc-a', { linksTo: ['doc-z'], mentions: [mention('REQ-9', false)] }),
        entryOf('doc-b', { docType: 'design' }),
      ]),
    )
    expect(findings.map((f) => f.severity)).toEqual([...findings.map((f) => f.severity)].sort())
    expect(findings[0]?.severity).toBe('error')
  })

  it('지적 id는 서로 다르다', () => {
    const findings = runTraceChecks(
      buildGraph([
        entryOf('doc-a', { linksTo: ['x', 'y'] }),
        entryOf('doc-b', { linksTo: ['x'] }),
      ]),
    )
    expect(new Set(findings.map((f) => f.id)).size).toBe(findings.length)
  })
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm vitest run packages/trace/test/checks.test.ts`
Expected: FAIL — `Cannot find module '../src/checks.js'`

- [ ] **Step 4: `checks.ts`를 쓴다**

```typescript
import type { TraceDocumentRef, TraceFinding } from '@ai-lint/contract'
import type { Severity } from '@ai-lint/rules'
import { referencedIds, type DocIndexEntry } from './entry.js'
import type { TraceGraph } from './graph.js'

export interface TraceRuleMeta {
  severity: Severity
  message: string
}

/** RULE_META에는 넣지 않는다. 이 룰들은 단일 문서 검사에서 실행될 수 없다. */
export const TRACE_RULES = {
  TRC001: { severity: 'error', message: '정의되지 않은 식별자를 참조합니다' },
  TRC002: { severity: 'warning', message: '설계 문서가 요구사항을 참조하지 않습니다' },
  TRC003: { severity: 'warning', message: '요구사항에 연결된 테스트가 없습니다' },
  TRC004: { severity: 'error', message: '같은 식별자를 두 문서가 정의합니다' },
  TRC005: { severity: 'info', message: '링크 대상 문서가 인덱스에 없습니다' },
  TRC006: { severity: 'error', message: '같은 식별자에 대한 서술이 서로 어긋납니다' },
} as const satisfies Record<string, TraceRuleMeta>

export type TraceRuleId = keyof typeof TRACE_RULES

const SEVERITY_RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 }

const refOf = (entry: DocIndexEntry): TraceDocumentRef => ({ uri: entry.uri, title: entry.title })

const refsOf = (graph: TraceGraph, uris: readonly string[]): TraceDocumentRef[] =>
  uris.map((uri) => graph.byUri.get(uri)).filter((e): e is DocIndexEntry => e !== undefined).map(refOf)

function finding(
  ruleId: TraceRuleId,
  id: string,
  why: string,
  documents: TraceDocumentRef[],
  subjectId: string | null,
): TraceFinding {
  const meta = TRACE_RULES[ruleId]
  return {
    id,
    ruleId,
    severity: meta.severity,
    message: meta.message,
    why,
    documents,
    subjectId,
    evidence: null,
    source: 'rule',
    confidence: 1,
  }
}

function undefinedReferences(graph: TraceGraph): TraceFinding[] {
  const findings: TraceFinding[] = []
  for (const [id, uris] of graph.referencedBy) {
    if ((graph.definedBy.get(id)?.length ?? 0) > 0) continue
    findings.push(
      finding(
        'TRC001',
        `TRC001:${id}`,
        `${id}을(를) 정의하는 문서가 인덱스에 없습니다. 원본 문서를 검사해 인덱스에 넣거나 참조를 고치세요.`,
        refsOf(graph, uris),
        id,
      ),
    )
  }
  return findings
}

function designsWithoutRequirements(graph: TraceGraph): TraceFinding[] {
  return graph.entries
    .filter((entry) => entry.docType === 'design')
    .filter((entry) => !entry.mentions.some((m) => m.kind === 'requirement'))
    .map((entry) =>
      finding(
        'TRC002',
        `TRC002:${entry.uri}`,
        '이 설계가 어떤 요구사항을 푸는지 문서만 보고는 알 수 없습니다. 요구사항 식별자를 본문에 적으세요.',
        [refOf(entry)],
        null,
      ),
    )
}

function untestedRequirements(graph: TraceGraph): TraceFinding[] {
  const findings: TraceFinding[] = []
  for (const [id, definers] of graph.definedBy) {
    if (graph.kinds.get(id) !== 'requirement') continue

    const referrers = graph.referencedBy.get(id) ?? []
    const tested = referrers.some((uri) =>
      graph.byUri.get(uri)?.mentions.some((m) => m.kind === 'test') === true,
    )
    if (tested) continue

    findings.push(
      finding(
        'TRC003',
        `TRC003:${id}`,
        `${id}을(를) 참조하는 문서 중 테스트 식별자를 가진 것이 없습니다. 검증 근거가 문서로 남지 않았습니다.`,
        refsOf(graph, definers),
        id,
      ),
    )
  }
  return findings
}

function duplicateDefinitions(graph: TraceGraph): TraceFinding[] {
  const findings: TraceFinding[] = []
  for (const [id, uris] of graph.definedBy) {
    if (uris.length < 2) continue
    findings.push(
      finding(
        'TRC004',
        `TRC004:${id}`,
        `${id}을(를) ${uris.length}개 문서가 정의합니다. 어느 쪽이 원본인지 알 수 없습니다.`,
        refsOf(graph, uris),
        id,
      ),
    )
  }
  return findings
}

function danglingLinks(graph: TraceGraph): TraceFinding[] {
  const findings: TraceFinding[] = []
  for (const entry of graph.entries) {
    for (const target of entry.linksTo) {
      if (graph.byUri.has(target)) continue
      findings.push(
        finding(
          'TRC005',
          `TRC005:${entry.uri}:${target}`,
          `${target}이(가) 인덱스에 없습니다. 끊긴 링크이거나 아직 검사하지 않은 문서입니다.`,
          [refOf(entry)],
          null,
        ),
      )
    }
  }
  return findings
}

export function sortTraceFindings(findings: readonly TraceFinding[]): TraceFinding[] {
  return [...findings].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      a.id.localeCompare(b.id),
  )
}

export function runTraceChecks(graph: TraceGraph): TraceFinding[] {
  return sortTraceFindings([
    ...undefinedReferences(graph),
    ...designsWithoutRequirements(graph),
    ...untestedRequirements(graph),
    ...duplicateDefinitions(graph),
    ...danglingLinks(graph),
  ])
}
```

`referencedIds` import가 쓰이지 않으면 지운다.

- [ ] **Step 5: 배럴에 더한다**

`packages/trace/src/index.ts`에 `export * from './checks.js'` 한 줄을 더한다.

- [ ] **Step 6: 테스트와 타입 검사를 돌린다**

Run: `pnpm vitest run packages/trace && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add packages/contract packages/trace
git commit -m "feat: add deterministic traceability checks TRC001-005

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 상충 탐지 TRC006

**Files:**
- Create: `packages/trace/src/contradiction.ts`
- Modify: `packages/trace/src/index.ts`
- Test: `packages/trace/test/contradiction.test.ts`

**Interfaces:**
- Consumes: `TraceGraph`, `DocIndexEntry`, `TRACE_RULES`, `sortTraceFindings`; `LlmProvider`, `evidenceFound`, `AnalyzeStatus` from `@ai-lint/llm`
- Produces: `ContradictionPair`, `selectPairs(graph, maxPairs)`, `ContradictionOptions`, `ContradictionResult`, `analyzeContradictions(pairs, provider, opts)`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/trace/test/contradiction.test.ts`:

```typescript
import type { CompletionRequest, LlmProvider } from '@ai-lint/llm'
import { describe, expect, it } from 'vitest'
import { analyzeContradictions, selectPairs } from '../src/contradiction.js'
import type { DocIndexEntry } from '../src/entry.js'
import { buildGraph } from '../src/graph.js'
import type { IdKind } from '../src/ids.js'

const mention = (id: string, snippet: string, kind: IdKind = 'requirement') =>
  ({ id, kind, blockId: 'b1', defining: false, snippet })

const entryOf = (uri: string, mentions: DocIndexEntry['mentions']): DocIndexEntry => ({
  uri,
  title: uri,
  docType: 'design',
  documentHash: 'h',
  modifiedAt: null,
  mentions,
  linksTo: [],
})

const providerOf = (reply: unknown | (() => never)): LlmProvider & { seen: CompletionRequest[] } => {
  const seen: CompletionRequest[] = []
  return {
    seen,
    name: 'mock',
    async complete(req) {
      seen.push(req)
      if (typeof reply === 'function') return (reply as () => never)()
      return reply
    },
  }
}

describe('selectPairs', () => {
  it('ID를 공유하는 쌍만 고른다', () => {
    const graph = buildGraph([
      entryOf('a', [mention('REQ-1', 'REQ-1 한도는 100이다')]),
      entryOf('b', [mention('REQ-1', 'REQ-1 한도는 200이다')]),
      entryOf('c', [mention('REQ-9', 'REQ-9는 별개다')]),
    ])
    const { pairs } = selectPairs(graph, 10)
    expect(pairs).toHaveLength(1)
    expect([pairs[0]?.a.uri, pairs[0]?.b.uri]).toEqual(['a', 'b'])
    expect(pairs[0]?.sharedIds).toEqual(['REQ-1'])
  })

  it('공유 ID가 많은 쌍을 앞에 놓는다', () => {
    const graph = buildGraph([
      entryOf('a', [mention('REQ-1', 'x'), mention('REQ-2', 'y')]),
      entryOf('b', [mention('REQ-1', 'x'), mention('REQ-2', 'y')]),
      entryOf('c', [mention('REQ-1', 'x')]),
    ])
    const { pairs } = selectPairs(graph, 10)
    expect([pairs[0]?.a.uri, pairs[0]?.b.uri]).toEqual(['a', 'b'])
  })

  it('상한을 넘으면 자르고 원래 수를 알려준다', () => {
    const graph = buildGraph([
      entryOf('a', [mention('REQ-1', 'x')]),
      entryOf('b', [mention('REQ-1', 'x')]),
      entryOf('c', [mention('REQ-1', 'x')]),
    ])
    const { pairs, considered } = selectPairs(graph, 1)
    expect(pairs).toHaveLength(1)
    expect(considered).toBe(3)
  })
})

describe('analyzeContradictions', () => {
  const graph = buildGraph([
    entryOf('a', [mention('REQ-1', 'REQ-1 결제 한도는 100만원이다')]),
    entryOf('b', [mention('REQ-1', 'REQ-1 결제 한도는 200만원이다')]),
  ])
  const pairs = selectPairs(graph, 10).pairs

  it('근거가 원문에 있으면 지적으로 채택한다', async () => {
    const provider = providerOf({
      contradictions: [
        {
          subjectId: 'REQ-1',
          quoteA: '결제 한도는 100만원이다',
          quoteB: '결제 한도는 200만원이다',
          why: '같은 요구사항의 한도가 다릅니다',
          confidence: 0.9,
        },
      ],
    })

    const result = await analyzeContradictions(pairs, provider)

    expect(result.status).toBe('ok')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]).toMatchObject({
      ruleId: 'TRC006',
      severity: 'error',
      source: 'llm',
      subjectId: 'REQ-1',
    })
    expect(result.findings[0]?.documents.map((d) => d.uri)).toEqual(['a', 'b'])
  })

  it('원문에 없는 근거는 버린다', async () => {
    const provider = providerOf({
      contradictions: [
        {
          subjectId: 'REQ-1',
          quoteA: '한도는 무제한이다',
          quoteB: '결제 한도는 200만원이다',
          why: '지어낸 근거',
          confidence: 0.95,
        },
      ],
    })

    const result = await analyzeContradictions(pairs, provider)

    expect(result.findings).toHaveLength(0)
    expect(result.rejectedCount).toBe(1)
  })

  it('신뢰도가 낮으면 버린다', async () => {
    const provider = providerOf({
      contradictions: [
        {
          subjectId: 'REQ-1',
          quoteA: '결제 한도는 100만원이다',
          quoteB: '결제 한도는 200만원이다',
          why: '확신이 없다',
          confidence: 0.2,
        },
      ],
    })

    expect((await analyzeContradictions(pairs, provider)).findings).toHaveLength(0)
  })

  it('LLM이 죽어도 던지지 않고 failed로 알린다', async () => {
    const provider = providerOf(() => {
      throw new Error('boom')
    })

    const result = await analyzeContradictions(pairs, provider)

    expect(result.status).toBe('failed')
    expect(result.findings).toEqual([])
  })

  it('공유 ID의 발췌만 프롬프트에 넣는다', async () => {
    const wide = buildGraph([
      entryOf('a', [mention('REQ-1', 'REQ-1 한도 100'), mention('REQ-7', '비밀번호 규칙')]),
      entryOf('b', [mention('REQ-1', 'REQ-1 한도 200')]),
    ])
    const provider = providerOf({ contradictions: [] })

    await analyzeContradictions(selectPairs(wide, 10).pairs, provider)

    expect(provider.seen[0]?.user).toContain('REQ-1 한도 100')
    expect(provider.seen[0]?.user).not.toContain('비밀번호 규칙')
  })

  it('쌍이 없으면 LLM을 부르지 않는다', async () => {
    const provider = providerOf({ contradictions: [] })
    const result = await analyzeContradictions([], provider)
    expect(provider.seen).toHaveLength(0)
    expect(result.status).toBe('ok')
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run packages/trace/test/contradiction.test.ts`
Expected: FAIL — `Cannot find module '../src/contradiction.js'`

- [ ] **Step 3: `contradiction.ts`를 쓴다**

```typescript
import type { TraceFinding } from '@ai-lint/contract'
import { evidenceFound, type AnalyzeStatus, type JsonSchema, type LlmProvider } from '@ai-lint/llm'
import { z } from 'zod'
import { TRACE_RULES, sortTraceFindings } from './checks.js'
import type { DocIndexEntry } from './entry.js'
import type { TraceGraph } from './graph.js'

export interface ContradictionPair {
  sharedIds: string[]
  a: DocIndexEntry
  b: DocIndexEntry
}

export interface ContradictionOptions {
  minConfidence?: number
  concurrency?: number
  maxTokens?: number
  onPairError?: (pair: ContradictionPair, error: unknown) => void
}

export interface ContradictionResult {
  findings: TraceFinding[]
  status: AnalyzeStatus
  rejectedCount: number
}

const DEFAULT_MIN_CONFIDENCE = 0.6
const DEFAULT_CONCURRENCY = 3
const DEFAULT_MAX_TOKENS = 2048

const CONTRADICTION_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    contradictions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subjectId: { type: 'string' },
          quoteA: { type: 'string' },
          quoteB: { type: 'string' },
          why: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['subjectId', 'quoteA', 'quoteB', 'why', 'confidence'],
      },
    },
  },
  required: ['contradictions'],
}

const CandidateSchema = z.object({
  subjectId: z.string().min(1),
  quoteA: z.string().min(1),
  quoteB: z.string().min(1),
  why: z.string().min(1),
  confidence: z.number().min(0).max(1),
})

const SYSTEM_PROMPT = `당신은 기술 문서 감사자다.
같은 식별자를 다루는 두 문서의 발췌를 받아, 서로 모순되는 서술만 찾아낸다.

지켜야 할 것:
- 두 발췌에 실제로 적힌 문장만 인용한다. 없는 문장을 지어내면 그 지적은 폐기된다.
- 표현이 다를 뿐 같은 뜻이면 상충이 아니다. 수치, 조건, 책임 주체가 실제로 어긋날 때만 보고한다.
- 한쪽에만 있는 내용은 상충이 아니다.
- 확신이 없으면 confidence를 낮게 준다.
- why는 한국어 한두 문장으로 무엇이 어긋나는지 적는다.`

function snippetsFor(entry: DocIndexEntry, ids: ReadonlySet<string>): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const mention of entry.mentions) {
    if (!ids.has(mention.id) || seen.has(mention.snippet)) continue
    seen.add(mention.snippet)
    lines.push(`- ${mention.snippet}`)
  }
  return lines.join('\n')
}

function buildUserPrompt(pair: ContradictionPair): string {
  const ids = new Set(pair.sharedIds)
  return [
    `공유 식별자: ${pair.sharedIds.join(', ')}`,
    '',
    `[문서 A] ${pair.a.title}`,
    snippetsFor(pair.a, ids),
    '',
    `[문서 B] ${pair.b.title}`,
    snippetsFor(pair.b, ids),
  ].join('\n')
}

/** 같은 ID를 다루는 문서 쌍만 후보다. 전량 대조는 문서 수의 제곱으로 늘어난다. */
export function selectPairs(
  graph: TraceGraph,
  maxPairs: number,
): { pairs: ContradictionPair[]; considered: number } {
  const shared = new Map<string, { a: string; b: string; ids: string[] }>()

  for (const id of graph.kinds.keys()) {
    const uris = [...new Set([...(graph.definedBy.get(id) ?? []), ...(graph.referencedBy.get(id) ?? [])])].sort()
    for (let i = 0; i < uris.length; i++) {
      for (let j = i + 1; j < uris.length; j++) {
        const a = uris[i]!
        const b = uris[j]!
        const key = `${a}|${b}`
        const existing = shared.get(key)
        if (existing === undefined) shared.set(key, { a, b, ids: [id] })
        else existing.ids.push(id)
      }
    }
  }

  const pairs = [...shared.values()]
    .sort((x, y) => y.ids.length - x.ids.length || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
    .slice(0, maxPairs)
    .map((entry) => ({
      sharedIds: [...entry.ids].sort(),
      a: graph.byUri.get(entry.a)!,
      b: graph.byUri.get(entry.b)!,
    }))

  return { pairs, considered: shared.size }
}

async function mapWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

function verifyPair(
  raw: unknown,
  pair: ContradictionPair,
  minConfidence: number,
): { accepted: TraceFinding[]; rejected: number } {
  const items = (raw as { contradictions?: unknown } | null)?.contradictions
  if (!Array.isArray(items)) return { accepted: [], rejected: 1 }

  const ids = new Set(pair.sharedIds)
  const textA = snippetsFor(pair.a, ids)
  const textB = snippetsFor(pair.b, ids)
  const accepted: TraceFinding[] = []
  let rejected = 0

  for (const item of items) {
    const parsed = CandidateSchema.safeParse(item)
    if (!parsed.success) {
      rejected++
      continue
    }

    const candidate = parsed.data
    const grounded =
      candidate.confidence >= minConfidence &&
      evidenceFound(candidate.quoteA, textA) &&
      evidenceFound(candidate.quoteB, textB)

    if (!grounded) {
      rejected++
      continue
    }

    accepted.push({
      id: `TRC006:${pair.a.uri}:${pair.b.uri}:${candidate.subjectId}`,
      ruleId: 'TRC006',
      severity: TRACE_RULES.TRC006.severity,
      message: TRACE_RULES.TRC006.message,
      why: candidate.why,
      documents: [
        { uri: pair.a.uri, title: pair.a.title },
        { uri: pair.b.uri, title: pair.b.title },
      ],
      subjectId: candidate.subjectId,
      evidence: `A: ${candidate.quoteA}\nB: ${candidate.quoteB}`,
      source: 'llm',
      confidence: candidate.confidence,
    })
  }

  return { accepted, rejected }
}

/** 어떤 경우에도 던지지 않는다. 결정적 판정은 이미 나와 있고 그것만이라도 돌려줘야 한다. */
export async function analyzeContradictions(
  pairs: readonly ContradictionPair[],
  provider: LlmProvider,
  opts: ContradictionOptions = {},
): Promise<ContradictionResult> {
  if (pairs.length === 0) return { findings: [], status: 'ok', rejectedCount: 0 }

  const minConfidence = opts.minConfidence ?? DEFAULT_MIN_CONFIDENCE

  const perPair = await mapWithLimit(pairs, opts.concurrency ?? DEFAULT_CONCURRENCY, async (pair) => {
    try {
      const raw = await provider.complete({
        system: SYSTEM_PROMPT,
        user: buildUserPrompt(pair),
        schema: CONTRADICTION_SCHEMA,
        maxTokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      })
      return { ok: true as const, ...verifyPair(raw, pair, minConfidence) }
    } catch (error) {
      opts.onPairError?.(pair, error)
      return { ok: false as const, accepted: [] as TraceFinding[], rejected: 0 }
    }
  })

  const succeeded = perPair.filter((r) => r.ok).length
  const merged = new Map<string, TraceFinding>()
  for (const result of perPair) {
    for (const f of result.accepted) {
      const existing = merged.get(f.id)
      if (existing === undefined || f.confidence > existing.confidence) merged.set(f.id, f)
    }
  }

  return {
    findings: sortTraceFindings([...merged.values()]),
    status: succeeded === pairs.length ? 'ok' : succeeded === 0 ? 'failed' : 'partial',
    rejectedCount: perPair.reduce((n, r) => n + r.rejected, 0),
  }
}
```

- [ ] **Step 4: 배럴에 더한다**

`packages/trace/src/index.ts`에 `export * from './contradiction.js'` 한 줄을 더한다.

- [ ] **Step 5: 테스트와 타입 검사를 돌린다**

Run: `pnpm vitest run packages/trace && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add packages/trace
git commit -m "feat: detect contradictory statements across documents

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 백엔드 인덱스 스토어와 마이그레이션

**Files:**
- Create: `apps/backend/src/services/trace-index.ts`, `apps/backend/src/db/migrations/002_trace.sql`
- Modify: `apps/backend/package.json`
- Test: `apps/backend/test/trace-index.test.ts`

**Interfaces:**
- Consumes: `DocIndexEntry` (Task 2), `Pool` from `../db/client.js`
- Produces: `TraceIndexStore`, `MAX_INDEX_DOCS`, `createMemoryTraceIndex()`, `createPgTraceIndex(pool)`

- [ ] **Step 1: 의존성을 더한다**

`apps/backend/package.json`의 `dependencies`에 `"@ai-lint/trace": "workspace:*"`를 넣고 `pnpm install`을 돌린다.

- [ ] **Step 2: 실패하는 테스트를 쓴다**

`apps/backend/test/trace-index.test.ts`:

```typescript
import type { DocIndexEntry } from '@ai-lint/trace'
import { describe, expect, it } from 'vitest'
import { createMemoryTraceIndex } from '../src/services/trace-index.js'

const entryOf = (uri: string, over: Partial<DocIndexEntry> = {}): DocIndexEntry => ({
  uri,
  title: uri,
  docType: 'design',
  documentHash: 'h1',
  modifiedAt: null,
  mentions: [],
  linksTo: [],
  ...over,
})

describe('createMemoryTraceIndex', () => {
  it('넣은 엔트리를 그대로 돌려준다', async () => {
    const index = createMemoryTraceIndex()
    await index.upsert(entryOf('doc-a'))

    expect(await index.all()).toEqual([entryOf('doc-a')])
    expect(await index.count()).toBe(1)
  })

  it('같은 uri는 덮어쓴다', async () => {
    const index = createMemoryTraceIndex()
    await index.upsert(entryOf('doc-a', { title: '옛 제목' }))
    await index.upsert(entryOf('doc-a', { title: '새 제목' }))

    const all = await index.all()
    expect(all).toHaveLength(1)
    expect(all[0]?.title).toBe('새 제목')
  })

  it('최근 갱신한 것부터 돌려준다', async () => {
    const index = createMemoryTraceIndex()
    await index.upsert(entryOf('doc-a'))
    await index.upsert(entryOf('doc-b'))
    await index.upsert(entryOf('doc-a'))

    expect((await index.all()).map((e) => e.uri)).toEqual(['doc-a', 'doc-b'])
  })
})
```

- [ ] **Step 3: 실패를 확인한다**

Run: `pnpm vitest run apps/backend/test/trace-index.test.ts`
Expected: FAIL — `Cannot find module '../src/services/trace-index.js'`

- [ ] **Step 4: `trace-index.ts`를 쓴다**

```typescript
import type { DocIndexEntry } from '@ai-lint/trace'
import type { Pool } from '../db/client.js'

/** 그래프를 메모리에 통째로 올린다. 상한이 없으면 코퍼스가 커진 뒤 이 라우트가 서버를 넘어뜨린다. */
export const MAX_INDEX_DOCS = 5000

export interface TraceIndexStore {
  upsert(entry: DocIndexEntry): Promise<void>
  /** 최근 갱신 순으로 MAX_INDEX_DOCS까지 */
  all(): Promise<DocIndexEntry[]>
  count(): Promise<number>
}

export function createMemoryTraceIndex(): TraceIndexStore {
  const byUri = new Map<string, { entry: DocIndexEntry; seq: number }>()
  let seq = 0

  return {
    async upsert(entry) {
      byUri.set(entry.uri, { entry, seq: ++seq })
    },

    async all() {
      return [...byUri.values()]
        .sort((a, b) => b.seq - a.seq)
        .slice(0, MAX_INDEX_DOCS)
        .map((e) => e.entry)
    },

    async count() {
      return byUri.size
    },
  }
}

export function createPgTraceIndex(pool: Pool): TraceIndexStore {
  return {
    async upsert(entry) {
      await pool.query(
        `INSERT INTO doc_index (document_uri, title, doc_type, document_hash, modified_at, payload)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (document_uri) DO UPDATE SET
           title = EXCLUDED.title,
           doc_type = EXCLUDED.doc_type,
           document_hash = EXCLUDED.document_hash,
           modified_at = EXCLUDED.modified_at,
           payload = EXCLUDED.payload,
           updated_at = now()`,
        [entry.uri, entry.title, entry.docType, entry.documentHash, entry.modifiedAt, JSON.stringify(entry)],
      )
    },

    async all() {
      const { rows } = await pool.query<{ payload: DocIndexEntry }>(
        'SELECT payload FROM doc_index ORDER BY updated_at DESC, document_uri LIMIT $1',
        [MAX_INDEX_DOCS],
      )
      return rows.map((r) => r.payload)
    },

    async count() {
      const { rows } = await pool.query<{ count: string }>('SELECT count(*)::text AS count FROM doc_index')
      return Number(rows[0]?.count ?? 0)
    },
  }
}
```

- [ ] **Step 5: 마이그레이션을 쓴다**

`apps/backend/src/db/migrations/002_trace.sql`:

```sql
CREATE TABLE doc_index (
  document_uri   TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  doc_type       TEXT NOT NULL,
  document_hash  TEXT NOT NULL,
  modified_at    TIMESTAMPTZ,
  payload        JSONB NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX doc_index_updated ON doc_index (updated_at DESC);
```

- [ ] **Step 6: 테스트와 타입 검사를 돌린다**

Run: `pnpm vitest run apps/backend && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/backend pnpm-lock.yaml
git commit -m "feat: add document index store for traceability

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: 추적성 서비스, 라우트, lint 부수 적재

**Files:**
- Create: `apps/backend/src/services/counting-provider.ts`, `apps/backend/src/services/trace-service.ts`, `apps/backend/src/routes/trace.ts`
- Modify: `apps/backend/src/services/lint-service.ts`, `apps/backend/src/routes/lint.ts`, `apps/backend/src/app.ts`, `apps/backend/src/index.ts`
- Test: `apps/backend/test/trace-route.test.ts`

**Interfaces:**
- Consumes: `TraceIndexStore`, `MAX_INDEX_DOCS` (Task 5); `buildGraph`, `runTraceChecks`, `selectPairs`, `analyzeContradictions`, `toIndexEntry`, `DEFAULT_TRACE_CONFIG`, `TraceConfig` (Tasks 1~4); `TraceRequestSchema`, `TraceReport` (Task 3)
- Produces: `countingProvider(provider)`, `TraceDeps`, `analyzeTrace(request, deps, userId)`, `traceRoutes(deps)`, `AppDeps.traceIndex`, `AppDeps.traceConfig`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/backend/test/trace-route.test.ts`:

```typescript
import type { LintReport, TraceReport } from '@ai-lint/contract'
import type { Document } from '@ai-lint/ir'
import type { LlmProvider } from '@ai-lint/llm'
import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import { createFixedQuota } from '../src/services/quota.js'
import { createMemoryTraceIndex } from '../src/services/trace-index.js'

const TOKEN = 'test-token'

const silentProvider: LlmProvider = {
  name: 'silent',
  async complete() {
    return { contradictions: [] }
  },
}

const docOf = (uri: string, title: string, text: string, docType: Document['docType']['value'] = 'design'): Document => ({
  schemaVersion: 1,
  source: { kind: 'confluence', uri },
  title,
  docType: { value: docType, confidence: 1, origin: 'label' },
  blocks: [{ id: 'b1', path: [0], anchor: ANCHOR, kind: 'paragraph', text }],
  links: [],
  metadata: { labels: [] },
})

const apps: Array<{ close: () => Promise<void> }> = []

const appWith = (over: Partial<Parameters<typeof buildApp>[0]> = {}) => {
  const app = buildApp({ provider: silentProvider, serviceToken: TOKEN, ...over })
  apps.push(app)
  return app
}

const lint = (app: ReturnType<typeof buildApp>, document: Document) =>
  app.inject({
    method: 'POST',
    url: '/v1/lint',
    headers: { 'X-AI-Lint-Token': TOKEN },
    payload: { document, options: { useLlm: false } },
  })

const analyze = (app: ReturnType<typeof buildApp>, body: unknown = { useLlm: false }) =>
  app.inject({
    method: 'POST',
    url: '/v1/trace/analyze',
    headers: { 'X-AI-Lint-Token': TOKEN },
    payload: body,
  })

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()))
})

describe('POST /v1/lint 부수 적재', () => {
  it('검사한 문서가 인덱스에 쌓인다', async () => {
    const index = createMemoryTraceIndex()
    const app = appWith({ traceIndex: index })

    const response = await lint(app, docOf('https://wiki/a', 'REQ-1 결제', 'REQ-1 한도'))
    expect(response.statusCode).toBe(200)

    const entries = await index.all()
    expect(entries.map((e) => e.uri)).toEqual(['https://wiki/a'])
    expect(entries[0]?.documentHash).toBe((response.json() as LintReport).documentHash)
  })

  it('인덱스가 실패해도 검사 결과는 나간다', async () => {
    const index = createMemoryTraceIndex()
    index.upsert = async () => {
      throw new Error('디스크가 꽉 찼습니다')
    }

    const response = await lint(appWith({ traceIndex: index }), docOf('https://wiki/a', 'A', 'REQ-1'))
    expect(response.statusCode).toBe(200)
  })
})

describe('POST /v1/trace/analyze', () => {
  it('인덱스가 비면 빈 리포트를 준다', async () => {
    const report = (await analyze(appWith())).json() as TraceReport
    expect(report.documentCount).toBe(0)
    expect(report.findings).toEqual([])
    expect(report.llmStatus).toBe('skipped')
  })

  it('쌓인 문서에서 결정적 지적을 낸다', async () => {
    const app = appWith()
    await lint(app, docOf('https://wiki/a', '결제 설계', 'REQ-9를 따른다'))

    const report = (await analyze(app)).json() as TraceReport

    expect(report.documentCount).toBe(1)
    expect(report.idCount).toBe(1)
    expect(report.findings.map((f) => f.ruleId)).toContain('TRC001')
  })

  it('useLlm이 false면 disabled로 알린다', async () => {
    const report = (await analyze(appWith())).json() as TraceReport
    expect(report.llmSkipReason).toBe('disabled')
  })

  it('쿼터가 막히면 결정적 결과만 낸다', async () => {
    const app = appWith({ quota: createFixedQuota({ allowed: false, reason: 'daily-limit' }) })
    await lint(app, docOf('https://wiki/a', 'A', 'REQ-9'))

    const report = (await analyze(app, { useLlm: true })).json() as TraceReport

    expect(report.llmStatus).toBe('skipped')
    expect(report.llmSkipReason).toBe('quota')
    expect(report.stats.pairsAnalyzed).toBe(0)
  })

  it('LLM을 쓰면 호출 수를 쿼터에 기록한다', async () => {
    const quota = createFixedQuota({ allowed: true })
    const app = appWith({ quota })
    await lint(app, docOf('https://wiki/a', 'A', 'REQ-1 한도는 100이다'))
    await lint(app, docOf('https://wiki/b', 'B', 'REQ-1 한도는 200이다'))

    const report = (await analyze(app, { useLlm: true })).json() as TraceReport

    expect(report.stats.pairsAnalyzed).toBe(1)
    expect(quota.recorded).toEqual([['anonymous', 1]])
  })

  it('토큰이 없으면 막는다', async () => {
    const response = await appWith().inject({ method: 'POST', url: '/v1/trace/analyze', payload: {} })
    expect(response.statusCode).toBe(401)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run apps/backend/test/trace-route.test.ts`
Expected: FAIL — `traceIndex` is not a known property / 404 on `/v1/trace/analyze`

- [ ] **Step 3: `countingProvider`를 뽑아낸다**

`apps/backend/src/services/counting-provider.ts` 신규:

```typescript
import type { LlmProvider } from '@ai-lint/llm'

/** 쿼터에 기록할 실제 호출 수를 센다. 요약·유형추론까지 포함해야 상한이 의미를 갖는다. */
export function countingProvider(provider: LlmProvider): { provider: LlmProvider; calls: () => number } {
  let calls = 0
  return {
    provider: {
      name: provider.name,
      complete: (req) => {
        calls++
        return provider.complete(req)
      },
    },
    calls: () => calls,
  }
}
```

`apps/backend/src/services/lint-service.ts`에서 같은 이름의 로컬 함수(63~76행)를 지우고 import로 바꾼다:

```typescript
import { countingProvider } from './counting-provider.js'
```

- [ ] **Step 4: `trace-service.ts`를 쓴다**

```typescript
import { randomUUID } from 'node:crypto'
import type { LlmSkipReason, TraceReport, TraceRequest } from '@ai-lint/contract'
import type { LlmProvider } from '@ai-lint/llm'
import {
  analyzeContradictions,
  buildGraph,
  runTraceChecks,
  selectPairs,
  type TraceConfig,
} from '@ai-lint/trace'
import { countingProvider } from './counting-provider.js'
import type { QuotaService } from './quota.js'
import type { TraceIndexStore } from './trace-index.js'

export interface TraceDeps {
  provider: LlmProvider
  index: TraceIndexStore
  quota: QuotaService
  config: TraceConfig
  now: () => Date
}

const EMPTY_STATS = { pairsConsidered: 0, pairsAnalyzed: 0, llmFindingsRejected: 0 }

/**
 * 결정적 판정이 먼저 나오고, LLM 대조는 그 위에 얹는다.
 * LLM이 죽거나 쿼터가 막혀도 그래프 판정은 반드시 나간다.
 */
export async function analyzeTrace(
  request: TraceRequest,
  deps: TraceDeps,
  userId: string,
): Promise<TraceReport> {
  const startedAt = Date.now()

  const entries = await deps.index.all()
  const graph = buildGraph(entries)
  const findings = runTraceChecks(graph)

  const skipReason = await resolveSkipReason(request, deps, userId)
  const selection = skipReason === undefined ? selectPairs(graph, deps.config.maxPairs) : null

  let stats = { ...EMPTY_STATS, pairsConsidered: selection?.considered ?? 0 }
  let llmStatus: TraceReport['llmStatus'] = 'skipped'

  if (selection !== null) {
    const counted = countingProvider(deps.provider)
    const result = await analyzeContradictions(selection.pairs, counted.provider)
    if (counted.calls() > 0) await deps.quota.record(userId, counted.calls())

    findings.push(...result.findings)
    llmStatus = result.status
    stats = {
      pairsConsidered: selection.considered,
      pairsAnalyzed: selection.pairs.length,
      llmFindingsRejected: result.rejectedCount,
    }
  }

  return {
    reportId: randomUUID(),
    documentCount: await deps.index.count(),
    idCount: graph.kinds.size,
    findings,
    stats: { ...stats, durationMs: Date.now() - startedAt },
    llmStatus,
    ...(skipReason ? { llmSkipReason: skipReason } : {}),
    truncated: stats.pairsConsidered > stats.pairsAnalyzed,
    createdAt: deps.now().toISOString(),
  }
}

async function resolveSkipReason(
  request: TraceRequest,
  deps: TraceDeps,
  userId: string,
): Promise<LlmSkipReason | undefined> {
  if (!request.useLlm) return 'disabled'
  if (!(await deps.quota.check(userId)).allowed) return 'quota'
  return undefined
}
```

`findings`는 `runTraceChecks`가 새 배열을 돌려주므로 그대로 push해도 된다. LLM 지적은 결정적 지적 뒤에 붙되 같은 심각도 안에서 순서가 흔들리지 않도록 `sortTraceFindings`로 다시 정렬한다 — `findings.push(...)` 다음 줄에서:

```typescript
    findings.push(...result.findings)
```

를

```typescript
    findings.splice(0, findings.length, ...sortTraceFindings([...findings, ...result.findings]))
```

로 바꾸고 `sortTraceFindings`를 `@ai-lint/trace`에서 함께 import한다.

- [ ] **Step 5: `routes/trace.ts`를 쓴다**

```typescript
import { TraceRequestSchema } from '@ai-lint/contract'
import type { FastifyPluginAsync } from 'fastify'
import { analyzeTrace, type TraceDeps } from '../services/trace-service.js'

export function traceRoutes(deps: TraceDeps): FastifyPluginAsync {
  return async (app) => {
    app.post('/v1/trace/analyze', async (request) =>
      analyzeTrace(TraceRequestSchema.parse(request.body ?? {}), deps, request.userId),
    )
  }
}
```

- [ ] **Step 6: lint 라우트에 부수 적재를 넣는다**

`apps/backend/src/routes/lint.ts` 전체를 갈아끼운다:

```typescript
import { LintRequestSchema } from '@ai-lint/contract'
import { toIndexEntry, type TraceConfig } from '@ai-lint/trace'
import type { FastifyPluginAsync } from 'fastify'
import { lintDocument, type LintDeps } from '../services/lint-service.js'
import type { TraceIndexStore } from '../services/trace-index.js'

export interface LintTraceDeps {
  index: TraceIndexStore
  config: TraceConfig
}

export function lintRoutes(deps: LintDeps, trace: LintTraceDeps): FastifyPluginAsync {
  return async (app) => {
    app.post('/v1/lint', async (request) => {
      const { document, options } = LintRequestSchema.parse(request.body)
      const report = await lintDocument(document, options, deps, request.userId)

      try {
        // 유형은 리포트 쪽이 사용자 지정을 반영한 확정값이다.
        await trace.index.upsert(
          toIndexEntry({ ...document, docType: { ...document.docType, value: report.docType } },
            report.documentHash, trace.config),
        )
      } catch (cause) {
        // 색인이 실패해도 검사 결과는 돌려준다.
        request.log.warn({ err: cause }, '추적성 인덱스 갱신 실패')
      }

      return report
    })
  }
}
```

- [ ] **Step 7: `app.ts`를 배선한다**

import를 더한다:

```typescript
import { DEFAULT_TRACE_CONFIG, type TraceConfig } from '@ai-lint/trace'
import { traceRoutes } from './routes/trace.js'
import { createMemoryTraceIndex, type TraceIndexStore } from './services/trace-index.js'
import type { TraceDeps } from './services/trace-service.js'
```

`AppDeps`에 두 줄을 더한다:

```typescript
  traceIndex?: TraceIndexStore
  traceConfig?: Partial<TraceConfig>
```

`buildApp` 안에서 `lintDeps` 아래에 더한다:

```typescript
  const traceDeps: TraceDeps = {
    provider: deps.provider,
    index: deps.traceIndex ?? createMemoryTraceIndex(),
    quota: lintDeps.quota,
    config: { ...DEFAULT_TRACE_CONFIG, ...deps.traceConfig },
    now: lintDeps.now,
  }
```

등록 부분을 고친다:

```typescript
  app.register(lintRoutes(lintDeps, { index: traceDeps.index, config: traceDeps.config }))
  app.register(traceRoutes(traceDeps))
```

- [ ] **Step 8: `index.ts`를 배선한다**

`createPgTraceIndex`, `createMemoryTraceIndex`를 import하고 `persistence` 블록에 `traceIndex`를 더한다:

```typescript
const persistence = await (async () => {
  if (!config.DATABASE_URL) {
    return {
      store: createMemoryStore(),
      quota: createUnlimitedQuota(),
      traceIndex: createMemoryTraceIndex(),
      close: async () => {},
    }
  }
  const pool = createPool(config.DATABASE_URL)
  await migrate(pool)
  return {
    store: createPgStore(pool),
    quota: createPgQuota(pool, config.LLM_DAILY_LIMIT_PER_USER),
    traceIndex: createPgTraceIndex(pool),
    close: () => pool.end(),
  }
})()
```

`buildApp` 호출에 `traceIndex: persistence.traceIndex,`를 더한다.

- [ ] **Step 9: 테스트와 타입 검사를 돌린다**

Run: `pnpm test && pnpm typecheck`
Expected: PASS — 기존 백엔드 테스트도 모두 그대로 통과해야 한다

- [ ] **Step 10: 커밋**

```bash
git add apps/backend
git commit -m "feat: expose traceability analysis endpoint

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 백엔드 클라이언트 `requestTrace`

**Files:**
- Modify: `packages/backend-client/src/client.ts`
- Test: `packages/backend-client/test/client.test.ts`

**Interfaces:**
- Consumes: `TraceReport`, `TraceRequest` (Task 3); 기존 `post`, `BackendSettings`
- Produces: `requestTrace(options, settings, fetchImpl)`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`packages/backend-client/test/client.test.ts`에 describe 블록을 더한다. 파일 상단 import에 `requestTrace`를 넣는다.

```typescript
describe('requestTrace', () => {
  const settings = { backendUrl: 'http://localhost:3000', serviceToken: 't', userId: 'u', rulesetId: 'default' }

  it('추적성 리포트를 받아온다', async () => {
    const calls: Array<[string, RequestInit | undefined]> = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init])
      return new Response(JSON.stringify({ reportId: 'r1', findings: [] }), { status: 200 })
    }) as unknown as typeof fetch

    const report = await requestTrace({ useLlm: false }, settings, fetchImpl)

    expect(report.reportId).toBe('r1')
    expect(calls[0]?.[0]).toBe('http://localhost:3000/v1/trace/analyze')
    expect(JSON.parse(String(calls[0]?.[1]?.body))).toEqual({ useLlm: false })
  })

  it('설정이 비면 부르지 않는다', async () => {
    await expect(
      requestTrace({}, { ...settings, serviceToken: '' }, (() => {
        throw new Error('불려서는 안 된다')
      }) as unknown as typeof fetch),
    ).rejects.toMatchObject({ kind: 'unconfigured' })
  })
})
```

기존 파일의 헬퍼 이름과 스타일이 다르면 그 파일의 관례를 따른다.

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run packages/backend-client`
Expected: FAIL — `requestTrace is not exported`

- [ ] **Step 3: `requestTrace`를 쓴다**

`packages/backend-client/src/client.ts`의 import에 `TraceReport`, `TraceRequest`를 더하고 파일 끝에 넣는다:

```typescript
export async function requestTrace(
  options: Partial<TraceRequest>,
  settings: BackendSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<TraceReport> {
  const response = await post('/v1/trace/analyze', options, settings, fetchImpl)
  return (await response.json()) as TraceReport
}
```

- [ ] **Step 4: 테스트와 타입 검사를 돌린다**

Run: `pnpm vitest run packages/backend-client && pnpm typecheck`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/backend-client
git commit -m "feat: add trace analysis client call

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: 데스크톱 내보내기 공통화와 추적성 내보내기

**Files:**
- Create: `apps/desktop/src/core/xlsx-writer.ts`, `apps/desktop/src/core/export-trace.ts`
- Modify: `apps/desktop/src/core/export-xlsx.ts`, `apps/desktop/src/core/export-html.ts`
- Test: `apps/desktop/test/export-trace.test.ts`

**Interfaces:**
- Consumes: `TraceReport`, `TraceFinding` (Task 3); `SEVERITY_LABELS` from `@ai-lint/labels`
- Produces: `Sheet`, `buildXlsx(sheets)`, `htmlPage(title, body)`, `toTraceHtml(report, generatedAt)`, `toTraceXlsx(report)`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`apps/desktop/test/export-trace.test.ts`:

```typescript
// @vitest-environment happy-dom
import { xlsxToDocument } from '@ai-lint/adapter-office'
import type { TraceFinding, TraceReport } from '@ai-lint/contract'
import { describe, expect, it } from 'vitest'
import { toTraceHtml, toTraceXlsx } from '../src/core/export-trace.js'

const finding = (over: Partial<TraceFinding> = {}): TraceFinding => ({
  id: 'TRC001:REQ-9',
  ruleId: 'TRC001',
  severity: 'error',
  message: '정의되지 않은 식별자를 참조합니다',
  why: 'REQ-9를 정의하는 문서가 인덱스에 없습니다',
  documents: [{ uri: 'https://wiki/a', title: '결제 설계' }],
  subjectId: 'REQ-9',
  evidence: null,
  source: 'rule',
  confidence: 1,
  ...over,
})

const reportOf = (over: Partial<TraceReport> = {}): TraceReport => ({
  reportId: 'r1',
  documentCount: 12,
  idCount: 30,
  findings: [finding()],
  stats: { pairsConsidered: 3, pairsAnalyzed: 3, llmFindingsRejected: 0, durationMs: 40 },
  llmStatus: 'ok',
  truncated: false,
  createdAt: '2026-08-23T00:00:00.000Z',
  ...over,
})

describe('toTraceHtml', () => {
  it('요약과 지적을 담는다', () => {
    const html = toTraceHtml(reportOf(), '2026-08-23')
    expect(html).toContain('12')
    expect(html).toContain('REQ-9')
    expect(html).toContain('결제 설계')
    expect(html).toContain('정의되지 않은 식별자를 참조합니다')
  })

  it('문서 내용이 태그로 살아나지 않는다', () => {
    const html = toTraceHtml(
      reportOf({ findings: [finding({ why: '<img onerror=x>' })] }),
      '2026-08-23',
    )
    expect(html).not.toContain('<img onerror=x>')
    expect(html).toContain('&lt;img onerror=x&gt;')
  })

  it('바깥 파일을 하나도 부르지 않는다', () => {
    expect(toTraceHtml(reportOf(), '2026-08-23')).not.toMatch(/<(script|link|img)\b/)
  })

  it('일부만 대조했으면 그 사실을 적는다', () => {
    const html = toTraceHtml(
      reportOf({ truncated: true, stats: { pairsConsidered: 50, pairsAnalyzed: 20, llmFindingsRejected: 0, durationMs: 1 } }),
      '2026-08-23',
    )
    expect(html).toContain('50')
    expect(html).toContain('20')
  })
})

describe('toTraceXlsx', () => {
  it('다시 읽어보면 지적이 그대로 있다', () => {
    const doc = xlsxToDocument(toTraceXlsx(reportOf()), { uri: 'C:\\out.xlsx' })
    const text = doc.blocks.map((block) => JSON.stringify(block)).join('\n')

    expect(text).toContain('TRC001')
    expect(text).toContain('REQ-9')
    expect(text).toContain('결제 설계')
  })

  it('지적이 하나도 없어도 읽히는 파일을 만든다', () => {
    const doc = xlsxToDocument(toTraceXlsx(reportOf({ findings: [] })), { uri: 'C:\\out.xlsx' })
    expect(doc.blocks.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 실패를 확인한다**

Run: `pnpm vitest run apps/desktop/test/export-trace.test.ts`
Expected: FAIL — `Cannot find module '../src/core/export-trace.js'`

- [ ] **Step 3: `xlsx-writer.ts`로 조립기를 옮긴다**

`apps/desktop/src/core/export-xlsx.ts:6-41`(`XML_ENTITIES`부터 `REL_NS`까지)과 `toXlsx` 안의 zip 조립부를 통째로 `apps/desktop/src/core/xlsx-writer.ts`로 옮긴다. 셀 값 타입과 `strToU8` 사용은 그대로 둔다. 옮긴 코드 위에 이것만 새로 쓴다:

```typescript
import { strToU8, zipSync } from 'fflate'

export type CellValue = string | number

export interface Sheet {
  name: string
  rows: CellValue[][]
}
```

`XML_ENTITIES`, `CONTROL_CHARS`, `escapeXml`, `COLUMNS`, `colNameOf`, `cellXml`, `sheetXml`, `REL_NS`는 기존 구현을 그대로 옮기고, 지역 `type CellValue` 선언만 위 export로 대체한다. 그 아래에 조립 함수를 둔다 — 본문은 기존 `toXlsx`의 `files` 블록과 글자 하나까지 같고 시트 목록만 인자로 받는다:

```typescript
export function buildXlsx(sheets: readonly Sheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {
    // 기존 toXlsx의 files 리터럴을 그대로 옮긴다.
  }

  for (const [i, sheet] of sheets.entries()) {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet.rows))
  }

  return zipSync(files, { level: 6 })
}
```

`export-xlsx.ts`에는 `summaryRows`, `findingRows`와 다음만 남긴다. `fflate` import는 사라진다:

```typescript
import { AXIS_LABELS, SEVERITY_LABELS } from '@ai-lint/labels'
import { countBySeverity, describeAnchor, sortFindings } from './describe.js'
import type { JobState } from './lint-file.js'
import { buildXlsx, type CellValue } from './xlsx-writer.js'

// summaryRows, findingRows는 그대로 둔다.

export const toXlsx = (jobs: readonly JobState[]): Uint8Array =>
  buildXlsx([
    { name: '요약', rows: summaryRows(jobs) },
    { name: '지적', rows: findingRows(jobs) },
  ])
```

- [ ] **Step 4: `export-html.ts`에서 페이지 껍데기를 뽑아낸다**

`toHtml`(60~70행)이 직접 만들던 껍데기를 함수로 빼고 `toHtml`이 그것을 쓰게 한다.

```typescript
export const htmlPage = (title: string, body: string): string =>
  `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>${STYLE}</style></head><body>
${body}
</body></html>`

export function toHtml(jobs: readonly JobState[], generatedAt: string): string {
  return htmlPage(
    'AI Lint 검사 결과',
    `<h1>AI Lint 검사 결과</h1>
<p>${escapeHtml(generatedAt)} · 파일 ${jobs.length}개</p>
<table><thead><tr><th>파일</th><th>점수</th><th>등급</th><th>오류</th><th>경고</th><th>정보</th></tr></thead>
<tbody>${jobs.map(summaryRow).join('')}</tbody></table>
${jobs.map(detailHtml).join('\n')}`,
  )
}
```

`STYLE` 문자열 끝에 추적성 표가 쓸 규칙을 더한다:

```
.muted { color: #6b7280; }
table.trace td { vertical-align: top; }
```

- [ ] **Step 5: `export-trace.ts`를 쓴다**

```typescript
import type { TraceFinding, TraceReport } from '@ai-lint/contract'
import { SEVERITY_LABELS } from '@ai-lint/labels'
import { escapeHtml, htmlPage } from './export-html.js'
import { buildXlsx } from './xlsx-writer.js'

const HEADERS = ['심각도', '규칙', '식별자', '문서', '내용', '이유']

const cells = (finding: TraceFinding): string[] => [
  SEVERITY_LABELS[finding.severity],
  finding.ruleId,
  finding.subjectId ?? '',
  finding.documents.map((d) => `${d.title} (${d.uri})`).join('\n'),
  finding.message,
  finding.evidence === null ? finding.why : `${finding.why}\n${finding.evidence}`,
]

export function summaryText(report: TraceReport): string {
  const base = `문서 ${report.documentCount}개, 식별자 ${report.idCount}개에서 ${report.findings.length}건을 찾았습니다.`
  return report.truncated
    ? `${base} 문서 쌍 ${report.stats.pairsConsidered}개 중 ${report.stats.pairsAnalyzed}개만 AI로 대조했습니다.`
    : base
}

export function toTraceHtml(report: TraceReport, generatedAt: string): string {
  const rows = report.findings
    .map((f) => `<tr>${cells(f).map((c) => `<td>${escapeHtml(c).replace(/\n/g, '<br>')}</td>`).join('')}</tr>`)
    .join('')

  return htmlPage(
    '추적성 검사 결과',
    [
      '<h1>추적성 검사 결과</h1>',
      `<p class="muted">${escapeHtml(generatedAt)}</p>`,
      `<p>${escapeHtml(summaryText(report))}</p>`,
      `<table class="trace"><thead><tr>${HEADERS.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`,
    ].join(''),
  )
}

export const toTraceXlsx = (report: TraceReport): Uint8Array =>
  buildXlsx([{ name: '추적성', rows: [HEADERS, ...report.findings.map(cells)] }])
```

- [ ] **Step 6: 테스트와 타입 검사를 돌린다**

Run: `pnpm test && pnpm typecheck`
Expected: PASS — 기존 `apps/desktop/test/export.test.ts`도 그대로 통과해야 한다

- [ ] **Step 7: 커밋**

```bash
git add apps/desktop
git commit -m "feat: export traceability report to HTML and Excel

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: 데스크톱 추적성 탭

**Files:**
- Create: `apps/desktop/src/ui/TraceTab.tsx`
- Modify: `apps/desktop/src/App.tsx`, `apps/desktop/src/styles.css`

**Interfaces:**
- Consumes: `requestTrace` (Task 7), `toTraceHtml`/`toTraceXlsx`/`summaryText` (Task 8), 기존 `pickSavePath`/`saveFile`, `toBackendSettings`
- Produces: `TraceTab({ settings, token })`

- [ ] **Step 1: `TraceTab.tsx`를 쓴다**

```tsx
import type { TraceReport } from '@ai-lint/contract'
import { requestTrace } from '@ai-lint/backend-client'
import { SEVERITY_LABELS } from '@ai-lint/labels'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'
import { useState, type JSX } from 'react'
import { summaryText, toTraceHtml, toTraceXlsx } from '../core/export-trace.js'
import { toBackendSettings, type DesktopSettings } from '../core/settings.js'
import { pickSavePath, saveFile } from '../platform/tauri.js'

export interface TraceTabProps {
  settings: DesktopSettings
  token: string
}

const stamp = (): string => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')

export function TraceTab({ settings, token }: TraceTabProps): JSX.Element {
  const [report, setReport] = useState<TraceReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [useLlm, setUseLlm] = useState(true)

  const onRun = async (): Promise<void> => {
    setRunning(true)
    setError(null)
    try {
      setReport(await requestTrace({ useLlm }, toBackendSettings(settings, token), tauriFetch))
    } catch (cause) {
      setReport(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(false)
    }
  }

  const onExportHtml = async (): Promise<void> => {
    if (report === null) return
    const path = await pickSavePath(`ai-lint-trace-${stamp()}.html`)
    if (path === null) return
    await saveFile(path, new TextEncoder().encode(toTraceHtml(report, new Date().toLocaleString('ko-KR'))))
  }

  const onExportXlsx = async (): Promise<void> => {
    if (report === null) return
    const path = await pickSavePath(`ai-lint-trace-${stamp()}.xlsx`)
    if (path === null) return
    await saveFile(path, toTraceXlsx(report))
  }

  return (
    <>
      <section className="actions">
        <button type="button" onClick={() => void onRun()} disabled={running}>코퍼스 조회</button>
        <label className="inline">
          <input type="checkbox" checked={useLlm} onChange={(e) => setUseLlm(e.target.checked)} disabled={running} />
          AI 대조 사용
        </label>
        <button type="button" onClick={() => void onExportHtml()} disabled={running || report === null}>
          HTML 저장
        </button>
        <button type="button" onClick={() => void onExportXlsx()} disabled={running || report === null}>
          Excel 저장
        </button>
      </section>

      {error !== null ? <p className="error">{error}</p> : null}
      {report === null ? (
        <p className="muted">코퍼스를 조회하면 지금까지 검사한 문서들의 추적성을 확인할 수 있습니다.</p>
      ) : (
        <section className="report">
          <p>{summaryText(report)}</p>
          {report.documentCount === 0 ? (
            <p className="muted">아직 검사한 문서가 없습니다. 문서 검사 탭에서 먼저 검사하세요.</p>
          ) : (
            <table className="trace">
              <thead>
                <tr><th>심각도</th><th>규칙</th><th>식별자</th><th>문서</th><th>내용</th></tr>
              </thead>
              <tbody>
                {report.findings.map((finding) => (
                  <tr key={finding.id}>
                    <td className={`sev-${finding.severity}`}>{SEVERITY_LABELS[finding.severity]}</td>
                    <td>{finding.ruleId}</td>
                    <td>{finding.subjectId ?? ''}</td>
                    <td>{finding.documents.map((d) => d.title).join(', ')}</td>
                    <td>
                      <p className="finding-message">{finding.message}</p>
                      <p className="muted">{finding.why}</p>
                      {finding.evidence !== null ? <pre className="evidence">{finding.evidence}</pre> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  )
}
```

- [ ] **Step 2: `App.tsx`에 탭을 넣는다**

import에 `TraceTab`을 더하고 상태를 하나 더한다:

```typescript
const [tab, setTab] = useState<'lint' | 'trace'>('lint')
```

`<h1>AI Lint</h1>` 바로 아래에 탭 버튼을 넣는다:

```tsx
      <nav className="tabs">
        <button type="button" className={tab === 'lint' ? 'active' : ''} onClick={() => setTab('lint')}>
          문서 검사
        </button>
        <button type="button" className={tab === 'trace' ? 'active' : ''} onClick={() => setTab('trace')}>
          추적성
        </button>
      </nav>
```

기존 `<section className="actions">`와 `<section className="split">` 두 블록을 감싸 `tab === 'lint'`일 때만 그리고, 아니면 `<TraceTab settings={settings} token={token} />`를 그린다. 설정 `<section className="settings">`는 두 탭이 함께 쓰므로 감싸지 않는다.

- [ ] **Step 3: 스타일을 더한다**

`apps/desktop/src/styles.css` 끝에 붙인다:

```css
.tabs { display: flex; gap: 4px; margin-bottom: 16px; }
.tabs button.active { background: #e4ecf9; border-color: #3f7ac2; font-weight: 600; }
table.trace { width: 100%; border-collapse: collapse; }
table.trace th, table.trace td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e3e6ea; vertical-align: top; }
table.trace th { font-weight: 600; color: #5a6270; }
table.trace .finding-message { margin: 0 0 2px; }
```

- [ ] **Step 4: 타입 검사와 빌드를 돌린다**

Run: `pnpm typecheck && pnpm --filter @ai-lint/desktop exec vite build`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add apps/desktop
git commit -m "feat: add traceability tab to desktop app

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: 전체 검증과 PR

**Files:** 없음 (검증과 병합만)

- [ ] **Step 1: 전체 테스트와 타입 검사**

Run: `pnpm test && pnpm typecheck`
Expected: 모두 PASS. 서브프로젝트 1~3의 기존 테스트가 하나도 깨지지 않아야 한다.

- [ ] **Step 2: 데스크톱 릴리스 빌드**

Run: `PATH="$PATH:/c/Users/geniu/.cargo/bin" pnpm --filter @ai-lint/desktop build`
Expected: msi 산출물 생성 성공

- [ ] **Step 3: PR을 만들고 머지한다**

```bash
git push -u origin feat/traceability
gh pr create --title "feat: cross-document traceability analysis" --body "$(cat <<'EOF'
## 요약
- 검사된 문서의 식별자·링크를 코퍼스 인덱스에 부수 적재
- 결정적 추적성 판정 TRC001~005와 LLM 상충 탐지 TRC006
- `POST /v1/trace/analyze` 라우트와 데스크톱 추적성 탭

## 설계
`docs/superpowers/specs/2026-08-23-traceability-design.md`

추적성 지적은 문서 점수에 들어가지 않는다. 코퍼스 전체를 봐야 나오는 판정이라 단일 문서 점수에 섞으면 남의 문서 상태에 따라 점수가 흔들린다.

## 검증
- `pnpm test`
- `pnpm typecheck`
- 데스크톱 msi 빌드

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
gh pr merge --squash --delete-branch
```

---

## 자체 점검

**스펙 커버리지**

| 스펙 절 | 구현 태스크 |
|---|---|
| 1 설계를 가르는 결정 | Global Constraints, Task 6 (부수 적재), Task 3 (별도 리포트) |
| 2 패키지 구조 | Task 1 (스캐폴딩), 이후 전부 |
| 3 설정과 식별자 추출 | Task 1 |
| 4 인덱스 엔트리와 그래프 | Task 2 |
| 5 검사 항목 TRC001~005 | Task 3 |
| 6 상충 탐지 TRC006 | Task 4 |
| 7 계약 타입 | Task 3 |
| 8 저장과 라우트 | Task 5, Task 6 |
| 9 데스크톱 탭 | Task 8 (내보내기), Task 9 (UI) |
| 10 에러 처리 | Task 4 (LLM 실패), Task 6 (인덱스 실패·쿼터) |
| 11 테스트 | 각 태스크의 테스트 단계 |

**타입 일관성**

- `TraceConfig`는 Task 1에서 정의하고 Task 4·5·6이 그대로 쓴다.
- `DocIndexEntry`는 Task 2에서 정의하고 Task 4·5·6이 그대로 쓴다.
- `TraceFinding`/`TraceReport`는 Task 3에서 정의하고 Task 4·6·7·8·9가 그대로 쓴다.
- `TraceGraph.kinds`는 Task 2에서 넣고 Task 3(TRC003)·Task 4(selectPairs)가 쓴다.
- `toIndexEntry(doc, documentHash, config)` 세 인자 형태를 Task 2와 Task 6이 동일하게 쓴다.
- `buildXlsx(sheets)`는 Task 8에서 정의하고 같은 태스크의 `toXlsx`·`toTraceXlsx`가 쓴다.
