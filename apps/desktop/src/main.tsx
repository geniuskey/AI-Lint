import { setPdfWorkerSrc } from '@ai-lint/adapter-pdf'
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './styles.css'

// pdf.js는 브라우저에서 워커 없이 돌지 않는다. 지정하지 않으면 PDF만 통째로 검사에 실패한다.
setPdfWorkerSrc(pdfWorkerUrl)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
