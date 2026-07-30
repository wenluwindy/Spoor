# Regenerate src-tauri/icons from root LOGO.png.
# Crops to logo artwork, removes the outer background, then generates Tauri icons.
# Run: powershell -ExecutionPolicy Bypass -File scripts/regenerate-app-icons.ps1

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$srcPath = Join-Path $root 'LOGO.png'
$appIcon = Join-Path $root 'src-tauri\app-icon.png'

$fillPercent = 0.86
# Transparent icons do not need to fill the whole square; keep a small optical margin.
$zoomBoost = 1.0
$outSize = 1024

if (-not (Test-Path $srcPath)) {
  throw "Missing LOGO.png at repo root"
}

$src = [System.Drawing.Bitmap]::FromFile($srcPath)
$bg = $src.GetPixel(0, 0)
$minX = $src.Width
$minY = $src.Height
$maxX = 0
$maxY = 0

for ($y = 0; $y -lt $src.Height; $y++) {
  for ($x = 0; $x -lt $src.Width; $x++) {
    $p = $src.GetPixel($x, $y)
    $isOrange = ($p.R -gt 130 -and ($p.R - $p.G) -gt 35 -and ($p.G - $p.B) -gt 8 -and $p.A -gt 180)
    if ($isOrange) {
      if ($x -lt $minX) { $minX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}

if ($maxX -le $minX) {
  throw "Could not find logo strokes in LOGO.png"
}

# Square crop centered on strokes — includes cream card fills + drop shadow (not in orange bounds).
$cx = ($minX + $maxX) / 2.0
$cy = ($minY + $maxY) / 2.0
# Square around strokes with enough room for the stacked sheets and shadow.
$half = ([Math]::Max($maxX - $minX, $maxY - $minY) + 1) / 2.0 * 1.28
$side = [int]([Math]::Ceiling($half * 2))
$minX = [int]([Math]::Floor($cx - $half))
$minY = [int]([Math]::Floor($cy - $half))
$maxX = $minX + $side - 1
$maxY = $minY + $side - 1
if ($minX -lt 0) { $maxX -= $minX; $minX = 0 }
if ($minY -lt 0) { $maxY -= $minY; $minY = 0 }
if ($maxX -ge $src.Width) { $minX -= ($maxX - $src.Width + 1); $maxX = $src.Width - 1 }
if ($maxY -ge $src.Height) { $minY -= ($maxY - $src.Height + 1); $maxY = $src.Height - 1 }
$w = $maxX - $minX + 1
$h = $maxY - $minY + 1

$crop = New-Object System.Drawing.Bitmap $w, $h
$gc = [System.Drawing.Graphics]::FromImage($crop)
$gc.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$srcRect = New-Object System.Drawing.Rectangle $minX, $minY, $w, $h
$destRect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
$gc.DrawImage($src, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
$gc.Dispose()
$src.Dispose()

$canvas = New-Object System.Drawing.Bitmap $outSize, $outSize, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($canvas)
$g.Clear([System.Drawing.Color]::Transparent)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

$scale = [Math]::Max($outSize / $crop.Width, $outSize / $crop.Height) * $fillPercent * $zoomBoost
$drawW = [int]($crop.Width * $scale)
$drawH = [int]($crop.Height * $scale)
$dstX = [int](($outSize - $drawW) / 2)
$dstY = [int](($outSize - $drawH) / 2)
$dstRect = New-Object System.Drawing.Rectangle $dstX, $dstY, $drawW, $drawH
$g.DrawImage($crop, $dstRect)
$g.Dispose()
$crop.Dispose()

# Remove only the flat cream background connected to canvas edges.
# This keeps enclosed card fills while making the icon non-square on the taskbar.
$visited = New-Object 'bool[,]' $outSize, $outSize
$queue = New-Object System.Collections.Generic.Queue[System.Drawing.Point]

function Test-BackgroundPixel {
  param($p, $bg)
  if ($p.A -eq 0) { return $true }
  $dr = [Math]::Abs($p.R - $bg.R)
  $dg = [Math]::Abs($p.G - $bg.G)
  $db = [Math]::Abs($p.B - $bg.B)
  return ($dr + $dg + $db) -lt 80
}

function Add-BackgroundPoint {
  param($x, $y)
  if ($x -lt 0 -or $y -lt 0 -or $x -ge $outSize -or $y -ge $outSize) { return }
  if ($visited[$x, $y]) { return }
  $visited[$x, $y] = $true
  if (Test-BackgroundPixel $canvas.GetPixel($x, $y) $bg) {
    $queue.Enqueue([System.Drawing.Point]::new($x, $y))
  }
}

for ($i = 0; $i -lt $outSize; $i++) {
  Add-BackgroundPoint $i 0
  Add-BackgroundPoint $i ($outSize - 1)
  Add-BackgroundPoint 0 $i
  Add-BackgroundPoint ($outSize - 1) $i
}

while ($queue.Count -gt 0) {
  $pt = $queue.Dequeue()
  $canvas.SetPixel($pt.X, $pt.Y, [System.Drawing.Color]::Transparent)
  Add-BackgroundPoint ($pt.X + 1) $pt.Y
  Add-BackgroundPoint ($pt.X - 1) $pt.Y
  Add-BackgroundPoint $pt.X ($pt.Y + 1)
  Add-BackgroundPoint $pt.X ($pt.Y - 1)
}

$canvas.Save($appIcon, [System.Drawing.Imaging.ImageFormat]::Png)
$canvas.Dispose()

Write-Host "Wrote $appIcon (${fillPercent} fill)"
Push-Location $root
npx tauri icon "src-tauri/app-icon.png" -o "src-tauri/icons"
Pop-Location
Write-Host "Done. Stop tauri dev, then run: npx tauri dev (rebuilds native exe with new icon.ico)"
