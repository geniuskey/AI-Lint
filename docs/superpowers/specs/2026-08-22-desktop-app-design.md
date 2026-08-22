# AI-Lint Windows 데스크톱 앱 설계

서브프로젝트 3. PPTX / DOCX / XLSX / PDF 문서가 AI 시대에 맞게 작성되었는지 검사하는 Windows GUI 앱.

상위 스펙: `2026-08-22-ai-lint-design.md` 10장. 이 문서는 그 개요를 확정한다.

## 1. 스택 확정

상위 스펙이 "Tauri + Python sidecar" 를 후보로 남겨두었으나, **사이드카 없는 Tauri v2 + React** 로 확정한다.

근거: 문서 파싱에 Node 런타임이 필요 없다. OOXML 세 포맷은 zip + XML이고 압축 해제(`fflate`)와 XML 파싱(`DOMParser`)이 모두 웹뷰에서 동작한다. PDF는 `pdfjs-dist`가 본래 브라우저용이다. 서브프로젝트 2에서 같은 계열 코드를 크롬 확장 번들로 넣어 실제로 돌린 전례가 있다.

| 항목 | 선택 | 비고 |
|---|---|---|
| 셸 | Tauri v2 | 설치 ~10MB, WebView2 사용 |
| UI | React + Vite | 모노레포 TS 스택 유지 |
| 파일 IO | Tauri fs · dialog 플러그인 | 폴더 재귀 순회 포함 |
| 백엔드 호출 | Tauri http 플러그인 | CORS 우회 |
| 파싱 | 순수 TS 패키지 | Node API 의존 없음 |

포기하는 것: Playwright의 Electron 1급 지원. Tauri E2E는 `tauri-driver` + WebdriverIO라는 별도 스택이 필요하다. 대신 **파싱과 IR 매핑을 순수 TS 패키지로 분리해 vitest로 두껍게 덮는다.** 결함은 셸이 아니라 포맷 해석에 있다.

## 2. 패키지 구성

```
apps/desktop/
  src-tauri/          Rust 셸, capabilities 설정
  src/                React UI
packages/xml/         DOMParser 기반 태그 순회 헬퍼
packages/adapter-office/  pptx · docx · xlsx → Document IR
packages/adapter-pdf/     pdf → Document IR
```

`packages/xml`은 신규가 아니라 승격이다. `adapter-confluence/src/dom.ts`의 `tagOf` / `childrenOf` / `childOf` / `findDescendants` / `findDescendant` / `textOf`를 그대로 옮기고, `adapter-confluence`가 거기서 가져다 쓰도록 고친다. OOXML도 접두사 태그(`a:p`, `w:pStyle`, `p:sp`)를 다루므로 같은 헬퍼가 필요하다.

`adapter-office`와 `adapter-pdf`를 나누는 이유: `pdfjs-dist`는 수 MB짜리 무거운 의존성이고 OOXML 세 포맷과 공유하는 코드가 없다. OOXML 셋은 zip + XML이라는 기반을 공유하므로 한 패키지에 둔다.

## 3. 파서 모드

Confluence storage는 `ac:` · `ri:` 접두사가 선언되지 않아 `text/html`로 읽어야 했다. OOXML은 네임스페이스를 전부 선언하므로 `application/xml`도 후보였으나, **`text/html`로 통일한다.**

실측 결과 `happy-dom`은 `application/xml`을 실제 XML로 파싱하지 않는다. 두 모드 모두 HTML 파서로 넘기고 `localName`에 접두사를 소문자로 남긴다 (`p:sld`). 반면 실제 브라우저의 `application/xml`은 `localName`이 `sld`, `prefix`가 `p`다. 이 차이를 그대로 두면 테스트가 통과해도 WebView2에서 어긋난다. `text/html`은 양쪽 모두 `p:sld`를 내므로 테스트와 런타임이 일치한다.

OOXML을 HTML 파서로 읽어도 안전한 이유: DOCX·PPTX의 태그는 전부 접두사가 붙어(`w:tbl`, `a:p`) HTML의 특수 태그 처리에 걸리지 않는다. XLSX 시트 XML만 기본 네임스페이스라 접두사가 없으나(`worksheet`, `sheetData`, `row`, `c`, `v`) HTML 특수 태그와 이름이 겹치지 않는다.

접두사는 고정 관례일 뿐이므로 순회 헬퍼는 접두사를 무시하고 지역명으로 맞춘다. Confluence처럼 접두사까지 봐야 하는 곳은 콜론을 포함한 질의로 정확히 맞춘다.

## 4. 공통 OOXML 기반

`adapter-office/src/ooxml.ts`:

```typescript
export interface Package {
  /** zip 엔트리 경로 → 내용 */
  entry(path: string): string | null
  bytes(path: string): Uint8Array | null
  paths(prefix: string): string[]
}

export function openPackage(bytes: Uint8Array): Package
export function parsePart(pkg: Package, path: string): Element | null
/** `_rels/<name>.rels`를 읽어 rId → target 으로 만든다. 세 포맷 공통이다. */
export function relationships(pkg: Package, partPath: string): Map<string, string>
```

`fflate`의 `unzipSync`를 쓴다. 동기 API여야 파서 코드가 단순해지고, 문서 하나는 웹뷰를 멈출 만큼 크지 않다.

## 5. 포맷별 IR 매핑

공통 규칙: 파싱 못 한 요소는 건너뛰되 `STR012`(렌더되지 않은 요소)로 보고한다. 전체 검사는 계속한다.

### 5.1 PPTX

대상: `ppt/slides/slide*.xml`, `ppt/notesSlides/notesSlide*.xml`

| OOXML | 블록 |
|---|---|
| 슬라이드 제목 도형 (`p:ph` `type="title"` 또는 `"ctrTitle"`) | `heading` (level 1) |
| 나머지 도형의 `a:p` | `paragraph` |
| `a:p`에 `a:buChar` / `a:buAutoNum` | `list` |
| `a:tbl` | `table` |
| `p:pic` | `image` |
| 노트 슬라이드 본문 | `paragraph` |

관건은 두 가지다. **그룹 도형** `p:grpSp`는 도형을 중첩해 담으므로 재귀로 순회한다. **제목 없는 슬라이드**는 흔하며, 이 경우 슬라이드 번호로 `heading`을 합성하지 않는다 — 없는 제목을 지어내면 룰이 문제를 못 본다.

앵커: `{ kind: 'pptx', slide, shapeId }`. `shapeId`는 `p:nvSpPr/p:cNvPr@id`.

### 5.2 DOCX

대상: `word/document.xml`, 스타일은 `word/styles.xml`

| OOXML | 블록 |
|---|---|
| `w:pStyle` = `Heading1`~`Heading6` | `heading` (level 1~6) |
| `w:numPr` 있는 `w:p` | `list` |
| `w:tbl` | `table` |
| `w:drawing` | `image` |
| 나머지 `w:p` | `paragraph` |

관건은 **스타일 없이 만든 가짜 제목**이다. 스타일이 없는 `w:p`인데 모든 run이 굵고(`w:b`) 글자 크기(`w:sz`)가 본문 중앙값보다 4half-point 이상 크며 한 줄이 짧으면(80자 미만) 제목 의도로 본다. 이때 블록은 `paragraph`로 두고 새 룰 `STR013`으로 보고한다. IR에서 `heading`으로 승격해버리면 룰이 검출할 대상이 사라진다.

앵커: `{ kind: 'docx', paragraphIndex }`. body 직계 자식 기준 0-based.

### 5.3 XLSX

대상: `xl/worksheets/sheet*.xml`, `xl/sharedStrings.xml`, `xl/workbook.xml`

시트마다 시트명을 `heading`(level 1)으로 두고, 데이터 영역을 `table`로 만든다.

헤더 행 추정: 첫 번째 비어 있지 않은 행의 모든 셀이 문자열이고, 그 아래 행에 숫자 셀이 하나라도 있으면 헤더로 본다. 아니면 헤더 없음으로 두고 `STR009`(헤더 없는 표)가 잡게 한다.

병합 셀(`mergeCells`)은 값을 좌상단 셀에 두고 나머지는 빈칸으로 채운다. 병합이 헤더 행에 걸쳐 있으면 `STR009`로 보고한다 — 병합 헤더는 AI가 열 이름을 못 읽는 대표 사례다.

빈 시트와 차트 전용 시트는 건너뛴다.

앵커: `{ kind: 'xlsx', sheet, range }`.

### 5.4 PDF

`pdfjs-dist`의 `getTextContent()`로 페이지마다 텍스트 아이템을 얻는다. 각 아이템은 `transform`(위치·배율)과 `fontName`을 갖는다.

- 같은 y좌표대의 아이템을 한 줄로 묶는다
- 줄의 폰트 크기 = `transform`의 배율 성분
- 본문 크기 = 문서 전체 줄 크기의 중앙값
- 본문 크기의 1.2배 이상이고 80자 미만인 줄 → `heading`. 크기 순위로 level 1~3을 매긴다
- `fontName`에 `Bold`가 들어가면 제목 판정에 가산

**텍스트 아이템이 한 개도 없으면 스캔 PDF**다. 새 룰 `STR014`로 error를 내고 파싱을 중단한다. 이 문서는 AI가 읽을 수 없다는 것이 검사 결과의 전부다.

앵커: `{ kind: 'pdf', page, bbox }`.

## 6. 새 규칙

| ID | 축 | 심각도 | 내용 |
|---|---|---|---|
| `STR013` | structure | warning | 스타일 없이 굵게·크게로 만든 제목. 목차·네비게이션·청킹에서 제목으로 인식되지 않는다 |
| `STR014` | structure | error | 텍스트 레이어가 없는 스캔 PDF. AI가 내용을 읽을 수 없다 |

`packages/rules`에 픽스처 쌍(위반·정상)과 함께 추가한다. 상위 스펙 13장의 규칙이다.

## 7. 앱 흐름

1. **선택** — 파일 열기 또는 폴더 열기 (Tauri dialog)
2. **수집** — 폴더면 재귀 순회 후 확장자(`.pptx` `.docx` `.xlsx` `.pdf`) 필터. 임시 파일(`~$`로 시작)은 제외
3. **큐 실행** — 파일마다 `readFile` → 어댑터 → IR → `POST /v1/lint`
4. **결과 표** — 파일명 · 문서유형 · 등급 · 점수 · 지적 수 · 상태
5. **상세** — 행을 누르면 지적 목록. 심각도별 묶음, 수정 제안 diff, 규칙 설명 링크
6. **내보내기** — HTML(공유용), Excel(집계용)

위치 보기는 제공하지 않는다. 원본 문서를 앱 안에 렌더하지 않으므로 "12페이지 2번째 표" 같은 **텍스트 안내**로 대신한다. 앵커의 `kind`별로 사람이 읽을 문장을 만든다.

### 동시성과 비용

동시 처리는 3개로 제한한다. 백엔드 쿼터와 LLM 비용을 보호한다.

**폴더 일괄 검사는 LLM을 기본으로 끈다.** 파일 수만큼 비용이 곱해지기 때문이다. 체크박스로 명시적으로 켜야 한다. 단일 파일 검사는 기본으로 켠다.

### 부분 실패

파일 하나가 파싱에 실패해도 큐는 계속 돈다. 해당 행만 실패 사유와 함께 표시한다. 상위 스펙 12장의 원칙 — 부분 실패해도 얻은 만큼은 보여준다.

## 8. 설정

확장과 같은 항목을 쓴다: 백엔드 주소, 서비스 토큰, 사용자 ID, 규칙셋, LLM 사용 여부.

저장 위치는 Tauri의 앱 설정 디렉터리(`%APPDATA%/ai-lint/settings.json`)다. 서비스 토큰은 평문으로 두지 않고 Windows 자격 증명 관리자(`keyring`)에 넣는다.

## 9. 라벨 공유

심각도·축·문서유형의 한국어 라벨은 확장과 데스크톱이 같은 값을 써야 한다. `packages/contract`에 넣으면 zod가 값 import를 통해 딸려오므로, 의존성 없는 `packages/labels`로 분리하고 양쪽이 가져다 쓴다.

확장의 `renderFindings`는 DOM을 직접 조작하므로 React에서 재사용하지 않는다. 컴포넌트로 다시 쓰되 라벨과 정렬 순서는 공유한다.

## 10. 테스트 전략

- **어댑터** — 포맷마다 실제 파일 픽스처를 만들어 IR 스냅샷을 잡는다. 픽스처는 XML을 손으로 지어내지 않고 로컬에 설치된 Office를 COM으로 구동해 실제 산출물을 만든 뒤 커밋한다. 생성 스크립트도 `test/fixtures/make/`에 함께 두어 재생성 경로를 남긴다. PDF는 Word의 `ExportAsFixedFormat`으로 뽑고, 스캔 PDF는 텍스트 없이 이미지만 넣은 문서로 만든다. 관건으로 지목한 것(그룹 도형, 가짜 제목, 병합 헤더, 스캔 PDF)은 각각 전용 픽스처를 둔다
- **규칙** — `STR013` · `STR014`에 위반·정상 IR 픽스처 쌍
- **큐** — 동시성 제한, 부분 실패 시 큐 지속, LLM 토글 반영을 백엔드 목으로 검증
- **UI** — React Testing Library로 결과 표와 상세 렌더
- **셸** — Tauri 셸 자체는 E2E로 덮지 않는다. 수동 확인한다

## 11. 구현 순서

| # | 범위 |
|---|---|
| 1 | `packages/xml` 승격, `adapter-confluence` 이전 |
| 2 | `adapter-office` OOXML 기반 (zip, 파트 파싱, relationships) |
| 3 | XLSX 어댑터 — 가장 단순한 구조 |
| 4 | DOCX 어댑터 + `STR013` |
| 5 | PPTX 어댑터 — 그룹 도형 |
| 6 | `adapter-pdf` + `STR014` |
| 7 | Tauri 셸, 설정, 파일·폴더 선택 |
| 8 | 검사 큐, 동시성, 부분 실패 |
| 9 | 결과 표와 상세 뷰 |
| 10 | HTML · Excel 내보내기 |
