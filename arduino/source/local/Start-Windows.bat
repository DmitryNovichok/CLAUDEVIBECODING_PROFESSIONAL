@echo off
chcp 65001 >nul
cd /d "%~dp0"
title MicroLab
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 server.py
  goto done
)
where python >nul 2>nul
if %errorlevel% equ 0 (
  python server.py
  goto done
)
echo.
echo Python 3 не найден.
echo Установите его с https://www.python.org/downloads/
echo и при установке отметьте "Add python.exe to PATH".
:done
pause
