@echo off
setlocal
title Atualizador - Central de Orcamentos
color 0A

echo.
echo  ==========================================================
echo    CENTRAL DE ORCAMENTOS - ATUALIZADOR
echo  ==========================================================
echo.
echo   Baixa a versao mais recente do GitHub, faz backup do
echo   banco e atualiza o sistema sem apagar seus dados.
echo.
echo   Feche o sistema antes de continuar (ou ele sera fechado).
echo.
timeout /t 4 /nobreak >nul

powershell -NoProfile -ExecutionPolicy Bypass -Command "iwr -UseBasicParsing 'https://raw.githubusercontent.com/SamuelNoia/orca3/main/atualizar-windows.ps1' -OutFile '%TEMP%\atualizar-orcamentos.ps1'; & '%TEMP%\atualizar-orcamentos.ps1'"

if errorlevel 1 (
    echo.
    echo  ==========================================================
    echo    NAO FOI POSSIVEL CONCLUIR
    echo  ==========================================================
    echo.
    echo   Verifique sua conexao e tente novamente.
    echo   Se a instalacao estiver em outro lugar, rode pelo PowerShell:
    echo     powershell -ExecutionPolicy Bypass -File atualizar-windows.ps1 -Pasta "C:\caminho"
    echo.
    pause
)
