export type BackendErrorKind =
  | 'unconfigured'
  | 'unauthorized'
  | 'forbidden'
  | 'quota'
  | 'offline'
  | 'server'

export const BACKEND_ERROR_MESSAGES: Record<BackendErrorKind, string> = {
  unconfigured: '옵션에서 백엔드 주소와 서비스 토큰을 먼저 설정하세요.',
  unauthorized: '서비스 토큰이 올바르지 않습니다. 옵션에서 다시 확인하세요.',
  forbidden: '이 문서를 검사할 권한이 없습니다.',
  quota: '오늘 AI 검사 한도를 다 썼습니다. 규칙 검사 결과만 표시합니다.',
  offline: '백엔드에 연결하지 못했습니다.',
  server: '백엔드에서 오류가 발생했습니다.',
}

export class BackendError extends Error {
  readonly kind: BackendErrorKind

  constructor(kind: BackendErrorKind, message: string = BACKEND_ERROR_MESSAGES[kind]) {
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
