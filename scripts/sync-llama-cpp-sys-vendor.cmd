@echo off
REM Copy llama-cpp-sys-2 from cargo registry into src-tauri/third_party, then apply MSVC include fix.
set "REG_BASE=%USERPROFILE%\.cargo\registry\src\index.crates.io-1949cf8c6b5b557f"
set "SRC=%REG_BASE%\llama-cpp-sys-2-0.1.146"
set "DST=%~dp0..\src-tauri\third_party\llama-cpp-sys-2"

if not exist "%SRC%\build.rs" (
  echo ERROR: Expected crate at %SRC%
  echo Run from project root: cargo fetch -p llama-cpp-sys-2
  exit /b 1
)

if exist "%DST%" rmdir /s /q "%DST%"
mkdir "%DST%" 2>nul
robocopy "%SRC%" "%DST%" /E /NFL /NDL /NJH /NJS
if %ERRORLEVEL% GEQ 8 exit /b %ERRORLEVEL%

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0patch-llama-sys-build.ps1"
exit /b %ERRORLEVEL%
