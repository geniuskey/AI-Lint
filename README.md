# AI-Lint

레거시 문서가 AI에게 읽히는지 검사하고, 고칠 곳을 알려줍니다.

RAG를 붙이든 에이전트를 붙이든 검색이 물어오는 것은 결국 사내 문서입니다. 제목 없이 3천 자가 이어지면 청크가 여러 주제를 섞고, 표가 이미지로만 있으면 값이 아예 추출되지 않고, "지난번 논의대로 진행"이라고만 적혀 있으면 모델이 그 논의를 찾을 방법이 없습니다. AI-Lint는 이런 문서를 AI가 읽기 전에 찾아냅니다.

**문서: https://geniuskey.github.io/AI-Lint/**

## 무엇을 하나

| | 대상 | 진입점 |
|---|---|---|
| Confluence 확장 | 위키 페이지 | 페이지 좌하단 "AI Lint" 버튼 |
| 데스크톱 앱 | PPTX, DOCX, XLSX, PDF | 파일·폴더 선택 후 일괄 검사 |
| 추적성 분석 | 검사한 문서 전체 | 데스크톱 앱 "추적성" 탭 |

셋 다 같은 백엔드 하나를 바라봅니다.

## 세 축으로 채점

| 축 | 가중치 | 룰 | 무엇을 보나 |
|---|---|---|---|
| 구조 & 청킹 친화성 | 0.35 | STR001~014 | 제목 계층, 섹션 길이, 이미지 대체 텍스트, 표 헤더, 스캔 PDF |
| 맥락 자립성 | 0.45 | CTX001~009 | 문서 밖 참조, 정의 없는 약어, 목적 부재 — 전부 LLM 판정 |
| 메타데이터 & 최신성 | 0.20 | META001~008 | 제목의 서술력, 요약, 라벨, 담당자, 오래된 문서, 깨진 링크 |

맥락 자립성에 가장 큰 가중치가 붙어 있습니다. 정규식으로 "여기를 클릭"이라는 링크 텍스트는 잡을 수 있지만, "지난번 논의대로 진행하기로 했습니다"가 문제인지 아닌지는 그 논의가 같은 문서 안에 있는지 읽어봐야 알 수 있습니다.

LLM이 지어낸 지적은 걸러냅니다. 모델은 판정할 때 근거 문장을 함께 내야 하고, 그 문장이 본문에 실제로 존재하는지 대조해 통과한 것만 리포트에 남습니다.

## 문서간 추적성

검사한 문서에서 `REQ-42`, `TC-7` 같은 식별자를 모아 그래프를 만듭니다. 끊긴 참조(TRC001), 테스트 없는 요구사항(TRC003), 두 문서가 같은 것을 두고 다른 말을 하는 경우(TRC006)를 찾습니다. 마지막 것은 LLM이 양쪽 발췌를 대조합니다.

추적성 지적은 문서 점수에 넣지 않습니다. 남이 문서를 안 올렸다는 이유로 내 문서 등급이 떨어지면 안 되기 때문입니다.

## 빠르게 띄우기

```bash
pnpm install
pnpm test

export SERVICE_TOKEN=$(openssl rand -hex 24)   # 16자 이상
export LLM_BASE_URL=https://llm.mycorp.com/v1
export LLM_MODEL=internal-gpt-4o
export LLM_API_KEY=...
docker compose up -d

curl http://localhost:8787/v1/health
```

기본 프로바이더는 OpenAI 호환 엔드포인트입니다. 사내 LLM 라우터를 전제로 하기 때문에 토큰을 실을 헤더 이름(`LLM_AUTH_HEADER`)과 라우터가 요구하는 필수 헤더(`LLM_HEADERS`)를 지정할 수 있습니다 — [연결 방법](https://geniuskey.github.io/AI-Lint/guide/backend#사내-llm-라우터-연결). Gemini API에 직접 붙이려면 `LLM_PROVIDER=gemini`에 `GEMINI_API_KEY`를 주면 됩니다.

확장과 데스크톱 앱 설치는 [빠른 시작](https://geniuskey.github.io/AI-Lint/guide/getting-started)을 보세요.

## 저장소 구조

```
packages/
  ir                  문서 중간 표현 — 스키마, 앵커, 해시, 순회
  xml                 XML 파서 (어댑터 공용)
  rules               룰 카탈로그, 실행기, 채점, 규칙셋
  llm                 LLM 프로바이더(OpenAI 호환 / Gemini), 프롬프트, 근거 대조
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

website/              문서 사이트 (VitePress)
```

Confluence 스토리지 XHTML, PPTX, DOCX, XLSX, PDF는 어댑터를 거쳐 하나의 IR로 수렴합니다. 룰은 IR만 보므로 문서가 어디서 왔는지 알 필요가 없습니다. 새 형식을 지원하려면 어댑터 하나만 추가하면 됩니다.

## 설계상 정해둔 것

**백엔드는 문서를 가지러 가지 않습니다.** 확장은 사용자 브라우저의 세션 쿠키로, 데스크톱은 사용자 파일 시스템으로 문서를 읽어 IR로 바꾼 뒤 보냅니다. 백엔드가 Confluence 자격 증명을 가지면 모든 사용자의 모든 페이지를 볼 수 있는 주체가 되고, 권한 경계가 무너집니다.

**문서 원문은 저장하지 않습니다.** 리포트에는 지적 위치와 근거 발췌만, 추적성 인덱스에는 식별자가 등장한 블록의 발췌(기본 400자)만 남습니다.

**LLM 실패가 전체를 막지 않습니다.** 모델이 죽거나 쿼터가 소진되면 `llmStatus`로 표시하고 룰 결과만 돌려줍니다.

## 개발

```bash
pnpm test                                     # Vitest
pnpm typecheck                                # Turborepo
pnpm build
pnpm --filter @ai-lint/extension test:e2e     # Playwright
pnpm --filter @ai-lint/website dev            # 문서 사이트
```

Node 22 이상, pnpm 10.27 이상. 데스크톱 앱을 빌드하려면 Rust 툴체인이 필요합니다.

## 라이선스

사내 배포용 도구입니다.
