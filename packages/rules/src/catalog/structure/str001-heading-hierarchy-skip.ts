import { headings } from '@ai-lint/ir'
import { defineRule } from '../define.js'

export const str001 = defineRule('STR001', (ctx) => {
  const hs = headings(ctx.doc)
  const findings = []

  for (let i = 1; i < hs.length; i++) {
    const prev = hs[i - 1]!
    const cur = hs[i]!
    if (cur.level <= prev.level + 1) continue
    findings.push({
      blockId: cur.id,
      message: `제목 레벨이 h${prev.level}에서 h${cur.level}로 건너뜁니다`,
      why: '제목 계층은 AI가 문서를 청크로 나눌 때 쓰는 뼈대입니다. 레벨을 건너뛰면 상위-하위 관계가 끊겨 잘못된 단위로 잘립니다.',
      evidence: cur.text,
      suggestion: { before: `h${cur.level}: ${cur.text}`, after: `h${prev.level + 1}: ${cur.text}` },
    })
  }

  return findings
})
