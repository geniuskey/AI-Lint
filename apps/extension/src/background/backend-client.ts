import type { LintOptions, LintReport } from '@ai-lint/contract'
import type { DocType, Document } from '@ai-lint/ir'
import type { BackendErrorKind } from '../shared/messages.js'
import { isConfigured, type Settings } from '../shared/settings.js'

const MESSAGES: Record<BackendErrorKind, string> = {
  unconfigured: '옵션에서 백엔드 주소와 서비스 토큰을 먼저 설정하세요.',
  unauthorized: '서비스 토큰이 올바르지 않습니다. 옵션에서 다시 확인하세요.',
  forbidden: '이 문서를 검사할 권한이 없습니다.',
  quota: '오늘 AI 검사 한도를 다 썼습니다. 규칙 검사 결과만 표시합니다.',
  offline: '백엔드에 연결하지 못했습니다.',
  server: '백엔드에서 오류가 발생했습니다.',
}

export class BackendError extends Error {
  readonly kind: BackendErrorKind

  constructor(kind: BackendErrorKind, message: string = MESSAGES[kind]) {
    super(message)
    this.name = 'BackendError'
    this.kind = kind
  }
}

export function kindOfStatus(status: number): BackendErrorKind {
  if (status === 401) return 'unauthorized'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'quota'
  return 'server'
}

function headersFor(settings: Settings): Record<string, string> {
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

async function post(path: string, body: unknown, settings: Settings, fetchImpl: typeof fetch): Promise<Response> {
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
    throw new BackendError(kind, (await detailOf(response)) ?? MESSAGES[kind])
  }
  return response
}

export async function requestLint(
  document: Document,
  options: Partial<LintOptions>,
  settings: Settings,
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

export async function saveDocTypeOverride(
  uri: string,
  docType: DocType,
  settings: Settings,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  await post('/v1/doctype-overrides', { uri, docType }, settings, fetchImpl)
}
