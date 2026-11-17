@echo off
setlocal
title Desinstalador - Central de Orcamentos
color 0E

echo.
echo  ==========================================================
echo    CENTRAL DE ORCAMENTOS - DESINSTALADOR
echo  ==========================================================
echo.
echo   Este arquivo baixa o desinstalador mais recente do GitHub
echo   e executa. Ele cria um backup do banco antes de apagar.
echo.
echo   Para cancelar, feche esta janela agora.
echo.
timeout /t 4 /nobreak >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -UseBasicParsing 'https://raw.githubusercontent.com/SamuelNoia/orca3/main/desinstalar-windows.ps1' -OutFile '%TEMP%\desinstalar-orcamentos.ps1'; & '%TEMP%\desinstalar-orcamentos.ps1'"

if errorlevel 1 (
    echo.
    echo  ==========================================================
    echo    NAO FOI POSSIVEL CONCLUIR
    echo  ==========================================================
    echo.
    echo   Se a instalacao estiver em outro lugar, rode pelo PowerShell:
    echo     powershell -ExecutionPolicy Bypass -File desinstalar-windows.ps1 -Pasta "C:\caminho"
    echo.
    pause
)
