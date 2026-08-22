import { defineRule, num } from '../define.js'

export const str006 = defineRule('STR006', (ctx) => {
  const minLines = num(ctx.options, 'minLines', 3)

  return ctx.doc.blocks.flatMap((block) => {
    if (block.kind !== 'code' || block.lang) return []
    const lines = block.text.split('\n').length
    if (lines < minLines) return []

    return [
      {
        blockId: block.id,
        message: `${lines}줄짜리 코드블록에 언어가 지정되지 않았습니다`,
        why: '언어 표시가 없으면 AI는 이 블록이 코드인지 로그인지 설정 파일인지 구분하지 못합니다. 코드로 인용해야 할 내용을 산문처럼 요약해버립니다.',
        evidence: block.text.slice(0, 60),
      },
    ]
  })
})
