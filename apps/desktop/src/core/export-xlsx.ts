import { AXIS_LABELS, SEVERITY_LABELS } from '@ai-lint/labels'
import { strToU8, zipSync } from 'fflate'
import { countBySeverity, describeAnchor, sortFindings } from './describe.js'
import type { JobState } from './lint-file.js'

const XML_ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

/** XML 1.0이 허용하지 않는 제어 문자는 Excel이 파일 전체를 거부하게 만든다. */
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g')

const escapeXml = (text: string): string =>
  text.replace(CONTROL_CHARS, '').replace(/[&<>"]/g, (ch) => XML_ENTITIES[ch]!)

const COLUMNS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const colNameOf = (index: number): string => {
  let name = ''
  let n = index
  do {
    name = COLUMNS[n % 26]! + name
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return name
}

type CellValue = string | number

const cellXml = (value: CellValue, ref: string): string =>
  typeof value === 'number'
    ? `<c r="${ref}"><v>${value}</v></c>`
    : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`

const sheetXml = (rows: readonly CellValue[][]): string =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows
    .map(
      (cells, r) =>
        `<row r="${r + 1}">${cells.map((cell, c) => cellXml(cell, `${colNameOf(c)}${r + 1}`)).join('')}</row>`,
    )
    .join('')}</sheetData></worksheet>`

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function summaryRows(jobs: readonly JobState[]): CellValue[][] {
  const rows: CellValue[][] = [['파일', '경로', '점수', '등급', '오류', '경고', '정보', '상태']]
  for (const job of jobs) {
    if (job.report === null) {
      rows.push([job.file.name, job.file.path, 0, '-', 0, 0, 0, job.error ?? '실패'])
      continue
    }
    const counts = countBySeverity(job.report.findings)
    rows.push([
      job.file.name, job.file.path, job.report.score.total, job.report.score.grade,
      counts.error, counts.warning, counts.info, '완료',
    ])
  }
  return rows
}

function findingRows(jobs: readonly JobState[]): CellValue[][] {
  const rows: CellValue[][] = [['파일', '심각도', '규칙', '축', '위치', '내용', '이유', '수정 제안']]
  for (const job of jobs) {
    if (job.report === null) continue
    for (const finding of sortFindings(job.report.findings)) {
      rows.push([
        job.file.name, SEVERITY_LABELS[finding.severity], finding.ruleId, AXIS_LABELS[finding.axis],
        describeAnchor(finding.anchor), finding.message, finding.why,
        finding.suggestion === null ? '' : finding.suggestion.after,
      ])
    }
  }
  return rows
}

export function toXlsx(jobs: readonly JobState[]): Uint8Array {
  const sheets = [
    { name: '요약', rows: summaryRows(jobs) },
    { name: '지적', rows: findingRows(jobs) },
  ]

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${sheets
  .map(
    (_sheet, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('')}
</Types>`),

    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="${REL_NS}/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),

    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${REL_NS}">
<sheets>${sheets
      .map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets>
</workbook>`),

    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_sheet, i) =>
      `<Relationship Id="rId${i + 1}" Type="${REL_NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('')}
</Relationships>`),
  }

  for (const [i, sheet] of sheets.entries()) {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(sheet.rows))
  }

  return zipSync(files, { level: 6 })
}
