# Writes .env.local with VITE_BUILTIN_MIMO_API_KEY (gitignored). Does not commit secrets.
param(
  [Parameter(Mandatory = $true)]
  [string]$Key
)

$trimmed = $Key.Trim()
if (-not $trimmed.StartsWith('tp-')) {
  Write-Error 'MiMo Token Plan keys usually start with tp-. Check the key from Xiaomi MiMo console.'
  exit 1
}

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env.local'
$content = @"
# Hosted MiMo for all users (baked into dist at build time). DO NOT COMMIT.
VITE_BUILTIN_MIMO_API_KEY=$trimmed
"@

Set-Content -Path $envFile -Value $content -Encoding utf8NoBOM
Write-Host "Wrote $envFile"
Write-Host 'Next: npm run build   (web)  or  npm run tauri:build   (desktop)'
Write-Host 'Netlify Drop: upload dist/ after build. Or set the same var in Netlify env and rebuild.'
