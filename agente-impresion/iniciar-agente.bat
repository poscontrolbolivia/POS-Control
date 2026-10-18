@echo off
chcp 65001 >nul
title Agente de impresion POS Control
cd /d "%~dp0"
rem Cambia la direccion de abajo por la de tu app (la misma que abres en Chrome).
set ORIGEN=https://tu-app.vercel.app
where node >nul 2>nul || (echo Falta instalar Node.js 18 o superior: https://nodejs.org & pause & exit /b 1)
node agente.mjs --origen %ORIGEN%
pause
