$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_flatopc.ps1')

$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'guide.docx'

# Selection은 활성 창을 요구해서 자동화에서 멈춘다. Range와 Paragraph만 쓴다.
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0   # wdAlertsNone

$doc = $word.Documents.Add()
$r = $doc.Content
$r.InsertAfter("설치 가이드`r")
$r.InsertAfter("이 문서는 사내 배포 도구 설치 절차를 설명합니다.`r")
$r.InsertAfter("사전 준비물`r")
$r.InsertAfter("관리자 권한 계정`r")
$r.InsertAfter("사내 네트워크 접속`r")

$doc.Paragraphs.Item(1).Style = $doc.Styles.Item(-2)   # wdStyleHeading1

# 스타일 없이 굵게·크게만 준 가짜 제목 — STR013 대상
$fake = $doc.Paragraphs.Item(3).Range
$fake.Font.Bold = $true
$fake.Font.Size = 16

$bullets = $doc.Range($doc.Paragraphs.Item(4).Range.Start, $doc.Paragraphs.Item(5).Range.End)
$bullets.ListFormat.ApplyBulletDefault()

$table = $doc.Tables.Add($doc.Paragraphs.Item($doc.Paragraphs.Count).Range, 3, 2)
$table.Cell(1, 1).Range.Text = '항목'
$table.Cell(1, 2).Range.Text = '값'
$table.Cell(2, 1).Range.Text = '최소 메모리'
$table.Cell(2, 2).Range.Text = '8GB'
$table.Cell(3, 1).Range.Text = '디스크'
$table.Cell(3, 2).Range.Text = '2GB'
$table.Rows.Item(1).Range.Font.Bold = $true
$table.Rows.Item(1).HeadingFormat = $true

$xml = $doc.Content.WordOpenXML
$doc.Close(0)
$word.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null

Save-FlatOpc -Xml $xml -Path $out -Title '설치 가이드'
Write-Output "wrote $out"
