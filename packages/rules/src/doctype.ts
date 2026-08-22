import type { DocType } from '@ai-lint/ir'

export interface RequiredSection {
  /** 사용자에게 보여줄 이름 */
  label: string
  /** 제목 매칭에 쓰는 동의어. 소문자·공백 제거 후 부분 일치로 비교한다. */
  synonyms: string[]
}

const section = (label: string, ...synonyms: string[]): RequiredSection => ({
  label,
  synonyms: [label, ...synonyms],
})

/** 스펙 5.3절. META007이 참조한다. */
export const REQUIRED_SECTIONS: Record<DocType, RequiredSection[]> = {
  'meeting-notes': [
    section('일시', '날짜', '개최일', 'date', 'when'),
    section('참석자', '참가자', '참석', 'attendees', 'participants'),
    section('결정사항', '결정 사항', '결론', 'decisions', 'decision'),
    section('액션아이템', '액션 아이템', '할 일', 'todo', 'action items', 'actionitems', '후속 조치', '후속조치'),
  ],
  requirement: [
    section('목적', '범위', '개요', 'purpose', 'scope', 'overview'),
    section('요구사항', '요건', 'requirements'),
    section('수용 기준', '수용기준', '완료 조건', '완료조건', 'acceptance criteria', 'acceptancecriteria', 'dod'),
  ],
  design: [
    section('배경', '문제', '문제 정의', '문제정의', 'background', 'problem', 'context'),
    section('결정', '설계', '해결 방안', '해결방안', 'decision', 'design', 'solution'),
    section('대안', '트레이드오프', '검토한 대안', 'alternatives', 'tradeoffs', 'trade-offs'),
  ],
  guide: [
    section('대상', '대상 독자', '대상독자', 'audience', 'who'),
    section('전제조건', '전제 조건', '사전 준비', '사전준비', 'prerequisites', 'requirements'),
    section('단계', '절차', '방법', 'steps', 'procedure', 'how to', 'howto'),
  ],
  'api-doc': [
    section('엔드포인트', '경로', 'endpoint', 'endpoints', 'path', 'url'),
    section('파라미터', '요청', '인자', 'parameters', 'params', 'request'),
    section('응답', '반환', 'response', 'responses', 'returns'),
    section('예시', '예제', 'example', 'examples', 'sample'),
  ],
  troubleshooting: [
    section('증상', '현상', 'symptom', 'symptoms', 'issue'),
    section('원인', '분석', 'cause', 'root cause', 'rootcause', 'analysis'),
    section('해결', '조치', '해결 방법', '해결방법', 'resolution', 'solution', 'fix'),
  ],
  reference: [section('정의', '설명', '용어', 'definition', 'definitions', 'terms')],
  unknown: [],
}
