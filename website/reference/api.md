# HTTP API

Base URL은 백엔드 배포 주소입니다. 개발 시 `http://localhost:8787`.

## 인증

`GET /v1/health`를 제외한 모든 경로가 토큰을 요구합니다.

| 헤더 | 필수 | 설명 |
|---|---|---|
| `x-ai-lint-token` | ● | 백엔드의 `SERVICE_TOKEN`. `timingSafeEqual`로 비교 |
| `x-ai-lint-user` | | 쿼터 집계 단위. 없으면 `anonymous` |

토큰이 없거나 틀리면 `401`입니다.

## 오류 형식

모든 오류는 같은 모양입니다.

```json
{ "error": "document.blocks.0.kind: Invalid discriminator value" }
```

| 상태 | 언제 |
|---|---|
| 400 | 요청 스키마 검증 실패 (Zod 메시지가 그대로 담김) |
| 401 | 토큰 없음·불일치 |
| 404 | 없는 규칙셋 |
| 502 | LLM 호출 실패 |
| 500 | 그 외. 스택과 내부 메시지는 로그에만 남고 응답에는 나가지 않음 |

요청 본문 상한은 32MB입니다. 슬라이드가 많은 PPTX의 IR은 기본값 1MB를 쉽게 넘습니다.

---

## GET /v1/health

유일한 공개 경로입니다.

```json
{ "status": "ok" }
```

---

## POST /v1/lint

문서 하나를 검사합니다.

### 요청

```json
{
  "document": { "schemaVersion": 1, "source": { ... }, "title": "...", "docType": { ... }, "blocks": [...], "links": [...], "metadata": { ... } },
  "options": {
    "useLlm": true,
    "rulesetId": "default",
    "save": true
  }
}
```

`document`는 [문서 IR](/guide/concepts#문서-ir)입니다. `options`는 통째로 생략할 수 있고, 각 필드의 기본값은 위와 같습니다.

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `useLlm` | `true` | `false`면 LLM 룰을 건너뛰고 `llmSkipReason: 'disabled'` |
| `rulesetId` | `"default"` | 없는 ID면 404 |
| `save` | `true` | `false`면 리포트를 저장하지 않음 |

### 응답

```json
{
  "reportId": "...",
  "documentUri": "https://wiki/x/1",
  "documentHash": "...",
  "docType": "guide",
  "rulesetId": "default",
  "rulesetVersion": 1,
  "score": {
    "total": 72,
    "grade": "C",
    "axes": { "structure": 85, "context": 58, "metadata": 92 }
  },
  "findings": [
    {
      "id": "...",
      "ruleId": "CTX001",
      "axis": "context",
      "severity": "error",
      "blockId": "b1",
      "anchor": { "kind": "confluence", "xpath": "//p[1]", "textQuote": { "exact": "지난번 논의대로" } },
      "message": "문서 안에서 해소되지 않는 참조입니다",
      "why": "이 논의를 담은 문서가 어디인지 본문에 없어, 검색이 이 조각만 가져오면 무슨 결정인지 알 수 없습니다",
      "evidence": "지난번 논의대로 진행합니다.",
      "suggestion": { "before": "지난번 논의대로 진행합니다.", "after": "2026-07-14 아키텍처 리뷰(REQ-42)에서 정한 3단계 방식으로 진행합니다." },
      "source": "llm",
      "confidence": 0.86,
      "docsUrl": "..."
    }
  ],
  "stats": { "rulesEvaluated": 31, "llmFindingsRejected": 2, "durationMs": 4180 },
  "llmStatus": "ok",
  "truncated": false,
  "cached": false,
  "createdAt": "2026-08-23T02:11:00.000Z"
}
```

| 필드 | 설명 |
|---|---|
| `score.axes` | 축별 100점 만점. `total`은 가중 평균 |
| `stats.llmFindingsRejected` | 근거 대조를 통과하지 못해 버린 LLM 지적 수 |
| `llmStatus` | `ok` \| `partial` \| `skipped` \| `failed` |
| `llmSkipReason` | `skipped`일 때만. `disabled` \| `quota` \| `too-large` |
| `truncated` | 블록 수가 `MAX_BLOCKS`를 넘어 잘라서 검사함 |
| `cached` | 같은 해시의 기존 리포트를 재사용함 |

### 부수 효과

성공하면 이 문서가 [추적성 인덱스](/guide/traceability#인덱스는-어떻게-쌓이나)에 들어갑니다. 인덱스 갱신이 실패해도 리포트는 정상 반환되고, 실패는 경고 로그로만 남습니다.

---

## POST /v1/trace/analyze {#post-v1-trace-analyze}

인덱스에 쌓인 문서 전체를 그래프로 분석합니다.

### 요청

```json
{ "useLlm": true }
```

본문 전체를 생략할 수 있습니다. `useLlm`이 `false`면 TRC006(상충 탐지) 없이 결정적 판정만 돕니다.

### 응답

```json
{
  "reportId": "...",
  "documentCount": 148,
  "idCount": 302,
  "findings": [
    {
      "id": "TRC001:REQ-42",
      "ruleId": "TRC001",
      "severity": "error",
      "message": "정의되지 않은 식별자를 참조합니다",
      "why": "REQ-42을(를) 정의하는 문서가 인덱스에 없습니다. 원본 문서를 검사해 인덱스에 넣거나 참조를 고치세요.",
      "documents": [{ "uri": "https://wiki/x/9", "title": "결제 모듈 설계" }],
      "subjectId": "REQ-42",
      "evidence": null,
      "source": "rule",
      "confidence": 1
    }
  ],
  "stats": { "pairsConsidered": 57, "pairsAnalyzed": 20, "llmFindingsRejected": 3, "durationMs": 9120 },
  "llmStatus": "ok",
  "truncated": true,
  "createdAt": "2026-08-23T02:20:00.000Z"
}
```

| 필드 | 설명 |
|---|---|
| `documentCount` | 인덱스에 쌓인 문서 수 |
| `idCount` | 그래프에 등장한 고유 식별자 수 |
| `documents` | 이 지적에 걸린 문서들. TRC004·TRC006은 둘 이상 |
| `stats.pairsConsidered` / `pairsAnalyzed` | 상충 후보 쌍 중 실제로 대조한 수 |
| `truncated` | `maxPairs`(기본 20)에 걸려 일부만 대조함 |

지적은 심각도 → 룰 ID → 지적 ID 순으로 정렬되어 옵니다.

---

## GET /v1/reports

URI별 검사 이력.

| 쿼리 | 필수 | 기본값 | 제약 |
|---|---|---|---|
| `uri` | ● | | |
| `limit` | | `20` | 1–100 |

```json
{ "reports": [ { "reportId": "...", "score": { ... }, "findings": [ ... ], "createdAt": "..." } ] }
```

`reports`의 각 항목은 `POST /v1/lint`가 돌려주는 리포트와 같은 구조입니다. 최신순입니다.

---

## POST /v1/doctype-overrides

문서 유형을 사람이 지정합니다. 자동 분류가 틀렸을 때 씁니다.

```json
{ "uri": "https://wiki/x/1", "docType": "design" }
```

`docType`은 `meeting-notes`, `requirement`, `design`, `guide`, `api-doc`, `troubleshooting`, `reference`, `unknown` 중 하나입니다.

`201`과 함께 저장한 값을 그대로 돌려줍니다. 이후 검사에서 이 문서의 `docType.origin`은 `user`가 되고, 자동 분류가 이 값을 덮어쓰지 않습니다.

## GET /v1/doctype-overrides

| 쿼리 | 필수 |
|---|---|
| `uri` | ● |

```json
{ "uri": "https://wiki/x/1", "docType": "design" }
```

지정된 값이 없으면 `docType`은 `null`입니다.

---

## GET /v1/rules

룰 카탈로그 전체.

```json
{
  "rules": [
    {
      "id": "STR003",
      "name": "section-too-long",
      "axis": "structure",
      "defaultSeverity": "warning",
      "appliesTo": "all",
      "description": "한 섹션이 너무 길어 청크가 여러 주제를 섞습니다.",
      "llm": false,
      "docsUrl": "..."
    }
  ]
}
```

`appliesTo`는 `"all"`이거나 문서 유형 배열입니다.

---

## GET /v1/rulesets

```json
{ "rulesets": [ { "id": "default", "version": 1, "name": "기본 규칙셋" } ] }
```

## GET /v1/rulesets/:id

해석이 끝난 규칙셋 전체. 생략된 값은 카탈로그 기본값으로 채워져 나옵니다.

```json
{
  "id": "default",
  "version": 1,
  "name": "기본 규칙셋",
  "axisWeights": { "structure": 0.35, "context": 0.45, "metadata": 0.2 },
  "rules": {
    "STR003": { "enabled": true, "severity": "warning", "options": { "maxSectionChars": 1500 } }
  }
}
```

없는 ID면 `404`.

---

## 클라이언트 패키지

TypeScript에서는 `@ai-lint/backend-client`를 쓰면 됩니다.

```ts
import { requestLint, requestTrace, isConfigured, type BackendSettings } from '@ai-lint/backend-client'

const settings: BackendSettings = {
  backendUrl: 'https://ai-lint.mycorp.com',
  serviceToken: '...',
  userId: 'geniuskey',
  rulesetId: 'default',
}

const report = await requestLint(document, { useLlm: true }, settings)
const trace = await requestTrace({ useLlm: true }, settings)
```

`backendUrl`이나 `serviceToken`이 비어 있으면 네트워크를 타기 전에 `{ kind: 'unconfigured' }`로 거부합니다. 설정하지 않은 상태에서 요청이 나가는 일이 없습니다.

세 번째 인자로 `fetch` 구현을 넘길 수 있습니다. 데스크톱 앱은 Tauri의 HTTP 플러그인을, 테스트는 가짜를 넘깁니다.
