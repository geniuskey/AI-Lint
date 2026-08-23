import type { LintOptions, LintReport, TraceReport, TraceRequest } from '@ai-lint/contract'
import type { DocType, Document } from '@ai-lint/ir'
import { BACKEND_ERROR_MESSAGES, BackendError, kindOfStatus } from './errors.js'

/** 확장과 데스크톱 앱이 백엔드를 부르는 데 필요한 최소 설정. 각자의 설정 타입이 이것을 포함한다. */
export interface BackendSettings {
  backendUrl: string
  serviceToken: string
  /** 백엔드 쿼터 집계 단위. 비우면 anonymous로 집계된다. */
  userId: string
  rulesetId: string
}

export const isConfigured = (settings: BackendSettings): boolean =>
  settings.backendUrl.length > 0 && settings.serviceToken.length > 0

function headersFor(settings: BackendSettings): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-AI-Lint-Token': settings.serviceToken,
    ...(settings.userId ? { 'X-AI-Lint-User': settings.userId } : {}),
  }
}

/** 백엔드는 오류를 `{ error }`로 준다. 사용자에게는 그 문장이 기본 안내보다 훨씬 쓸모 있다. */
async function detailOf(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : null
  } catch {
    return null
  }
}

async function post(
  path: string,
  body: unknown,
  settings: BackendSettings,
  fetchImpl: typeof fetch,
): Promise<Response> {
  if (!isConfigured(settings)) throw new BackendError('unconfigured')

  let response: Response
  try {
    response = await fetchImpl(`${settings.backendUrl}${path}`, {
      method: 'POST',
      headers: headersFor(settings),
      body: JSON.stringify(body),
    })
  } catch {
    throw new BackendError('offline')
  }

  if (!response.ok) {
    const kind = kindOfStatus(response.status)
    throw new BackendError(kind, (await detailOf(response)) ?? BACKEND_ERROR_MESSAGES[kind])
  }
  return response
}

export async function requestLint(
  document: Document,
  options: Partial<LintOptions>,
  settings: BackendSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<LintReport> {
  const response = await post(
    '/v1/lint',
    { document, options: { rulesetId: settings.rulesetId, ...options } },
    settings,
    fetchImpl,
  )
  return (await response.json()) as LintReport
}

export async function requestTrace(
  options: Partial<TraceRequest>,
  settings: BackendSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<TraceReport> {
  const response = await post('/v1/trace/analyze', options, settings, fetchImpl)
  return (await response.json()) as TraceReport
}

export async function saveDocTypeOverride(
  uri: string,
  docType: DocType,
  settings: BackendSettings,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await post('/v1/doctype-overrides', { uri, docType }, settings, fetchImpl)
}
