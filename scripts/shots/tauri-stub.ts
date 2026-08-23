export interface TauriStubInit {
  /** `read_settings`가 돌려줄 JSON 문자열. */
  settings: string
  token: string
  /** `plugin:dialog|open`이 돌려줄 경로 목록. */
  pick: string[]
}

/**
 * 데스크톱 앱은 Tauri 셸 안에서만 동작한다. 스크린샷은 브라우저에서 찍으므로
 * IPC 계층만 대신 채워 넣는다. HTTP와 파일 읽기는 페이지 밖(Node)으로 넘겨서
 * CORS 없이 실제 백엔드와 실제 파일을 그대로 쓴다.
 */
export const tauriStub = (init: TauriStubInit): string => `
(() => {
  const init = ${JSON.stringify(init)}
  const pending = new Map()
  const bodies = new Map()
  let nextRid = 1

  const toBytes = (base64) => {
    const raw = atob(base64)
    const bytes = new Uint8Array(raw.length)
    for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
    return bytes
  }

  const invoke = async (cmd, args) => {
    try {
      return await run(cmd, args)
    } catch (cause) {
      console.error('[stub] ' + cmd + ': ' + (cause && cause.message))
      throw cause
    }
  }

  const run = async (cmd, args) => {
    const a = args || {}
    switch (cmd) {
      case 'read_settings':
        return init.settings
      case 'read_token':
        return init.token
      case 'write_settings':
      case 'write_token':
      case 'save_file':
        return null
      case 'list_dir':
        return []
      case 'read_document':
        return toBytes(await window.__shotRead(a.path))
      case 'plugin:dialog|open':
        return a.options && a.options.directory ? null : init.pick
      case 'plugin:dialog|save':
        return null
      case 'plugin:http|fetch': {
        const rid = nextRid++
        pending.set(rid, a.clientConfig)
        return rid
      }
      case 'plugin:http|fetch_send': {
        const config = pending.get(a.rid)
        pending.delete(a.rid)
        const res = await window.__shotFetch(config)
        bodies.set(a.rid, res.body)
        return { status: res.status, statusText: res.statusText, url: res.url, headers: res.headers, rid: a.rid }
      }
      case 'plugin:http|fetch_read_body': {
        const data = bodies.get(a.rid)
        if (data === undefined) return [1]
        bodies.delete(a.rid)
        return [...data, 0]
      }
      case 'plugin:http|fetch_cancel':
      case 'plugin:http|fetch_cancel_body':
        return null
      default:
        throw new Error('스크린샷 스텁이 모르는 커맨드입니다: ' + cmd)
    }
  }

  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: (callback) => callback,
    convertFileSrc: (path) => path,
  }
})()
`

export interface StubRequest {
  method: string
  url: string
  headers: Array<[string, string]>
  data: number[] | null
}

export interface StubResponse {
  status: number
  statusText: string
  url: string
  headers: Record<string, string>
  body: number[]
}

const DROPPED = new Set(['host', 'connection', 'content-length'])

/** 페이지 밖에서 진짜 요청을 보낸다. 브라우저가 아니므로 CORS가 걸리지 않는다. */
export async function stubFetch(request: StubRequest): Promise<StubResponse> {
  const headers = new Headers()
  for (const [name, value] of request.headers) {
    if (!DROPPED.has(name.toLowerCase())) headers.set(name, value)
  }

  let response: Response
  try {
    response = await fetch(request.url, {
      method: request.method,
      headers,
      body: request.data === null ? null : new Uint8Array(request.data),
    })
  } catch (cause) {
    throw new Error(`${request.method} ${request.url} 실패: ${String((cause as Error).cause ?? cause)}`)
  }

  return {
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    headers: Object.fromEntries(response.headers.entries()),
    body: [...new Uint8Array(await response.arrayBuffer())],
  }
}
