@echo off
setlocal enabledelayedexpansion
rem PET Reading - Windows deploy launcher.
rem PowerShell does not know "bash", so call Git Bash by full path.
rem Keep this file ASCII-only: cmd.exe reads .cmd in the OEM codepage,
rem and UTF-8 comments get garbled into executable garbage.
rem
rem   deploy.cmd --setup <IP>   first time
rem   deploy.cmd <IP>           every time

set "BASH=C:\Program Files\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=C:\Program Files (x86)\Git\bin\bash.exe"
if not exist "%BASH%" (
  echo [x] Git Bash not found. Install Git for Windows first.
  exit /b 1
)

if "%~1"=="" (
  echo.
  echo   first time : deploy.cmd --setup ^<IP^>
  echo   every time : deploy.cmd ^<IP^>
  echo.
  set /p "IP=ECS public IP: "
  if "!IP!"=="" exit /b 1
  "%BASH%" "%~dp0deploy.sh" --setup "!IP!"
) else (
  "%BASH%" "%~dp0deploy.sh" %*
)
