$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_scrub.ps1')

$out = Join-Path (Split-Path $PSScriptRoot -Parent) 'deck.pptx'
if (Test-Path $out) { Remove-Item $out }

# PowerPoint는 창 없이 동작하지 않는다. Visible을 끄면 대부분의 호출이 실패한다.
$ppt = New-Object -ComObject PowerPoint.Application
$pres = $ppt.Presentations.Add(1)

# 1번: 제목 + 글머리 기호 본문 + 발표자 노트
$s1 = $pres.Slides.Add(1, 2)   # ppLayoutText
$s1.Shapes.Item(1).TextFrame.TextRange.Text = '분기 리뷰'
$s1.Shapes.Item(2).TextFrame.TextRange.Text = "매출 12% 증가`r월간 활성 사용자 3만명`r이탈률 4%p 감소"
$s1.NotesPage.Shapes.Item(2).TextFrame.TextRange.Text = '수치는 8월 1일 기준입니다.'

# 2번: 제목 없음 + 그룹 도형 안에 텍스트 두 개
$s2 = $pres.Slides.Add(2, 12)  # ppLayoutBlank
$a = $s2.Shapes.AddTextbox(1, 60, 60, 300, 40)
$a.TextFrame.TextRange.Text = '왼쪽 상자 내용'
$b = $s2.Shapes.AddTextbox(1, 60, 140, 300, 40)
$b.TextFrame.TextRange.Text = '오른쪽 상자 내용'
$s2.Shapes.Range(@($a.Name, $b.Name)).Group() | Out-Null

# 3번: 제목 + 표
$s3 = $pres.Slides.Add(3, 11)  # ppLayoutTitleOnly
$s3.Shapes.Item(1).TextFrame.TextRange.Text = '지표 요약'
$table = $s3.Shapes.AddTable(3, 2).Table
$table.Cell(1, 1).Shape.TextFrame.TextRange.Text = '지표'
$table.Cell(1, 2).Shape.TextFrame.TextRange.Text = '값'
$table.Cell(2, 1).Shape.TextFrame.TextRange.Text = '매출'
$table.Cell(2, 2).Shape.TextFrame.TextRange.Text = '12억'
$table.Cell(3, 1).Shape.TextFrame.TextRange.Text = 'MAU'
$table.Cell(3, 2).Shape.TextFrame.TextRange.Text = '3만'

# PowerShell은 BuiltInDocumentProperties의 인덱서를 직접 못 부른다.
$flags = 'System.Reflection.BindingFlags' -as [type]
function Set-DocProperty($pres, $name, $value) {
  $props = $pres.BuiltInDocumentProperties
  $prop = [System.__ComObject].InvokeMember('Item', $flags::GetProperty, $null, $props, @($name))
  [System.__ComObject].InvokeMember('Value', $flags::SetProperty, $null, $prop, @($value)) | Out-Null
}
Set-DocProperty $pres 'Title' '분기 리뷰'
Set-DocProperty $pres 'Author' '테스터'

$pres.SaveAs($out, 24)   # ppSaveAsOpenXMLPresentation
$pres.Close()
$ppt.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null

Set-LastModifiedBy -Path $out
Write-Output "wrote $out"
