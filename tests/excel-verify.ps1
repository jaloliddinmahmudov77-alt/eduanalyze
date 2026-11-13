# Haqiqiy Microsoft Excel'da formulalarni tekshirish (avval: npm test)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content (Join-Path $PSScriptRoot 'out\expect.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false
$xl.DisplayAlerts = $false
$script:fails = 0
$script:passes = 0
function Check($ws, $map, $label) {
  foreach ($p in $map.PSObject.Properties) {
    $v = $ws.Range($p.Name).Value2
    $e = $p.Value
    if ($e -is [string]) { $good = ([string]$v) -eq $e }
    else { $good = ($null -ne $v) -and ([math]::Abs([double]$v - [double]$e) -lt 1e-9) }
    if ($good) { $script:passes++ } else { $script:fails++; Write-Host "  x [$label] $($p.Name): Excel=$v expected=$e" }
  }
}
try {
  $wb = $xl.Workbooks.Open($cfg.file)
  $ws = $wb.Worksheets.Item(1)
  $xl.CalculateFull()
  Check $ws $cfg.expect 'initial'
  foreach ($p in $cfg.mutate.set.PSObject.Properties) { $ws.Range($p.Name).Value2 = $p.Value }
  $xl.Calculate()
  Check $ws $cfg.mutate.expect 'after edit'
  $wb.Close($false)
} finally {
  $xl.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($xl)
}
Write-Host "Excel check: $($script:passes) passed, $($script:fails) failed"
if ($script:fails) { exit 1 }
