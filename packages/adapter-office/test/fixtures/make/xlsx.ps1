$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_scrub.ps1')

$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'report.xlsx'
if (Test-Path $out) { Remove-Item $out }

$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false

$book = $excel.Workbooks.Add()

while ($book.Worksheets.Count -lt 3) { $book.Worksheets.Add() | Out-Null }

$s1 = $book.Worksheets.Item(1)
$s1.Name = '요구사항'
$s1.Range('A1').Value2 = 'ID'
$s1.Range('B1').Value2 = '요구사항'
$s1.Range('C1').Value2 = '우선순위'
$s1.Range('A2').Value2 = 'REQ-001'
$s1.Range('B2').Value2 = '결제 수단을 추가할 수 있어야 한다'
$s1.Range('C2').Value2 = 1
$s1.Range('A3').Value2 = 'REQ-002'
$s1.Range('B3').Value2 = '결제 실패 시 사유를 보여준다'
$s1.Range('C3').Value2 = 2
$s1.Range('A4').Value2 = 'REQ-003'
$s1.Range('B4').Value2 = '환불은 관리자만 승인한다'
$s1.Range('C4').Value2 = 1

$s2 = $book.Worksheets.Item(2)
$s2.Name = '집계'
$s2.Range('A1:B1').Merge()
$s2.Range('A1').Value2 = '2026년 상반기 집계'
$s2.Range('A2').Value2 = '완료'
$s2.Range('B2').Value2 = 12
$s2.Range('A3').Value2 = '진행'
$s2.Range('B3').Value2 = 5

$book.Worksheets.Item(3).Name = '빈시트'

# PowerShell은 BuiltinDocumentProperties의 인덱서를 직접 못 부른다.
$flags = 'System.Reflection.BindingFlags' -as [type]
function Set-DocProperty($book, $name, $value) {
  $props = $book.BuiltinDocumentProperties
  $prop = [System.__ComObject].InvokeMember('Item', $flags::GetProperty, $null, $props, @($name))
  [System.__ComObject].InvokeMember('Value', $flags::SetProperty, $null, $prop, @($value)) | Out-Null
}
Set-DocProperty $book 'Title' '결제 모듈 요구사항'
Set-DocProperty $book 'Author' '테스터'

$book.SaveAs($out, 51)
$book.Close($false)
$excel.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null

Set-LastModifiedBy -Path $out
Write-Output "wrote $out"
