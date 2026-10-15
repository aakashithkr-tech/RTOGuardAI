@echo off
setlocal
cd /d "%~dp0frontend"
if not exist ".env" (
  copy /y ".env.example" ".env" >nul
  if errorlevel 1 (
    echo Could not create frontend .env from .env.example.
    pause
    exit /b 1
  )
)
if not exist "node_modules" (
  echo [RTOGuard AI] Installing frontend dependencies...
  call npm ci
  if errorlevel 1 (
    echo Frontend dependency installation failed. Ensure Node.js and npm are installed.
    pause
    exit /b 1
  )
)
echo [RTOGuard AI] Frontend will run at http://localhost:5173
call npm run dev -- --host 127.0.0.1
pause
