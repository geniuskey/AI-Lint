import { docxToDocument, pptxToDocument, xlsxToDocument } from '@ai-lint/adapter-office'
import { pdfToDocument } from '@ai-lint/adapter-pdf'
import type { Document, FileContext } from '@ai-lint/ir'
import type { DocumentFile } from './collect.js'

export interface DocReader {
  read(path: string): Promise<Uint8Array>
}

export async function parseDocument(reader: DocReader, file: DocumentFile): Promise<Document> {
  const bytes = await reader.read(file.path)
  const ctx: FileContext = {
    uri: file.path,
    ...(file.modifiedAt === undefined ? {} : { modifiedAt: file.modifiedAt }),
  }
  switch (file.ext) {
    case 'pptx':
      return pptxToDocument(bytes, ctx)
    case 'docx':
      return docxToDocument(bytes, ctx)
    case 'xlsx':
      return xlsxToDocument(bytes, ctx)
    case 'pdf':
      return pdfToDocument(bytes, ctx)
  }
}
