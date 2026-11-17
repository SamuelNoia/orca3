<#
.SYNOPSIS
    Instalador da Central de Orçamentos para Windows.

.DESCRIPTION
    Baixa a aplicação do GitHub, instala o Node.js se necessário, cria a pasta de
    dados, gera o atalho na área de trabalho e inicia o sistema.

.PARAMETER Pasta
    Onde instalar. Padrão: %LOCALAPPDATA%\CentralOrcamentos

.PARAMETER Porta
    Porta local do sistema. Padrão: 3088

.PARAMETER Origem
    Instala a partir de uma pasta local (sem baixar do GitHub).

.PARAMETER SemAtalho
    Não cria o atalho na área de trabalho.

.PARAMETER NaoIniciar
    Instala mas não abre o sistema no final.

.PARAMETER SemPausa
    Não espera Enter no fim (útil para instalação automatizada).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File instalar-windows.ps1
#>
param(
    [string]$Pasta = "$env:LOCALAPPDATA\CentralOrcamentos",
    [int]$Porta = 3088,
    [string]$Origem = "",
    [switch]$SemAtalho,
    [switch]$NaoIniciar,
    [switch]$SemPausa
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'Continue'

$repo = 'SamuelNoia/orca3'
$zipUrl = "https://github.com/$repo/archive/refs/heads/main.zip"
$versaoMinima = [version]'22.5.0'

function Linha { Write-Host ('-' * 62) -ForegroundColor DarkGray }
function Passo($n, $texto) { Write-Host ""; Write-Host "  [$n] $texto" -ForegroundColor White }
function Info($t) { Write-Host "      $t" -ForegroundColor Gray }
function Ok($t) { Write-Host "      OK  $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "      !   $t" -ForegroundColor Yellow }
function Falhou($t) { Write-Host "      X   $t" -ForegroundColor Red }

function AcharNode {
    $noCaminho = Get-Command node -ErrorAction SilentlyContinue
    if ($noCaminho) { return $noCaminho.Source }

    $possiveis = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
        "$env:LOCALAPPDATA\Microsoft\WindowsApps\node.exe"
    )
    foreach ($p in $possiveis) {
        if (Test-Path $p) { return $p }
    }
    return $null
}

function AtualizarPath {
    $maquina = [Environment]::GetEnvironmentVariable('PATH', 'Machine')
    $usuario = [Environment]::GetEnvironmentVariable('PATH', 'User')
    $env:PATH = $maquina + ';' + $usuario
}

function VersaoDoNode($exe) {
    try {
        $bruto = & $exe --version 2>$null
        if (-not $bruto) { return $null }
        return [version]($bruto.Trim().TrimStart('v'))
    } catch {
        return $null
    }
}

# ------------------------------------------------------------------ cabecalho
Clear-Host
Write-Host ""
Write-Host "  ##########################################################" -ForegroundColor DarkCyan
Write-Host "  #                                                        #" -ForegroundColor DarkCyan
Write-Host "  #        CENTRAL DE ORÇAMENTOS - INSTALADOR WINDOWS      #" -ForegroundColor DarkCyan
Write-Host "  #                                                        #" -ForegroundColor DarkCyan
Write-Host "  ##########################################################" -ForegroundColor DarkCyan
Write-Host ""
Info "Este instalador vai:"
Info "  1. verificar/instalar o Node.js"
Info "  2. baixar o sistema do GitHub"
Info "  3. criar a pasta de dados"
Info "  4. criar um atalho na área de trabalho"
Info "  5. iniciar o sistema no navegador"
Write-Host ""
Info "Pasta de instalação: $Pasta"
Info "Porta:               $Porta"
if ($Origem) { Info "Origem local:        $Origem" }
Write-Host ""

if ($Porta -lt 1 -or $Porta -gt 65535) {
    Falhou "Porta inválida: $Porta"
    return
}

# ------------------------------------------------------------------ 1. node
Passo 1 'Verificando o Node.js'

$nodeExe = AcharNode
$nodeVersao = $null
if ($nodeExe) { $nodeVersao = VersaoDoNode $nodeExe }

if ($nodeVersao -and $nodeVersao -ge $versaoMinima) {
    Ok "Node.js $nodeVersao encontrado"
    Info $nodeExe
} else {
    if ($nodeVersao) {
        Aviso "Node.js $nodeVersao é antigo (precisa de $versaoMinima ou mais novo)"
    } else {
        Aviso 'Node.js não encontrado'
    }

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Info 'Instalando o Node.js LTS pelo winget (pode demorar alguns minutos)...'
        try {
            & winget install --id OpenJS.NodeJS.LTS -e --silent `
                --accept-source-agreements --accept-package-agreements | Out-Null
            AtualizarPath
            $nodeExe = AcharNode
            if ($nodeExe) { $nodeVersao = VersaoDoNode $nodeExe }
            if ($nodeVersao -and $nodeVersao -ge $versaoMinima) {
                Ok "Node.js $nodeVersao instalado"
            }
        } catch {
            Falhou "O winget não conseguiu instalar: $($_.Exception.Message)"
        }
    } else {
        Aviso 'O winget não está disponível nesta máquina'
    }

    if (-not ($nodeVersao -and $nodeVersao -ge $versaoMinima)) {
        Write-Host ""
        Falhou 'Node.js não está disponível.'
        Info 'Instale manualmente a versão LTS em https://nodejs.org'
        Info 'Depois feche esta janela e rode o instalador de novo.'
        Write-Host ""
        Read-Host 'Pressione Enter para abrir o site'
        Start-Process 'https://nodejs.org/pt-br/download'
        return
    }
}

# ------------------------------------------------------------------ 2. arquivos
Passo 2 'Obtendo os arquivos do sistema'

$tempBase = Join-Path $env:TEMP ('orcamentos-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tempBase | Out-Null

try {
    if ($Origem) {
        if (-not (Test-Path (Join-Path $Origem 'server.js'))) {
            Falhou "A pasta de origem não contém a aplicação: $Origem"
            return
        }
        $raizOrigem = (Resolve-Path $Origem).Path
        Ok "Usando a pasta local $raizOrigem"
    } else {
        $zip = Join-Path $tempBase 'app.zip'
        Info 'Baixando do GitHub...'
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        } catch { }
        Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing
        Info 'Descompactando...'
        Expand-Archive -Path $zip -DestinationPath $tempBase -Force

        $candidatos = Get-ChildItem -Path $tempBase -Directory | Where-Object { $_.Name -like 'orca3-*' }
        if (-not $candidatos) {
            Falhou 'Não encontrei o conteúdo do pacote baixado.'
            return
        }
        $raizOrigem = $candidatos[0].FullName
        Ok 'Download concluído'
    }

    if (-not (Test-Path (Join-Path $raizOrigem 'server.js'))) {
        Falhou 'Os arquivos baixados não parecem ser a aplicação.'
        return
    }

    # ------------------------------------------------------------------ 3. copia
    Passo 3 "Instalando em $Pasta"

    $novo = -not (Test-Path (Join-Path $Pasta 'server.js'))
    New-Item -ItemType Directory -Force -Path $Pasta | Out-Null

    # lista fechada: só o que a aplicação precisa (nada de dados, backups ou lixo)
    $itens = @(
        'server.js', 'package.json', 'README.md',
        'src', 'public', 'tools', 'docs', 'docker', '.github',
        'Dockerfile', '.dockerignore', '.gitignore',
        'docker-compose.yml', 'docker-compose.ghcr.yml', 'docker-compose.casaos.yml',
        'instalar.sh', 'instalar-windows.ps1', 'INSTALAR.cmd', 'iniciar.cmd',
        'desinstalar-windows.ps1', 'DESINSTALAR.cmd',
        'modelo_importacao_produtos.xlsx', 'modelo_importacao_produtos.csv'
    )

    $copiados = 0
    foreach ($item in $itens) {
        $origemItem = Join-Path $raizOrigem $item
        if (-not (Test-Path $origemItem)) { continue }
        $destinoItem = Join-Path $Pasta $item
        if (Test-Path $origemItem -PathType Container) {
            if (Test-Path $destinoItem) { Remove-Item $destinoItem -Recurse -Force }
            Copy-Item $origemItem -Destination $destinoItem -Recurse -Force
        } else {
            Copy-Item $origemItem -Destination $destinoItem -Force
        }
        $copiados++
    }

    if (-not (Test-Path (Join-Path $Pasta 'server.js'))) {
        Falhou 'A cópia não trouxe o server.js. Instalação abortada.'
        return
    }
    Ok "$copiados item(ns) copiado(s)"

    $pastaDados = Join-Path $Pasta 'data'
    New-Item -ItemType Directory -Force -Path $pastaDados | Out-Null

    if (Test-Path (Join-Path $pastaDados 'orcamentos.db')) {
        Ok 'Banco de dados existente preservado'
    } else {
        Ok 'Pasta de dados criada'
    }

    # ------------------------------------------------------------------ 4. inicializador
    Passo 4 'Criando o inicializador'

    $iniciar = Join-Path $Pasta 'iniciar.cmd'
    $nodeParaUsar = '"' + $nodeExe + '"'
    $conteudo = @"
@echo off
title Central de Orcamentos
cd /d "%~dp0"
set "NODE_ENV=production"
set "PORT=$Porta"
set "HOST=127.0.0.1"
echo.
echo  Central de Orcamentos
echo  Abrindo em http://127.0.0.1:$Porta
echo  Para encerrar: feche esta janela ou pressione Ctrl+C
echo.
start "" "http://127.0.0.1:$Porta"
$nodeParaUsar server.js
echo.
echo  Servidor encerrado.
pause
"@
    Set-Content -Path $iniciar -Value $conteudo -Encoding Default -Force
    Ok "iniciar.cmd criado (porta $Porta)"

    # ------------------------------------------------------------------ 5. semear
    Passo 5 'Preparando o banco de dados'

    $db = Join-Path $pastaDados 'orcamentos.db'
    if (-not (Test-Path $db)) {
        Push-Location $Pasta
        try {
            & $nodeExe 'tools\seed-inicial.js' 2>&1 | Out-Null
        } catch {
            Aviso "Não foi possível semear a base: $($_.Exception.Message)"
        }
        Pop-Location
        if (Test-Path $db) { Ok 'Banco criado com 1 produto de teste' }
    } else {
        Ok 'Banco já existe — dados mantidos'
    }

    # ------------------------------------------------------------------ 6. atalho
    if (-not $SemAtalho) {
        Passo 6 'Criando o atalho na área de trabalho'
        $locais = @(
            [Environment]::GetFolderPath('Desktop'),
            (Join-Path $env:USERPROFILE 'Desktop'),
            (Join-Path $env:USERPROFILE 'OneDrive\Desktop'),
            (Join-Path $env:USERPROFILE 'OneDrive\Área de Trabalho')
        ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

        $criado = $false
        foreach ($local in $locais) {
            try {
                $atalho = Join-Path $local 'Central de Orçamentos.lnk'
                $ws = New-Object -ComObject WScript.Shell
                $lnk = $ws.CreateShortcut($atalho)
                $lnk.TargetPath = $iniciar
                $lnk.WorkingDirectory = $Pasta
                $lnk.Description = 'Central de Orçamentos'
                $lnk.IconLocation = "$env:SystemRoot\System32\shell32.dll,21"
                $lnk.WindowStyle = 7
                $lnk.Save()
                Ok "Atalho criado em $local"
                $criado = $true
                break
            } catch {
                continue
            }
        }
        if (-not $criado) {
            Aviso 'Não foi possível criar o atalho automaticamente.'
            Info "Crie um atalho manualmente para: $iniciar"
        }
    }

    # ------------------------------------------------------------------ 7. iniciar
    Write-Host ""
    Linha
    if ($novo) {
        Write-Host "  INSTALAÇÃO CONCLUÍDA" -ForegroundColor Green
    } else {
        Write-Host "  ATUALIZAÇÃO CONCLUÍDA" -ForegroundColor Green
    }
    Linha
    Write-Host ""
    Info "Pasta:   $Pasta"
    Info "Acesso:  http://127.0.0.1:$Porta"
    Info "Atalho:  Área de trabalho > Central de Orçamentos"
    Write-Host ""

    if (-not $NaoIniciar) {
        Info 'Iniciando o sistema...'
        Start-Process -FilePath $iniciar -WorkingDirectory $Pasta
        Start-Sleep -Seconds 4

        $arquivoSenha = Join-Path $pastaDados 'PRIMEIRO_ACESSO.txt'
        if (Test-Path $arquivoSenha) {
            Write-Host ""
            Write-Host "  PRIMEIRO ACESSO" -ForegroundColor Yellow
            Get-Content $arquivoSenha | ForEach-Object { Write-Host "    $_" -ForegroundColor Yellow }
            Write-Host ""
            Info 'Guarde a senha e troque no primeiro acesso.'
        }
    } else {
        Info "Para iniciar: abra o atalho ou rode $iniciar"
    }

    Write-Host ""
    Info 'Para desinstalar: apague a pasta acima (o backup é a subpasta data).'
    Write-Host ""
} finally {
    if (Test-Path $tempBase) {
        Remove-Item $tempBase -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
if (-not $SemPausa) {
    Read-Host 'Pressione Enter para fechar'
}
