@echo off
setlocal
cd /d "%~dp0"
title DRIP Urban

rem ---- Python 3.11+ ------------------------------------------------------------
set "PY=python"

python --version >nul 2>nul
if errorlevel 1 (
  echo Python non trovato.
  echo Installa Python 3.11 o successivo da https://www.python.org/downloads/
  echo e assicurati che Python sia aggiunto al PATH.
  pause
  exit /b 1
)

rem ---- ambiente locale (.venv) ------------------------------------------------
if not exist ".venv\Scripts\python.exe" (
  echo Prima esecuzione: preparo l'ambiente Python...
  %PY% -m venv .venv || (
    echo Creazione dell'ambiente non riuscita.
    pause
    exit /b 1
  )
)

rem Reinstalla le dipendenze solo se requirements.txt e' cambiato.
fc /b "services\api\requirements.txt" ".venv\requirements.installed" >nul 2>nul
if errorlevel 1 (
  echo Installo le dipendenze...
  ".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r "services\api\requirements.txt" || (
    echo Installazione non riuscita: serve la connessione a Internet.
    pause
    exit /b 1
  )
  copy /y "services\api\requirements.txt" ".venv\requirements.installed" >nul
)

rem ---- avvio -----------------------------------------------------------------
".venv\Scripts\python.exe" "tools\windows\launcher.py"
if errorlevel 1 pause

endlocal
