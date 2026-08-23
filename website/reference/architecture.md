# 아키텍처

## 저장소 구조

pnpm 워크스페이스 + Turborepo. TypeScript strict, ESM, Node 22 이상.

```
packages/
  ir                  문서 중간 표현. 스키마, 앵커, 해시, 순회
  xml                 XML 파서 (어댑터 공용)
  rules               룰 카탈로그, 실행기, 채점, 규칙셋
  llm                 Gemini 프로바이더, 프롬프트, 근거 대조
  trace               식별자 추출, 그래프, TRC 룰, 상충 탐지
  contract            요청·응답 타입과 Zod 스키마
  backend-client      확장·데스크톱이 공유하는 HTTP 클라이언트
  labels              사용자에게 보이는 문구
  adapter-confluence  Confluence 스토리지 XHTML → IR
  adapter-office      PPTX / DOCX / XLSX → IR
  adapter-pdf         PDF → IR

apps/
  backend             Fastify 서버
  extension           Confluence 크롬 확장 (MV3)
  desktop             Tauri v2 + React 19

website/              이 문서 사이트 (VitePress)
```

## 의존 방향

```
adapter-*  ─┐
            ├─→  ir  ←─  rules  ←─  trace
contract  ──┘                ↑
                            llm
```

- `ir`은 아무것도 의존하지 않습니다. 스키마와 순회 유틸리티뿐입니다.
- 룰은 `ir`만 봅니다. 문서가 어디서 왔는지 알지 못하고, 알 필요도 없습니다.
- 어댑터는 `ir`에만 의존합니다. 룰이나 백엔드를 모릅니다.
- 앱은 패키지를 조합할 뿐 도메인 로직을 갖지 않습니다.

새 문서 형식을 지원하려면 어댑터 하나를 추가하면 됩니다. 룰 31개는 손대지 않습니다.

## 데이터 흐름

### 문서 검사

```
1. 클라이언트가 문서를 읽는다
   확장 → 브라우저 DOM (사용자 세션 쿠키)
   데스크톱 → 로컬 파일 (Rust 명령)

2. 어댑터가 IR로 변환

3. POST /v1/lint

4. 백엔드
   ├─ 규칙셋 로드
   ├─ 문서 해시로 캐시 조회 → 있으면 cached: true로 반환
   ├─ 결정적 룰 실행 (STR 전부, META 6개)
   ├─ LLM 룰 실행 (CTX 9개, META001, META007)
   │    └─ 근거 대조 + 확신도 하한을 통과한 것만 채택
   ├─ 채점
   ├─ 저장 (save: true일 때)
   └─ 추적성 인덱스 갱신 (부수 효과, 실패해도 무시)

5. 클라이언트가 결과 표시
   확장 → 패널 + 본문 강조
   데스크톱 → 목록 + HTML/Excel 내보내기
```

### 추적성 분석

```
POST /v1/trace/analyze
   ├─ 인덱스에서 전체 문서 항목 로드
   ├─ 식별자 그래프 구성 (definedBy / referencedBy / kinds / byUri)
   ├─ TRC001~005 (결정적)
   ├─ 상충 후보 쌍 선별 → 공유 ID 많은 순 상위 maxPairs
   ├─ LLM 대조 (동시 3개) → TRC006
   │    └─ 인용 문장이 발췌에 실제로 있는지 대조
   └─ 심각도 → 룰 ID → 지적 ID 순 정렬
```

## 설계 결정

### 백엔드는 문서를 가지러 가지 않는다

크롤러를 두면 Confluence 자격 증명이 필요해집니다. 그러면 백엔드가 모든 사용자의 모든 페이지를 볼 수 있는 주체가 되고, 권한 경계가 무너집니다.

대신 문서를 읽는 것은 항상 클라이언트입니다. 확장은 사용자 세션 쿠키로, 데스크톱은 사용자 파일 시스템으로 읽습니다. 사용자가 볼 수 없는 것은 검사되지도 않습니다.

추적성 인덱스가 `POST /v1/lint`의 부수 효과인 것도 같은 이유입니다.

### 원문을 저장하지 않는다

리포트에는 지적 위치와 근거 발췌만 남습니다. 추적성 인덱스에는 식별자가 등장한 블록의 발췌만 남고 기본 400자에서 잘립니다.

백엔드 DB가 사내 문서 전체의 사본이 되면 그 자체가 관리 대상이 됩니다. 검사 결과만 보관하면 그럴 일이 없습니다.

### LLM 실패가 전체를 막지 않는다

`analyzeContradictions`는 어떤 경우에도 예외를 던지지 않습니다. 결정적 판정은 이미 나와 있고, 그것만이라도 사용자에게 가야 하기 때문입니다.

문서 검사도 같습니다. LLM이 죽으면 `llmStatus: 'failed'`로 표시하고 룰 결과만 돌려줍니다. 리포트가 아예 안 나오는 것보다 낫습니다.

룰 하나가 예외를 던져도 나머지 30개는 계속 돕니다.

### 근거 대조

모델은 그럴듯한 지적을 지어냅니다. 그래서 판정할 때 근거 문장을 함께 내게 하고, 그 문장이 실제 본문에 있는지 대조합니다. 없으면 버립니다.

버린 개수를 `stats.llmFindingsRejected`로 노출하는 이유는, 이 값이 계속 높으면 프롬프트나 모델에 문제가 있다는 신호이기 때문입니다.

### 추적성은 별도 리포트

`TRC001`~`TRC006`은 `RULE_META`에 없습니다. 코퍼스 상태에 따라 판정이 달라지는 룰을 단일 문서 점수에 섞으면, 남이 문서를 안 올렸다는 이유로 내 문서 등급이 떨어집니다.

### 의존성 주입

`buildApp(deps)`가 팩토리인 것은 테스트 때문입니다. 목 프로바이더와 인메모리 저장소만으로 앱 전체를 띄울 수 있어야 테스트가 라우트를 통째로 검증할 수 있습니다.

Postgres 저장소와 메모리 저장소는 같은 인터페이스를 만족하므로, 코드 어디에서도 어느 쪽인지 알 필요가 없습니다.

## 테스트

```bash
pnpm test          # Vitest — packages/*/test, apps/*/test
pnpm typecheck     # Turborepo
pnpm build
pnpm --filter @ai-lint/extension test:e2e    # Playwright
```

루트 `vitest.config.ts`가 `packages/*/test/**/*.test.ts`와 `apps/*/test/**/*.test.{ts,tsx}`를 모두 잡습니다. 패키지마다 설정을 두지 않습니다.

확장 E2E는 Playwright가 목 서버를 띄웁니다. 이 서버가 Confluence와 백엔드를 겸하고, 빌드 시 `AI_LINT_ORIGINS`로 origin을 갈아끼웁니다.

## 기술 선택

| | | 이유 |
|---|---|---|
| Fastify 5 | 백엔드 | 스키마 검증과 훅이 필요한 만큼만 있음 |
| Zod 3 | 검증 | IR 스키마가 곧 타입 정의. 이중 관리 없음 |
| Tauri v2 | 데스크톱 | 설치 파일 크기. 사이드카가 필요 없어 Electron의 이점이 상쇄됨 |
| fflate | OOXML | 순수 JS. PPTX/DOCX/XLSX 압축 해제와 Excel 생성에 모두 씀 |
| pdfjs-dist | PDF | 텍스트 레이어와 위치를 함께 얻을 수 있음 |
| @google/genai | LLM | 구조화 출력 스키마 지원 (`google-generativeai`는 폐지됨) |
| VitePress | 문서 | 이 사이트 |
