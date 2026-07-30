# Restore IndexedDB from com.spatialnodes.app to com.spoor.app
# Close Tauri / npx tauri dev before running.

$ErrorActionPreference = 'Stop'
$oldRoot = Join-Path $env:LOCALAPPDATA 'com.spatialnodes.app\EBWebView\Default'
$newRoot = Join-Path $env:LOCALAPPDATA 'com.spoor.app\EBWebView\Default'

if (-not (Test-Path $oldRoot)) {
  Write-Error "Old data not found: $oldRoot"
}
if (-not (Test-Path $newRoot)) {
  Write-Error "New data not found: $newRoot (run npx tauri dev once first)"
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $env:LOCALAPPDATA "com.spoor.app\EBWebView\Default.backup-$stamp"
Write-Host "Backing up new profile to: $backup"
Copy-Item -Path $newRoot -Destination $backup -Recurse -Force

$items = @(
  'IndexedDB\http_localhost_3000.indexeddb.leveldb',
  'IndexedDB\http_localhost_3000.indexeddb.blob',
  'IndexedDB\http_tauri.localhost_0.indexeddb.leveldb'
)

foreach ($rel in $items) {
  $src = Join-Path $oldRoot $rel
  $dst = Join-Path $newRoot $rel
  if (-not (Test-Path $src)) {
    Write-Host "Skip (missing in old): $rel"
    continue
  }
  if (Test-Path $dst) {
    Remove-Item -Path $dst -Recurse -Force
  }
  $parent = Split-Path $dst -Parent
  if (-not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  Copy-Item -Path $src -Destination $dst -Recurse -Force
  Write-Host "Restored: $rel"
}

Write-Host ""
Write-Host "Done. Run: npx tauri dev"
