<#
.SYNOPSIS
    Atualizador da Central de Orçamentos para Windows.

.DESCRIPTION
    Baixa a versão mais recente do GitHub, faz backup do banco, substitui apenas os
    arquivos do sistema (mantendo a pasta data) e reinicia se estava rodando.

.PARAMETER Pasta
    Onde o sistema está instalado. Padrão: %LOCALAPPDATA%\CentralOrcamentos

.PARAMETER Origem
    Atualiza a partir de uma pasta local (sem baixar do GitHub).

.PARAMETER SemBackup
    Não cria o .zip de backup do banco antes de atualizar.

.PARAMETER Forcar
    Atualiza mesmo que a versão seja a mesma.

.PARAMETER Iniciar
    Abre o sistema no final, mesmo que estivesse fechado.

.PARAMETER SemPausa
    Não espera Enter no fim.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File atualizar-windows.ps1
#>
param(
    [string]$Pasta = "$env:LOCALAPPDATA\CentralOrcamentos",
    [string]$Origem = "",
    [switch]$SemBackup,
    [switch]$Forcar,
    [switch]$Iniciar,
    [switch]$SemPausa
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repo = 'SamuelNoia/orca3'
$zipUrl = "https://github.com/$repo/archive/refs/heads/main.zip"

function Linha { Write-Host ('-' * 62) -ForegroundColor DarkGray }
function Passo($n, $texto) { Write-Host ""; Write-Host "  [$n] $texto" -ForegroundColor White }
function Info($t) { Write-Host "      $t" -ForegroundColor Gray }
function Ok($t) { Write-Host "      OK  $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "      !   $t" -ForegroundColor Yellow }
function Falhou($t) { Write-Host "      X   $t" -ForegroundColor Red }

function VersaoDe($pasta) {
    $arq = Join-Path $pasta 'package.json'
    if (-not (Test-Path $arq)) { return $null }
    try {
        $j = Get-Content $arq -Raw | ConvertFrom-Json
        return [string]$j.version
    } catch {
        return $null
    }
}

function CompararVersao($a, $b) {
    try { return ([version]$a).CompareTo([version]$b) }
    catch { return [string]::CompareOrdinal($a, $b) }
}

function PararSistema($pasta) {
    $parados = 0
    try {
        $processos = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue
        foreach ($p in $processos) {
            if ($p.CommandLine -and $p.CommandLine.ToLower().Contains($pasta.ToLower())) {
                try {
                    Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
                    $parados++
                } catch { }
            }
        }
    } catch { }
    return $parados
}

Clear-Host
Write-Host ""
Write-Host "  ##########################################################" -ForegroundColor DarkCyan
Write-Host "  #                                                        #" -ForegroundColor DarkCyan
Write-Host "  #        CENTRAL DE ORÇAMENTOS - ATUALIZADOR             #" -ForegroundColor DarkCyan
Write-Host "  #                                                        #" -ForegroundColor DarkCyan
Write-Host "  ##########################################################" -ForegroundColor DarkCyan
Write-Host ""

# ------------------------------------------------------------------ 0. instalacao
Passo 0 'Localizando a instalação'

if (-not (Test-Path $Pasta)) {
    Falhou "Não encontrei a instalação em: $Pasta"
    Info 'Se instalou em outro lugar, use: -Pasta "C:\caminho"'
    Info 'Se ainda não instalou, use o INSTALAR.cmd'
    Write-Host ""
    if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' }
    return
}

if (-not (Test-Path (Join-Path $Pasta 'server.js'))) {
    Falhou "Esta pasta não parece ser a Central de Orçamentos: $Pasta"
    Write-Host ""
    if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' }
    return
}

$versaoAtual = VersaoDe $Pasta
if (-not $versaoAtual) { $versaoAtual = 'desconhecida' }
Ok "Instalação encontrada (versão $versaoAtual)"

# sistema rodando?
$rodando = $false
try {
    $processos = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue
    foreach ($p in $processos) {
        if ($p.CommandLine -and $p.CommandLine.ToLower().Contains($Pasta.ToLower())) { $rodando = $true; break }
    }
} catch { }
if ($rodando) { Aviso 'O sistema está aberto — será fechado para atualizar' }

# ------------------------------------------------------------------ 1. backup
if (Test-Path (Join-Path $Pasta 'data\orcamentos.db')) {
    if (-not $SemBackup) {
        Passo 1 'Salvando backup do banco'
        $pastaBackup = Join-Path $Pasta 'backups'
        New-Item -ItemType Directory -Force -Path $pastaBackup | Out-Null
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $arquivo = Join-Path $pastaBackup "orcamentos-$stamp.zip"
        try {
            if ($rodando) { PararSistema $Pasta | Out-Null; Start-Sleep -Milliseconds 400 }
            Compress-Archive -Path (Join-Path $Pasta 'data') -DestinationPath $arquivo -Force
            $kb = [math]::Round((Get-Item $arquivo).Length / 1KB, 1)
            Ok "Backup: $arquivo ($kb KB)"
        } catch {
            Falhou "Não consegui criar o backup: $($_.Exception.Message)"
            Info 'Atualização cancelada para não arriscar os dados.'
            Info 'Se quiser mesmo assim, rode com -SemBackup'
            Write-Host ""
            if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' }
            return
        }
    } else {
        Aviso 'Backup ignorado (-SemBackup)'
    }
} else {
    Ok 'Sem banco ainda — nada para copiar'
}

# ------------------------------------------------------------------ 2. download
Passo 2 'Obtendo a versão nova'
$tempBase = Join-Path $env:TEMP ('orcamentos-up-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tempBase | Out-Null

$arquivoBackup = $arquivo
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
        try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }
        Invoke-WebRequest -Uri $zipUrl -OutFile $zip -UseBasicParsing
        Info 'Descompactando...'
        Expand-Archive -Path $zip -DestinationPath $tempBase -Force
        $candidatos = Get-ChildItem -Path $tempBase -Directory | Where-Object { $_.Name -like 'orca3-*' }
        if (-not $candidatos) { Falhou 'Conteúdo do pacote inesperado.'; return }
        $raizOrigem = $candidatos[0].FullName
        Ok 'Download concluído'
    }

    $versaoNova = VersaoDe $raizOrigem
    if (-not $versaoNova) { $versaoNova = 'desconhecida' }
    Ok "Versão disponível: $versaoNova"

    if ((CompararVersao $versaoNova $versaoAtual) -le 0 -and -not $Forcar) {
        Write-Host ""
        Linha
        Write-Host "  JÁ ESTÁ ATUALIZADO (versão $versaoAtual)" -ForegroundColor Green
        Linha
        if ($rodando) {
            Info 'Reabrindo o sistema...'
            Start-Process -FilePath (Join-Path $Pasta 'iniciar.cmd') -WorkingDirectory $Pasta
        }
        Write-Host ""
        if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' }
        return
    }

    # ------------------------------------------------------------------ 3. aplica
    Passo 3 "Atualizando de $versaoAtual para $versaoNova"

    $parados = PararSistema $Pasta
    if ($parados -gt 0) { Ok "$parados processo(s) encerrado(s)" } else { Ok 'Nada rodando' }
    Start-Sleep -Milliseconds 500

    # 'iniciar.cmd' NÃO é copiado: ele tem a porta e o caminho do Node desta máquina
    $itens = @(
        'server.js', 'package.json', 'README.md',
        'src', 'public', 'tools', 'docs', 'docker', '.github',
        'Dockerfile', '.dockerignore', '.gitignore',
        'docker-compose.yml', 'docker-compose.ghcr.yml', 'docker-compose.casaos.yml',
        'instalar.sh', 'instalar-windows.ps1', 'INSTALAR.cmd',
        'atualizar-windows.ps1', 'ATUALIZAR.cmd',
        'desinstalar-windows.ps1', 'DESINSTALAR.cmd',
        'modelo_importacao_produtos.xlsx', 'modelo_importacao_produtos.csv'
    )

    $copiados = 0
    foreach ($item in $itens) {
        $origemItem = Join-Path $raizOrigem $item
        if (-not (Test-Path $origemItem)) { continue }
        $destinoItem = Join-Path $Pasta $item
        if (Test-Path $origemItem -PathType Container) {
            if (Test-Path $destinoItem) { Remove-Item $destinoItem -Recurse -Force -ErrorAction SilentlyContinue }
            Copy-Item $origemItem -Destination $destinoItem -Recurse -Force
        } else {
            Copy-Item $origemItem -Destination $destinoItem -Force
        }
        $copiados++
    }
    Ok "$copiados item(ns) atualizado(s)"

    New-Item -ItemType Directory -Force -Path (Join-Path $Pasta 'data') | Out-Null

    # ------------------------------------------------------------------ 4. reinicia
    Write-Host ""
    Linha
    Write-Host "  ATUALIZAÇÃO CONCLUÍDA — versão $versaoNova" -ForegroundColor Green
    Linha
    Write-Host ""
    Info "Pasta:  $Pasta"
    if ($arquivoBackup -and (Test-Path $arquivoBackup)) { Info "Backup: $arquivoBackup" }
    Info 'O banco é migrado automaticamente na próxima inicialização.'
    Write-Host ""

    if ($rodando -or $Iniciar) {
        $iniciar = Join-Path $Pasta 'iniciar.cmd'
        if (Test-Path $iniciar) {
            Info 'Abrindo o sistema...'
            Start-Process -FilePath $iniciar -WorkingDirectory $Pasta
        } else {
            Aviso 'iniciar.cmd não encontrado — abra pelo atalho da área de trabalho.'
        }
    } else {
        Info 'Abra pelo atalho quando quiser usar.'
    }
} finally {
    if (Test-Path $tempBase) {
        Remove-Item $tempBase -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host ""
if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' }
