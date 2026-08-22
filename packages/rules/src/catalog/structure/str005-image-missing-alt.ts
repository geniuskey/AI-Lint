import { defineRule } from '../define.js'

const FILENAME = /\.(png|jpe?g|gif|svg|webp|bmp)$/i
const PLACEHOLDER = /^(image|img|screenshot|picture|캡처|캡쳐|그림|이미지|스크린샷)[\s_-]*\d*$/i

/** 파일명이나 "image1" 같은 자리표시자는 대체 텍스트로 치지 않는다. */
export const isMeaningfulAlt = (alt: string | undefined): boolean => {
  const t = alt?.trim() ?? ''
  return t.length >= 3 && !FILENAME.test(t) && !PLACEHOLDER.test(t)
}

export const str005 = defineRule('STR005', (ctx) =>
  ctx.doc.blocks.flatMap((block) => {
    if (block.kind !== 'image') return []
    if (isMeaningfulAlt(block.alt) || isMeaningfulAlt(block.caption)) return []

    return [
      {
        blockId: block.id,
        message: block.alt
          ? `대체 텍스트 "${block.alt}"가 내용을 설명하지 않습니다`
          : '이미지에 대체 텍스트와 캡션이 모두 없습니다',
        why: 'AI는 이미지를 읽지 못합니다. 설명이 없으면 이 이미지가 담은 정보는 문서에 존재하지 않는 것과 같습니다.',
        evidence: block.alt ?? block.assetRef,
        suggestion: {
          before: block.alt ?? '(대체 텍스트 없음)',
          after: '이미지가 무엇을 보여주는지 한 문장으로 적으세요. 예: "결제 승인 요청부터 정산까지의 흐름도"',
        },
      },
    ]
  }),
)
