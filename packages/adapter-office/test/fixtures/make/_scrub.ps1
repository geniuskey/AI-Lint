Add-Type -AssemblyName System.IO.Compression.FileSystem

# Office는 저장할 때 cp:lastModifiedBy에 Windows 사용자 이름을 박는다.
# 픽스처는 저장소에 그대로 커밋되므로 중립적인 이름으로 바꿔 둔다.
function Set-LastModifiedBy {
  param([string]$Path, [string]$Name = '테스터')

  $zip = [System.IO.Compression.ZipFile]::Open($Path, 'Update')
  try {
    $entry = $zip.GetEntry('docProps/core.xml')
    if ($null -eq $entry) { return }

    $stream = $entry.Open()
    $reader = New-Object System.IO.StreamReader($stream)
    $xml = $reader.ReadToEnd()
    $reader.Dispose()

    $xml = $xml -replace '<cp:lastModifiedBy>[^<]*</cp:lastModifiedBy>', "<cp:lastModifiedBy>$Name</cp:lastModifiedBy>"

    $stream = $entry.Open()
    $stream.SetLength(0)
    $writer = New-Object System.IO.StreamWriter($stream, (New-Object System.Text.UTF8Encoding $false))
    $writer.Write($xml)
    $writer.Dispose()
  }
  finally {
    $zip.Dispose()
  }
}
