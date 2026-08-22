# Lint 엔진 + 백엔드 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document IR을 받아 규칙 검사와 LLM 맥락 검사를 수행하고 점수·수정 제안이 담긴 LintReport를 반환하는 백엔드를 만든다.

**Architecture:** pnpm 모노레포. `ir`이 스키마와 직렬화를, `rules`가 결정적 규칙 엔진을, `llm`이 맥락 분석과 근거 검증을 담당하고, `backend`가 이들을 조립해 HTTP로 노출한다. 클라이언트(확장/데스크톱 앱)는 이 백엔드의 유일한 소비자이며 IR만 보낸다.

**Tech Stack:** TypeScript strict / ESM, pnpm workspace, Turborepo, Vitest, zod, yaml, Fastify, PostgreSQL(`pg`), `@google/genai`

## Global Constraints

- Node.js 22 이상, pnpm 10 이상
- 모든 패키지는 ESM (`"type": "module"`), TypeScript strict mode
- 내부 패키지는 빌드 없이 `exports`가 `./src/index.ts`를 직접 가리킨다. 백엔드는 `tsx`로 실행하고 배포 빌드만 `tsup`으로 번들한다
- 룰 ID는 스펙 6장 카탈로그와 정확히 일치해야 한다 (STR001~STR012, CTX001~CTX009, META001~META008)
- 축 가중치 기본값 `structure 0.35 / context 0.45 / metadata 0.20`, 감점 `error 15 / warning 6 / info 2`, 같은 룰은 3회까지 전액 감점 후 1점씩
- 등급 경계 A(90+) / B(75+) / C(60+) / D(60 미만)
- LLM finding은 근거 검증(스펙 7.4절 5개 조건)을 통과해야만 리포트에 포함된다. 검증 로직은 LLM 호출 없이 단위 테스트 가능해야 한다
- 모든 사용자 노출 문자열(message, why)은 한국어

---

### Task 1: 모노레포 스캐폴드 + IR 패키지

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `turbo.json`, `vitest.workspace.ts`, `.gitignore`
- Create: `packages/ir/package.json`, `packages/ir/tsconfig.json`
- Create: `packages/ir/src/{index,schema,anchor,walk,serialize,hash}.ts`
- Test: `packages/ir/test/{schema,walk,serialize,hash}.test.ts`

**Interfaces:**
- Consumes: 없음 (최초 태스크)
- Produces:
  - `Document`, `Block`, `Link`, `SourceAnchor`, `DocType`, `Severity`, `Axis` 타입
  - `DocumentSchema: z.ZodType<Document>` — 런타임 검증
  - `serializeToMarkdown(doc: Document): string` — 블록 ID 주석 포함
  - `hashDocument(doc: Document): string` — sha256 hex, 캐시 키
  - `walkSections(doc: Document): Section[]` where `Section = { heading: HeadingBlock | null; blocks: Block[]; charCount: number }`
  - `blockText(block: Block): string` — 블록의 검사 대상 텍스트
  - `totalTextLength(doc: Document): number`

- [ ] **Step 1: 워크스페이스 루트 파일 생성**

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

루트 `package.json`:
```json
{
  "name": "ai-lint",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@10.27.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "turbo run typecheck",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "turbo": "^2.3.0",
    "tsx": "^4.19.0",
    "@types/node": "^22.10.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "declaration": true,
    "noEmit": true
  }
}
```

`vitest.workspace.ts`:
```typescript
export default ['packages/*', 'apps/*']
```

`.gitignore`: `node_modules`, `dist`, `.turbo`, `*.log`, `.env`

- [ ] **Step 2: IR 패키지 셸 생성**

`packages/ir/package.json`:
```json
{
  "name": "@ai-lint/ir",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc -p tsconfig.json" },
  "dependencies": { "zod": "^3.24.0" }
}
```

`packages/ir/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

`pnpm install` 실행.

- [ ] **Step 3: 스키마 실패 테스트 작성**

`packages/ir/test/schema.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { DocumentSchema } from '../src/index.js'

const minimalDoc = {
  schemaVersion: 1,
  source: { kind: 'confluence', uri: 'https://wiki/x/1' },
  title: '결제 모듈 개편',
  docType: { value: 'design', confidence: 0.9, origin: 'llm' },
  blocks: [
    { id: 'h1', path: [1], anchor: { kind: 'confluence', xpath: '//h1[1]', textQuote: { exact: '개요' } },
      kind: 'heading', level: 1, text: '개요' },
  ],
  links: [],
  metadata: { labels: [] },
}

describe('DocumentSchema', () => {
  it('최소 문서를 통과시킨다', () => {
    expect(DocumentSchema.parse(minimalDoc).title).toBe('결제 모듈 개편')
  })

  it('알 수 없는 블록 kind를 거부한다', () => {
    const bad = { ...minimalDoc, blocks: [{ ...minimalDoc.blocks[0], kind: 'sparkle' }] }
    expect(() => DocumentSchema.parse(bad)).toThrow()
  })

  it('heading level 범위를 강제한다', () => {
    const bad = { ...minimalDoc, blocks: [{ ...minimalDoc.blocks[0], level: 9 }] }
    expect(() => DocumentSchema.parse(bad)).toThrow()
  })

  it('anchor kind와 필드가 맞지 않으면 거부한다', () => {
    const bad = { ...minimalDoc, blocks: [{ ...minimalDoc.blocks[0], anchor: { kind: 'pptx' } }] }
    expect(() => DocumentSchema.parse(bad)).toThrow()
  })
})
```

- [ ] **Step 4: 테스트 실패 확인**

Run: `pnpm vitest run packages/ir`
Expected: FAIL — `Cannot find module '../src/index.js'`

- [ ] **Step 5: anchor.ts 구현**

`SourceAnchor`를 zod discriminated union으로 정의한다. 스펙 4.2절의 5개 변형(confluence/pptx/docx/xlsx/pdf)을 그대로 옮긴다. `TextQuoteSchema`는 `{ exact: string; prefix?: string; suffix?: string }`.

```typescript
import { z } from 'zod'

export const TextQuoteSchema = z.object({
  exact: z.string().min(1),
  prefix: z.string().optional(),
  suffix: z.string().optional(),
})

export const SourceAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('confluence'), xpath: z.string(), textQuote: TextQuoteSchema }),
  z.object({ kind: z.literal('pptx'), slide: z.number().int().positive(), shapeId: z.string().optional() }),
  z.object({ kind: z.literal('docx'), paragraphIndex: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('xlsx'), sheet: z.string(), range: z.string().optional() }),
  z.object({ kind: z.literal('pdf'), page: z.number().int().positive(),
             bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional() }),
])

export type SourceAnchor = z.infer<typeof SourceAnchorSchema>
```

- [ ] **Step 6: schema.ts 구현**

`BlockBaseSchema`(id/path/anchor)를 정의하고 11개 블록 변형을 `z.discriminatedUnion('kind', ...)`로 합친 뒤 `BlockBaseSchema`와 교차(intersection)한다. `DocTypeSchema`는 스펙 5.1절 8개 리터럴의 enum. `LinkSchema`, `DocumentSchema`는 스펙 4장 그대로.

주의: discriminated union과 base를 합칠 때는 각 변형 객체에 base 필드를 `.merge()`로 넣어야 `discriminatedUnion`이 동작한다. intersection은 discriminator를 잃는다.

```typescript
const withBase = <T extends z.ZodRawShape>(shape: T) => BlockBaseSchema.extend(shape)

export const BlockSchema = z.discriminatedUnion('kind', [
  withBase({ kind: z.literal('heading'), level: z.number().int().min(1).max(6), text: z.string() }),
  withBase({ kind: z.literal('paragraph'), text: z.string() }),
  // ... 나머지 9개
])
```

- [ ] **Step 7: 스키마 테스트 통과 확인**

Run: `pnpm vitest run packages/ir/test/schema.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 8: walk/serialize/hash 실패 테스트 작성**

`packages/ir/test/serialize.test.ts`:
```typescript
import { describe, it, expect } from 'vitest'
import { serializeToMarkdown, walkSections, hashDocument, blockText } from '../src/index.js'
import { doc } from './fixtures/design-doc.js'

describe('serializeToMarkdown', () => {
  it('모든 블록 앞에 ID 주석을 붙인다', () => {
    const md = serializeToMarkdown(doc)
    for (const b of doc.blocks) expect(md).toContain(`<!--b:${b.id}-->`)
  })

  it('heading을 마크다운 제목으로 쓴다', () => {
    expect(serializeToMarkdown(doc)).toContain('# 결제 모듈 개편')
  })

  it('table을 마크다운 표로 쓴다', () => {
    const md = serializeToMarkdown(doc)
    expect(md).toContain('| 단계 | 담당 |')
    expect(md).toContain('| --- | --- |')
  })

  it('image는 alt와 캡션을 드러내고 없으면 명시한다', () => {
    expect(serializeToMarkdown(doc)).toContain('[이미지: alt 없음]')
  })
})

describe('walkSections', () => {
  it('제목을 경계로 섹션을 나눈다', () => {
    const sections = walkSections(doc)
    expect(sections.map(s => s.heading?.text)).toEqual([null, '개요', '아키텍처'].slice(1 - 1))
  })

  it('제목 앞 블록은 heading이 null인 선행 섹션에 담는다', () => {
    const leading = walkSections(doc)[0]
    if (leading.heading === null) expect(leading.blocks.length).toBeGreaterThan(0)
  })

  it('섹션 charCount가 본문 길이 합과 같다', () => {
    for (const s of walkSections(doc)) {
      expect(s.charCount).toBe(s.blocks.reduce((n, b) => n + blockText(b).length, 0))
    }
  })
})

describe('hashDocument', () => {
  it('같은 내용이면 같은 해시', () => {
    expect(hashDocument(doc)).toBe(hashDocument(structuredClone(doc)))
  })

  it('본문이 바뀌면 해시가 바뀐다', () => {
    const changed = structuredClone(doc)
    const target = changed.blocks.find(b => b.kind === 'paragraph')!
    ;(target as { text: string }).text += ' 추가'
    expect(hashDocument(changed)).not.toBe(hashDocument(doc))
  })

  it('앵커만 바뀌면 해시가 그대로다', () => {
    const changed = structuredClone(doc)
    changed.blocks[0].anchor = { kind: 'confluence', xpath: '//div[9]', textQuote: { exact: 'x' } }
    expect(hashDocument(changed)).toBe(hashDocument(doc))
  })
})
```

픽스처 `packages/ir/test/fixtures/design-doc.ts`는 heading 3개, paragraph 4개, table 1개, image(alt 없음) 1개, code 1개를 담은 설계문서 IR을 export한다.

- [ ] **Step 9: 테스트 실패 확인**

Run: `pnpm vitest run packages/ir`
Expected: FAIL — 함수 미정의

- [ ] **Step 10: walk.ts 구현**

`blockText(block)`은 kind별로 검사 대상 텍스트를 뽑는다. table은 헤더+셀을 공백 결합, list는 항목 결합, image는 `alt ?? caption ?? ''`, code는 본문, slide는 `title + notes`.

`walkSections(doc)`은 blocks를 순회하며 heading을 만나면 새 섹션을 연다. 첫 heading 이전 블록은 `heading: null` 섹션에 담고, 그 섹션이 비면 결과에서 제외한다.

`totalTextLength(doc)`은 `blockText` 합.

- [ ] **Step 11: serialize.ts 구현**

블록마다 `<!--b:{id}-->` 를 앞에 붙이고 kind별 마크다운을 출력한다.

- heading → `#`.repeat(level) + text
- paragraph → text
- list → `- ` 또는 `1. ` 접두 항목
- table → 헤더 행, `| --- |` 구분 행, 데이터 행. 캡션이 있으면 표 앞줄에 `표: {caption}`
- code → ` ```{lang ?? ''} ` 펜스
- image → alt/caption이 있으면 `[이미지: {alt}]`, 없으면 `[이미지: alt 없음]`. ocrText가 있으면 다음 줄에 붙인다
- callout → `> [{variant}] {text}`
- macro → `renderedText`가 있으면 그것을, 없으면 `[매크로: {name} — 내용 추출 불가]`
- slide → `## 슬라이드 {index}: {title}` + notes를 `발표자 노트: ...`로
- sheet → `## 시트 {name}` + 헤더 나열

LLM이 위치를 지목해야 하므로 **ID 주석은 절대 생략하지 않는다.**

- [ ] **Step 12: hash.ts 구현**

앵커와 source의 휘발성 필드를 제외하고 정규화한 뒤 sha256을 낸다. 앵커가 바뀌어도 내용이 같으면 캐시가 살아야 하기 때문이다.

```typescript
import { createHash } from 'node:crypto'

export function hashDocument(doc: Document): string {
  const normalized = {
    title: doc.title.trim(),
    docType: doc.docType.value,
    labels: [...doc.metadata.labels].sort(),
    blocks: doc.blocks.map(b => {
      const { anchor: _a, ...rest } = b
      return rest
    }),
    links: doc.links.map(l => ({ text: l.text, href: l.href, target: l.target })),
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
}
```

- [ ] **Step 13: 테스트 통과 확인**

Run: `pnpm vitest run packages/ir`
Expected: PASS

- [ ] **Step 14: 커밋**

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json turbo.json vitest.workspace.ts .gitignore packages/ir
git commit -m "feat(ir): add Document IR schema, section walker, markdown serializer, content hash"
```

---

### Task 2: 룰 엔진 코어 · 규칙셋 · 점수 산정

**Files:**
- Create: `packages/rules/package.json`, `packages/rules/tsconfig.json`
- Create: `packages/rules/src/{index,types,registry,runner,ruleset,scoring,doctype}.ts`
- Create: `packages/rules/rulesets/default.yaml`
- Test: `packages/rules/test/{runner,ruleset,scoring}.test.ts`

**Interfaces:**
- Consumes: `@ai-lint/ir` — `Document`, `Block`, `walkSections`, `blockText`, `totalTextLength`
- Produces:
  - `interface Rule { id: string; axis: Axis; defaultSeverity: Severity; appliesTo: DocType[] | 'all'; check(ctx: RuleContext): RawFinding[] }`
  - `interface RuleContext { doc: Document; options: Record<string, unknown>; sections: Section[] }`
  - `type RawFinding = { blockId: string | null; message: string; why: string; evidence?: string; suggestion?: { before: string; after: string } }`
  - `registerRule(rule: Rule): void`, `getRule(id): Rule | undefined`, `allRules(): Rule[]`
  - `runRules(doc: Document, ruleset: ResolvedRuleset): Finding[]`
  - `loadRuleset(yamlText: string): ResolvedRuleset`, `DEFAULT_RULESET: ResolvedRuleset`
  - `scoreFindings(findings: Finding[], weights: AxisWeights): Score`
  - `REQUIRED_SECTIONS: Record<DocType, string[]>`

- [ ] **Step 1: 패키지 셸 + 타입 정의**

`packages/rules/package.json`은 `@ai-lint/ir`을 `workspace:*`로, `yaml`과 `zod`를 의존성으로 갖는다.

`types.ts`에 `Rule`, `RuleContext`, `RawFinding`, `Finding`, `Severity`, `Axis`, `ResolvedRuleset`, `AxisWeights`, `Score`를 정의한다. `Finding`은 스펙 8.1절 그대로.

- [ ] **Step 2: 러너 실패 테스트 작성**

`packages/rules/test/runner.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { createRegistry, runRules, DEFAULT_RULESET } from '../src/index.js'
import type { Rule } from '../src/index.js'
import { makeDoc, para } from './helpers.js'

const alwaysFires: Rule = {
  id: 'STR001', axis: 'structure', defaultSeverity: 'warning', appliesTo: 'all',
  check: (ctx) => ctx.doc.blocks.map(b => ({ blockId: b.id, message: '문제', why: '이유' })),
}

describe('runRules', () => {
  it('활성 룰의 finding에 심각도와 축과 앵커를 채운다', () => {
    const reg = createRegistry([alwaysFires])
    const doc = makeDoc([para('p1', '본문')])
    const [f] = runRules(doc, DEFAULT_RULESET, reg)
    expect(f.ruleId).toBe('STR001')
    expect(f.axis).toBe('structure')
    expect(f.severity).toBe('warning')
    expect(f.source).toBe('rule')
    expect(f.anchor).toEqual(doc.blocks[0].anchor)
  })

  it('비활성 룰은 실행하지 않는다', () => {
    const reg = createRegistry([alwaysFires])
    const rs = { ...DEFAULT_RULESET, rules: { STR001: { enabled: false, severity: 'warning', options: {} } } }
    expect(runRules(makeDoc([para('p1', 'x')]), rs, reg)).toHaveLength(0)
  })

  it('규칙셋의 심각도 오버라이드를 적용한다', () => {
    const reg = createRegistry([alwaysFires])
    const rs = { ...DEFAULT_RULESET, rules: { STR001: { enabled: true, severity: 'error', options: {} } } }
    expect(runRules(makeDoc([para('p1', 'x')]), rs, reg)[0].severity).toBe('error')
  })

  it('문서 유형에 해당하지 않는 룰은 건너뛴다', () => {
    const reg = createRegistry([{ ...alwaysFires, appliesTo: ['meeting-notes'] }])
    expect(runRules(makeDoc([para('p1', 'x')], 'design'), DEFAULT_RULESET, reg)).toHaveLength(0)
  })

  it('룰 하나가 예외를 던져도 나머지 룰 결과를 반환한다', () => {
    const boom: Rule = { ...alwaysFires, id: 'STR002', check: () => { throw new Error('boom') } }
    const reg = createRegistry([boom, alwaysFires])
    expect(runRules(makeDoc([para('p1', 'x')]), DEFAULT_RULESET, reg)).toHaveLength(1)
  })
})
```

`test/helpers.ts`는 `makeDoc(blocks, docType?)`, `para(id, text)`, `heading(id, level, text)`, `table(id, headers, rows)` 등 IR 픽스처 빌더를 export한다. 이후 모든 룰 테스트가 이걸 쓴다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run packages/rules`
Expected: FAIL — 모듈 없음

- [ ] **Step 4: registry.ts, runner.ts 구현**

레지스트리는 전역 싱글턴과 `createRegistry(rules)` 팩토리를 함께 제공한다 (테스트가 전역을 오염시키지 않도록).

러너는 각 룰을 try/catch로 감싸 격리한다. 룰 하나가 죽어도 전체 검사가 죽으면 안 된다. 예외는 로그에 남기고 finding 0개로 처리한다. `blockId`로 블록을 찾아 `anchor`를 채우고, 없으면 `anchor: null`.

- [ ] **Step 5: 규칙셋 로딩 테스트 작성**

`packages/rules/test/ruleset.test.ts`:
```typescript
describe('loadRuleset', () => {
  it('YAML을 파싱해 규칙셋을 만든다', () => {
    const rs = loadRuleset(`
id: team-a
version: 2
name: A팀
axisWeights: { structure: 0.3, context: 0.5, metadata: 0.2 }
rules:
  STR003: { enabled: true, severity: warning, options: { maxSectionChars: 900 } }
`)
    expect(rs.id).toBe('team-a')
    expect(rs.rules.STR003.options.maxSectionChars).toBe(900)
  })

  it('명시되지 않은 룰은 카탈로그 기본값으로 채운다', () => {
    const rs = loadRuleset('id: x\nversion: 1\nname: x\nrules: {}\n')
    expect(rs.rules.STR001.enabled).toBe(true)
    expect(rs.rules.STR001.severity).toBe('warning')
  })

  it('축 가중치 합이 1이 아니면 거부한다', () => {
    expect(() => loadRuleset('id: x\nversion: 1\nname: x\naxisWeights: { structure: 0.9, context: 0.9, metadata: 0.9 }\nrules: {}\n')).toThrow(/가중치/)
  })

  it('알 수 없는 룰 ID를 거부한다', () => {
    expect(() => loadRuleset('id: x\nversion: 1\nname: x\nrules: { STR999: { enabled: true } }\n')).toThrow(/STR999/)
  })
})
```

- [ ] **Step 6: 점수 산정 테스트 작성**

`packages/rules/test/scoring.test.ts`:
```typescript
const w = { structure: 0.35, context: 0.45, metadata: 0.20 }
const f = (axis, severity, ruleId) => ({ axis, severity, ruleId, /* ...나머지 필드 */ })

describe('scoreFindings', () => {
  it('finding이 없으면 만점 A', () => {
    const s = scoreFindings([], w)
    expect(s.total).toBe(100)
    expect(s.grade).toBe('A')
  })

  it('심각도별 감점을 적용한다', () => {
    expect(scoreFindings([f('structure', 'error', 'STR004')], w).axes.structure).toBe(85)
    expect(scoreFindings([f('structure', 'warning', 'STR001')], w).axes.structure).toBe(94)
    expect(scoreFindings([f('structure', 'info', 'STR006')], w).axes.structure).toBe(98)
  })

  it('같은 룰 반복은 3회까지만 전액 감점하고 이후 1점씩', () => {
    const five = Array.from({ length: 5 }, () => f('structure', 'error', 'STR004'))
    expect(scoreFindings(five, w).axes.structure).toBe(100 - 45 - 2)
  })

  it('축 점수는 0 밑으로 내려가지 않는다', () => {
    const many = Array.from({ length: 30 }, (_, i) => f('context', 'error', `CTX00${i % 9}`))
    expect(scoreFindings(many, w).axes.context).toBe(0)
  })

  it('총점은 축 점수의 가중 평균이다', () => {
    const s = scoreFindings([f('context', 'error', 'CTX001')], w)
    expect(s.total).toBe(Math.round(100 * 0.35 + 85 * 0.45 + 100 * 0.20))
  })

  it('등급 경계를 정확히 적용한다', () => {
    expect(gradeOf(90)).toBe('A'); expect(gradeOf(89)).toBe('B')
    expect(gradeOf(75)).toBe('B'); expect(gradeOf(74)).toBe('C')
    expect(gradeOf(60)).toBe('C'); expect(gradeOf(59)).toBe('D')
  })
})
```

- [ ] **Step 7: ruleset.ts, scoring.ts, doctype.ts 구현**

`ruleset.ts` — YAML 파싱 후 zod 검증, 카탈로그에 없는 룰 ID면 에러, 가중치 합이 1.0 ± 0.001을 벗어나면 에러, 미지정 룰은 카탈로그 기본값으로 채운다. `axisWeights` 자체가 없으면 기본값 사용.

`scoring.ts` — 룰 ID별 발생 횟수를 세면서 축별로 감점 누적. 4번째 발생부터는 1점.

`doctype.ts` — 스펙 5.3절 표를 `REQUIRED_SECTIONS: Record<DocType, string[]>`로 옮긴다. 값은 한국어 섹션 이름이며 META007이 이걸 참조한다.

`rulesets/default.yaml` — 스펙 5.4절 형식으로 전체 룰의 기본값을 명시한다.

- [ ] **Step 8: 테스트 통과 확인**

Run: `pnpm vitest run packages/rules`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add packages/rules
git commit -m "feat(rules): add rule engine core, ruleset loading, and axis scoring"
```

---

### Task 3: 구조 룰 카탈로그 (STR001~STR012)

**Files:**
- Create: `packages/rules/src/catalog/structure/*.ts` (룰별 1파일), `packages/rules/src/catalog/index.ts`
- Test: `packages/rules/test/catalog/structure.test.ts`

**Interfaces:**
- Consumes: Task 2의 `Rule`, `RuleContext`, `RawFinding`, `createRegistry`; Task 1의 `walkSections`, `blockText`, `totalTextLength`
- Produces: `STRUCTURE_RULES: Rule[]`, `ALL_RULES: Rule[]` (catalog/index.ts에서 구조+메타데이터+LLM 룰 메타를 합친 것)

- [ ] **Step 1: 룰별 위반/정상 픽스처 쌍 테스트 작성**

**규칙: 룰마다 위반 케이스와 정상 케이스를 반드시 쌍으로 작성한다.** 정상 케이스가 없으면 오탐을 잡을 수 없다.

```typescript
import { describe, it, expect } from 'vitest'
import { STRUCTURE_RULES } from '../../src/catalog/index.js'
import { runRules, DEFAULT_RULESET, createRegistry } from '../../src/index.js'
import { makeDoc, heading, para, table, image, code, link, macro } from '../helpers.js'

const reg = createRegistry(STRUCTURE_RULES)
const fire = (doc) => runRules(doc, DEFAULT_RULESET, reg).map(f => f.ruleId)

describe('STR001 heading-hierarchy-skip', () => {
  it('h1 다음 h3이면 위반', () => {
    expect(fire(makeDoc([heading('a', 1, '개요'), heading('b', 3, '세부')]))).toContain('STR001')
  })
  it('h1 다음 h2면 정상', () => {
    expect(fire(makeDoc([heading('a', 1, '개요'), heading('b', 2, '세부')]))).not.toContain('STR001')
  })
  it('레벨이 내려가는 건 정상 (h3 다음 h1)', () => {
    expect(fire(makeDoc([heading('a', 1, 'x'), heading('b', 2, 'y'), heading('c', 3, 'z'), heading('d', 1, 'w')])))
      .not.toContain('STR001')
  })
})

describe('STR002 no-headings', () => {
  it('제목 없이 800자 초과면 위반', () => {
    expect(fire(makeDoc([para('p', 'ㄱ'.repeat(801))]))).toContain('STR002')
  })
  it('짧은 문서는 정상', () => {
    expect(fire(makeDoc([para('p', 'ㄱ'.repeat(200))]))).not.toContain('STR002')
  })
  it('제목이 있으면 길어도 정상', () => {
    expect(fire(makeDoc([heading('h', 1, '개요'), para('p', 'ㄱ'.repeat(2000))]))).not.toContain('STR002')
  })
})

describe('STR004 table-as-image', () => {
  it('alt/캡션 없는 이미지에 표·차트 암시 문맥이면 위반', () => {
    expect(fire(makeDoc([para('p', '아래 표를 참고하세요.'), image('i', {})]))).toContain('STR004')
  })
  it('표가 실제 table 블록으로 있으면 정상', () => {
    expect(fire(makeDoc([para('p', '아래 표를 참고하세요.'), table('t', ['단계'], [['1차']])]))).not.toContain('STR004')
  })
  it('ocrText가 있으면 정상', () => {
    expect(fire(makeDoc([para('p', '아래 표'), image('i', { ocrText: '단계 담당\n1차 김' })]))).not.toContain('STR004')
  })
})

describe('STR005 image-missing-alt', () => {
  it('alt와 캡션 모두 없으면 위반', () => {
    expect(fire(makeDoc([image('i', {})]))).toContain('STR005')
  })
  it('alt가 있으면 정상', () => {
    expect(fire(makeDoc([image('i', { alt: '결제 흐름도' })]))).not.toContain('STR005')
  })
  it('의미 없는 alt(파일명)는 위반', () => {
    expect(fire(makeDoc([image('i', { alt: 'image001.png' })]))).toContain('STR005')
  })
})

describe('STR007 vague-link-text', () => {
  it('"여기" 링크 텍스트는 위반', () => {
    expect(fire(makeDoc([para('p', '자세한 내용은 여기')], 'design', [link('p', '여기', 'https://x')])))
      .toContain('STR007')
  })
  it('설명적 링크 텍스트는 정상', () => {
    expect(fire(makeDoc([para('p', '결제 API 명세 참고')], 'design', [link('p', '결제 API 명세', 'https://x')])))
      .not.toContain('STR007')
  })
})
```

STR003, STR006, STR008~STR012도 동일한 형태로 위반/정상 쌍을 작성한다.

- **STR003** — 섹션 charCount > `maxSectionChars`(기본 1500) 위반 / 이하 정상 / 제목으로 잘 나뉜 긴 문서 정상
- **STR006** — 언어 없는 code 블록 위반 / `lang: 'ts'` 정상 / 3줄 미만 짧은 코드는 정상(오탐 방지)
- **STR008** — 헤더 없고 셀 2개 이하인 표 위반 / 정상 데이터 표 정상
- **STR009** — `headers`가 빈 배열이고 행이 2개 이상 위반 / 헤더 있으면 정상
- **STR010** — list depth ≥ 4 위반 / depth 2 정상
- **STR011** — 텍스트 총량 200자 미만 + 첨부 링크 존재 위반 / 본문 있으면 정상
- **STR012** — `macro` 블록에 `renderedText`가 없고 name이 콘텐츠 매크로 목록(`include`, `excerpt-include`, `multimedia`, `viewxls`, `viewpdf`)에 속하면 위반 / `renderedText` 있으면 정상 / `toc` 같은 네비게이션 매크로는 정상

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run packages/rules/test/catalog/structure.test.ts`
Expected: FAIL — `STRUCTURE_RULES` 없음

- [ ] **Step 3: 룰 12개 구현**

각 룰은 한 파일에 하나. 파일명은 `str001-heading-hierarchy-skip.ts` 형식.

`message`는 무엇이 문제인지, `why`는 왜 AI 가독성 문제인지를 한국어로 쓴다. 예를 들어 STR005는:

```typescript
message: '이미지에 대체 텍스트가 없습니다',
why: 'AI는 이미지를 읽지 못합니다. 이 이미지가 담은 정보는 문서에 존재하지 않는 것과 같습니다.',
```

STR005의 "의미 없는 alt" 판정: alt가 파일명 패턴(`/\.(png|jpe?g|gif|svg|webp)$/i`)이거나, `image`/`screenshot`/`캡처`/`그림` 뒤에 숫자만 오는 형태이거나, 3자 미만이면 없는 것으로 본다.

STR004의 표·차트 암시 판정: 직전 2개 블록 또는 직후 1개 블록의 텍스트에 `표|차트|그래프|다이어그램|아키텍처|플로우|table|chart|diagram` 중 하나가 있고, 같은 섹션에 `table` 블록이 없으며, 이미지에 `ocrText`가 없을 때 발화한다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run packages/rules`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/rules
git commit -m "feat(rules): add STR001-STR012 structure and chunkability rules"
```

---

### Task 4: 메타데이터 룰 카탈로그 (META001~META008)

**Files:**
- Create: `packages/rules/src/catalog/metadata/*.ts`
- Modify: `packages/rules/src/catalog/index.ts`
- Test: `packages/rules/test/catalog/metadata.test.ts`

**Interfaces:**
- Consumes: Task 2의 `Rule`, `REQUIRED_SECTIONS`; Task 3의 카탈로그 패턴
- Produces: `METADATA_RULES: Rule[]`

- [ ] **Step 1: 위반/정상 쌍 테스트 작성**

```typescript
describe('META001 title-not-descriptive', () => {
  it('"회의록"만 있는 제목은 위반', () => {
    expect(fire(makeDoc([para('p', 'x')], 'meeting-notes', [], { title: '회의록' }))).toContain('META001')
  })
  it('"[2026-07-15] 결제 모듈 아키텍처 리뷰"는 정상', () => {
    expect(fire(makeDoc([para('p', 'x')], 'meeting-notes', [], { title: '[2026-07-15] 결제 모듈 아키텍처 리뷰' })))
      .not.toContain('META001')
  })
  it('"복사본" 접미가 붙으면 위반', () => {
    expect(fire(makeDoc([para('p', 'x')], 'design', [], { title: '결제 설계 (복사본)' }))).toContain('META001')
  })
})

describe('META005 stale-document', () => {
  it('임계 기간을 넘긴 문서는 위반', () => {
    expect(fire(makeDoc([para('p', 'x')], 'design', [], { modifiedAt: '2023-01-01T00:00:00Z' })))
      .toContain('META005')
  })
  it('최근 수정 문서는 정상', () => {
    expect(fire(makeDoc([para('p', 'x')], 'design', [], { modifiedAt: nowIso() }))).not.toContain('META005')
  })
  it('modifiedAt이 없으면 발화하지 않는다', () => {
    expect(fire(makeDoc([para('p', 'x')]))).not.toContain('META005')
  })
})

describe('META007 missing-required-section', () => {
  it('회의록에 액션아이템이 없으면 위반', () => {
    const doc = makeDoc([heading('h1', 1, '일시'), para('p1', '2026-07-15'),
                         heading('h2', 1, '참석자'), para('p2', '김, 이'),
                         heading('h3', 1, '결정사항'), para('p3', '3단계 진행')], 'meeting-notes')
    const f = runRules(doc, DEFAULT_RULESET, reg).find(x => x.ruleId === 'META007')
    expect(f?.message).toContain('액션아이템')
  })
  it('필수 섹션이 모두 있으면 정상', () => {
    const doc = makeDoc([heading('h1', 1, '일시'), para('p1', '2026-07-15'),
                         heading('h2', 1, '참석자'), para('p2', '김, 이'),
                         heading('h3', 1, '결정사항'), para('p3', 'x'),
                         heading('h4', 1, '액션아이템'), para('p4', '김: API 초안 (7/20)')], 'meeting-notes')
    expect(fire(doc)).not.toContain('META007')
  })
  it('unknown 유형은 발화하지 않는다', () => {
    expect(fire(makeDoc([para('p', 'x')], 'unknown'))).not.toContain('META007')
  })
})

describe('META008 draft-marker', () => {
  it('TBD가 남아 있으면 위반', () => {
    expect(fire(makeDoc([para('p', '응답 형식은 TBD')]))).toContain('META008')
  })
  it('코드블록 안의 TODO는 무시한다', () => {
    expect(fire(makeDoc([code('c', 'ts', '// TODO: refactor')]))).not.toContain('META008')
  })
})
```

META002, META003, META004, META006도 위반/정상 쌍을 작성한다.

- **META002** — 총 텍스트 1200자 초과 + 첫 섹션에 요약/개요/TL;DR 계열 제목 없음 위반 / 요약 섹션 있으면 정상
- **META003** — `metadata.labels`가 비면 위반 / 하나라도 있으면 정상
- **META004** — `metadata.owner`가 없고 본문에서 담당자 패턴을 못 찾으면 위반 / owner 있으면 정상
- **META006** — `links` 중 `status: 'broken'`이 있으면 위반 / 모두 ok거나 unchecked면 정상 (링크 검사는 클라이언트가 수행해 IR에 채워 보낸다)

**중요:** `META005`는 현재 시각에 의존한다. 룰이 `Date.now()`를 직접 부르면 테스트가 불안정해진다. `RuleContext`에 `now: Date`를 추가하고 러너가 주입한다. 테스트는 고정 시각을 넣는다. Task 2의 `RuleContext`를 이에 맞춰 수정한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run packages/rules/test/catalog/metadata.test.ts`
Expected: FAIL

- [ ] **Step 3: RuleContext에 now 주입 추가**

`RuleContext`에 `now: Date`를 추가하고, `runRules(doc, ruleset, registry, opts?: { now?: Date })`가 기본값 `new Date()`로 채운다.

- [ ] **Step 4: 룰 8개 구현**

META001의 비서술 제목 판정: 제목을 정규화한 뒤 (1) 일반명사 단독 목록(`회의록`, `메모`, `임시`, `테스트`, `문서`, `노트`, `Untitled`, `제목 없음`)과 일치하거나, (2) `복사본|copy|사본|백업|old|deprecated` 를 포함하거나, (3) 5자 미만이면 위반. 이 룰은 LLM 층에서도 다시 검사되므로 여기서는 명백한 것만 잡는다.

META007은 `REQUIRED_SECTIONS[docType]`의 각 항목에 대해 제목 블록 텍스트를 동의어 사전으로 매칭한다. 예: `액션아이템` ← `액션 아이템`, `Action Items`, `할 일`, `TODO`, `후속 조치`. 매칭 실패한 항목을 message에 나열한다.

META008의 미완성 표식: `TBD`, `TODO`, `작성중`, `작성 중`, `???`, `XXX`, `FIXME`. `code` 블록은 검사 대상에서 제외한다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run packages/rules`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add packages/rules
git commit -m "feat(rules): add META001-META008 metadata and freshness rules"
```

---

### Task 5: LLM Provider 추상화 + Gemini 구현

**Files:**
- Create: `packages/llm/package.json`, `packages/llm/tsconfig.json`
- Create: `packages/llm/src/{index,provider,schema}.ts`, `packages/llm/src/providers/{gemini,mock}.ts`
- Test: `packages/llm/test/{provider,gemini}.test.ts`

**Interfaces:**
- Consumes: 없음 (독립)
- Produces:
  - `interface LlmProvider { name: string; complete(req: CompletionRequest): Promise<unknown> }`
  - `type CompletionRequest = { system: string; user: string; schema: JsonSchema; maxTokens: number; temperature?: number }`
  - `createGeminiProvider(opts: { apiKey: string; model?: string }): LlmProvider`
  - `createMockProvider(responses: unknown[]): LlmProvider & { calls: CompletionRequest[] }`
  - `LLM_FINDING_SCHEMA: JsonSchema`, `LlmFindingSchema: z.ZodType<LlmFinding>`
  - `class LlmError extends Error { kind: 'auth' | 'rate-limit' | 'timeout' | 'invalid-response' | 'unknown' }`

- [ ] **Step 1: 스키마와 목 provider 테스트 작성**

```typescript
describe('LlmFindingSchema', () => {
  it('유효한 finding을 통과시킨다', () => {
    expect(() => LlmFindingSchema.parse({
      ruleId: 'CTX001', blockId: 'p3', evidence: '지난번 논의대로',
      why: '어떤 논의인지 문서에 없습니다.',
      suggestion: { before: '지난번 논의대로', after: '2026-07-15 아키텍처 리뷰 결정에 따라' },
      confidence: 0.9,
    })).not.toThrow()
  })
  it('confidence 범위를 강제한다', () => { /* 1.5 → throw */ })
  it('suggestion은 null을 허용한다', () => { /* ... */ })
  it('LLM 대상이 아닌 룰 ID를 거부한다', () => { /* STR001 → throw */ })
})

describe('createMockProvider', () => {
  it('호출 순서대로 응답을 반환하고 요청을 기록한다', async () => {
    const p = createMockProvider([{ findings: [] }, { findings: [{ ruleId: 'CTX001' }] }])
    await p.complete({ system: 's', user: 'u', schema: {}, maxTokens: 100 })
    const second = await p.complete({ system: 's', user: 'u2', schema: {}, maxTokens: 100 })
    expect(p.calls[1].user).toBe('u2')
    expect(second).toEqual({ findings: [{ ruleId: 'CTX001' }] })
  })
  it('응답이 소진되면 명확한 에러를 던진다', async () => { /* ... */ })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run packages/llm`
Expected: FAIL

- [ ] **Step 3: provider.ts, schema.ts, mock.ts 구현**

`LLM_FINDING_SCHEMA`는 Gemini의 `responseSchema`로 넘길 JSON Schema다. 최상위는 `{ findings: LlmFinding[] }`. `ruleId`는 `enum`으로 CTX001~CTX009, META001, META007만 허용한다 — 모델이 STR 룰을 지어내지 못하게 스키마 층에서 막는다.

`LlmFindingSchema`는 같은 제약의 zod 버전. 응답을 받은 뒤 한 번 더 검증한다.

- [ ] **Step 4: Gemini provider 구현**

```typescript
import { GoogleGenAI } from '@google/genai'

export function createGeminiProvider(opts: { apiKey: string; model?: string }): LlmProvider {
  const client = new GoogleGenAI({ apiKey: opts.apiKey })
  const model = opts.model ?? 'gemini-2.5-flash'
  return {
    name: `gemini:${model}`,
    async complete(req) {
      try {
        const res = await client.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: req.user }] }],
          config: {
            systemInstruction: req.system,
            responseMimeType: 'application/json',
            responseSchema: req.schema,
            maxOutputTokens: req.maxTokens,
            temperature: req.temperature ?? 0.2,
          },
        })
        const text = res.text
        if (!text) throw new LlmError('빈 응답', 'invalid-response')
        return JSON.parse(text)
      } catch (e) {
        throw toLlmError(e)
      }
    },
  }
}
```

`toLlmError`는 상태 코드와 메시지로 `auth`/`rate-limit`/`timeout`/`unknown`을 분류한다. JSON 파싱 실패는 `invalid-response`.

Gemini 테스트는 SDK를 모킹해 요청 구성과 에러 분류만 검증한다. 실제 API 호출은 하지 않는다.

- [ ] **Step 5: 테스트 통과 확인**

Run: `pnpm vitest run packages/llm`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add packages/llm
git commit -m "feat(llm): add provider abstraction, structured output schema, and Gemini implementation"
```

---

### Task 6: 근거 검증기

**Files:**
- Create: `packages/llm/src/verify.ts`
- Test: `packages/llm/test/verify.test.ts`

**Interfaces:**
- Consumes: Task 1의 `Document`, `blockText`; Task 5의 `LlmFinding`; Task 2의 `ResolvedRuleset`
- Produces:
  - `verifyFindings(raw: unknown, doc: Document, ruleset: ResolvedRuleset, opts?: { minConfidence?: number }): { accepted: Finding[]; rejected: RejectionRecord[] }`
  - `type RejectionRecord = { ruleId?: string; reason: 'unknown-rule' | 'rule-disabled' | 'doctype-mismatch' | 'unknown-block' | 'evidence-not-found' | 'low-confidence' | 'schema-invalid' }`

이 태스크가 제품 신뢰도의 핵심이다. LLM이 그럴듯하게 지어낸 지적을 여기서 걸러낸다.

- [ ] **Step 1: 검증 테스트 작성**

```typescript
import { describe, it, expect } from 'vitest'
import { verifyFindings } from '../src/verify.js'
import { DEFAULT_RULESET } from '@ai-lint/rules'
import { makeDoc, para } from './helpers.js'

const doc = makeDoc([para('p1', '지난번 논의대로 3단계로 나눠서 진행하기로 했습니다.')], 'design')
const base = { ruleId: 'CTX001', blockId: 'p1', why: '이유', suggestion: null, confidence: 0.9 }

describe('verifyFindings', () => {
  it('근거가 원문에 있으면 통과시킨다', () => {
    const r = verifyFindings({ findings: [{ ...base, evidence: '지난번 논의대로' }] }, doc, DEFAULT_RULESET)
    expect(r.accepted).toHaveLength(1)
    expect(r.accepted[0].source).toBe('llm')
    expect(r.accepted[0].anchor).toEqual(doc.blocks[0].anchor)
  })

  it('원문에 없는 근거를 만들어내면 폐기한다', () => {
    const r = verifyFindings({ findings: [{ ...base, evidence: '작년 워크샵에서 정한 대로' }] }, doc, DEFAULT_RULESET)
    expect(r.accepted).toHaveLength(0)
    expect(r.rejected[0].reason).toBe('evidence-not-found')
  })

  it('존재하지 않는 blockId를 폐기한다', () => {
    const r = verifyFindings({ findings: [{ ...base, blockId: 'p99', evidence: '지난번' }] }, doc, DEFAULT_RULESET)
    expect(r.rejected[0].reason).toBe('unknown-block')
  })

  it('공백 차이는 허용한다', () => {
    const r = verifyFindings({ findings: [{ ...base, evidence: '지난번  논의대로' }] }, doc, DEFAULT_RULESET)
    expect(r.accepted).toHaveLength(1)
  })

  it('카탈로그에 없는 룰 ID를 폐기한다', () => {
    const r = verifyFindings({ findings: [{ ...base, ruleId: 'CTX999', evidence: '지난번' }] }, doc, DEFAULT_RULESET)
    expect(r.rejected[0].reason).toBe('unknown-rule')
  })

  it('규칙셋에서 비활성인 룰을 폐기한다', () => {
    const rs = { ...DEFAULT_RULESET, rules: { ...DEFAULT_RULESET.rules, CTX001: { enabled: false, severity: 'error', options: {} } } }
    expect(verifyFindings({ findings: [{ ...base, evidence: '지난번' }] }, doc, rs).rejected[0].reason).toBe('rule-disabled')
  })

  it('이 문서 유형에 적용되지 않는 룰을 폐기한다', () => {
    const rs = { ...DEFAULT_RULESET, rules: { ...DEFAULT_RULESET.rules, CTX007: { enabled: true, severity: 'warning', options: {}, appliesTo: ['meeting-notes'] } } }
    const r = verifyFindings({ findings: [{ ...base, ruleId: 'CTX007', evidence: '지난번' }] }, doc, rs)
    expect(r.rejected[0].reason).toBe('doctype-mismatch')
  })

  it('confidence가 임계치 미만이면 폐기한다', () => {
    const r = verifyFindings({ findings: [{ ...base, evidence: '지난번', confidence: 0.3 }] }, doc, DEFAULT_RULESET)
    expect(r.rejected[0].reason).toBe('low-confidence')
  })

  it('suggestion.before가 원문에 없으면 suggestion만 버리고 finding은 살린다', () => {
    const r = verifyFindings({ findings: [{ ...base, evidence: '지난번 논의대로',
      suggestion: { before: '없는 문장', after: '고친 문장' } }] }, doc, DEFAULT_RULESET)
    expect(r.accepted).toHaveLength(1)
    expect(r.accepted[0].suggestion).toBeNull()
  })

  it('스키마를 어긴 응답 전체를 안전하게 처리한다', () => {
    const r = verifyFindings({ nonsense: true }, doc, DEFAULT_RULESET)
    expect(r.accepted).toHaveLength(0)
    expect(r.rejected[0].reason).toBe('schema-invalid')
  })

  it('같은 블록·같은 룰의 중복 finding을 하나로 합친다', () => {
    const r = verifyFindings({ findings: [
      { ...base, evidence: '지난번 논의대로' },
      { ...base, evidence: '지난번 논의대로', confidence: 0.7 },
    ] }, doc, DEFAULT_RULESET)
    expect(r.accepted).toHaveLength(1)
    expect(r.accepted[0].confidence).toBe(0.9)
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run packages/llm/test/verify.test.ts`
Expected: FAIL

- [ ] **Step 3: verify.ts 구현**

순서대로 검사하고, 첫 실패에서 사유를 기록하고 폐기한다.

1. 최상위를 `z.object({ findings: z.array(LlmFindingSchema) })`로 파싱. 실패 시 `schema-invalid` 하나만 기록하고 종료. 개별 finding 파싱 실패는 그 finding만 `schema-invalid`
2. `ruleId`가 LLM 대상 카탈로그에 있는가 → `unknown-rule`
3. 규칙셋에서 `enabled`인가 → `rule-disabled`
4. `appliesTo`가 문서 유형을 포함하는가 → `doctype-mismatch`
5. `blockId`가 실제 블록인가 → `unknown-block`
6. `confidence >= minConfidence`(기본 0.6)인가 → `low-confidence`
7. `evidence`가 블록 텍스트에 있는가 → `evidence-not-found`

근거 대조는 공백 정규화 후 부분 문자열 일치를 먼저 시도하고, 실패하면 정규화된 편집거리 유사도 0.9 이상인 부분 문자열을 탐색한다. 유사도 탐색은 evidence 길이의 슬라이딩 윈도로 수행하되 블록 텍스트가 2000자를 넘으면 건너뛴다 (비용 방어).

중복 병합은 `(ruleId, blockId)` 키로 묶고 confidence가 가장 높은 것을 남긴다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `pnpm vitest run packages/llm`
Expected: PASS (12 tests)

- [ ] **Step 5: 커밋**

```bash
git add packages/llm
git commit -m "feat(llm): add evidence verification to reject hallucinated findings"
```

---

### Task 7: 맥락 분석기 (프롬프트 · 청킹 · 오케스트레이션)

**Files:**
- Create: `packages/llm/src/{prompt,chunk,analyzer,doctype-infer}.ts`
- Test: `packages/llm/test/{chunk,analyzer,doctype-infer}.test.ts`

**Interfaces:**
- Consumes: Task 1의 `serializeToMarkdown`/`walkSections`, Task 5의 `LlmProvider`, Task 6의 `verifyFindings`
- Produces:
  - `analyzeContext(doc, ruleset, provider, opts?): Promise<{ findings: Finding[]; status: 'ok'|'partial'|'failed'; rejectedCount: number; chunks: number }>`
  - `inferDocType(doc, provider): Promise<{ value: DocType; confidence: number }>`
  - `planChunks(doc, opts?): Chunk[]` where `Chunk = { index: number; markdown: string; blockIds: string[] }`
  - `buildSystemPrompt(ruleset, docType): string`, `buildUserPrompt(chunk, globalContext): string`

- [ ] **Step 1: 청킹 테스트 작성**

```typescript
describe('planChunks', () => {
  it('임계치 이하면 한 덩어리', () => {
    expect(planChunks(shortDoc, { maxChars: 12000 })).toHaveLength(1)
  })
  it('임계치를 넘으면 제목 경계로 나눈다', () => {
    const chunks = planChunks(longDoc, { maxChars: 2000 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.markdown.length).toBeLessThanOrEqual(2400)
  })
  it('모든 블록이 정확히 한 청크에 속한다', () => {
    const ids = planChunks(longDoc, { maxChars: 2000 }).flatMap(c => c.blockIds)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(longDoc.blocks.map(b => b.id).sort())
  })
  it('한 섹션이 단독으로 임계치를 넘으면 그 섹션만으로 청크를 만든다', () => {
    const chunks = planChunks(hugeSectionDoc, { maxChars: 500 })
    expect(chunks.every(c => c.blockIds.length > 0)).toBe(true)
  })
})
```

- [ ] **Step 2: 분석기 테스트 작성 (목 provider)**

```typescript
describe('analyzeContext', () => {
  it('검증을 통과한 finding만 반환한다', async () => {
    const provider = createMockProvider([{ findings: [
      { ruleId: 'CTX001', blockId: 'p1', evidence: '지난번 논의대로', why: '이유', suggestion: null, confidence: 0.9 },
      { ruleId: 'CTX001', blockId: 'p1', evidence: '존재하지 않는 인용', why: '이유', suggestion: null, confidence: 0.9 },
    ] }])
    const r = await analyzeContext(doc, DEFAULT_RULESET, provider)
    expect(r.findings).toHaveLength(1)
    expect(r.rejectedCount).toBe(1)
    expect(r.status).toBe('ok')
  })

  it('청크 일부가 실패해도 성공한 청크 결과를 반환하고 partial을 표시한다', async () => {
    const provider = createFlakyProvider({ failAt: [1] })
    const r = await analyzeContext(longDoc, DEFAULT_RULESET, provider, { maxChars: 2000 })
    expect(r.status).toBe('partial')
    expect(r.findings.length).toBeGreaterThan(0)
  })

  it('모든 청크가 실패하면 failed를 반환하고 예외를 던지지 않는다', async () => {
    const r = await analyzeContext(doc, DEFAULT_RULESET, createAlwaysFailingProvider())
    expect(r.status).toBe('failed')
    expect(r.findings).toHaveLength(0)
  })

  it('여러 청크에 걸친 동일 finding을 중복 제거한다', async () => { /* ... */ })

  it('동시 호출 수를 제한한다', async () => {
    const provider = createConcurrencyTrackingProvider()
    await analyzeContext(veryLongDoc, DEFAULT_RULESET, provider, { maxChars: 500, concurrency: 2 })
    expect(provider.maxObservedConcurrency).toBeLessThanOrEqual(2)
  })

  it('프롬프트에 비활성 룰을 포함시키지 않는다', async () => {
    const provider = createMockProvider([{ findings: [] }])
    const rs = { ...DEFAULT_RULESET, rules: { ...DEFAULT_RULESET.rules, CTX006: { enabled: false, severity: 'info', options: {} } } }
    await analyzeContext(doc, rs, provider)
    expect(provider.calls[0].system).not.toContain('CTX006')
  })
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run packages/llm`
Expected: FAIL

- [ ] **Step 4: prompt.ts 구현**

시스템 프롬프트는 활성화된 CTX 룰과 META001/META007만 골라 ID·이름·판정 기준을 나열한다. 핵심 지시:

```
당신은 문서가 AI(RAG·LLM 에이전트)에게 읽힐 수 있는지 검사하는 린터입니다.
사람이 회의 맥락을 공유한 상태에서만 이해되는 표현을 찾아내는 것이 목표입니다.

판정 기준:
- 이 문서를 섹션 단위로 잘라 검색 결과로만 읽는 사람이 의미를 복원할 수 있는가
- 복원할 수 없다면 어떤 표현이 원인인가

반드시 지킬 것:
- evidence는 반드시 원문에서 그대로 복사한 문자열이어야 합니다. 요약하거나 바꿔 쓰면 폐기됩니다.
- blockId는 <!--b:ID--> 주석에 나타난 ID여야 합니다.
- 확신이 없으면 보고하지 마십시오. 놓치는 것보다 잘못 지적하는 것이 나쁩니다.
- suggestion.before도 원문 그대로여야 합니다. 고칠 방법이 명확하지 않으면 suggestion을 null로 두십시오.
```

마지막 두 줄이 오탐률을 좌우한다. 사용자 프롬프트는 전역 맥락(제목, 유형, 목차, 요약)과 청크 마크다운을 담는다.

- [ ] **Step 5: chunk.ts 구현**

`walkSections`로 섹션을 얻고 `maxChars`(기본 12000)까지 섹션을 누적한다. 단일 섹션이 임계치를 넘으면 그 섹션만으로 청크를 만든다 (블록을 쪼개지 않는다 — 블록이 쪼개지면 blockId 지목이 깨진다).

- [ ] **Step 6: analyzer.ts 구현**

전역 맥락은 제목 + 문서 유형 + 전체 제목 목차로 구성한다. 청크가 2개 이상일 때만 LLM으로 문서 요약을 한 번 더 만들어 전역 맥락에 추가한다 (1개면 이미 전문을 보므로 불필요).

청크를 `concurrency`(기본 4) 제한으로 병렬 호출하고, 각 결과를 `verifyFindings`에 통과시킨다. 성공 청크 수에 따라 status를 정한다: 전부 성공 `ok`, 일부 성공 `partial`, 전부 실패 `failed`. **어떤 경우에도 예외를 던지지 않는다** — 백엔드는 룰 결과만이라도 반환해야 한다.

`doctype-infer.ts`는 제목 + 제목 목차 + 첫 500자로 유형을 추론한다. 응답 스키마는 `{ value: DocType; confidence: number }`. 실패하면 `{ value: 'unknown', confidence: 0 }`.

- [ ] **Step 7: 테스트 통과 확인**

Run: `pnpm vitest run packages/llm`
Expected: PASS

- [ ] **Step 8: 커밋**

```bash
git add packages/llm
git commit -m "feat(llm): add context analyzer with chunking, prompts, and doctype inference"
```

---

### Task 8: 백엔드 서버 · /v1/lint

**Files:**
- Create: `apps/backend/package.json`, `apps/backend/tsconfig.json`, `.env.example`
- Create: `apps/backend/src/{index,app,config,auth}.ts`
- Create: `apps/backend/src/routes/{lint,rules,health}.ts`
- Create: `apps/backend/src/services/lint-service.ts`
- Test: `apps/backend/test/{lint-route,rules-route,auth}.test.ts`

**Interfaces:**
- Consumes: `@ai-lint/ir`, `@ai-lint/rules`, `@ai-lint/llm` 전부
- Produces:
  - `buildApp(deps: AppDeps): FastifyInstance` — `AppDeps = { provider: LlmProvider; store?: ReportStore; rulesets: RulesetSource; now?: () => Date }`
  - `lintDocument(doc, opts, deps): Promise<LintReport>`
  - `POST /v1/lint`, `GET /v1/rules`, `GET /v1/rulesets`, `GET /v1/rulesets/:id`, `GET /v1/health`

`buildApp`이 의존성을 주입받는 팩토리인 게 중요하다. 테스트가 목 provider와 인메모리 store로 앱 전체를 띄울 수 있어야 한다.

- [ ] **Step 1: 라우트 테스트 작성**

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { buildApp } from '../src/app.js'
import { createMockProvider } from '@ai-lint/llm'
import { designDoc } from './fixtures.js'

const inject = (app, payload, headers = { 'x-ai-lint-token': 'test-token' }) =>
  app.inject({ method: 'POST', url: '/v1/lint', payload, headers })

describe('POST /v1/lint', () => {
  it('룰과 LLM finding을 합친 리포트를 반환한다', async () => {
    const app = buildApp({ provider: createMockProvider([{ findings: [
      { ruleId: 'CTX001', blockId: 'p1', evidence: '지난번 논의대로', why: '이유', suggestion: null, confidence: 0.9 },
    ] }]) })
    const res = await inject(app, { document: designDoc })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.findings.some(f => f.source === 'rule')).toBe(true)
    expect(body.findings.some(f => f.source === 'llm')).toBe(true)
    expect(body.score.grade).toMatch(/^[ABCD]$/)
    expect(body.llmStatus).toBe('ok')
  })

  it('useLlm=false면 룰 검사만 하고 provider를 호출하지 않는다', async () => {
    const provider = createMockProvider([])
    const app = buildApp({ provider })
    const body = (await inject(app, { document: designDoc, options: { useLlm: false } })).json()
    expect(provider.calls).toHaveLength(0)
    expect(body.llmStatus).toBe('skipped')
    expect(body.findings.every(f => f.source === 'rule')).toBe(true)
  })

  it('LLM이 실패해도 200과 룰 결과를 반환한다', async () => {
    const app = buildApp({ provider: createAlwaysFailingProvider() })
    const body = (await inject(app, { document: designDoc })).json()
    expect(body.llmStatus).toBe('failed')
    expect(body.findings.length).toBeGreaterThan(0)
  })

  it('IR 스키마 위반은 400과 필드 경로를 반환한다', async () => {
    const res = await inject(buildApp({ provider: createMockProvider([]) }), { document: { title: 'x' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('document')
  })

  it('토큰이 없으면 401', async () => {
    const res = await inject(buildApp({ provider: createMockProvider([]) }), { document: designDoc }, {})
    expect(res.statusCode).toBe(401)
  })

  it('블록 수 상한을 넘으면 잘라서 검사하고 truncated를 표시한다', async () => {
    const huge = { ...designDoc, blocks: Array.from({ length: 2500 }, (_, i) => ({ ...designDoc.blocks[0], id: `p${i}` })) }
    const body = (await inject(buildApp({ provider: createMockProvider([{ findings: [] }]) }), { document: huge })).json()
    expect(body.truncated).toBe(true)
  })

  it('docType.origin이 llm이 아니면 유형 추론을 호출하지 않는다', async () => {
    const provider = createMockProvider([{ findings: [] }])
    const app = buildApp({ provider })
    await inject(app, { document: { ...designDoc, docType: { value: 'design', confidence: 1, origin: 'label' } } })
    expect(provider.calls).toHaveLength(1)
  })
})

describe('GET /v1/rules', () => {
  it('전체 카탈로그를 축·심각도와 함께 반환한다', async () => {
    const body = (await buildApp({ provider: createMockProvider([]) })
      .inject({ method: 'GET', url: '/v1/rules', headers: { 'x-ai-lint-token': 'test-token' } })).json()
    expect(body.rules).toHaveLength(29)
    expect(body.rules.find(r => r.id === 'CTX001').axis).toBe('context')
  })
})
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `pnpm vitest run apps/backend`
Expected: FAIL

- [ ] **Step 3: config.ts, auth.ts 구현**

`config.ts`는 환경변수를 zod로 검증해 읽는다: `PORT`, `SERVICE_TOKEN`, `GEMINI_API_KEY`, `DATABASE_URL`(선택), `LLM_MAX_DOC_CHARS`, `LLM_DAILY_LIMIT_PER_USER`, `MAX_BLOCKS`. 누락 시 부팅에서 실패한다.

`auth.ts`는 `x-ai-lint-token`을 `SERVICE_TOKEN`과 상수 시간 비교하고, `x-ai-lint-user`를 `request.userId`에 넣는다 (없으면 `anonymous`). `/v1/health`는 인증에서 제외한다.

- [ ] **Step 4: lint-service.ts 구현**

```
1. DocumentSchema로 파싱 (실패 → 400)
2. 블록 수 > MAX_BLOCKS면 잘라내고 truncated 표시
3. 규칙셋 해석 (options.rulesetId ?? 'default')
4. docType.origin === 'llm' && useLlm이면 inferDocType 호출해 확정
5. runRules 실행 → 룰 finding
6. useLlm이면 analyzeContext 실행 → LLM finding (실패해도 계속)
7. finding 병합 → scoreFindings
8. LintReport 조립 후 반환
```

룰 검사와 LLM 검사의 순서가 중요하다. **룰 검사는 절대 LLM을 기다리지 않는다.** 확장이 룰 결과를 먼저 보여줄 수 있도록 이후 스트리밍 엔드포인트를 추가할 여지를 남긴다.

- [ ] **Step 5: app.ts, routes 구현**

`buildApp(deps)`는 Fastify 인스턴스를 만들고 인증 훅과 라우트를 등록한다. 에러 핸들러는 zod 에러를 400으로, `LlmError`를 502로, 나머지를 500으로 매핑하고 사용자에게 스택을 노출하지 않는다.

`index.ts`는 config를 읽어 실제 provider와 store를 만들고 `buildApp`에 주입한 뒤 listen한다.

- [ ] **Step 6: 테스트 통과 확인**

Run: `pnpm vitest run apps/backend`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add apps/backend
git commit -m "feat(backend): add lint endpoint combining rule and LLM analysis"
```

---

### Task 9: 영속화 · 캐시 · 쿼터

**Files:**
- Create: `apps/backend/src/db/{client,migrate}.ts`, `apps/backend/src/db/migrations/001_init.sql`
- Create: `apps/backend/src/services/{report-store,quota}.ts`
- Create: `apps/backend/src/routes/{reports,doctype}.ts`
- Modify: `apps/backend/src/services/lint-service.ts`, `apps/backend/src/app.ts`
- Create: `docker-compose.yml`, `apps/backend/Dockerfile`
- Test: `apps/backend/test/{report-store,cache,quota}.test.ts`

**Interfaces:**
- Consumes: Task 8의 `AppDeps`, `lintDocument`
- Produces:
  - `interface ReportStore { findByHash(hash, rulesetVersion, promptVersion): Promise<LintReport | null>; save(report, userId): Promise<void>; listByUri(uri, limit): Promise<LintReport[]>; getDocTypeOverride(uri): Promise<DocType | null>; setDocTypeOverride(uri, docType, userId): Promise<void> }`
  - `createPgStore(pool: Pool): ReportStore`, `createMemoryStore(): ReportStore`
  - `interface QuotaService { check(userId): Promise<{ allowed: boolean; reason?: 'daily-limit' }>; record(userId, tokens): Promise<void> }`

- [ ] **Step 1: 마이그레이션 SQL 작성**

`001_init.sql`:
```sql
CREATE TABLE rulesets (
  id             TEXT PRIMARY KEY,
  version        INTEGER NOT NULL,
  name           TEXT NOT NULL,
  yaml           TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE reports (
  report_id        UUID PRIMARY KEY,
  document_uri     TEXT NOT NULL,
  document_hash    TEXT NOT NULL,
  ruleset_id       TEXT NOT NULL,
  ruleset_version  INTEGER NOT NULL,
  prompt_version   INTEGER NOT NULL,
  doc_type         TEXT NOT NULL,
  score_total      INTEGER NOT NULL,
  score_grade      TEXT NOT NULL,
  payload          JSONB NOT NULL,
  created_by       TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX reports_cache_key
  ON reports (document_hash, ruleset_id, ruleset_version, prompt_version);
CREATE INDEX reports_by_uri ON reports (document_uri, created_at DESC);

CREATE TABLE doctype_overrides (
  document_uri  TEXT PRIMARY KEY,
  doc_type      TEXT NOT NULL,
  set_by        TEXT NOT NULL,
  set_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE llm_usage (
  id          BIGSERIAL PRIMARY KEY,
  user_id     TEXT NOT NULL,
  usage_date  DATE NOT NULL,
  calls       INTEGER NOT NULL DEFAULT 0,
  tokens      BIGINT NOT NULL DEFAULT 0,
  UNIQUE (user_id, usage_date)
);
```

캐시 키에 `prompt_version`이 들어가는 게 중요하다. 프롬프트를 고치면 이전 리포트가 자동으로 무효화되어야 한다.

- [ ] **Step 2: 캐시·쿼터 테스트 작성**

```typescript
describe('리포트 캐시', () => {
  it('같은 문서를 다시 검사하면 LLM을 호출하지 않는다', async () => {
    const provider = createMockProvider([{ findings: [] }])
    const app = buildApp({ provider, store: createMemoryStore() })
    await inject(app, { document: designDoc, options: { save: true } })
    await inject(app, { document: designDoc, options: { save: true } })
    expect(provider.calls).toHaveLength(1)
  })

  it('문서 내용이 바뀌면 다시 호출한다', async () => { /* 본문 수정 후 2회 호출 확인 */ })
  it('규칙셋 버전이 바뀌면 캐시를 무시한다', async () => { /* ... */ })
  it('save=false면 저장하지 않는다', async () => { /* ... */ })
})

describe('쿼터', () => {
  it('일일 상한을 넘으면 룰 검사만 수행한다', async () => {
    const app = buildApp({ provider, store, quota: createFixedQuota({ allowed: false, reason: 'daily-limit' }) })
    const body = (await inject(app, { document: designDoc })).json()
    expect(body.llmStatus).toBe('skipped')
    expect(body.llmSkipReason).toBe('daily-limit')
    expect(body.findings.length).toBeGreaterThan(0)
  })

  it('문서가 토큰 상한을 넘으면 LLM을 건너뛴다', async () => { /* ... */ })
})

describe('createMemoryStore와 createPgStore가 같은 계약을 만족한다', () => {
  // 동일한 테스트 스위트를 두 구현에 대해 실행한다.
  // Pg 테스트는 DATABASE_URL이 없으면 skip한다.
})
```

- [ ] **Step 3: 테스트 실패 확인**

Run: `pnpm vitest run apps/backend`
Expected: FAIL

- [ ] **Step 4: store, quota, migrate 구현**

`createMemoryStore`를 먼저 만들어 계약을 확정하고, `createPgStore`가 같은 인터페이스를 구현한다. 테스트는 하나의 스위트를 두 구현에 돌린다 — 인메모리로 CI를 빠르게 돌리면서 Postgres 구현의 정합성도 지킨다.

`migrate.ts`는 `migrations/*.sql`을 이름순으로 읽어 `schema_migrations` 테이블과 대조해 미적용분만 트랜잭션 안에서 실행한다.

`quota.ts`는 `llm_usage`를 `INSERT ... ON CONFLICT DO UPDATE`로 증가시킨다.

- [ ] **Step 5: lint-service에 캐시·쿼터 결합**

```
1. hashDocument로 캐시 키 계산
2. store.findByHash 히트면 즉시 반환 (cached: true 표시)
3. doctype override 조회 → 있으면 origin: 'user'로 확정하고 LLM 추론 생략
4. 쿼터 확인 → 불가면 useLlm을 끄고 llmSkipReason 기록
5. (기존 검사 흐름)
6. options.save면 store.save
```

- [ ] **Step 6: reports/doctype 라우트 추가**

`GET /v1/reports?uri=`는 최근 20건을 반환한다. `POST /v1/doctype-overrides`는 `{ uri, docType }`을 받아 저장한다.

- [ ] **Step 7: docker-compose와 Dockerfile 작성**

`docker-compose.yml`은 postgres 16과 backend를 띄운다. Dockerfile은 멀티스테이지로 `tsup` 번들 후 `node:22-alpine`에서 실행한다.

- [ ] **Step 8: 테스트 통과 확인**

Run: `pnpm vitest run`
Expected: PASS (전체 스위트)

- [ ] **Step 9: 전체 타입체크**

Run: `pnpm typecheck`
Expected: 에러 없음

- [ ] **Step 10: 커밋**

```bash
git add apps/backend docker-compose.yml
git commit -m "feat(backend): add report persistence, result caching, and LLM quota"
```

---

## Self-Review

**스펙 커버리지**

| 스펙 항목 | 태스크 |
|---|---|
| 4장 Document IR | Task 1 |
| 4.2 SourceAnchor | Task 1 |
| 5.2 유형 판정 순서 | Task 7 (LLM 추론), Task 9 (user override) |
| 5.3 유형별 필수 섹션 | Task 2 (`REQUIRED_SECTIONS`), Task 4 (META007) |
| 5.4 규칙셋 YAML | Task 2 |
| 6.1 STR 룰 | Task 3 |
| 6.2 CTX 룰 | Task 5 (스키마 enum), Task 7 (프롬프트) |
| 6.3 META 룰 | Task 4 |
| 6.5 점수 산정 | Task 2 |
| 7.1~7.3 LLM 파이프라인 | Task 5, 7 |
| 7.4 근거 검증 | Task 6 |
| 7.5 청킹 | Task 7 |
| 7.6 provider 추상화·캐싱·쿼터 | Task 5, 9 |
| 8장 API | Task 8, 9 |
| 8.2 인증 | Task 8 |
| 8.3 저장소 | Task 9 |
| 12장 에러 처리 | Task 8 (부분 실패), Task 2 (룰 격리), Task 6 (검증 폐기) |
| 13장 테스트 전략 | 전 태스크 |

미포함(의도적): 어댑터(서브프로젝트 2), LLM 회귀 테스트 세트(코퍼스 확보 후), OIDC(후속 과제).

**타입 일관성 확인**

- `Finding`은 Task 2에서 정의하고 Task 6·8이 그대로 쓴다
- `RuleContext.now`는 Task 4에서 추가되므로 Task 2 구현 시 미리 넣어둔다
- `AppDeps`에 `quota`가 Task 9에서 추가된다. Task 8에서는 선택 필드로 선언해두고 Task 9에서 채운다
- `LintReport`에 `truncated`(Task 8), `cached`·`llmSkipReason`(Task 9)이 스펙 8.1절보다 추가된다. 세 필드를 스펙에 반영해야 한다
