@echo off
setlocal
chcp 65001 >nul 2>&1
cd /d "%~dp0.."

if not exist "scripts\borrar-empresa.mjs" (
  echo ERROR: no se encuentra scripts\borrar-empresa.mjs desde esta carpeta.
  echo Este .bat tiene que quedar dentro de "install", sin mover la carpeta del proyecto.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: no se encontro Node.js. Instalalo desde https://nodejs.org ^(version LTS^) y vuelve a abrir este archivo.
  pause
  exit /b 1
)

node scripts\borrar-empresa.mjs
echo.
pause
exit /b
