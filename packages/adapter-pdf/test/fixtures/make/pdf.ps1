$ErrorActionPreference = 'Stop'
$dir = Split-Path $PSScriptRoot -Parent

# 이 환경의 Word는 SaveAs도 ExportAsFixedFormat도 응답하지 않는다.
# PowerPoint의 PDF 내보내기는 정상이므로 그쪽으로 만든다. 글자 크기는 그대로 PDF에 실린다.
$ppt = New-Object -ComObject PowerPoint.Application
$pres = $ppt.Presentations.Add(1)

function Add-Box($slide, $top, $height, $size, $text) {
  $box = $slide.Shapes.AddTextbox(1, 40, $top, 880, $height)
  $frame = $box.TextFrame
  $frame.AutoSize = 0      # ppAutoSizeNone. 자동 축소가 걸리면 크기 대비가 무너진다.
  $frame.WordWrap = -1
  $frame.TextRange.Text = $text
  $frame.TextRange.Font.Size = $size
  return $box
}

# 1) 텍스트 PDF — 제목은 본문의 두 배 크기로 두어 크기만으로 구분되게 한다.
$s1 = $pres.Slides.Add(1, 12)   # ppLayoutBlank
Add-Box $s1 40 40 24 '배포 절차' | Out-Null
Add-Box $s1 90 60 11 "이 문서는 사내 배포 도구의 실행 절차를 설명합니다.`r각 단계는 순서대로 수행합니다." | Out-Null
Add-Box $s1 200 40 24 '사전 확인' | Out-Null
Add-Box $s1 250 60 11 "배포 대상 서버 목록과 접근 권한을 먼저 확인합니다.`r실패하면 롤백 절차를 따릅니다." | Out-Null

$pres.SaveAs((Join-Path $dir 'guide.pdf'), 32)   # ppSaveAsPDF
$pres.Close()

# 2) 이미지만 있는 스캔 PDF
Add-Type -AssemblyName System.Drawing
$png = Join-Path $env:TEMP 'ai-lint-scan.png'
$bmp = New-Object System.Drawing.Bitmap 800, 300
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::White)
$font = New-Object System.Drawing.Font 'Malgun Gothic', 28
$g.DrawString('스캔된 문서입니다', $font, [System.Drawing.Brushes]::Black, 40, 100)
$g.Dispose()
$bmp.Save($png, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

$pres2 = $ppt.Presentations.Add(1)
$s2 = $pres2.Slides.Add(1, 12)
$s2.Shapes.AddPicture($png, 0, -1, 80, 120, 800, 300) | Out-Null
$pres2.SaveAs((Join-Path $dir 'scanned.pdf'), 32)
$pres2.Close()
Remove-Item $png

$ppt.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($ppt) | Out-Null
Write-Output "wrote $dir"
