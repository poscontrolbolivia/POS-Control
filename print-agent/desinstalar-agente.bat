@echo off
setlocal enableextensions
chcp 65001 >nul
title Desinstalar el arranque automatico del agente POS Control

set "CARPETA=%LOCALAPPDATA%\POSControl\agente"
set "TAREA=POS Control - Agente de impresion"
set "VIGILA=POS Control - Agente de impresion (vigilar)"

echo.
echo  Quitando las tareas del Programador de Windows...
schtasks /Delete /TN "%VIGILA%" /F >nul 2>nul
schtasks /Delete /TN "%TAREA%" /F >nul 2>nul

rem El atajo que el instalador pone en "Inicio" cuando el Programador pide
rem administrador (se quita aqui para que no vuelva a levantar el agente).
del /q "%USERPROFILE%\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\POS Control - Agente.lnk" >nul 2>nul

rem Apaga SOLO el agente (puede que este abierto en una ventana o lanzado por el
rem vigilante); no toca ningun otro programa de Node de esta PC.
curl -s -X POST --max-time 5 http://127.0.0.1:9101/apagar >nul 2>nul

echo  Listo: el agente ya no se arrancara solo al encender la PC.
echo  Los archivos quedan en %CARPETA% (borralos si quieres quitarlos).
echo  Si aun responde http://127.0.0.1:9101, reinicia la PC.
echo.
pause
exit /b 0
