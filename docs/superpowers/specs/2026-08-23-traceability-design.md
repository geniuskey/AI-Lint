# 문서간 추적성 검사 설계 (서브프로젝트 4)

**목표:** 코퍼스에 쌓인 문서들의 식별자·링크 관계를 그래프로 만들고, 끊긴 참조·고아 문서·미검증 요구사항·상충 서술을 찾아낸다.

**범위:** `packages/trace`(신규), `packages/contract`(리포트 타입 추가), `apps/backend`(인덱스 스토어·라우트), `apps/desktop`(추적성 탭).

## 1. 설계를 가르는 결정

**추적성 지적은 문서 점수에 넣지 않는다.** 기존 점수는 structure/context/metadata 3축이고 가중치 합이 1이다. 추적성은 코퍼스 전체를 봐야 나오는 판정이라 단일 문서 점수에 섞으면 같은 문서가 남의 문서 상태 때문에 점수가 오르내린다. `LintReport`와 나란한 별도 타입 `TraceReport`를 만들고 기존 스코어링은 건드리지 않는다.

같은 이유로 추적성 룰 ID(`TRC001`~)는 `RULE_META`에 넣지 않는다. `resolveRuleset`은 `RULE_META`의 모든 룰을 문서 검사에 활성화하는데, 추적성 룰은 단일 문서에서 실행될 수 없다.

**코퍼스는 검사할 때 수동적으로 쌓인다.** `/v1/lint`가 성공하면 그 문서의 식별자·링크를 인덱스에 upsert한다. 백엔드가 Confluence 자격증명을 갖지 않는다는 기존 원칙이 그대로 유지된다. 대신 아무도 검사하지 않은 문서는 그래프에 없어 판정에 노이즈가 생긴다. 리포트 헤더에 인덱싱된 문서 수를 실어 사용자가 커버리지를 판단하게 하고, 커버리지에 민감한 항목(TRC005)은 심각도를 낮춘다.

**원문을 보관하지 않는다.** 상충 대조에는 본문이 필요하지만 문서 전문을 백엔드에 쌓으면 Confluence 권한 모델 밖에 사본이 생긴다. ID가 등장한 블록의 발췌(기본 400자)만 저장한다. 이 발췌가 상충 판정과 근거 검증 양쪽에 쓰인다.

## 2. 패키지 구조

```
packages/trace          ← 순수 로직 + LLM 대조. 의존: ir, rules, llm, contract
  src/config.ts         TraceConfig, DEFAULT_TRACE_CONFIG
  src/ids.ts            식별자 추출
  src/entry.ts          Document → DocIndexEntry
  src/graph.ts          엔트리 목록 → 그래프
  src/checks.ts         TRC001~005 결정적 판정
  src/contradiction.ts  후보 쌍 선별 + LLM 대조 + 근거 검증
  src/index.ts

packages/contract       ← TraceReport, TraceFinding, 요청 스키마 추가

apps/backend
  src/services/trace-index.ts    TraceIndexStore (메모리/Postgres)
  src/services/trace-service.ts  analyzeTrace
  src/routes/trace.ts            POST /v1/trace/analyze
  src/db/migrations/002_trace.sql

apps/desktop
  src/core/trace.ts       요약 계산, 내보내기용 행 생성
  src/ui/TraceTab.tsx     추적성 탭
```

의존 방향은 `trace → llm → rules → ir`. 순환이 없다. 데스크톱은 `@ai-lint/trace`를 가져오지 않고 `@ai-lint/contract`의 타입만 쓴다 — 번들에 백엔드 로직이 딸려 들어가지 않아야 한다.

## 3. 설정과 식별자 추출

```typescript
export interface TraceConfig {
  patterns: IdPattern[]
  /** 상충 대조에 보낼 문서 쌍 상한 */
  maxPairs: number
  /** 발췌 길이 상한 */
  snippetChars: number
}

export const DEFAULT_TRACE_CONFIG: TraceConfig = {
  patterns: DEFAULT_ID_PATTERNS,
  maxPairs: 20,
  snippetChars: 400,
}
```

`AppDeps`로 주입해 테스트가 상한을 낮춰 잡을 수 있게 한다. 환경 변수 노출은 하지 않는다 — 지금 조절할 이유가 없다.

```typescript
export type IdKind = 'requirement' | 'test' | 'ticket'

export interface IdPattern {
  kind: IdKind
  /** 문자열로 둔다. 설정 파일과 JSON 직렬화를 통과해야 한다. */
  regex: string
}

export const DEFAULT_ID_PATTERNS: IdPattern[] = [
  { kind: 'requirement', regex: 'REQ-\\d+' },
  { kind: 'test', regex: 'TC-\\d+' },
  { kind: 'ticket', regex: '[A-Z]{2,10}-\\d+' },
]

export interface IdMention {
  id: string
  kind: IdKind
  /** null이면 문서 제목에서 나왔다는 뜻 */
  blockId: string | null
  defining: boolean
  /** 이 ID가 등장한 블록의 발췌. 상충 대조와 근거 검증에 쓴다. */
  snippet: string
}

export function extractIds(doc: Document, config: TraceConfig): IdMention[]
```

패턴은 배열 순서대로 적용하고 먼저 잡힌 것이 이긴다. `REQ-123`은 `[A-Z]{2,10}-\d+`에도 걸리지만 requirement 패턴이 앞서므로 requirement로 분류된다.

**defining 판정** — 다음 중 하나면 그 문서가 그 ID를 정의한다고 본다:

- 문서 제목이나 `heading` 블록에 등장
- 문서의 `docType`이 `requirement`이고 ID가 requirement 종류

두 번째 규칙이 필요한 이유: 요구사항 문서는 표 한 행마다 REQ를 정의하지 제목에 전부 쓰지 않는다.

**테스트 유무는 문서 유형이 아니라 ID로 판정한다.** `DocType`에 `test`가 없다. REQ-123을 참조하는 문서 중 test 종류 ID를 하나라도 가진 문서가 없으면 미검증으로 본다.

## 4. 인덱스 엔트리와 그래프

```typescript
export interface DocIndexEntry {
  uri: string
  title: string
  docType: DocType
  documentHash: string
  modifiedAt: string | null
  mentions: IdMention[]
  /** 정규화한 내부 링크 대상 */
  linksTo: string[]
}

/** 해시는 lint 리포트가 이미 계산해 두었다. 다시 재지 않는다. */
export function toIndexEntry(doc: Document, documentHash: string, config: TraceConfig): DocIndexEntry

export interface TraceGraph {
  entries: DocIndexEntry[]
  byUri: Map<string, DocIndexEntry>
  /** ID → 그 ID를 정의하는 문서 uri */
  definedBy: Map<string, string[]>
  /** ID → 그 ID를 참조하는 문서 uri */
  referencedBy: Map<string, string[]>
}

export function buildGraph(entries: readonly DocIndexEntry[]): TraceGraph
export const definedIds = (entry: DocIndexEntry): string[]
export const referencedIds = (entry: DocIndexEntry): string[]
```

링크 정규화는 `doc.links` 중 `target === 'internal'`인 것만 쓴다. 프래그먼트(`#...`)와 쿼리를 떼고 뒤쪽 슬래시를 정리한 문자열을 `linksTo`에 넣는다. 상대 경로는 해석하지 않는다 — 문서 출처가 Confluence와 로컬 파일로 섞여 있어 공통 기준점이 없다. 해석하지 못한 링크는 TRC005의 대상이 되고, 이 항목이 info인 이유가 여기에도 있다.

## 5. 검사 항목

| ID | 판정 | 심각도 | 근거 |
|---|---|---|---|
| TRC001 | 아무 문서도 정의하지 않은 ID를 참조한다 | error | 참조가 가리키는 대상이 코퍼스에 없다 |
| TRC002 | `design` 문서가 requirement ID를 하나도 참조하지 않는다 | warning | 상위 요구사항 없이 떠 있는 설계 |
| TRC003 | 정의된 requirement를 참조하는 문서 중 test ID를 가진 것이 없다 | warning | 검증되지 않은 요구사항 |
| TRC004 | 같은 ID를 두 문서 이상이 정의한다 | error | 어느 쪽이 원본인지 알 수 없다 |
| TRC005 | 내부 링크 대상이 인덱스에 없다 | info | 끊긴 링크일 수도, 아직 검사 안 한 문서일 수도 있다 |
| TRC006 | 같은 ID를 다루는 두 문서의 서술이 상충한다 | error | LLM 대조 |

TRC001·TRC004는 코퍼스 커버리지와 무관하게 성립하므로 error다. TRC005는 수동적 수집의 구조적 한계를 그대로 받으므로 info다.

```typescript
export function runTraceChecks(graph: TraceGraph): TraceFinding[]
```

판정은 순수 함수다. 같은 그래프를 넣으면 항상 같은 지적이 같은 순서로 나온다 — 정렬은 심각도(error→warning→info) → 룰 ID → 대상 ID 순.

## 6. 상충 탐지 (TRC006)

전량 대조는 O(n²)이라 불가능하다. 세 단계로 좁힌다.

**후보 쌍 선별**

```typescript
export interface ContradictionPair {
  sharedIds: string[]
  a: DocIndexEntry
  b: DocIndexEntry
}

export function selectPairs(
  graph: TraceGraph,
  maxPairs: number,
): { pairs: ContradictionPair[]; considered: number }
```

같은 ID를 정의하거나 참조하는 문서 쌍만 후보다. 공유 ID 수 내림차순, 동률이면 uri 사전순으로 정렬해 상한(기본 20)까지 자른다. 결정적 정렬이라 같은 코퍼스에서 같은 쌍이 나온다. `considered`가 `pairs.length`보다 크면 리포트에 `truncated: true`를 실어 잘렸다는 사실을 숨기지 않는다.

**대조 프롬프트**

쌍마다 공유 ID가 등장한 발췌만 보낸다. 문서 전문은 보내지 않는다. 응답 스키마:

```typescript
const ContradictionSchema = z.object({
  contradictions: z.array(z.object({
    subjectId: z.string().min(1),
    quoteA: z.string().min(1),
    quoteB: z.string().min(1),
    why: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })),
})
```

**근거 검증**

`packages/llm`의 `verify.ts`와 같은 원칙이다. `quoteA`는 문서 A의 발췌 안에, `quoteB`는 문서 B의 발췌 안에 실제로 있어야 채택한다. 공백을 정규화한 뒤 포함 여부로 판정하고, 신뢰도가 기준(0.6) 미만이면 폐기한다. 폐기 수는 `llmFindingsRejected`로 노출한다.

```typescript
export interface ContradictionResult {
  findings: TraceFinding[]
  status: AnalyzeStatus
  rejectedCount: number
}

export async function analyzeContradictions(
  pairs: readonly ContradictionPair[],
  provider: LlmProvider,
  options?: { minConfidence?: number; concurrency?: number; maxTokens?: number },
): Promise<ContradictionResult>
```

쌍 하나가 실패해도 나머지는 계속한다. 전부 실패하면 `status: 'failed'`, 일부면 `'partial'`.

## 7. 계약 타입

`packages/contract`에 더한다:

```typescript
export interface TraceFinding {
  id: string
  ruleId: string
  severity: Severity
  message: string
  why: string
  /** 이 지적에 걸린 문서들 */
  documents: { uri: string; title: string }[]
  subjectId: string | null
  evidence: string | null
  source: 'rule' | 'llm'
  confidence: number
}

export interface TraceReport {
  reportId: string
  /** 인덱스에 쌓인 문서 수 */
  documentCount: number
  /** 그래프에 등장한 고유 ID 수 (정의든 참조든) */
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

export const TraceRequestSchema = z.object({
  useLlm: z.boolean().default(true),
}).default({})
```

`LlmStatus`와 `LlmSkipReason`은 lint 쪽 것을 그대로 쓴다. 클라이언트가 이미 이 값들을 문장으로 바꾸는 코드를 갖고 있다.

## 8. 저장과 라우트

```sql
-- 002_trace.sql
CREATE TABLE doc_index (
  document_uri   TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  doc_type       TEXT NOT NULL,
  document_hash  TEXT NOT NULL,
  modified_at    TIMESTAMPTZ,
  payload        JSONB NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

```typescript
export interface TraceIndexStore {
  upsert(entry: DocIndexEntry): Promise<void>
  /** 최근 갱신 순으로 상한(5000건)까지 */
  all(): Promise<DocIndexEntry[]>
  count(): Promise<number>
}
```

`all()`은 그래프를 메모리에 통째로 올린다. 상한을 두지 않으면 코퍼스가 커진 뒤 이 라우트 하나가 서버를 넘어뜨린다. `count()`가 상한보다 크면 리포트에 그대로 실려 사용자가 부분 조회임을 안다.

**적재는 라우트에서 한다.** `lintDocument`를 건드리지 않는다 — 검사와 색인은 별개 관심사이고, 라우트에는 `request.log`가 있어 실패를 남길 곳이 있다.

```typescript
app.post('/v1/lint', async (request) => {
  const { document, options } = LintRequestSchema.parse(request.body)
  const report = await lintDocument(document, options, deps, request.userId)
  try {
    await index.upsert(toIndexEntry(document, config))
  } catch (cause) {
    // 색인이 실패해도 검사 결과는 돌려준다.
    request.log.warn({ err: cause }, '추적성 인덱스 갱신 실패')
  }
  return report
})
```

캐시 히트일 때도 upsert한다. 해시가 같으면 엔트리도 같으므로 덮어써도 무해하고, 분기를 두면 "인덱스에 없는데 캐시가 있어서 안 들어가는" 구멍이 생긴다.

`POST /v1/trace/analyze`는 `TraceRequestSchema`를 받아 `TraceReport`를 돌려준다. LLM 호출 수는 lint와 같은 `countingProvider`로 세어 같은 쿼터에 기록한다. 쿼터가 막히면 `llmStatus: 'skipped'`, `llmSkipReason: 'quota'`로 결정적 결과만 반환한다.

## 9. 데스크톱 탭

`App.tsx` 최상단에 탭 전환(`'lint' | 'trace'`)을 둔다. 설정 영역은 두 탭이 공유한다.

추적성 탭 구성:

- **코퍼스 조회** 버튼 + AI 대조 사용 체크박스
- 요약 줄 — 인덱싱된 문서 N개, 식별자 M개, 지적 K건. 커버리지를 사용자가 판단할 근거다
- 지적 표 — 심각도 / 규칙 / 대상 ID / 문서 / 내용
- HTML·Excel 내보내기

내보내기는 기존 `toHtml`/`toXlsx`가 `JobState` 전용이라 재사용할 수 없다. `toTraceHtml(report)`/`toTraceXlsx(report)`를 따로 두고 이스케이프 유틸과 xlsx 생성 함수는 공유한다. 그래프 시각화는 넣지 않는다 — 표로 답을 얻을 수 있고, 노드 수십 개짜리 그래프 그림은 읽히지 않는다.

`@ai-lint/backend-client`에 `requestTrace(options, settings, fetchImpl)`를 더한다. 기존 `post` 헬퍼를 그대로 타므로 오류 분류(`unauthorized`/`quota`/`offline`)가 자동으로 따라온다.

## 10. 에러 처리

기존 원칙 그대로 — 부분 실패해도 얻은 만큼 보여준다.

| 상황 | 동작 |
|---|---|
| 인덱스 upsert 실패 | 로그만 남기고 lint 응답은 정상 반환 |
| 인덱스가 비어 있음 | 지적 0건 리포트 + `documentCount: 0`. 화면은 "먼저 문서를 검사하세요" |
| LLM 실패 | 결정적 지적만, `llmStatus: 'failed'` |
| 쿼터 초과 | 결정적 지적만, `llmStatus: 'skipped'`, `llmSkipReason: 'quota'` |
| 후보 쌍 상한 초과 | `truncated: true` + `pairsConsidered` 노출 |

## 11. 테스트

- **`packages/trace`** — 판정 항목마다 위반 엔트리와 정상 엔트리를 쌍으로 둔다. 식별자 추출은 패턴 우선순위·defining 판정·발췌 길이를 각각 검증
- **상충 분석기** — 목 provider로 후보 선별 순서, 근거 검증 통과·폐기, 부분 실패 시 `partial` 전이를 검증. 실제 LLM은 부르지 않는다
- **백엔드** — lint 요청 후 인덱스가 실제로 쌓이는지, `/v1/trace/analyze` 계약, 쿼터 초과 시 결정적 결과만 나오는지를 라우트째로 검증
- **데스크톱** — 요약 계산과 내보내기 함수의 순수 로직. xlsx는 기존 방식대로 `xlsxToDocument`로 되읽어 확인
