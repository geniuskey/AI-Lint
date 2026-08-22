import { PORT_NAME, type ContentMessage, type WorkerMessage } from '../shared/messages.js'
import { loadSettings } from '../shared/settings.js'
import { requestLint, saveDocTypeOverride } from './backend-client.js'
import { runLint } from './lint-runner.js'

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return

  // 사용자가 패널을 닫거나 페이지를 떠나면 포트가 끊긴다. 끊긴 포트에 쓰면 예외가 난다.
  let alive = true
  port.onDisconnect.addListener(() => {
    alive = false
  })
  const emit = (message: WorkerMessage): void => {
    if (alive) port.postMessage(message)
  }

  port.onMessage.addListener((message: ContentMessage) => {
    void handle(message, emit)
  })
})

async function handle(message: ContentMessage, emit: (message: WorkerMessage) => void): Promise<void> {
  const settings = await loadSettings(chrome.storage.sync)

  if (message.type === 'set-doctype') {
    try {
      await saveDocTypeOverride(message.uri, message.docType, settings)
      emit({ type: 'doctype-saved' })
    } catch (error) {
      emit({ type: 'error', phase: 'rules', kind: 'server', message: (error as Error).message })
      emit({ type: 'done' })
    }
    return
  }

  await runLint(
    message.document,
    { settings, request: (document, options) => requestLint(document, options, settings) },
    emit,
  )
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.runtime.openOptionsPage()
})
