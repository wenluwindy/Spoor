@echo off
REM Build Tauri release — no CUDA build chain needed anymore (uses prebuilt llama-cli).
set "ROOT=%~dp0.."
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" || exit /b 1
cd /d "%ROOT%" || exit /b 1
call npm run tauri -- build %*
exit /b %ERRORLEVEL%
