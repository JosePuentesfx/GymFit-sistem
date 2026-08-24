@echo off
title NovaFit Pro — Iniciando...
cd /d "%~dp0"
echo.
echo   ███╗   ██╗ ██████╗ ██╗   ██╗ █████╗ ███████╗██╗████████╗
echo   ████╗  ██║██╔═══██╗██║   ██║██╔══██╗██╔════╝██║╚══██╔══╝
echo   ██╔██╗ ██║██║   ██║██║   ██║███████║█████╗  ██║   ██║
echo   ██║╚██╗██║██║   ██║╚██╗ ██╔╝██╔══██║██╔══╝  ██║   ██║
echo   ██║ ╚████║╚██████╔╝ ╚████╔╝ ██║  ██║██║     ██║   ██║
echo   ╚═╝  ╚═══╝ ╚═════╝   ╚═══╝  ╚═╝  ╚═╝╚═╝     ╚═╝   ╚═╝
echo.
echo   Sistema Profesional de Gimnasio — v2.0 PRO
echo.
echo   Iniciando aplicacion...
echo.
npm start
if %errorlevel% neq 0 (
  echo.
  echo   ERROR: No se pudo iniciar NovaFit Pro.
  echo   Asegurate de tener Node.js instalado.
  echo   Descargalo en: https://nodejs.org
  echo.
  pause
)
