@echo off
setlocal
start "RTOGuard AI Backend" cmd /k ""%~dp0start-backend.bat""
timeout /t 2 /nobreak >nul
start "RTOGuard AI Frontend" cmd /k ""%~dp0start-frontend.bat""
echo Started the backend and frontend in separate terminal windows.
echo Open http://localhost:5173/ after Vite finishes starting.
