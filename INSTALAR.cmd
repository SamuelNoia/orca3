@echo off
setlocal
title Instalador - Central de Orcamentos
color 0B

echo.
echo  ==========================================================
echo    CENTRAL DE ORCAMENTOS - INSTALADOR PARA WINDOWS
echo  ==========================================================
echo.
echo   Este arquivo baixa o instalador mais recente do GitHub
echo   e executa. Requer conexao com a internet.
echo.
echo   Para cancelar, feche esta janela.
echo.
timeout /t 3 /nobreak >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -UseBasicParsing 'https://raw.githubusercontent.com/SamuelNoia/orca3/main/instalar-windows.ps1' -OutFile '%TEMP%\instalar-orcamentos.ps1'; & '%TEMP%\instalar-orcamentos.ps1'"

if errorlevel 1 (
    echo.
    echo  ==========================================================
    echo    NAO FOI POSSIVEL CONCLUIR A INSTALACAO
    echo  ==========================================================
    echo.
    echo   Verifique sua conexao e tente novamente.
    echo   Se o problema continuar, instale manualmente seguindo
    echo   as instrucoes em:
    echo   https://github.com/SamuelNoia/orca3
    echo.
    pause
)
