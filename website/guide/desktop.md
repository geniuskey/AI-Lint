# 데스크톱 앱

Tauri v2 + React 19. PPTX, DOCX, XLSX, PDF를 일괄 검사합니다.

Electron 대신 Tauri를 쓴 이유는 설치 파일 크기 때문입니다. 사내 배포에서 수십 MB와 수백 MB의 차이는 실제로 체감됩니다. 문서 파싱은 전부 TypeScript(fflate, pdfjs-dist)로 하므로 사이드카 바이너리가 필요 없고, Rust 쪽은 파일 읽기·쓰기와 자격 증명 저장만 담당합니다.

## 흐름

```
폴더 선택 → 재귀 수집 → 어댑터가 IR로 변환 → POST /v1/lint → 목록에 결과
                                                    ↓
                                          HTML / Excel 내보내기
```

## 파일 수집

폴더를 고르면 최대 8단계까지 재귀로 훑어 `.pptx`, `.docx`, `.xlsx`, `.pdf`를 모읍니다.

- `~$`로 시작하는 파일은 건너뜁니다. Office가 문서를 열어둘 때 만드는 잠금 파일입니다.
- 접근 권한이 없는 하위 폴더가 있어도 수집 전체가 멈추지 않고 그 폴더만 건너뜁니다.

## 어댑터가 보는 것

| 형식 | IR로 옮기는 것 |
|---|---|
| PPTX | 슬라이드별 도형 텍스트, 표, 발표자 노트, 이미지 대체 텍스트 |
| DOCX | 문단 스타일에서 제목 레벨, 표, 이미지, 하이퍼링크 |
| XLSX | 시트별 셀 값, 헤더 행 추정 |
| PDF | 텍스트 레이어와 페이지 위치. 텍스트가 없으면 STR014(스캔 PDF) |

앵커는 형식별로 다릅니다. PPTX는 슬라이드 번호와 도형 ID, DOCX는 문단 인덱스, XLSX는 시트 이름과 셀 범위, PDF는 페이지 번호와 위치입니다. 지적을 원본에서 찾아갈 수 있게 하기 위한 것입니다.

## 내보내기

| 형식 | 내용 |
|---|---|
| HTML | 문서별 점수와 지적을 담은 단일 파일. 그대로 공유 가능 |
| Excel | `요약` 시트(문서별 점수·등급)와 `지적` 시트(전체 지적 목록) 두 장 |

[추적성](/guide/traceability) 탭도 같은 두 형식으로 내보냅니다.

## 설정과 토큰

설정은 `%APPDATA%/ai-lint/settings.json`에 저장됩니다. 백엔드 URL, 사용자 ID, 규칙셋 같은 값들입니다.

**서비스 토큰은 이 파일에 들어가지 않습니다.** Windows 자격 증명 관리자(`ai-lint` / `backend-token`)에 넣습니다. 설정 파일이 백업되거나 공유 폴더에 올라가도 토큰이 새지 않게 하기 위한 것입니다. 토큰 칸을 비우고 저장하면 자격 증명 항목이 삭제됩니다.

## 보안 경계

Tauri에 노출한 명령은 일곱 개뿐입니다.

```
list_dir  read_document  save_file  read_settings  write_settings  read_token  write_token
```

`tauri-plugin-fs`를 쓰지 않고 직접 만든 Rust 명령으로 처리한 이유는, 플러그인의 범용 파일 API를 프론트엔드에 통째로 내주지 않기 위해서입니다.

HTTP 스코프도 좁혀 두었습니다.

```
http://localhost:*/*
http://127.0.0.1:*/*
https://*/v1/*
```

앱이 임의의 주소로 요청을 보낼 수 없습니다.

## 빌드

```bash
pnpm --filter @ai-lint/desktop dev      # 개발 실행 (tauri dev)
pnpm --filter @ai-lint/desktop build    # 설치 파일 (tauri build)
```

Rust 툴체인과 Windows에서는 WebView2 런타임이 필요합니다. Windows 11에는 기본 포함되어 있습니다.

프론트엔드만 브라우저에서 확인하려면 `dev:vite`를 쓰면 되지만, 파일 접근과 토큰 저장은 Tauri 명령이라 동작하지 않습니다.
