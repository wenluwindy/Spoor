# Tag and push to trigger GitHub Actions desktop installer build.
# Usage: .\scripts\publish-desktop-release.ps1
#        .\scripts\publish-desktop-release.ps1 -Version 0.1.0

param(
  [string]$Version = '0.1.0'
)

$ErrorActionPreference = 'Stop'
$tag = "v$Version"

Write-Host "This will create tag $tag and push to origin."
Write-Host "GitHub Actions will build Spoor_*_x64-setup.exe and attach it to Releases."
$confirm = Read-Host "Continue? (y/N)"
if ($confirm -notmatch '^[yY]') { exit 0 }

git tag -a $tag -m "Spoor desktop $Version"
git push origin $tag
Write-Host ""
Write-Host "Pushed $tag. Watch: https://github.com/iimorning/spoor/actions"
Write-Host "When green, download: https://github.com/iimorning/spoor/releases/latest"
