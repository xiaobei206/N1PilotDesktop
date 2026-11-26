@echo off
setlocal EnableExtensions
cd /d "%~dp0"
echo GPT SSH Pilot - Electron install repair and build
echo.
if not exist "%~dp0.tools\node\node.exe" (
  echo ERROR: Portable Node.js was not found in .tools\node.
  echo Run build.bat once to download Node.js, then run this repair script.
  pause
  exit /b 1
)
echo [1/3] Pinning Electron to 45.0.0 in package.json ...
"%~dp0.tools\node\node.exe" -e "const fs=require('fs');const p='package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.devDependencies=j.devDependencies||{};j.devDependencies.electron='45.0.0';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n');"
if errorlevel 1 (
  echo ERROR: Could not update package.json.
  pause
  exit /b 1
)
echo [2/3] Removing incomplete npm install ...
if exist "%~dp0node_modules" (
  rmdir /s /q "%~dp0node_modules"
  if exist "%~dp0node_modules" (
    echo ERROR: Could not remove node_modules. Close editors/processes using this folder and retry.
    pause
    exit /b 1
  )
)
if exist "%~dp0package-lock.json" (
  del /f /q "%~dp0package-lock.json"
  if exist "%~dp0package-lock.json" (
    echo ERROR: Could not remove package-lock.json.
    pause
    exit /b 1
  )
)
echo [3/3] Reinstalling cleanly and building ...
call "%~dp0build.bat"
exit /b %ERRORLEVEL%
