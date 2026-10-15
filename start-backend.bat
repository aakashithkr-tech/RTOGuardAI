@echo off
setlocal
cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" (
  echo [RTOGuard AI] Creating Python virtual environment...
  py -m venv .venv
  if errorlevel 1 (
    echo Could not create the Python environment. Ensure Python 3 is installed and the py launcher works.
    pause
    exit /b 1
  )
  call ".venv\Scripts\activate.bat"
  python -m pip install --upgrade pip
  python -m pip install -r requirements.txt
  if errorlevel 1 (
    echo Backend dependency installation failed.
    pause
    exit /b 1
  )
) else (
  call ".venv\Scripts\activate.bat"
)
echo [RTOGuard AI] Backend will run at http://localhost:8000
python -m uvicorn app:app --reload --host 127.0.0.1 --port 8000
pause
