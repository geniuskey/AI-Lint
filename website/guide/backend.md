# 백엔드

Fastify 5 + Postgres 16. 확장과 데스크톱 앱이 공유하는 단 하나의 서버입니다.

## 하는 일

- IR을 받아 룰 31개를 돌리고 LLM 판정을 합쳐 리포트를 만든다
- 리포트를 저장하고 URI별 이력을 돌려준다
- 문서 유형 수동 지정을 보관한다
- 룰 카탈로그와 규칙셋을 제공한다
- 검사한 문서를 추적성 인덱스에 쌓고, 요청이 오면 코퍼스를 분석한다

**하지 않는 일:** 문서를 직접 가지러 가지 않습니다. Confluence에도 파일 서버에도 접속하지 않습니다. 문서를 읽는 것은 항상 클라이언트 쪽이고, 백엔드는 이미 IR이 된 것만 받습니다.

## 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `8787` | |
| `HOST` | `0.0.0.0` | |
| `LOG_LEVEL` | `info` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` |
| `SERVICE_TOKEN` | **필수** | 클라이언트가 `x-ai-lint-token`으로 보내는 값. 16자 이상 |
| `GEMINI_API_KEY` | **필수** | |
| `GEMINI_MODEL` | 미지정 | 비우면 라이브러리 기본 모델 |
| `DATABASE_URL` | 미지정 | 비우면 메모리 저장소 |
| `LLM_MAX_DOC_CHARS` | `200000` | 넘으면 LLM을 건너뛰고 `llmSkipReason: 'too-large'` |
| `LLM_DAILY_LIMIT_PER_USER` | `200` | 넘으면 `llmSkipReason: 'quota'` |
| `MAX_BLOCKS` | `2000` | 넘으면 잘라서 검사하고 `truncated: true` |

설정이 틀리면 요청을 받기 전에 죽습니다. 반쯤 동작하는 서버보다 낫기 때문입니다.

## 인증

`/v1/health`를 뺀 모든 경로가 토큰을 요구합니다.

```
x-ai-lint-token: <SERVICE_TOKEN>
x-ai-lint-user: <사용자 식별자>
```

비교는 `timingSafeEqual`로 합니다. 길이가 다르거나 값이 다르면 401입니다.

`x-ai-lint-user`는 인증이 아니라 **쿼터 집계 단위**입니다. 비워두면 `anonymous`로 묶여서, 한 사람이 다 쓰면 모두가 막힙니다. 확장과 데스크톱 앱 설정에서 각자의 사번이나 계정을 넣게 하세요.

## 저장소

`DATABASE_URL`이 있으면 Postgres, 없으면 메모리입니다. 두 구현이 같은 인터페이스를 만족하므로 코드 어디에서도 어느 쪽인지 알 필요가 없습니다.

| 무엇 | 보관 내용 |
|---|---|
| 리포트 | 점수, 지적, 앵커, 근거 발췌 |
| 문서 유형 지정 | URI → 유형, 지정한 사람 |
| 추적성 인덱스 | 문서별 식별자 언급과 내부 링크 |

**문서 원문은 어디에도 저장되지 않습니다.** 지적에 붙는 `evidence`와 추적성 인덱스의 `snippet`만 남고, 발췌 길이는 기본 400자로 잘립니다.

마이그레이션 SQL은 `apps/backend/migrations/`에 있고, 컨테이너 빌드 시 `dist` 옆으로 복사됩니다.

## 규칙셋

규칙셋은 룰별로 켜고 끄고 심각도와 옵션을 바꿉니다. 기본값은 `default`입니다.

```json
{
  "id": "default",
  "version": 1,
  "rules": {
    "STR003": { "enabled": true, "severity": "warning", "options": { "maxSectionChars": 1500 } },
    "META005": { "enabled": true, "severity": "info", "options": { "staleMonths": 12 } }
  }
}
```

`GET /v1/rulesets`로 목록을, `GET /v1/rulesets/:id`로 내용을 볼 수 있습니다. 알 수 없는 룰 ID가 들어 있으면 로드할 때 거부됩니다 — 오타 난 규칙셋이 조용히 아무것도 안 하는 상황을 막기 위한 것입니다.

## docker

```bash
docker build -f apps/backend/Dockerfile -t ai-lint-backend .
```

빌드 컨텍스트가 **저장소 루트**입니다. `apps/backend`에서 빌드하면 워크스페이스 패키지를 찾지 못합니다.

이미지는 node:22-alpine 멀티스테이지이고, `USER node`로 떨어지며, `HEALTHCHECK`가 `/v1/health`를 두드립니다.

`docker-compose.yml`은 Postgres까지 함께 띄웁니다.

```bash
SERVICE_TOKEN=... GEMINI_API_KEY=... docker compose up -d
```

## 운영 시 볼 것

- `llmStatus`가 `failed`로 몰리면 Gemini 키나 할당량 문제입니다.
- `stats.llmFindingsRejected`가 계속 높으면 모델이 근거를 지어내고 있다는 신호입니다. 프롬프트나 모델을 손봐야 합니다.
- `cached: true` 비율이 낮으면 IR이 매번 미세하게 달라지고 있다는 뜻입니다. 어댑터가 불안정한 값(타임스탬프 등)을 IR에 넣고 있는지 확인하세요.
