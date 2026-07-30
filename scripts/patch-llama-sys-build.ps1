# Apply MSVC include-path fix to vendored llama-cpp-sys-2/build.rs (run after sync-llama-cpp-sys-vendor.cmd).
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$buildRs = Join-Path $root 'src-tauri\third_party\llama-cpp-sys-2\build.rs'
if (-not (Test-Path $buildRs)) {
    Write-Error "Missing $buildRs — run scripts/sync-llama-cpp-sys-vendor.cmd first."
}
$c = Get-Content -Raw $buildRs
if ($c -match '\.include\(Path::new\(&manifest_dir\)\)' -and $c -match '/utf-8') {
    Write-Host 'Patch already applied.'
    exit 0
}
$old = @'
        .file("wrapper_oai.cpp")
        .include(&llama_src)
'@
$new = @'
        .file("wrapper_oai.cpp")
        // wrapper_*.cpp uses `#include "llama.cpp/common/chat.h"`, which resolves from the crate root.
        .include(Path::new(&manifest_dir))
        .include(&llama_src)
'@
if ($c -notmatch '\.include\(Path::new\(&manifest_dir\)\)') {
    if (-not $c.Contains($old.Trim())) {
        Write-Error 'build.rs pattern mismatch — llama-cpp-sys-2 version may have changed. Patch manually.'
    }
    $c = $c.Replace($old, $new)
}
$oldUtf = @'
    if matches!(target_os, TargetOs::Windows(WindowsVariant::Msvc)) {
        common_wrapper_build.flag("/std:c++17");
    }
'@
$newUtf = @'
    if matches!(target_os, TargetOs::Windows(WindowsVariant::Msvc)) {
        common_wrapper_build.flag("/std:c++17");
        common_wrapper_build.flag("/utf-8");
    }
'@
if ($c -notmatch '/utf-8') {
    if (-not $c.Contains($oldUtf.Trim())) {
        Write-Warning 'MSVC block pattern mismatch — add /utf-8 manually for common_wrapper_build.'
    } else {
        $c = $c.Replace($oldUtf, $newUtf)
    }
}
Set-Content -Path $buildRs -Value $c -Encoding utf8NoBOM
Write-Host 'Patched' $buildRs
