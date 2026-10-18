' Arranca el agente de impresion de POS Control SIN VENTANA.
' Lo usa el Programador de tareas (instalar-agente.bat). No lleva rutas escritas: trabaja desde
' la carpeta donde esta este archivo, asi sirve en cualquier PC tal cual.
Option Explicit
Dim sh, fso, aqui
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
aqui = fso.GetParentFolderName(fso.GetAbsolutePathName(WScript.ScriptFullName))
sh.CurrentDirectory = aqui
sh.Run "cmd /c node agente.mjs", 0, False
