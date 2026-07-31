@echo off
REM ═══════════════════════════════════════════════════════════════════════════
REM Ozzyl HMS — DICOM Print Agent: Windows Service Installer
REM 
REM This script installs the DICOM Print Agent as a Windows service
REM so it starts automatically when the computer boots.
REM
REM Requirements: Run as Administrator
REM Uses: node-windows (or nssm) to create the service
REM ═══════════════════════════════════════════════════════════════════════════

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║   Ozzyl HMS — DICOM Print Agent Service Installer        ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.

REM Check for administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] This script must be run as Administrator.
    echo Right-click and select "Run as administrator"
    pause
    exit /B 1
)

REM Get the directory of this script
set SCRIPT_DIR=%~dp0
set AGENT_DIR=%SCRIPT_DIR%..
set NODE_SCRIPT=%AGENT_DIR%\src\index.js

REM Check if Node.js is installed
where node >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Node.js is not installed.
    echo Please install Node.js from https://nodejs.org
    pause
    exit /B 1
)

REM Check if dependencies are installed
if not exist "%AGENT_DIR%\node_modules" (
    echo [INFO] Installing dependencies...
    cd /d "%AGENT_DIR%"
    call npm install
    if %errorLevel% neq 0 (
        echo [ERROR] Failed to install dependencies
        pause
        exit /B 1
    )
)

REM Check if nssm exists, if not download it
set NSSM=%AGENT_DIR%\scripts\nssm.exe
if not exist "%NSSM%" (
    echo [INFO] Downloading NSSM (Non-Sucking Service Manager)...
    powershell -Command "Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile '%TEMP%\nssm.zip'"
    powershell -Command "Expand-Archive -Path '%TEMP%\nssm.zip' -DestinationPath '%TEMP%\nssm' -Force"
    copy "%TEMP%\nssm\nssm-2.24\win64\nssm.exe" "%NSSM%" >nul
    echo [OK] NSSM downloaded
)

REM Remove existing service if present
echo [INFO] Checking for existing service...
"%NSSM%" status OzzylDicomPrint >nul 2>&1
if %errorLevel% equ 0 (
    echo [INFO] Stopping existing service...
    "%NSSM%" stop OzzylDicomPrint >nul 2>&1
    "%NSSM%" remove OzzylDicomPrint confirm >nul 2>&1
    echo [OK] Old service removed
)

REM Get Node.js path
for /f "tokens=*" %%i in ('where node') do set NODE_PATH=%%i

REM Install the service
echo [INFO] Installing Windows service...
"%NSSM%" install OzzylDicomPrint "%NODE_PATH%" "%NODE_SCRIPT%"
"%NSSM%" set OzzylDicomPrint AppDirectory "%AGENT_DIR%"
"%NSSM%" set OzzylDicomPrint Description "Ozzyl HMS DICOM Print Agent — receives X-ray images and auto-prints"
"%NSSM%" set OzzylDicomPrint Start SERVICE_AUTO_START
"%NSSM%" set OzzylDicomPrint AppStdout "%AGENT_DIR%\logs\service-stdout.log"
"%NSSM%" set OzzylDicomPrint AppStderr "%AGENT_DIR%\logs\service-stderr.log"
"%NSSM%" set OzzylDicomPrint AppRotateFiles 1
"%NSSM%" set OzzylDicomPrint AppRotateBytes 5242880

REM Start the service
echo [INFO] Starting service...
"%NSSM%" start OzzylDicomPrint

echo.
echo ╔═══════════════════════════════════════════════════════════╗
echo ║   Service installed and started successfully!            ║
echo ║                                                          ║
echo ║   Service Name : OzzylDicomPrint                         ║
echo ║   Status       : Running                                 ║
echo ║   Auto-start   : Yes (starts with Windows)               ║
echo ║                                                          ║
echo ║   To manage the service:                                 ║
echo ║     Start : nssm start OzzylDicomPrint                   ║
echo ║     Stop  : nssm stop OzzylDicomPrint                    ║
echo ║     Remove: nssm remove OzzylDicomPrint                  ║
echo ╚═══════════════════════════════════════════════════════════╝
echo.
pause
