# 핵심 개념

## 문서 IR

Confluence 스토리지 XHTML, PPTX, DOCX, XLSX, PDF는 구조가 전혀 다릅니다. 룰마다 다섯 가지 형식을 다루게 하면 룰이 서른 개일 때 백오십 가지 경우가 생깁니다. 그래서 어댑터가 먼저 **하나의 중간 표현(IR)** 으로 바꾸고, 룰은 IR만 봅니다.

```
Confluence XHTML ─┐
PPTX ─────────────┤
DOCX ─────────────┼─→ Document ─→ 룰 31개
XLSX ─────────────┤
PDF ──────────────┘
```

`Document`의 뼈대는 이렇습니다.

```ts
interface Document {
  schemaVersion: 1
  source: { kind: 'confluence' | 'pptx' | 'docx' | 'xlsx' | 'pdf'; uri: string; modifiedAt?: string; ... }
  title: string
  docType: { value: DocType; confidence: number; origin: 'label' | 'template' | 'llm' | 'user' }
  blocks: Block[]
  links: Link[]
  metadata: { labels: string[]; owner?: string; reviewedAt?: string; ancestors?: string[] }
}
```

### 블록

`Block`은 `kind`로 갈라지는 판별 유니온입니다. `heading`, `paragraph`, `list`, `table`, `code`, `image`, `callout`, `macro`, `slide` 아홉 가지입니다.

모든 블록은 `id`, `path`, `anchor`를 갖습니다.

- `path` — 제목 계층상 위치. `[2, 1]`은 두 번째 h1 아래 첫 번째 h2라는 뜻입니다. 섹션 길이나 중첩 깊이를 재는 룰이 이 값을 씁니다.
- `anchor` — 원본에서 이 블록이 어디였는지. 지적을 원문 위치로 되돌리는 데 씁니다.

### 앵커

`SourceAnchor`도 판별 유니온이고, 원본 종류마다 필요한 정보가 다릅니다.

| kind | 담는 것 |
|---|---|
| `confluence` | XPath + 인용 텍스트(`textQuote`) |
| `pptx` | 슬라이드 번호, 도형 ID |
| `docx` | 문단 인덱스 |
| `xlsx` | 시트 이름, 셀 주소 |
| `pdf` | 페이지 번호, 텍스트 위치 |

Confluence 앵커에 XPath와 인용 텍스트를 둘 다 두는 이유는, 페이지가 조금 수정되면 XPath가 어긋나기 때문입니다. 확장은 XPath로 먼저 찾고 실패하면 인용 텍스트로 다시 찾습니다.

## 문서 유형

룰 중에는 유형을 알아야 판정할 수 있는 것이 있습니다. 회의록에 "결정 근거가 없다"고 지적하는 것은 타당하지만 API 문서에 같은 지적을 하면 소음입니다.

유형은 여덟 가지입니다: `meeting-notes`, `requirement`, `design`, `guide`, `api-doc`, `troubleshooting`, `reference`, `unknown`.

`origin`은 이 유형을 어디서 얻었는지 나타냅니다.

| origin | 근거 |
|---|---|
| `user` | 사람이 지정한 값 — `POST /v1/doctype-overrides`로 저장한 것 |
| `label` | Confluence 라벨 |
| `template` | 파일 구조·템플릿에서 추론 |
| `llm` | 앞의 셋으로 결정하지 못해 모델이 분류 |

`user`가 가장 셉니다. 자동 분류가 틀렸을 때 사람이 고친 값이 다음 검사에서 다시 뒤집히면 안 되기 때문입니다.

CTX007(근거 없는 결정)은 `appliesTo: ['design', 'meeting-notes', 'requirement']`라서 이 세 유형에서만 돕니다. 나머지 룰은 모든 유형에 적용됩니다.

## 점수 계산

축마다 100점에서 시작합니다.

```
error   → -15
warning → -6
info    → -2
```

같은 룰이 4번째부터 걸리면 감점이 **1점**으로 줄어듭니다. 이미지 40장에 alt가 없다고 해서 그 하나가 점수를 독점하면, 정작 심각한 다른 문제가 점수에 드러나지 않기 때문입니다.

축 점수는 0 밑으로는 내려가지 않고, 총점은 가중 평균입니다.

```
총점 = 구조 × 0.35 + 맥락 × 0.45 + 메타데이터 × 0.20
```

등급은 총점으로 매깁니다.

| 등급 | 총점 |
|---|---|
| A | 90 이상 |
| B | 75 이상 |
| C | 60 이상 |
| D | 그 미만 |

## 지적

룰이든 LLM이든 같은 `Finding` 형태로 나옵니다.

```ts
interface Finding {
  id: string
  ruleId: string                 // 'STR005', 'CTX001', ...
  axis: 'structure' | 'context' | 'metadata'
  severity: 'error' | 'warning' | 'info'
  blockId: string | null
  anchor: SourceAnchor | null    // 원문에서 강조할 위치
  message: string                // 무엇이 문제인가
  why: string                    // 왜 AI에게 문제가 되는가
  evidence: string | null        // 근거가 된 본문 문장
  suggestion: { before: string; after: string } | null
  source: 'rule' | 'llm'
  confidence: number
  docsUrl: string
}
```

`message`와 `why`를 나눈 것은 의도적입니다. "이미지에 대체 텍스트가 없습니다"는 무엇이 잘못됐는지만 말합니다. 사람이 고치게 하려면 "이 이미지가 담은 정보가 검색 색인에 전혀 들어가지 않습니다" 같은 이유가 함께 필요합니다.

`suggestion`은 있으면 그대로 붙여넣을 수 있는 수정안입니다. 구조 룰은 대부분 만들어낼 수 있고, 맥락 룰은 LLM이 함께 생성합니다.

## LLM 판정을 믿을 수 있게 만들기

모델은 그럴듯한 지적을 지어냅니다. AI-Lint는 두 단계로 거릅니다.

**근거 대조.** 모델은 판정할 때 근거가 된 본문 문장을 함께 내야 합니다. 그 문장이 실제 본문에 존재하는지 대조하고, 없으면 그 지적을 버립니다. 버린 개수는 `stats.llmFindingsRejected`로 리포트에 남습니다.

**확신도 하한.** `confidence`가 기준 밑이면 버립니다.

두 관문을 통과한 것만 사용자에게 보입니다.

## LLM 상태

LLM은 실패할 수 있고, 실패해도 룰 결과는 나가야 합니다. 리포트의 `llmStatus`가 무슨 일이 있었는지 알려줍니다.

| llmStatus | 뜻 |
|---|---|
| `ok` | 정상 |
| `partial` | 일부 호출만 성공 |
| `skipped` | 부르지 않음 — `llmSkipReason` 참고 |
| `failed` | 전부 실패. 룰 결과만 들어 있음 |

`llmSkipReason`은 셋 중 하나입니다.

| llmSkipReason | 뜻 |
|---|---|
| `disabled` | 요청이 `useLlm: false`였음 |
| `quota` | 사용자 일일 한도 소진 (`LLM_DAILY_LIMIT_PER_USER`, 기본 200) |
| `too-large` | 문서가 `LLM_MAX_DOC_CHARS`(기본 200,000자)를 넘음 |

## 문서 해시와 캐시

`documentHash`는 IR 내용으로 계산합니다. 같은 해시의 리포트가 이미 있으면 다시 검사하지 않고 그것을 돌려주며, `cached: true`로 표시합니다. 같은 페이지를 열 때마다 LLM을 부르지 않기 위한 것입니다.

블록 수가 `MAX_BLOCKS`(기본 2000)를 넘으면 잘라서 검사하고 `truncated: true`로 알립니다.
