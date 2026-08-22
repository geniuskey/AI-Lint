import { defineRule } from '../define.js'

// 링크 확인은 사용자 권한으로 클라이언트가 수행해 IR의 status에 채워 보낸다.
export const meta006 = defineRule('META006', (ctx) =>
  ctx.doc.links
    .filter((l) => l.status === 'broken')
    .map((l) => ({
      blockId: l.blockId,
      message: `링크가 깨졌습니다: ${l.text || l.href}`,
      why: '깨진 링크는 근거가 사라졌다는 신호입니다. 이 문서를 인용하는 답변은 확인할 수 없는 출처를 달게 됩니다.',
      evidence: l.href,
      suggestion: { before: l.href, after: '옮겨간 문서로 링크를 갱신하거나, 사라졌다면 해당 문장을 정리하세요.' },
    })),
)
