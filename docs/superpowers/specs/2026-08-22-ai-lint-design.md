# AI-Lint 설계 문서

작성일: 2026-08-22
상태: 승인됨

## 1. 문제 정의

조직의 지식은 Confluence 위키와 PPT/Word/Excel/PDF 문서에 쌓여 있다. 이 문서들은 **사람이 회의 맥락을 공유한 상태에서 읽는 것**을 전제로 작성되었다. "지난번 논의대로 진행", "위 표 참고", 스크린샷으로 박아넣은 표, 제목만 "회의록"인 페이지가 그 결과다.

이 문서들을 RAG나 LLM 에이전트에 넣으면 검색은 되지만 답이 틀린다. 청크 단위로 잘렸을 때 의미가 살아남지 않기 때문이다. 조직이 AI를 도입하기 전에 해결해야 하는 건 모델이 아니라 **데이터의 AI 가독성**이다.

AI-Lint는 이 문제를 코드 린터와 같은 방식으로 다룬다. 문서를 검사하고, 문제 위치를 짚고, 어떻게 고칠지 제안한다.

**한 줄 정의**: 레거시 문서가 AI가 읽을 수 있는 형태인지 검사하고, 어떻게 고칠지 알려주는 문서 린터.

## 2. 목표와 비목표

### 목표

- Confluence 페이지를 그 자리에서 검사하고 수정 제안을 받는다
- PPT/Word/Excel/PDF를 일괄 검사한다
- 규칙 기반 검사와 LLM 기반 맥락 검사를 결합한다. **LLM 검사가 핵심 차별점**이다
- 문서 유형(회의록/요구사항서/설계서/가이드/API문서)에 따라 다른 기준을 적용한다
- 팀 단위로 규칙셋을 공유하고 문서 품질 추이를 본다

### 비목표

- 문서를 자동으로 수정하지 않는다. 진단과 제안까지만 한다 (2차에서 재검토)
- 맞춤법/문법 검사기가 아니다. AI 가독성에 영향을 주는 것만 본다
- 문서 작성 도구가 아니다. 기존 문서를 검사한다
- 초기 버전은 한국어/영어 문서만 대상으로 한다

### 성공 기준

- Confluence 페이지 검사가 룰 결과 2초 이내, LLM 결과 15초 이내에 도착한다
- 오탐률이 충분히 낮아 사용자가 경고를 무시하지 않는다. 리포트당 오탐 2건 이하를 목표로 한다
- LLM이 지적한 이슈의 인용 근거가 원문에 실제로 존재한다 (환각 0건, 검증으로 강제)

## 3. 아키텍처

### 3.1 결정: 하이브리드 (클라이언트가 읽고, 서버가 분석)

클라이언트가 **사용자 자신의 권한으로** 문서를 읽어 공통 IR로 정규화하고, 백엔드는 IR만 받아 분석한다.

이 결정의 근거:

- **권한 안전성**: 백엔드가 Confluence 서비스 계정을 갖지 않는다. 사용자가 볼 수 없는 페이지는 애초에 IR이 만들어지지 않는다. 사내 위키 보안 리뷰에서 문제가 되지 않는다
- **엔진 재사용**: Confluence 확장과 Windows 앱이 서로 다른 원본을 읽지만, 같은 IR을 만들어 **같은 백엔드**를 호출한다. 룰 로직을 두 번 구현하지 않는다
- **규칙 일관성**: 규칙셋이 서버에서 버저닝되므로 사용자마다 다른 기준으로 검사되는 일이 없다
- **이력 수집**: 리포트가 서버에 남아 팀 대시보드가 가능하다

트레이드오프: 공간 전체 일괄 스캔은 브라우저가 켜져 있어야 한다. 공간 관리자가 명시적으로 동의한 공간에 한해 서비스 계정 배치 스캔을 추가하는 건 후속 과제로 둔다.

### 3.2 컴포넌트

```
┌──────────────────────┐     ┌──────────────────────┐
│ Chrome Extension     │     │ Windows GUI App      │
│ (Confluence DC)      │     │ (PPTX/DOCX/XLSX/PDF) │
│  storage XHTML 파싱  │     │  파일 파싱           │
└──────────┬───────────┘     └──────────┬───────────┘
           │      ── Document IR (JSON) ──          │
           └───────────────┬───────────────────────┘
                           ▼
              ┌─────────────────────────┐
              │  AI-Lint Backend        │
              │  ┌───────────────────┐  │
              │  │ Rule Engine       │  │  결정적 규칙
              │  ├───────────────────┤  │
              │  │ LLM Analyzer      │  │  맥락 자립성
              │  ├───────────────────┤  │
              │  │ Rule Registry     │  │  유형별 규칙셋
              │  ├───────────────────┤  │
              │  │ Report Store      │  │  이력 · 대시보드
              │  └───────────────────┘  │
              └─────────────────────────┘
```

### 3.3 모노레포 구조

```
ai-lint/
├── packages/
│   ├── ir/                  # IR 스키마(zod), 직렬화, 앵커 타입
│   ├── rules/               # 룰 엔진 + 룰 카탈로그 + 규칙셋 정의
│   ├── llm/                 # LLM provider 추상화 + 맥락 분석기 + 근거 검증
│   └── adapter-confluence/  # storage XHTML → IR
├── apps/
│   ├── backend/             # Fastify 서버
│   ├── extension/           # MV3 크롬 확장
│   └── desktop/             # Windows GUI 앱 (서브프로젝트 3)
└── docs/
```

pnpm workspace + Turborepo. TypeScript strict mode.

`adapter-confluence`를 `extension`이 아닌 별도 패키지로 두는 이유: 어댑터는 순수 함수(XHTML 문자열 → IR)라서 브라우저 없이 테스트할 수 있어야 한다. 실제 Confluence 페이지 샘플을 픽스처로 두고 IR 스냅샷 테스트를 돌린다.

## 4. Document IR

이 프로젝트의 핵심 자산. 모든 문서 포맷이 여기로 수렴하고, 그 뒤는 완전히 동일한 코드가 처리한다.

```typescript
interface Document {
  schemaVersion: 1
  source: {
    kind: 'confluence' | 'pptx' | 'docx' | 'xlsx' | 'pdf'
    uri: string            // 페이지 URL 또는 파일 경로
    version?: string       // Confluence 버전 번호
    modifiedAt?: string    // ISO 8601
    author?: string
    space?: string         // Confluence 스페이스 키 / 파일 상위 폴더
  }
  title: string
  docType: {
    value: DocType
    confidence: number     // 0..1
    origin: 'label' | 'template' | 'llm' | 'user'
  }
  blocks: Block[]          // 순서 있는 평탄 리스트, path로 계층 표현
  links: Link[]
  metadata: {
    labels: string[]
    owner?: string
    reviewedAt?: string
    ancestors?: string[]   // 상위 페이지 제목 경로
  }
}
```

### 4.1 Block

```typescript
type Block = BlockBase & (
  | { kind: 'heading';   level: 1|2|3|4|5|6; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list';      ordered: boolean; items: string[]; depth: number }
  | { kind: 'table';     caption?: string; headers: string[]; rows: string[][]; isLayoutTable: boolean }
  | { kind: 'code';      lang?: string; text: string }
  | { kind: 'image';     alt?: string; caption?: string; ocrText?: string; assetRef: string }
  | { kind: 'callout';   variant: string; text: string }
  | { kind: 'macro';     name: string; params: Record<string, string>; renderedText?: string }
  | { kind: 'slide';     index: number; title?: string; notes?: string }   // PPTX
  | { kind: 'sheet';     name: string; headers: string[]; usedRange: string } // XLSX
)

interface BlockBase {
  id: string          // 문서 내 안정적 식별자
  path: number[]      // 제목 계층상 위치. 예: [2,1] = 2번째 h1 아래 1번째 h2
  anchor: SourceAnchor
}
```

### 4.2 SourceAnchor

원본 위치 역참조. 이게 있어야 확장이 페이지의 해당 위치로 스크롤·하이라이트하고, GUI 앱이 "12페이지 2번째 표"로 안내한다. 포맷별 구현은 다르지만 인터페이스는 하나다.

```typescript
type SourceAnchor =
  | { kind: 'confluence'; xpath: string; textQuote: { exact: string; prefix?: string; suffix?: string } }
  | { kind: 'pptx';  slide: number; shapeId?: string }
  | { kind: 'docx';  paragraphIndex: number }
  | { kind: 'xlsx';  sheet: string; range?: string }
  | { kind: 'pdf';   page: number; bbox?: [number, number, number, number] }
```

Confluence 앵커에 xpath와 textQuote를 함께 두는 이유: 렌더된 DOM이 storage format과 구조가 달라 xpath만으로는 빗나갈 수 있다. **textQuote로 fallback 검색**한다 (W3C Web Annotation의 TextQuoteSelector와 같은 방식).

### 4.3 Link

```typescript
interface Link {
  blockId: string
  text: string           // 링크 텍스트. "여기" 같은 무의미 텍스트 검출용
  href: string
  target: 'internal' | 'external' | 'attachment' | 'anchor'
  resolvedTitle?: string // 내부 링크의 대상 페이지 제목
  status?: 'ok' | 'broken' | 'unchecked'
}
```

## 5. 문서 유형과 규칙셋

### 5.1 DocType

```typescript
type DocType =
  | 'meeting-notes'    // 회의록
  | 'requirement'      // 요구사항서
  | 'design'           // 설계문서
  | 'guide'            // 가이드 / 절차서
  | 'api-doc'          // API 문서
  | 'troubleshooting'  // 장애·트러블슈팅
  | 'reference'        // 용어집 · 정책 · 참조
  | 'unknown'
```

### 5.2 유형 판정 순서

1. 사용자가 이전에 이 문서 유형을 수정한 적이 있으면 그 값 (`origin: 'user'`)
2. Confluence 라벨이 매핑 테이블에 있으면 그 값 (`origin: 'label'`)
3. Confluence 템플릿/블루프린트 정보가 있으면 그 값 (`origin: 'template'`)
4. 없으면 LLM이 제목 + 제목 구조 + 첫 500자로 추론 (`origin: 'llm'`)

사용자가 패널에서 유형을 바꾸면 `(uri, docType)`으로 저장하고 다음 검사부터 1번이 적용된다.

### 5.3 유형별 필수 섹션

규칙 `META007`이 이 표를 참조한다.

| DocType | 필수 요소 |
|---|---|
| meeting-notes | 일시, 참석자, 결정사항, 액션아이템(담당자 + 기한) |
| requirement | 목적/범위, 요구사항 항목(ID 부여), 수용 기준 |
| design | 배경/문제, 결정 내용, 검토한 대안과 트레이드오프 |
| guide | 대상 독자, 전제조건, 순서 있는 단계 |
| api-doc | 엔드포인트, 파라미터, 응답, 예시 |
| troubleshooting | 증상, 원인, 해결 방법 |
| reference | 용어/항목 정의 |
| unknown | 없음 (범용 규칙만 적용) |

### 5.4 규칙셋

규칙셋은 서버에 저장되는 YAML이다. 규칙별 활성화 여부, 심각도 오버라이드, 임계값, 축 가중치를 담는다.

```yaml
id: default
version: 3
name: 기본 규칙셋
axisWeights: { structure: 0.35, context: 0.45, metadata: 0.20 }
rules:
  STR003: { enabled: true, severity: warning, options: { maxSectionChars: 1500 } }
  META005: { enabled: true, severity: info,    options: { staleMonths: 12 } }
  CTX007: { enabled: true, severity: warning, appliesTo: [design, meeting-notes] }
```

맥락 축 가중치를 가장 높게 잡은 건 이게 AI 가독성에 가장 직접적으로 작용하고 사람 눈에는 가장 안 보이는 문제이기 때문이다.

## 6. 룰 카탈로그

### 6.1 구조 & 청킹 친화성 (STR) — 결정적 규칙

| ID | 이름 | 검출 내용 | 기본 심각도 |
|---|---|---|---|
| STR001 | heading-hierarchy-skip | 제목 레벨 건너뜀 (h2 → h4) | warning |
| STR002 | no-headings | 본문 800자 초과인데 제목이 없음 | error |
| STR003 | section-too-long | 한 섹션 본문이 임계치 초과. 청크가 여러 주제를 섞는다 | warning |
| STR004 | table-as-image | 표/도표가 이미지로만 존재. 텍스트로 추출 불가 | error |
| STR005 | image-missing-alt | 이미지에 alt·캡션 없음. AI에게는 존재하지 않는 내용 | error |
| STR006 | code-block-no-language | 코드블록 언어 미지정 | info |
| STR007 | vague-link-text | "여기", "링크", "click here" 등 무의미 링크 텍스트 | warning |
| STR008 | layout-table | 레이아웃 목적으로 쓰인 표 (헤더 없음 + 1~2셀) | info |
| STR009 | table-no-header | 표에 헤더 행이 없어 열 의미를 알 수 없음 | warning |
| STR010 | deep-nesting | 목록 4단계 이상 중첩 | info |
| STR011 | attachment-only | 본문이 사실상 비어 있고 첨부파일만 있음 | error |
| STR012 | unrendered-macro | 내용을 담은 매크로가 텍스트로 추출되지 않음 | warning |

### 6.2 맥락 자립성 (CTX) — LLM 규칙

이 축이 제품의 핵심이다. 규칙 기반으로는 검출할 수 없다.

| ID | 이름 | 검출 내용 | 기본 심각도 |
|---|---|---|---|
| CTX001 | dangling-reference | "지난번 논의대로", "위 표 참고" 등 문서 내에서 해소되지 않는 참조 | error |
| CTX002 | undefined-term | 정의 없이 등장하는 약어·사내 은어·코드네임 | warning |
| CTX003 | missing-purpose | 문서의 목적과 범위가 도입부에 명시되지 않음 | warning |
| CTX004 | ambiguous-actor | 주어 생략으로 행위 주체가 불명확 (특히 액션아이템) | warning |
| CTX005 | unresolved-pronoun | 지시대명사가 가리키는 대상이 같은 섹션 안에 없음 | warning |
| CTX006 | relative-time | "현재", "최근", "다음 주" 등 절대 시점 없는 시간 표현 | info |
| CTX007 | decision-without-rationale | 결정만 있고 근거·검토한 대안이 없음 | warning |
| CTX008 | section-topic-drift | 섹션 제목과 실제 내용이 어긋남 | warning |
| CTX009 | external-assumption | 문서 밖에 있는 전제에 의존해 문장이 성립함 | info |

### 6.3 메타데이터 & 최신성 (META)

| ID | 이름 | 검출 내용 | 판정 방식 | 기본 심각도 |
|---|---|---|---|---|
| META001 | title-not-descriptive | 제목이 내용을 대변하지 못함 ("회의록", "임시", "복사본", "Untitled") | 규칙 + LLM | warning |
| META002 | missing-summary | 긴 문서에 요약/TL;DR 없음 | 규칙 | warning |
| META003 | no-labels | 라벨 없음 | 규칙 | info |
| META004 | no-owner | 소유자·담당자 미기재 | 규칙 | info |
| META005 | stale-document | 최종 수정 후 임계 기간 경과 | 규칙 | info |
| META006 | broken-link | 깨진 내부/외부 링크 | 규칙 | warning |
| META007 | missing-required-section | 유형별 필수 섹션 누락 (5.3절 표) | 규칙 + LLM | error |
| META008 | draft-marker | "TBD", "작성중", "???" 등 미완성 표식 잔존 | 규칙 | warning |

### 6.4 심각도 정의

- **error** — AI가 이 문서를 읽으면 내용을 놓치거나 틀리게 이해한다
- **warning** — AI 답변 품질이 떨어진다
- **info** — 개선하면 좋다

### 6.5 점수 산정

축별로 100점에서 시작해 감점한다. 감점은 `error 15점 / warning 6점 / info 2점`, 축별 하한 0점. 같은 규칙이 반복 위반되면 3회까지만 누적하고 그 이상은 1점씩 더한다 (한 종류의 문제가 점수를 독점하지 않도록).

총점은 축별 점수의 가중 평균. 등급은 A(90+) / B(75+) / C(60+) / D(60 미만).

## 7. LLM 분석기

### 7.1 파이프라인

```
IR ──> 마크다운 직렬화(블록 ID 주석 포함)
   ──> 문서 전역 요약 생성 (긴 문서만)
   ──> 섹션 청크 분할 (전역 요약을 각 청크에 동봉)
   ──> 구조화 출력 강제 호출 (병렬)
   ──> 근거 검증 필터
   ──> 중복 제거 · 병합
   ──> Finding[]
```

### 7.2 직렬화 형식

LLM에게 IR을 JSON으로 주지 않는다. 마크다운이 훨씬 잘 읽히고 토큰도 적게 쓴다. 대신 각 블록 앞에 ID 주석을 붙여 LLM이 위치를 지목할 수 있게 한다.

```markdown
<!--b:h1--> # 결제 모듈 개편
<!--b:p3--> 지난번 논의대로 3단계로 나눠서 진행하기로 했습니다.
<!--b:t1--> | 단계 | 담당 |
            | --- | --- |
            | 1차 | 김 |
```

### 7.3 구조화 출력

LLM provider의 구조화 출력 기능으로 스키마를 강제한다. 자유 텍스트 파싱은 하지 않는다.

```typescript
interface LlmFinding {
  ruleId: string        // CTX001 ~ CTX009, META001, META007 중 하나
  blockId: string       // 직렬화에 등장한 ID
  evidence: string      // 원문에서 그대로 인용한 문자열
  why: string           // 이게 왜 AI 가독성 문제인가 (한국어 1~2문장)
  suggestion: { before: string; after: string } | null
  confidence: number    // 0..1
}
```

### 7.4 근거 검증 (환각 방지)

LLM 응답을 그대로 신뢰하지 않는다. 다음을 모두 통과해야 리포트에 들어간다.

1. `ruleId`가 카탈로그에 존재하고, 현재 규칙셋에서 활성화되어 있으며, 이 문서 유형에 적용 대상인가
2. `blockId`가 실제 IR 블록에 존재하는가
3. `evidence`가 해당 블록 텍스트에 실제로 존재하는가 (공백 정규화 후 부분 문자열 일치, 실패 시 정규화된 편집거리 0.9 이상 유사도로 재시도)
4. `suggestion.before`가 원문에 존재하는가 (없으면 suggestion만 버리고 finding은 유지)
5. `confidence`가 임계치(기본 0.6) 이상인가

**탈락한 finding은 조용히 버리고 카운트를 로그에 남긴다.** 이 탈락률이 프롬프트 품질의 회귀 지표가 된다.

이 검증 단계가 3장에서 말한 "오탐 2건 이하" 목표를 지탱한다. LLM이 그럴듯하게 지어낸 지적은 원문 인용 대조에서 대부분 걸러진다.

### 7.5 청킹 전략

맥락 자립성 검사는 역설적으로 **전역 맥락이 필요하다**. "이 표현이 문서 안에서 해소되는가"를 판단하려면 문서 전체를 알아야 한다.

- 문서가 임계치(기본 12000자) 이하면 통째로 한 번 호출
- 초과하면 제목 경계로 섹션 청크를 만들고, 각 청크 프롬프트에 **문서 전역 요약 + 전체 제목 목차 + 정의된 용어 목록**을 동봉한다
- 청크는 병렬 호출하되 동시성을 제한한다 (기본 4)

### 7.6 Provider 추상화와 비용 통제

```typescript
interface LlmProvider {
  name: string
  complete(req: { system: string; user: string; schema: JSONSchema; maxTokens: number }): Promise<unknown>
}
```

기본 구현은 Gemini. 온프레미스 모델로 교체할 수 있도록 인터페이스 뒤에 둔다.

- **캐싱**: IR 정규화 해시 + 규칙셋 버전 + 프롬프트 버전을 키로 리포트를 캐시한다. 문서가 안 바뀌었으면 LLM을 호출하지 않는다
- **쿼터**: 문서당 토큰 상한, 사용자별 일일 호출 상한. 초과 시 룰 검사만 수행하고 리포트에 `llmSkipped: 'quota'` 표시
- **부분 실패**: 청크 일부가 실패해도 성공한 청크 결과는 반환하고 `partial: true` 표시

## 8. 백엔드 API

```
POST /v1/lint
  body: { document: Document, options?: { rulesetId?, useLlm?: boolean, save?: boolean } }
  →     LintReport

GET  /v1/rulesets                 규칙셋 목록
GET  /v1/rulesets/:id             규칙셋 상세
GET  /v1/rules                    룰 카탈로그 (설명 · 기본 심각도 · 문서 링크)
POST /v1/doctype-overrides        { uri, docType }  사용자 유형 수정 저장
GET  /v1/reports?uri=...          해당 문서 검사 이력
GET  /v1/health
```

### 8.1 LintReport

```typescript
interface LintReport {
  reportId: string
  documentUri: string
  documentHash: string
  docType: Document['docType']
  rulesetId: string
  rulesetVersion: number
  score: { total: number; grade: 'A'|'B'|'C'|'D'; axes: { structure: number; context: number; metadata: number } }
  findings: Finding[]
  stats: { rulesEvaluated: number; llmFindingsRejected: number; durationMs: number }
  llmStatus: 'ok' | 'partial' | 'skipped' | 'failed'
  createdAt: string
}

interface Finding {
  id: string
  ruleId: string
  axis: 'structure' | 'context' | 'metadata'
  severity: 'error' | 'warning' | 'info'
  blockId: string | null       // 문서 전체에 대한 지적이면 null
  anchor: SourceAnchor | null
  message: string              // 무엇이 문제인가
  why: string                  // 왜 AI 가독성 문제인가
  evidence: string | null
  suggestion: { before: string; after: string } | null
  source: 'rule' | 'llm'
  confidence: number
  docsUrl: string              // 룰 설명 문서
}
```

### 8.2 인증

사내 배포이므로 초기에는 확장/앱이 서비스 토큰을 보내고, 사용자 식별은 `X-AI-Lint-User` 헤더로 받는다. OIDC 연동은 후속 과제. 토큰은 확장 옵션 페이지와 앱 설정에서 입력한다.

### 8.3 저장소

PostgreSQL. 테이블: `rulesets`, `reports`, `findings`, `doctype_overrides`, `llm_usage`.

`reports`는 `document_hash`에 유니크 인덱스를 두고 캐시 조회에 쓴다.

## 9. Confluence 크롬 확장

### 9.1 대상

Confluence Server / Data Center. REST API v1과 storage format(XHTML)을 다룬다.

### 9.2 데이터 흐름

```
content script (Confluence 페이지에서 실행)
  1. 페이지 ID 추출 (AJS.params.pageId 또는 meta[name=ajs-page-id])
  2. fetch('/rest/api/content/{id}?expand=body.storage,version,metadata.labels,ancestors,history',
           { credentials: 'include' })          ← 사용자 세션 쿠키 그대로
  3. storage XHTML → Document IR  (adapter-confluence)
  4. service worker로 IR 전달
service worker
  5. POST {backendUrl}/v1/lint   (서비스 토큰 첨부)
  6. LintReport 수신 → content script로 반환
content script
  7. Shadow DOM 패널에 렌더
```

동일 출처 fetch이므로 CORS 문제가 없고 별도 로그인도 필요 없다. 사용자가 볼 수 없는 페이지는 API가 403을 준다 — 권한 모델이 그대로 유지된다.

### 9.3 UI

**FAB 버튼** — 페이지 **좌하단** 고정. Shadow DOM으로 격리해 Confluence 스타일과 충돌하지 않는다. 이전 검사 결과가 캐시에 있으면 버튼에 등급 배지를 함께 표시한다.

**결과 패널** — 버튼 클릭 시 좌측에서 슬라이드 인, 너비 420px, 리사이즈 가능.

```
┌─────────────────────────────┐
│ AI-Lint            [설정][×]│
├─────────────────────────────┤
│      B  78점                │
│  구조 85 · 맥락 68 · 메타 82│
│  유형: 설계문서  [변경]      │
├─────────────────────────────┤
│ ● error 2   ▲ warning 5     │
│ ● 표가 이미지로만 있음       │
│   "아키텍처 개요" 아래       │
│   → AI는 이 표를 못 읽습니다 │
│   [위치 보기]               │
│                             │
│ ▲ 해소되지 않는 참조         │
│   "지난번 논의대로 3단계로"  │
│   → 어떤 논의인지 문서 안에  │
│      없습니다               │
│   수정 제안:                │
│   ┌─────────────────────┐   │
│   │- 지난번 논의대로     │   │
│   │+ 2026-07-15 아키텍처 │   │
│   │  리뷰 결정에 따라    │   │
│   └─────────────────────┘   │
│   [복사] [위치 보기]        │
└─────────────────────────────┘
```

**점진적 표시** — 룰 검사 결과가 먼저 도착해 즉시 렌더되고, LLM 결과는 도착하는 대로 목록에 합쳐진다. 사용자가 15초를 빈 화면으로 기다리지 않는다.

**위치 보기** — `SourceAnchor`로 렌더된 DOM에서 대상을 찾아 스크롤하고 강조 표시한다. xpath 우선, 실패 시 textQuote로 검색.

**옵션 페이지** — 백엔드 URL, 서비스 토큰, LLM 사용 여부, 규칙셋 선택, 자동 검사 여부.

### 9.4 권한

`manifest.json`의 `host_permissions`는 사내 Confluence 도메인으로 한정한다. `activeTab`, `storage`만 요청한다. 광범위한 `<all_urls>`는 쓰지 않는다.

## 10. Windows GUI 앱 (서브프로젝트 3, 개요)

별도 스펙에서 상세화한다. 확정된 것:

- 입력: PPTX / DOCX / XLSX / PDF. 단일 파일과 폴더 일괄 검사
- 각 포맷 어댑터가 Document IR을 만들고 **같은 백엔드 `/v1/lint`** 를 호출한다
- 결과는 앱 내 리포트 뷰 + Excel/HTML 내보내기

포맷별 IR 매핑 원칙:

| 포맷 | 매핑 |
|---|---|
| PPTX | 슬라이드 → `slide` 블록, 제목 도형 → `heading`, 본문 → `paragraph`/`list`, 표 → `table`, 발표자 노트 → `paragraph`. 도형에 갇힌 텍스트와 그룹 도형 처리가 관건 |
| DOCX | 스타일(Heading 1~6) → `heading`, 나머지는 직관적 매핑. 스타일 없이 굵게+크게로 만든 가짜 제목 검출이 관건 |
| XLSX | 시트 → `sheet` 블록, 헤더 행 추정 → `table`. 병합 셀과 헤더 없는 표가 관건 |
| PDF | 텍스트 레이어 추출 + 제목 추정(폰트 크기·굵기 휴리스틱). 스캔 PDF는 텍스트 레이어 부재를 `STR004` 계열 error로 보고 |

스택 후보: Tauri(React UI) + Python sidecar. 문서 파싱은 Python 생태계(python-pptx, python-docx, openpyxl, pdfplumber)가 압도적이고, UI는 웹 스택을 재사용한다. 스펙 단계에서 확정한다.

## 11. 추적성 검사 (서브프로젝트 4, 개요)

단일 문서 검사를 넘어서는 별개 문제다. 코퍼스가 쌓인 뒤 착수한다.

- 문서에서 식별자 패턴(`REQ-123`, `TC-45`, 티켓 키)과 문서간 링크를 추출해 그래프를 만든다
- 검사 항목: 상위 요구사항이 없는 설계, 테스트가 없는 요구사항, 끊긴 참조, 같은 주제를 다루면서 상충하는 서술
- 상충 서술 탐지는 LLM 대조가 필요하므로 비용이 크다. 대상을 좁히는 후보 선별이 선행 과제

## 12. 에러 처리

| 상황 | 동작 |
|---|---|
| 백엔드 도달 불가 | 패널에 명확한 에러 + 재시도 버튼. 마지막 캐시 리포트가 있으면 "N일 전 결과"로 표시 |
| Confluence API 403 | "이 페이지를 볼 권한이 없습니다" 안내 |
| LLM 호출 실패 | 룰 결과만 반환, `llmStatus: 'failed'`, 패널에 "맥락 검사를 수행하지 못했습니다" 배너 |
| LLM 쿼터 초과 | `llmStatus: 'skipped'`, 사유 표시 |
| 문서가 너무 큼 | 블록 수 상한(기본 2000) 초과 시 잘라서 검사하고 리포트에 truncated 표시 |
| 파싱 실패 (매크로/도형) | 해당 블록만 건너뛰고 `STR012`로 보고. 전체 검사는 계속 |
| 근거 검증 전량 탈락 | `llmStatus: 'partial'`, `llmFindingsRejected` 카운트 노출 |

원칙: **부분 실패해도 얻은 만큼은 보여준다.** 전부 아니면 무(無)로 처리하지 않는다.

## 13. 테스트 전략

- **룰 엔진** — 규칙마다 위반 IR 픽스처와 정상 IR 픽스처를 쌍으로 둔다. 규칙 추가 시 픽스처 쌍이 함께 오지 않으면 리뷰에서 막는다
- **어댑터** — 실제 Confluence storage XHTML 샘플(매크로·중첩표·첨부 포함)을 픽스처로 두고 IR 스냅샷 테스트
- **앵커** — 렌더된 HTML 샘플에서 xpath와 textQuote가 대상을 찾아내는지 검증. xpath 실패 시 fallback이 동작하는지 포함
- **LLM 분석기** — 두 층으로 나눈다
  - 결정적 층: provider를 모킹해 근거 검증·중복 제거·스키마 검증을 테스트. CI에서 항상 실행
  - 회귀 층: 라벨링된 문서 세트에 실제 LLM을 호출해 검출률/오탐률을 측정. 별도 태그로 분리해 수동 또는 야간 실행
- **백엔드** — API 계약 테스트, 캐시 히트/미스, 쿼터 동작
- **확장** — Playwright로 목 Confluence 페이지에 content script를 주입해 버튼 표시 → 검사 → 패널 렌더 → 위치 보기 흐름을 검증

## 14. 구현 순서

| # | 서브프로젝트 | 범위 | 근거 |
|---|---|---|---|
| 1 | Lint 엔진 + 백엔드 | `ir`, `rules`, `llm`, `backend` | 두 클라이언트의 공통 기반 |
| 2 | Confluence 크롬 확장 | `adapter-confluence`, `extension` | 가장 빠른 실사용 검증 |
| 3 | Windows GUI 앱 | `desktop` + 포맷 어댑터 | 파싱 난이도가 높음. 엔진 검증 후 착수 |
| 4 | 추적성 검사 | 코퍼스 인덱스 + 링크 그래프 | 코퍼스가 쌓인 뒤 의미 있음 |

각 서브프로젝트는 자체 구현 계획을 갖고 PR 단위로 머지한다.
