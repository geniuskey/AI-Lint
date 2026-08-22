import { headings } from '@ai-lint/ir'
import { REQUIRED_SECTIONS, type RequiredSection } from '../../doctype.js'
import { defineRule } from '../define.js'

const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, '')

const isPresent = (required: RequiredSection, headingTexts: string[]): boolean =>
  required.synonyms.some((syn) => headingTexts.some((h) => h.includes(normalize(syn))))

export const meta007 = defineRule('META007', (ctx) => {
  const required = REQUIRED_SECTIONS[ctx.doc.docType.value]
  if (required.length === 0) return []

  const headingTexts = headings(ctx.doc).map((h) => normalize(h.text))
  const missing = required.filter((r) => !isPresent(r, headingTexts))
  if (missing.length === 0) return []

  const labels = missing.map((m) => m.label)
  return [
    {
      blockId: null,
      message: `${ctx.doc.docType.value} 유형에 필요한 섹션이 빠졌습니다: ${labels.join(', ')}`,
      why: '같은 유형의 문서가 같은 골격을 가지면 AI가 여러 문서를 가로질러 같은 항목을 비교할 수 있습니다. 골격이 어긋난 문서는 그 비교에서 빠집니다.',
      suggestion: { before: '(누락)', after: `다음 섹션을 추가하세요: ${labels.join(', ')}` },
    },
  ]
})
