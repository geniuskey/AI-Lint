# 빠른 시작

백엔드를 띄우고, 확장이나 데스크톱 앱을 연결해 첫 검사를 돌립니다.

## 요구 사항

- Node.js 22 이상
- pnpm 10.27 이상 (`corepack enable`)
- LLM 접근 수단 — OpenAI 호환 엔드포인트 ([사내 라우터 연결](/guide/backend#사내-llm-라우터-연결)), 또는 Gemini API 키
- Postgres 16 (선택 — 없으면 메모리 저장소로 뜹니다)
- Rust 툴체인 (데스크톱 앱을 빌드할 때만)

## 저장소 준비

```bash
git clone https://github.com/geniuskey/AI-Lint.git
cd AI-Lint
pnpm install
pnpm test
```

## 백엔드 띄우기

### docker compose

가장 빠른 길입니다. Postgres까지 함께 뜹니다.

```bash
export SERVICE_TOKEN=$(openssl rand -hex 24)
export LLM_BASE_URL=https://llm.mycorp.com/v1
export LLM_MODEL=internal-gpt-4o
export LLM_API_KEY=...
export LLM_AUTH_HEADER=x-llm-token
export LLM_HEADERS='{"x-dept-code":"AI-PLATFORM"}'
docker compose up -d
curl http://localhost:8787/v1/health
# {"status":"ok"}
```

`SERVICE_TOKEN`은 16자 이상이어야 합니다. 짧으면 부팅 시 죽습니다.

`LLM_AUTH_HEADER`와 `LLM_HEADERS`는 라우터가 요구하는 값에 맞춰 바꾸세요. 기본값은 `Authorization: Bearer <토큰>`입니다. 자세한 것은 [사내 LLM 라우터 연결](/guide/backend#사내-llm-라우터-연결).

Gemini API에 직접 붙이려면 이쪽입니다.

```bash
export SERVICE_TOKEN=$(openssl rand -hex 24)
export LLM_PROVIDER=gemini
export GEMINI_API_KEY=...
docker compose up -d
```

### 로컬 개발 서버

```bash
cp apps/backend/.env.example apps/backend/.env
# .env에 SERVICE_TOKEN과 LLM 설정을 채운다
pnpm --filter @ai-lint/backend dev
```

`DATABASE_URL`을 비워두면 메모리 저장소로 뜹니다. 프로세스를 내리면 리포트와 추적성 인덱스가 사라지므로 개발용으로만 쓰세요.

전체 환경변수는 [백엔드](/guide/backend#환경변수)를 보세요.

## 첫 검사

문서 없이 API만 확인하려면 최소 IR을 하나 보내면 됩니다.

```bash
curl -s http://localhost:8787/v1/lint \
  -H 'content-type: application/json' \
  -H "x-ai-lint-token: $SERVICE_TOKEN" \
  -H 'x-ai-lint-user: me' \
  -d '{
    "document": {
      "schemaVersion": 1,
      "source": { "kind": "confluence", "uri": "https://wiki/x/1" },
      "title": "배포 절차",
      "docType": { "value": "guide", "confidence": 0.5, "origin": "template" },
      "blocks": [
        { "id": "b1", "path": [0], "kind": "paragraph", "text": "지난번 논의대로 진행합니다.",
          "anchor": { "kind": "confluence", "xpath": "//p[1]", "textQuote": { "exact": "지난번" } } }
      ],
      "links": [],
      "metadata": { "labels": [] }
    },
    "options": { "useLlm": false }
  }' | jq '.score, .findings[].ruleId'
```

`useLlm: false`면 모델을 부르지 않고 룰 검사만 돕니다. 키 없이 동작을 확인할 때 유용합니다.

## Confluence 확장 설치

1. `apps/extension/extension.config.json`의 도메인을 사내 값으로 바꿉니다. 기본값은 예시 도메인이라 그대로 두면 아무 페이지에도 붙지 않습니다.

   ```json
   {
     "confluenceOrigins": ["https://confluence.mycorp.com/*"],
     "backendOrigins": ["https://ai-lint.mycorp.com/*"]
   }
   ```

2. 빌드합니다.

   ```bash
   pnpm --filter @ai-lint/extension build
   ```

3. Chrome에서 `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램을 로드" → `apps/extension/dist`

4. 확장 옵션에서 백엔드 URL과 서비스 토큰을 넣습니다.

5. Confluence 페이지를 열면 좌하단에 **AI Lint** 버튼이 나타납니다.

![Confluence 페이지 좌하단의 AI Lint 버튼](/shots/extension-fab.png)

자세한 내용은 [Confluence 확장](/guide/extension).

## 데스크톱 앱 실행

```bash
pnpm --filter @ai-lint/desktop dev     # 개발 실행
pnpm --filter @ai-lint/desktop build   # 설치 파일 생성
```

앱을 처음 열면 하단 설정에서 백엔드 URL과 토큰을 넣습니다. 토큰은 Windows 자격 증명 관리자에 저장되고 설정 파일에는 남지 않습니다.

자세한 내용은 [데스크톱 앱](/guide/desktop).

## 자주 쓰는 명령

| 명령 | 하는 일 |
|---|---|
| `pnpm test` | 전체 테스트 (Vitest) |
| `pnpm typecheck` | 전체 타입 검사 (Turborepo) |
| `pnpm build` | 전체 빌드 |
| `pnpm --filter @ai-lint/extension test:e2e` | 확장 Playwright E2E |
| `pnpm --filter @ai-lint/website dev` | 이 문서 사이트 로컬 실행 |
| `pnpm shots` | 이 문서의 스크린샷을 실제 앱에서 다시 찍기 |
