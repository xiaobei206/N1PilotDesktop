@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "APP_ROOT=%~dp0"
set "LOCAL_NODE=%~dp0.tools\node"

rem Electron's postinstall downloads the actual Chromium/Electron binary.
rem In many networks GitHub release downloads fail, while npm package downloads work.
rem Electron's official documentation supports ELECTRON_MIRROR for this case.
if not defined ELECTRON_MIRROR set "ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/"
echo Electron binary mirror: %ELECTRON_MIRROR%

rem Prefer the private portable Node.js shipped/downloaded for this project.
if exist "%LOCAL_NODE%\node.exe" if exist "%LOCAL_NODE%\npm.cmd" goto use_local_node

rem Fall back to a Node.js installation already on PATH.
where node.exe >nul 2>nul
if not errorlevel 1 goto use_system_node

echo [1/3] No Node.js found. Downloading portable Node.js LTS into .tools\node ...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP_ROOT%ensure-node.ps1"
if errorlevel 1 goto failed
if not exist "%LOCAL_NODE%\node.exe" goto failed
if not exist "%LOCAL_NODE%\npm.cmd" goto failed

:use_local_node
set "PATH=%LOCAL_NODE%;%PATH%"
goto build_app

:use_system_node
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node.js was found, but npm.cmd was not found on PATH.
  echo Install the official Node.js LTS package from https://nodejs.org/ and reopen this terminal.
  goto failed
)

:build_app
echo [1/4] Compiling the native Windows file-properties launcher ...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%APP_ROOT%native\build-properties-helper.ps1" -Source "%APP_ROOT%native\PropertiesLauncher.cs" -Output "%APP_ROOT%assets\N1PilotProperties.exe"
if errorlevel 1 goto failed
if not exist "%APP_ROOT%assets\N1PilotProperties.exe" goto failed

echo [2/4] Installing application dependencies. Internet access is required ...
call npm.cmd install
if errorlevel 1 goto failed

echo [3/4] Running source smoke tests ...
call npm.cmd test
if errorlevel 1 goto failed

echo [4/4] Building the Windows portable EXE ...
call npm.cmd run dist:win
if errorlevel 1 goto failed

echo.
echo Build completed. N1PilotDesktop Monaco v1.0.3. Output folder: "%APP_ROOT%dist\"
if exist "%APP_ROOT%dist" explorer "%APP_ROOT%dist"
pause
exit /b 0

:failed
echo.
echo Build failed. Keep the full error output and send it for diagnosis.
echo If Electron still reports a network fetch error, test whether the mirror URL opens in your browser.
pause
exit /b 1
