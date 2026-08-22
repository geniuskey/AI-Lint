import type { DocType, Document } from '@ai-lint/ir'

/** 스펙 5.2절 2번. 사내에서 실제로 쓰는 라벨을 추가할 자리다. */
const LABEL_DOCTYPES: Record<string, DocType> = {
  'meeting-notes': 'meeting-notes',
  meetingnotes: 'meeting-notes',
  minutes: 'meeting-notes',
  retrospective: 'meeting-notes',
  회의록: 'meeting-notes',
  회의: 'meeting-notes',
  requirement: 'requirement',
  requirements: 'requirement',
  prd: 'requirement',
  요구사항: 'requirement',
  design: 'design',
  adr: 'design',
  architecture: 'design',
  설계: 'design',
  guide: 'guide',
  howto: 'guide',
  manual: 'guide',
  runbook: 'guide',
  가이드: 'guide',
  api: 'api-doc',
  'api-doc': 'api-doc',
  apidoc: 'api-doc',
  troubleshooting: 'troubleshooting',
  postmortem: 'troubleshooting',
  incident: 'troubleshooting',
  장애: 'troubleshooting',
  reference: 'reference',
  glossary: 'reference',
  policy: 'reference',
  용어집: 'reference',
}

/** 스펙 5.2절 3번. 블루프린트 키는 모듈 전체 경로로 오므로 부분 일치로 본다. */
const BLUEPRINT_DOCTYPES: Array<[string, DocType]> = [
  ['meeting-notes', 'meeting-notes'],
  ['retrospective', 'meeting-notes'],
  ['requirements', 'requirement'],
  ['decision', 'design'],
  ['how-to-article', 'guide'],
  ['troubleshooting-article', 'troubleshooting'],
]

const normalize = (label: string): string => label.trim().toLowerCase().replace(/\s+/g, '-')

export function detectDocType(labels: string[], properties: Record<string, unknown>): Document['docType'] {
  for (const label of labels) {
    const matched = LABEL_DOCTYPES[normalize(label)]
    if (matched) return { value: matched, confidence: 0.9, origin: 'label' }
  }

  const serialized = JSON.stringify(properties).toLowerCase()
  for (const [key, value] of BLUEPRINT_DOCTYPES) {
    if (serialized.includes(key)) return { value, confidence: 0.8, origin: 'template' }
  }

  // origin을 llm으로 두면 백엔드가 LLM 추론을 돌린다 (스펙 5.2절 4번).
  return { value: 'unknown', confidence: 0, origin: 'llm' }
}
