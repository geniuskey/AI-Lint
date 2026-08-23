import { LintRequestSchema } from '@ai-lint/contract'
import { toIndexEntry, type TraceConfig } from '@ai-lint/trace'
import type { FastifyPluginAsync } from 'fastify'
import { lintDocument, type LintDeps } from '../services/lint-service.js'
import type { TraceIndexStore } from '../services/trace-index.js'

export interface LintTraceDeps {
  index: TraceIndexStore
  config: TraceConfig
}

export function lintRoutes(deps: LintDeps, trace: LintTraceDeps): FastifyPluginAsync {
  return async (app) => {
    app.post('/v1/lint', async (request) => {
      const { document, options } = LintRequestSchema.parse(request.body)
      const report = await lintDocument(document, options, deps, request.userId)

      try {
        // 유형은 리포트 쪽이 사용자 지정을 반영한 확정값이다.
        await trace.index.upsert(
          toIndexEntry(
            { ...document, docType: { ...document.docType, value: report.docType } },
            report.documentHash,
            trace.config,
          ),
        )
      } catch (cause) {
        // 색인이 실패해도 검사 결과는 돌려준다.
        request.log.warn({ err: cause }, '추적성 인덱스 갱신 실패')
      }

      return report
    })
  }
}
