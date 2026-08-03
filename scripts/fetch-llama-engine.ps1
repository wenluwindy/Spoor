# 一键把 llama.cpp CPU 引擎拉到 src-tauri/resources/llama/（Windows 开发机用）。
#
# 与 .github/workflows/release-desktop.yml 的 "Bundle llama.cpp CPU engine (Windows)"
# 步骤保持同一逻辑：钉死版本、sha256 校验、只取 llama-server.exe 与全部 dll。
# 之后 `npm run tauri dev` / build 会经 bundle.resources 把它带进产物，
# engine.rs 按 resource_dir()/llama/ 找到它。CUDA 加速包不走这里——
# 那是应用内「本地推理引擎」区块的运行时下载（装到 SpoorData/llama/cuda/）。
#
# 用法：
#   powershell -ExecutionPolicy Bypass -File scripts/fetch-llama-engine.ps1
#   # 换版本（会跳过 sha256 校验并警告，正式升级请同步改 CI 与 engine.rs）：
#   powershell -ExecutionPolicy Bypass -File scripts/fetch-llama-engine.ps1 -Release b9999

param(
    # 与 engine.rs 的 LLAMA_RELEASE、release-desktop.yml 的 env.LLAMA_RELEASE 一致
    [string]$Release = "b8763"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# 仅对默认钉死版本做校验；换版本时值未知，明确警告而不是假装校验过
$PinnedSha256 = @{
    "b8763" = "7d1ddbc810fa0c3106cab3d93ea31019a0c8cf931c91eecd1665cc6cd3268036"
}

$root = Split-Path -Parent $PSScriptRoot
$dst = Join-Path $root "src-tauri\resources\llama"
$zipName = "llama-$Release-bin-win-cpu-x64.zip"
$url = "https://github.com/ggml-org/llama.cpp/releases/download/$Release/$zipName"
$tmp = Join-Path $env:TEMP "spoor-fetch-llama"

Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$zipPath = Join-Path $tmp $zipName

Write-Host "Downloading $zipName ..."
Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -TimeoutSec 600

if ($PinnedSha256.ContainsKey($Release)) {
    $actual = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actual -ne $PinnedSha256[$Release]) {
        throw "sha256 mismatch for ${zipName}: got $actual, want $($PinnedSha256[$Release])"
    }
    Write-Host "sha256 OK: $actual"
} else {
    Write-Warning "No pinned sha256 for release '$Release' — skipping verification."
}

$extract = Join-Path $tmp "extracted"
Expand-Archive -Path $zipPath -DestinationPath $extract

# zip 根目录平铺：只要 llama-server.exe 与全部 dll（CPU 包不含 cuda dll）
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Get-ChildItem $dst -Exclude ".gitkeep" | Remove-Item -Recurse -Force
Copy-Item (Join-Path $extract "llama-server.exe") $dst
Copy-Item (Join-Path $extract "*.dll") $dst
if (-not (Test-Path (Join-Path $dst "llama-server.exe"))) {
    throw "llama-server.exe missing after extract"
}

Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
$count = (Get-ChildItem $dst -Exclude ".gitkeep").Count
Write-Host "Done: $count files in $dst"

# dev 便利：tauri-build 的 build script 不跟踪资源文件变化，代码没改动时
# cargo 不重跑它，target/debug/llama/ 就一直是旧的（engine.rs 在 dev 下按
# resource_dir()=target/debug 找 llama/）。这里主动同步一份，省得拉完引擎
# 还要 touch tauri.conf.json 或 clean 才能生效。
$devDst = Join-Path $root "src-tauri\target\debug\llama"
if (Test-Path $devDst) {
    Get-ChildItem $devDst -Exclude ".gitkeep" | Remove-Item -Recurse -Force
    Copy-Item (Join-Path $dst "*") $devDst -Exclude ".gitkeep"
    Write-Host "Synced into dev dir: $devDst"
}
