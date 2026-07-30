$ProgressPreference = 'SilentlyContinue'
$urls = @{
    "llama-cuda12" = "https://github.com/ggml-org/llama.cpp/releases/download/b8763/llama-b8763-bin-win-cuda-12.4-x64.zip"
    "cudart-dlls"  = "https://github.com/ggml-org/llama.cpp/releases/download/b8763/cudart-llama-bin-win-cuda-12.4-x64.zip"
}
foreach ($name in $urls.Keys) {
    $url = $urls[$name]
    $out = "D:\Temp\$name.zip"
    Write-Host "Downloading $name..."
    try {
        Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 300
        Write-Host "  OK: $out ($(((Get-Item $out).Length / 1MB).ToString('N1')) MB)"
    } catch {
        Write-Host "  FAILED: $($_.Exception.Message)"
    }
}
