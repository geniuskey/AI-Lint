---
layout: home

hero:
  name: AI-Lint
  text: 문서가 AI에게 읽히는지 검사합니다
  tagline: 레거시 위키와 오피스 문서를 룰과 LLM으로 함께 진단하고, 어디를 어떻게 고칠지 알려줍니다.
  image:
    src: /favicon.svg
    alt: AI-Lint
  actions:
    - theme: brand
      text: 빠른 시작
      link: /guide/getting-started
    - theme: alt
      text: AI-Lint란
      link: /guide/
    - theme: alt
      text: 룰 카탈로그
      link: /rules/

features:
  - title: 세 축으로 진단
    icon: { src: /feature/axes.svg, width: '26', height: '26', wrap: true }
    details: 구조·청킹 친화성, 맥락 자립성, 메타데이터·최신성. 31개 룰이 문서를 100점 만점으로 채점하고 A~D 등급을 매깁니다.
  - title: 룰만으로는 못 잡는 것을 LLM이
    icon: { src: /feature/ai.svg, width: '26', height: '26', wrap: true }
    details: '"지난번 논의대로" 같은 문서 밖 참조, 정의 없는 약어, 근거 없는 결정. 문맥을 읽어야 보이는 문제는 LLM이 판정하고, 근거 문장이 본문에 실제로 있는지 대조한 뒤에만 지적으로 남깁니다.'
  - title: Confluence는 브라우저에서
    icon: { src: /feature/browser.svg, width: '26', height: '26', wrap: true }
    details: 페이지 좌하단 버튼 한 번이면 검사 결과가 뜹니다. 지적한 곳은 본문에서 바로 강조되고, 백엔드는 위키 자격 증명을 갖지 않습니다.
  - title: PPTX·DOCX·XLSX·PDF는 데스크톱에서
    icon: { src: /feature/files.svg, width: '26', height: '26', wrap: true }
    details: 폴더를 통째로 골라 일괄 검사하고 HTML·Excel로 내보냅니다. Tauri 기반이라 설치 파일이 가볍습니다.
  - title: 문서 하나가 아니라 코퍼스 전체를
    icon: { src: /feature/graph.svg, width: '26', height: '26', wrap: true }
    details: 검사한 문서에서 REQ-1, TC-3 같은 식별자를 모아 그래프를 만듭니다. 끊긴 참조, 테스트 없는 요구사항, 두 문서가 서로 다르게 적어둔 값을 찾아냅니다.
  - title: 사내에서 자급
    icon: { src: /feature/server.svg, width: '26', height: '26', wrap: true }
    details: Fastify 백엔드 + Postgres. docker compose 한 번으로 뜨고, 문서 원문은 저장하지 않습니다.
---

## 실제 화면

![Confluence 페이지 위에 열린 AI-Lint 패널. 등급 C, 총점 69점, 축별 점수와 지적 목록이 보인다](/shots/extension-panel.png)

*Confluence 페이지 좌하단 버튼을 누르면 같은 페이지 위에 결과가 열립니다. AI 배지가 붙은 지적은 LLM 판정입니다.*

![데스크톱 앱의 문서 검사 탭. PPTX, DOCX, XLSX, PDF 네 파일의 검사 결과와 선택한 문서의 지적 목록](/shots/desktop-lint.png)

*데스크톱 앱은 폴더를 통째로 골라 오피스 문서와 PDF를 일괄 검사합니다.*

## 한눈에 보기

```
Confluence 확장 ─┐
                 ├─→  POST /v1/lint  ─→  룰 31개 + LLM  ─→  점수·지적·수정 제안
데스크톱 앱     ─┘                              │
                                                 └─→  코퍼스 인덱스  ─→  POST /v1/trace/analyze
```

문서는 출처가 무엇이든 **하나의 중간 표현(IR)** 으로 바뀐 뒤에 검사됩니다. Confluence 스토리지 XHTML, PPTX, DOCX, XLSX, PDF가 모두 같은 `Document` 타입으로 수렴하므로, 룰은 어디서 온 문서인지 알 필요가 없습니다.

## 왜 필요한가

RAG를 붙이든 에이전트를 붙이든, 검색이 물어오는 것은 결국 사내 문서입니다. 그 문서가

- 제목 없이 3천 자가 이어지면 청크가 여러 주제를 섞고,
- 표가 이미지로만 있으면 값이 아예 추출되지 않고,
- "지난번 논의대로 진행"이라고만 적혀 있으면 모델이 그 논의를 찾을 방법이 없습니다.

AI-Lint는 이런 문서를 **AI가 읽기 전에** 찾아내고, 무엇을 어떻게 고치면 되는지 문장 단위로 알려줍니다.
