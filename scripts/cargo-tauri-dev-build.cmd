@echo off
REM Build the Tauri crate with the MSVC environment loaded.
REM No LLVM/libclang/CUDA needed — local inference uses prebuilt llama-server
REM binaries (see scripts/fetch-llama-engine.ps1), not a source build.

set "ROOT=%~dp0.."
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" || exit /b 1
cd /d "%ROOT%\src-tauri" || exit /b 1
cargo build %*
