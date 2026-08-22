Add-Type -AssemblyName System.IO.Compression.FileSystem

# 이 환경의 Word는 SaveAs가 응답하지 않는다(저장 경로가 OneDrive로 잡혀 대화상자에서 멈춤).
# 대신 Range.WordOpenXML로 Flat OPC를 받아 직접 zip으로 묶는다. 파트 내용은 Word가 쓴 그대로다.
$PKG_NS = 'http://schemas.microsoft.com/office/2006/xmlPackage'

$CORE_TYPE = 'application/vnd.openxmlformats-package.core-properties+xml'
$RELS_TYPE = 'application/vnd.openxmlformats-package.relationships+xml'
$CORE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties'

function New-CoreXml {
  param([string]$Title, [string]$Creator, [string]$Stamp)
  @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>$Title</dc:title><dc:creator>$Creator</dc:creator><cp:lastModifiedBy>$Creator</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">$Stamp</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">$Stamp</dcterms:modified></cp:coreProperties>
"@
}

function Save-FlatOpc {
  param(
    [string]$Xml,
    [string]$Path,
    [string]$Title,
    [string]$Creator = '테스터',
    [string]$Stamp = '2026-08-22T00:00:00Z'
  )

  [xml]$flat = $Xml
  $ns = New-Object System.Xml.XmlNamespaceManager($flat.NameTable)
  $ns.AddNamespace('pkg', $PKG_NS)

  $parts = [ordered]@{}
  $types = [ordered]@{}
  foreach ($part in $flat.SelectNodes('//pkg:part', $ns)) {
    $name = $part.GetAttribute('name', $PKG_NS).TrimStart('/')
    $types[$name] = $part.GetAttribute('contentType', $PKG_NS)

    $binary = $part.SelectSingleNode('pkg:binaryData', $ns)
    if ($null -ne $binary) {
      $parts[$name] = [Convert]::FromBase64String($binary.InnerText)
      continue
    }
    $data = $part.SelectSingleNode('pkg:xmlData', $ns)
    $text = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "`r`n" + $data.InnerXml
    $parts[$name] = [System.Text.Encoding]::UTF8.GetBytes($text)
  }

  # Flat OPC에는 문서 속성이 없다. 직접 넣고 루트 관계에 연결한다.
  $core = New-CoreXml -Title $Title -Creator $Creator -Stamp $Stamp
  $parts['docProps/core.xml'] = [System.Text.Encoding]::UTF8.GetBytes($core)
  $types['docProps/core.xml'] = $CORE_TYPE

  $rels = [System.Text.Encoding]::UTF8.GetString($parts['_rels/.rels'])
  $rels = $rels -replace '</Relationships>', ('<Relationship Id="rIdCore" Type="{0}" Target="docProps/core.xml"/></Relationships>' -f $CORE_REL)
  $parts['_rels/.rels'] = [System.Text.Encoding]::UTF8.GetBytes($rels)

  $overrides = ''
  foreach ($name in $types.Keys) {
    if ($types[$name] -eq $RELS_TYPE) { continue }
    $overrides += '<Override PartName="/{0}" ContentType="{1}"/>' -f $name, $types[$name]
  }
  $contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "`r`n" +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    ('<Default Extension="rels" ContentType="{0}"/>' -f $RELS_TYPE) +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    $overrides + '</Types>'

  if (Test-Path $Path) { Remove-Item $Path }
  $zip = [System.IO.Compression.ZipFile]::Open($Path, 'Create')
  try {
    $write = {
      param($entryName, $bytes)
      $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
      $stream = $entry.Open()
      $stream.Write($bytes, 0, $bytes.Length)
      $stream.Dispose()
    }
    & $write '[Content_Types].xml' ([System.Text.Encoding]::UTF8.GetBytes($contentTypes))
    foreach ($name in $parts.Keys) { & $write $name $parts[$name] }
  }
  finally {
    $zip.Dispose()
  }
}
