@echo off
title KnowUrAttendance - AUCE(A) CSE Attendance Portal
color 0b
cd /d "%~dp0"

echo ======================================================================
echo    KnowUrAttendance - AUCE(A) Computer Science ^& Engineering
echo    Andhra University College of Engineering (Autonomous)
echo ======================================================================
echo.

set "PY=python"
where python >nul 2>nul
if %errorlevel% neq 0 (
    where py >nul 2>nul
    if %errorlevel% neq 0 (
        color 0c
        echo [ERROR] Python was not found in your system PATH!
        echo Please install Python from https://www.python.org/
        echo IMPORTANT: tick "Add Python to PATH" during installation.
        echo.
        pause
        exit /b 1
    )
    set "PY=py -3"
)

%PY% "%~dp0launch_portal.py"
if errorlevel 1 (
    color 0c
    echo.
    echo [The portal stopped because of the error above.]
    pause
)
