import type { LintReport } from '@ai-lint/contract'
import type { DocType, Document } from '@ai-lint/ir'
import { PORT_NAME, type ContentMessage, type WorkerMessage } from '../shared/messages.js'
import { daysAgo, readCached, writeCached } from '../shared/report-cache.js'
import { loadSettings } from '../shared/settings.js'
import { checkLinks } from './link-check.js'
import { findBaseUrl, findPageId, PageReadError, readPage } from './page-reader.js'
import { mountPanel, type Panel } from './panel/panel.js'

const PHASE_STATUS = { rules: '규칙 검사 중…', llm: 'AI 맥락 검사 중…' } as const

let running = false

function send(panel: Panel, message: ContentMessage, onReport: (report: LintReport) => void): Promise<void> {
  return new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: PORT_NAME })
    port.onDisconnect.addListener(() => resolve())
    port.onMessage.addListener((incoming: WorkerMessage) => {
      switch (incoming.type) {
        case 'progress':
          panel.setStatus(PHASE_STATUS[incoming.phase])
          return
        case 'report':
          panel.setStatus('')
          onReport(incoming.report)
          return
        case 'error':
          panel.setBanner(incoming.message, incoming.kind === 'quota' ? 'warn' : 'error')
          panel.setStatus('')
          return
        case 'doctype-saved':
          port.disconnect()
          resolve()
          return
        case 'done':
          port.disconnect()
          resolve()
      }
    })
    port.postMessage(message)
  })
}

async function applyReport(panel: Panel, report: LintReport): Promise<void> {
  panel.setScore(report.score)
  panel.setDocType(report.docType)
  if (report.truncated) panel.setBanner('문서가 너무 커서 앞부분만 검사했습니다.', 'warn')
  await writeCached(chrome.storage.local, report.documentUri, {
    grade: report.score.grade,
    total: report.score.total,
    createdAt: report.createdAt,
  })
  panel.setBadge(report.score.grade)
}

async function run(panel: Panel): Promise<void> {
  if (running) return
  running = true
  panel.setBanner('', null)
  panel.setStatus('페이지를 읽는 중…')

  try {
    const raw = await readPage(document)
    const doc: Document = await checkLinks(raw, { baseUrl: findBaseUrl(document) })
    await send(panel, { type: 'lint', document: doc }, (report) => void applyReport(panel, report))
  } catch (error) {
    panel.setStatus('')
    panel.setBanner(error instanceof PageReadError ? error.message : '검사에 실패했습니다.', 'error')
  } finally {
    running = false
  }
}

async function changeDocType(panel: Panel, docType: DocType): Promise<void> {
  panel.setStatus('문서 유형을 저장하는 중…')
  await send(panel, { type: 'set-doctype', uri: location.href, docType }, () => {})
  panel.setStatus('')
  await run(panel)
}

async function init(): Promise<void> {
  if (!findPageId(document)) return

  const panel: Panel = mountPanel(document.body, {
    onRun: () => void run(panel),
    onDocTypeChange: (docType) => void changeDocType(panel, docType),
  })

  const cached = await readCached(chrome.storage.local, location.href)
  if (cached) {
    panel.setBadge(cached.grade)
    const days = daysAgo(cached.createdAt, new Date())
    panel.setStatus(days === 0 ? '오늘 검사한 결과가 있습니다.' : `${days}일 전 검사 결과가 있습니다.`)
  }

  const settings = await loadSettings(chrome.storage.sync)
  if (settings.autoRun) {
    panel.open()
    await run(panel)
  }
}

void init()
