@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "NODE_EXE="

rem 1) Node instalado no sistema
where node >nul 2>nul
if %errorlevel%==0 set "NODE_EXE=node"

rem 2) Node portatil dentro da pasta do projeto
if not defined NODE_EXE if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"

rem 3) Runtime que ja existe nesta maquina
if not defined NODE_EXE if exist "%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe" set "NODE_EXE=%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"

if not defined NODE_EXE (
  echo.
  echo  Node.js nao encontrado.
  echo.
  echo  Instale a versao LTS em https://nodejs.org  ^(Next, Next, Finish^)
  echo  Depois execute este arquivo novamente.
  echo.
  pause
  exit /b 1
)

echo.
echo  Iniciando a Central de Orcamentos...
echo  O navegador abrira em http://127.0.0.1:3000
echo  Para encerrar, feche esta janela ou pressione Ctrl+C.
echo.

start "" "http://127.0.0.1:3000"
"%NODE_EXE%" server.js

echo.
echo  Servidor encerrado.
pause
