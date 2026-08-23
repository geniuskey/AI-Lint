export const PAGE_ID = '5001'

/**
 * 검사 결과가 화면에 담기도록 만든 페이지.
 * 제목 단계 건너뛰기(STR001), 헤더 없는 표(STR009), 대체텍스트 없는 이미지(STR005),
 * "여기" 링크(STR007), 미완성 표식(META008)이 규칙 검사에 걸리고
 * 나머지 문장은 AI 맥락 검사가 집는다.
 */
export const STORAGE_XHTML = [
  '<h1>배경</h1>',
  '<p>지난번 논의대로 결제 승인 흐름을 3단계로 나누기로 했습니다.</p>',
  '<p>결제 요청은 PG 라우터를 거쳐 승인 서버로 전달됩니다.</p>',
  '<h2>결정 사항</h2>',
  '<p>승인과 매입을 분리하고, 매입은 야간 배치에서 처리합니다.</p>',
  '<h4>롤백 기준</h4>',
  '<p>실패율이 기준을 넘으면 즉시 되돌립니다. 기준값은 TBD.</p>',
  '<h2>단계별 담당</h2>',
  '<table><tbody>',
  '<tr><td>단계</td><td>담당</td><td>완료일</td></tr>',
  '<tr><td>승인 분리</td><td>결제팀</td><td>8월 2주</td></tr>',
  '<tr><td>매입 배치</td><td>정산팀</td><td>8월 4주</td></tr>',
  '</tbody></table>',
  '<h2>참고</h2>',
  '<p>상세 시퀀스는 <a href="/pages/viewpage.action?pageId=812">여기</a>를 보세요.</p>',
  '<p><ac:image><ri:attachment ri:filename="flow.png" /></ac:image></p>',
].join('')

const RENDERED = [
  '<h1 id="배경">배경</h1>',
  '<p>지난번 논의대로 결제 승인 흐름을 3단계로 나누기로 했습니다.</p>',
  '<p>결제 요청은 PG 라우터를 거쳐 승인 서버로 전달됩니다.</p>',
  '<h2 id="결정-사항">결정 사항</h2>',
  '<p>승인과 매입을 분리하고, 매입은 야간 배치에서 처리합니다.</p>',
  '<h4 id="롤백-기준">롤백 기준</h4>',
  '<p>실패율이 기준을 넘으면 즉시 되돌립니다. 기준값은 TBD.</p>',
  '<h2 id="단계별-담당">단계별 담당</h2>',
  '<table class="confluenceTable"><tbody>',
  '<tr><td class="confluenceTd">단계</td><td class="confluenceTd">담당</td><td class="confluenceTd">완료일</td></tr>',
  '<tr><td class="confluenceTd">승인 분리</td><td class="confluenceTd">결제팀</td><td class="confluenceTd">8월 2주</td></tr>',
  '<tr><td class="confluenceTd">매입 배치</td><td class="confluenceTd">정산팀</td><td class="confluenceTd">8월 4주</td></tr>',
  '</tbody></table>',
  '<h2 id="참고">참고</h2>',
  '<p>상세 시퀀스는 <a href="/pages/viewpage.action?pageId=812">여기</a>를 보세요.</p>',
  '<p><img src="/download/attachments/5001/flow.png" class="confluence-embedded-image" /></p>',
].join('\n      ')

/** 사내 위키처럼 보이게 한 껍데기. 확장 버튼이 어디에 뜨는지 보여주는 게 목적이다. */
export const PAGE_HTML = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="ajs-page-id" content="${PAGE_ID}" />
    <title>결제 승인 흐름 개편 설계 - ENG - Confluence</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; background: #fff; color: #172b4d; font: 14px/1.72 'Malgun Gothic', -apple-system, sans-serif; }
      .nav { display: flex; align-items: center; gap: 18px; height: 40px; padding: 0 18px; background: #0747a6; color: #fff; font-size: 13px; }
      .nav .logo { font-weight: 700; letter-spacing: -0.01em; }
      .nav .create { margin-left: auto; padding: 4px 12px; border-radius: 3px; background: #fff; color: #0747a6; font-weight: 600; }
      .shell { display: grid; grid-template-columns: 240px 1fr; min-height: calc(100vh - 40px); }
      .side { padding: 20px 16px; border-right: 1px solid #dfe1e6; background: #f4f5f7; font-size: 13px; }
      .side h2 { margin: 0 0 12px; font-size: 13px; }
      .side ul { margin: 0; padding: 0; list-style: none; color: #42526e; }
      .side li { padding: 5px 8px; border-radius: 3px; }
      .side li.on { background: #e4eefb; color: #0052cc; font-weight: 600; }
      main { max-width: 820px; padding: 26px 40px 80px; }
      .crumbs { color: #6b778c; font-size: 12px; }
      h1.title { margin: 6px 0 10px; font-size: 27px; font-weight: 600; letter-spacing: -0.01em; }
      .byline { display: flex; align-items: center; gap: 8px; color: #6b778c; font-size: 12px; }
      .avatar { width: 22px; height: 22px; border-radius: 50%; background: #ffab00; color: #fff; font-size: 11px; font-weight: 700; display: grid; place-items: center; }
      .labels { margin: 14px 0 22px; }
      .labels span { display: inline-block; padding: 2px 9px; margin-right: 6px; border-radius: 3px; background: #dfe1e6; color: #42526e; font-size: 12px; }
      .content h1 { font-size: 21px; margin: 26px 0 8px; }
      .content h2 { font-size: 17px; margin: 24px 0 8px; }
      .content h4 { font-size: 14px; margin: 18px 0 6px; }
      .content p { margin: 0 0 10px; }
      .content a { color: #0052cc; }
      table.confluenceTable { border-collapse: collapse; margin: 10px 0 4px; }
      td.confluenceTd { border: 1px solid #dfe1e6; padding: 7px 12px; }
      .confluence-embedded-image { display: block; width: 320px; height: 92px; border: 1px solid #dfe1e6; border-radius: 3px; background: repeating-linear-gradient(135deg, #f4f5f7 0 10px, #ebecf0 10px 20px); }
    </style>
  </head>
  <body>
    <div class="nav"><span class="logo">Confluence</span><span>공간</span><span>사람</span><span class="create">만들기</span></div>
    <div class="shell">
      <aside class="side">
        <h2>엔지니어링</h2>
        <ul>
          <li>결제 플랫폼</li>
          <li class="on">결제 승인 흐름 개편 설계</li>
          <li>정산 배치 운영 가이드</li>
          <li>결제 요구사항 정의서</li>
        </ul>
      </aside>
      <main>
        <div class="crumbs">엔지니어링 / 결제 플랫폼</div>
        <h1 class="title">결제 승인 흐름 개편 설계</h1>
        <div class="byline"><span class="avatar">박</span><span>박작성 님이 2026년 7월 15일에 수정</span></div>
        <div class="labels"><span>설계</span><span>payment</span></div>
        <div id="main-content" class="wiki-content content">
      ${RENDERED}
        </div>
      </main>
    </div>
  </body>
</html>`

export const CONTENT_JSON = {
  id: PAGE_ID,
  title: '결제 승인 흐름 개편 설계',
  space: { key: 'ENG' },
  version: { number: 12, when: '2026-07-15T02:00:00.000Z' },
  history: { createdBy: { displayName: '박작성' } },
  metadata: { labels: { results: [{ name: '설계' }, { name: 'payment' }] }, properties: {} },
  ancestors: [{ title: '엔지니어링' }, { title: '결제 플랫폼' }],
  body: { storage: { value: STORAGE_XHTML } },
}
