@echo off
setlocal enableextensions
chcp 65001 >nul
title Instalar el agente de impresion POS Control
cd /d "%~dp0"

rem ============================================================================
rem  AGENTE DE IMPRESION DE POS CONTROL - instalador (se ejecuta UNA VEZ)
rem  Deja el agente arrancando solo cuando enciendes la PC, SIN VENTANA, y lo
rem  revive cada minuto si se cierra. Despues basta abrir la app: las
rem  impresoras ya funcionan.  (Node.js 18 o superior es lo unico que hay que
rem  instalar antes; el instalador te avisa si falta.)
rem ============================================================================

rem Direccion de tu app. La app la deja escrita al descargar este archivo
rem (Configuracion > Impresoras > "Instalar arranque automatico"). Si esta
rem vacia, se pregunta al ejecutarlo.
set "ORIGEN="
set "PUERTO=9101"

set "CARPETA=%LOCALAPPDATA%\POSControl\agente"
set "TAREA=POS Control - Agente de impresion"
set "VIGILA=POS Control - Agente de impresion (vigilar)"

echo.
echo  POS Control - arranque automatico del agente de impresion
echo  ----------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 goto :falta_node

if /i "%ORIGEN%"=="" set /p "ORIGEN=Direccion de tu app (ej. https://pos-control.pages.dev): "
if /i "%ORIGEN%"=="" goto :sin_origen

if not exist "%CARPETA%" mkdir "%CARPETA%"

rem 1) El programa del agente: se baja el ultimo desde la app; si no se puede,
rem    se usa el que esta en esta misma carpeta.
curl -fsSL --max-time 25 "%ORIGEN%/agente.mjs" -o "%CARPETA%\agente.mjs" 2>nul
if exist "%CARPETA%\agente.mjs" for %%A in ("%CARPETA%\agente.mjs") do if %%~zA LSS 2000 del /q "%%A"
if not exist "%CARPETA%\agente.mjs" copy /y "%~dp0agente.mjs" "%CARPETA%\agente.mjs" >nul
if not exist "%CARPETA%\agente.mjs" goto :falta_agente

rem 2) El arranque sin ventana + los ajustes que lee el agente al volar solo.
copy /y "%~dp0agente-oculto.vbs" "%CARPETA%\agente-oculto.vbs" >nul
if not exist "%CARPETA%\agente-oculto.vbs" goto :falta_vbs
> "%CARPETA%\agente.conf" echo origen=%ORIGEN%
>> "%CARPETA%\agente.conf" echo puerto=%PUERTO%

rem 3) Dos tareas en el Programador de Windows: una al iniciar sesion y otra que
rem    revisa cada minuto (si ya hay un agente abierto, el nuevo se cierra solo).
rem    Si el Programador pide permiso de administrador se usa la carpeta "Inicio"
rem    de Windows, que no lo necesita y cumple la misma funcion al encender el PC.
schtasks /Delete /TN "%VIGILA%" /F >nul 2>nul
schtasks /Delete /TN "%TAREA%" /F >nul 2>nul
schtasks /Create /TN "%TAREA%" /TR "wscript.exe \"%CARPETA%\agente-oculto.vbs\"" /SC ONLOGON /F >nul 2>nul
if errorlevel 1 goto :sin_programador
schtasks /Create /TN "%VIGILA%" /TR "wscript.exe \"%CARPETA%\agente-oculto.vbs\"" /SC MINUTE /MO 1 /F >nul 2>nul
if errorlevel 1 goto :falta_tarea
schtasks /Run /TN "%TAREA%" >nul 2>nul
goto :listo

:sin_programador
call :crear_atajo
schtasks /Create /TN "%VIGILA%" /TR "wscript.exe \"%CARPETA%\agente-oculto.vbs\"" /SC MINUTE /MO 1 /F >nul 2>nul
if errorlevel 1 goto :falta_tarea
schtasks /Run /TN "%VIGILA%" >nul 2>nul
echo  Aviso: el Programador pidio permiso de administrador. El agente queda
echo  arrancando desde la carpeta "Inicio" de tu usuario, que no lo necesita.

:listo
echo.
echo  Listo. El agente esta corriendo oculto en http://127.0.0.1:%PUERTO%
echo  y se arrancara solo cada vez que enciendas esta PC.
echo.
echo  App: Configuracion ^> Impresoras ^> en cada grupo elige
echo  "Impresora de Windows por nombre (sin dialogo)" y prueba.
echo.
echo  Si algo falla, mira la bitacora:  %CARPETA%\agente.log
echo.
pause
exit /b 0

rem Atajo en "Inicio" (shell:startup): arranca sin ventana al iniciar sesion y no
rem pide elevacion, a diferencia de la tarea ONLOGON del Programador.
:crear_atajo
set "INICIO=%USERPROFILE%\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup"
set "ATAJO=%TEMP%\pos-control-atajo.vbs"
> "%ATAJO%" echo Set s = CreateObject("WScript.Shell")
>> "%ATAJO%" echo Set l = s.CreateShortcut("%INICIO%\POS Control - Agente.lnk")
>> "%ATAJO%" echo l.TargetPath = "wscript.exe"
>> "%ATAJO%" echo l.Arguments = """%CARPETA%\agente-oculto.vbs"""
>> "%ATAJO%" echo l.WorkingDirectory = "%CARPETA%"
>> "%ATAJO%" echo l.Description = "Agente de impresion de POS Control"
>> "%ATAJO%" echo l.Save
wscript //nologo "%ATAJO%" 2>nul
del /q "%ATAJO%" >nul 2>nul
exit /b

:falta_node
echo.
echo  Falta Node.js 18 o superior en esta PC.
echo  Descargalo e instalalo desde https://nodejs.org (es gratis, "LTS").
echo  Despues vuelve a ejecutar este instalador.
echo.
pause
exit /b 1

:sin_origen
echo.
echo  Sin la direccion de tu app el agente aceptaria cualquier pagina abierta en
echo  esta PC. Vuelve a ejecutarlo y escribe la direccion (descargando el
echo  instalador desde la app ya viene escrita).
echo.
pause
exit /b 1

:falta_agente
echo.
echo  No se pudo colocar el programa del agente en %CARPETA%
echo  Copia la carpeta "agente-impresion" completa a esta PC y vuelve a ejecutarlo.
echo.
pause
exit /b 1

:falta_vbs
echo.
echo  Falta el archivo agente-oculto.vbs al lado de este instalador.
echo  Copia la carpeta "agente-impresion" completa a esta PC y vuelve a ejecutarlo.
echo.
pause
exit /b 1

:falta_tarea
echo.
echo  El Programador de tareas no dejo registrar las tareas.
echo  Mientras tanto puedes abrir iniciar-agente.bat (ventana visible) y la
echo  impresion funciona igual; solo falta el arranque automatico.
echo.
pause
exit /b 1
