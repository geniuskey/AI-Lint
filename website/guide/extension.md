# Confluence 확장

Manifest V3 크롬 확장. Confluence 페이지 좌하단에 **AI Lint** 버튼을 띄우고, 검사 결과를 같은 페이지 위에 보여줍니다.

![Confluence 페이지 좌하단에 떠 있는 AI Lint 버튼](/shots/extension-fab.png)

*버튼은 페이지 어디를 스크롤해도 좌하단에 고정됩니다. 지난 검사 결과가 있으면 등급이 배지로 붙습니다.*

## 동작 순서

```
콘텐츠 스크립트가 페이지 DOM을 읽어 IR로 변환
        ↓
서비스 워커가 POST /v1/lint 호출
        ↓
패널에 점수·지적 표시, 앵커로 본문 강조
```

페이지를 읽는 것은 **사용자 브라우저**입니다. 사용자의 세션 쿠키로 이미 열려 있는 페이지를 그대로 파싱하므로,

- 백엔드가 Confluence 자격 증명을 가질 이유가 없고,
- 사용자가 볼 권한이 없는 페이지는 애초에 검사되지 않습니다.

## 권한

```json
{
  "permissions": ["storage", "activeTab"],
  "host_permissions": []
}
```

`host_permissions`가 템플릿에서 비어 있는 것은 실수가 아닙니다. 빌드 스크립트가 `extension.config.json`을 읽어 채웁니다.

```json
{
  "confluenceOrigins": ["https://confluence.mycorp.com/*"],
  "backendOrigins": ["https://ai-lint.mycorp.com/*"]
}
```

- 콘텐츠 스크립트는 `confluenceOrigins`에만 주입됩니다.
- `host_permissions`는 두 목록의 합집합입니다. 백엔드 origin은 fetch 권한으로만 필요합니다.
- 둘 중 하나라도 비어 있으면 빌드가 실패합니다.
- `<all_urls>`가 들어 있으면 빌드가 거부합니다. 사내 도메인만 지정하세요.

## 빌드와 설치

```bash
pnpm --filter @ai-lint/extension build
```

`apps/extension/dist`가 만들어집니다. `chrome://extensions` → 개발자 모드 → "압축해제된 확장 프로그램을 로드"로 이 폴더를 지정합니다.

사내 배포는 Chrome 정책의 `ExtensionSettings`로 강제 설치하거나, 크롬 웹스토어 비공개 게시를 씁니다.

`minimum_chrome_version`은 116입니다.

## 설정

확장 옵션 페이지에서 지정합니다. 값은 `chrome.storage.sync`에 들어갑니다.

![확장 옵션 페이지. 백엔드 주소, 서비스 토큰, 사용자 ID, 규칙셋, AI 맥락 검사 사용 여부](/shots/extension-options.png)

| 항목 | 기본값 | 설명 |
|---|---|---|
| `backendUrl` | 빈 값 | 끝의 `/`는 자동으로 잘립니다 |
| `serviceToken` | 빈 값 | 백엔드의 `SERVICE_TOKEN` |
| `userId` | 빈 값 | 쿼터 집계 단위. 비우면 `anonymous` |
| `useLlm` | `true` | 끄면 룰 검사만 |
| `rulesetId` | `default` | |
| `autoRun` | `false` | 켜면 페이지를 열 때 자동 검사 |

`backendUrl`이나 `serviceToken`이 비어 있으면 버튼이 눌려도 요청하지 않고 설정하라고 알립니다.

## 패널

![검사 결과 패널. 등급 C와 축별 점수, META007·CTX001·STR005 지적, 수정 제안의 전후 비교](/shots/extension-panel.png)

지적은 심각도순으로 정렬되어 나옵니다. 항목을 누르면 본문의 해당 위치가 강조됩니다.

`AI` 배지가 붙은 것은 LLM 판정입니다. 수정 제안이 있으면 전후를 나란히 보여주고, **제안 복사**로 바로 가져갈 수 있습니다. 상단의 문서 유형은 추론값이며, 틀렸으면 골라서 다시 검사할 수 있습니다.

강조 위치는 `SourceAnchor`로 찾습니다. Confluence 앵커는 XPath와 인용 텍스트를 **둘 다** 갖고 있는데, 렌더된 DOM은 스토리지 포맷과 구조가 달라 XPath가 빗나가는 일이 흔하기 때문입니다. XPath로 먼저 찾고, 실패하면 인용 텍스트(W3C Web Annotation의 TextQuoteSelector 방식)로 다시 찾습니다.

마지막 검사 결과(등급·총점·시각)는 URI별로 `chrome.storage`에 남습니다. 페이지를 다시 열면 검사하지 않고도 지난 등급과 며칠 전 것인지를 버튼에 띄웁니다. 최근 50건까지만 보관합니다.

같은 내용을 다시 검사하면 백엔드가 문서 해시로 기존 리포트를 재사용하므로(`cached: true`) LLM은 다시 불리지 않습니다.

## 링크 검사

META006(깨진 링크)은 콘텐츠 스크립트가 페이지 안에서 확인합니다. 사용자 세션 쿠키로 `HEAD` 요청을 보내므로, 권한이 없어 403이 나는 경우와 문서가 실제로 사라진 404·410을 구분할 수 있습니다. 백엔드에서는 이 구분이 불가능합니다.

- 내부 링크와 첨부만 확인합니다. 외부 링크는 CORS 때문에 브라우저에서 상태를 알 수 없어 `unchecked`로 둡니다.
- 한 페이지당 최대 40개, 동시 4개까지 확인합니다.

## E2E

```bash
pnpm --filter @ai-lint/extension test:e2e
```

Playwright가 목 서버를 띄웁니다. 이 목 서버가 Confluence와 백엔드를 겸하므로, 빌드 시 `AI_LINT_ORIGINS` 환경변수로 origin을 갈아끼웁니다.
