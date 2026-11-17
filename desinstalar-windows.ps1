<#
.SYNOPSIS
    Desinstalador da Central de Orçamentos para Windows.

.DESCRIPTION
    Para o sistema se estiver rodando, cria um backup do banco, remove o atalho
    da área de trabalho e apaga a pasta de instalação.

.PARAMETER Pasta
    Onde o sistema está instalado. Padrão: %LOCALAPPDATA%\CentralOrcamentos

.PARAMETER ManterDados
    Apaga o programa mas mantém a pasta data (banco, orçamentos, cliente).

.PARAMETER SemBackup
    Não cria o arquivo .zip de backup antes de apagar.

.PARAMETER Forcar
    Não pede confirmação.

.PARAMETER SemPausa
    Não espera Enter no fim.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File desinstalar-windows.ps1
#>
param(
    [string]$Pasta = "$env:LOCALAPPDATA\CentralOrcamentos",
    [switch]$ManterDados,
    [switch]$SemBackup,
    [switch]$Forcar,
    [switch]$SemPausa
)

$ErrorActionPreference = 'Stop'

function Linha { Write-Host ('-' * 62) -ForegroundColor DarkGray }
function Passo($n, $texto) { Write-Host ""; Write-Host "  [$n] $texto" -ForegroundColor White }
function Info($t) { Write-Host "      $t" -ForegroundColor Gray }
function Ok($t) { Write-Host "      OK  $t" -ForegroundColor Green }
function Aviso($t) { Write-Host "      !   $t" -ForegroundColor Yellow }
function Falhou($t) { Write-Host "      X   $t" -ForegroundColor Red }

Clear-Host
Write-Host ""
Write-Host "  ##########################################################" -ForegroundColor DarkYellow
Write-Host "  #                                                        #" -ForegroundColor DarkYellow
Write-Host "  #       CENTRAL DE ORÇAMENTOS - DESINSTALADOR            #" -ForegroundColor DarkYellow
Write-Host "  #                                                        #" -ForegroundColor DarkYellow
Write-Host "  ##########################################################" -ForegroundColor DarkYellow
Write-Host ""
Info "Pasta: $Pasta"
Write-Host ""

if (-not (Test-Path $Pasta)) {
    Falhou "A pasta não existe: $Pasta"
    Info 'Nada a fazer. Talvez o sistema esteja instalado em outro lugar.'
    Info 'Use: -Pasta "C:\outro\caminho"'
    Write-Host ""
    if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' }
    return
}

# proteção: só apaga o que parece ser a instalação
$marcadores = (Test-Path (Join-Path $Pasta 'server.js')) -and (Test-Path (Join-Path $Pasta 'src'))
if (-not $marcadores) {
    Falhou "A pasta não parece ser a Central de Orçamentos."
    Info "Esperava encontrar server.js e a pasta src em: $Pasta"
    if (-not $Forcar) {
        Info 'Por segurança nada foi apagado. Use -Forcar se tiver certeza.'
        Write-Host ""
        if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' }
        return
    }
    Aviso 'Continuando por causa de -Forcar'
}

$pastaDados = Join-Path $Pasta 'data'
$temDados = Test-Path (Join-Path $pastaDados 'orcamentos.db')

if (-not $Forcar) {
    Write-Host ""
    Linha
    Write-Host "  O que será feito:" -ForegroundColor Yellow
    if ($temDados) {
        if ($ManterDados) {
            Write-Host "   - manter a pasta data (banco e orçamentos)" -ForegroundColor Yellow
        } elseif (-not $SemBackup) {
            Write-Host "   - salvar um backup do banco em .zip" -ForegroundColor Yellow
            Write-Host "   - apagar a pasta data" -ForegroundColor Yellow
        } else {
            Write-Host "   - APAGAR a pasta data SEM backup" -ForegroundColor Red
        }
    }
    Write-Host "   - remover o atalho da área de trabalho" -ForegroundColor Yellow
    Write-Host "   - apagar a pasta $Pasta" -ForegroundColor Yellow
    Linha
    Write-Host ""
    $resposta = Read-Host '  Confirmar? (S/N)'
    if ($resposta -notmatch '^[SsYy]') {
        Info 'Cancelado. Nada foi alterado.'
        Write-Host ""
        if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' }
        return
    }
}

# ------------------------------------------------------------------ 1. parar
Passo 1 'Parando o sistema, se estiver rodando'
$parados = 0
try {
    $processos = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue
    foreach ($p in $processos) {
        if ($p.CommandLine -and $p.CommandLine.ToLower().Contains($Pasta.ToLower())) {
            try {
                Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
                $parados++
            } catch {
                Aviso "Não consegui parar o processo $($p.ProcessId)"
            }
        }
    }
} catch {
    Aviso "Não foi possível verificar os processos: $($_.Exception.Message)"
}
if ($parados -gt 0) { Ok "$parados processo(s) encerrado(s)" } else { Ok 'Nenhum processo em execução' }

Start-Sleep -Milliseconds 400

# ------------------------------------------------------------------ 2. backup
if ($temDados -and -not $ManterDados -and -not $SemBackup) {
    Passo 2 'Criando backup do banco'
    $pai = Split-Path $Pasta -Parent
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $arquivoBackup = Join-Path $pai ("CentralOrcamentos-backup-$stamp.zip")
    try {
        Compress-Archive -Path $pastaDados -DestinationPath $arquivoBackup -Force
        $kb = [math]::Round((Get-Item $arquivoBackup).Length / 1KB, 1)
        Ok "Backup salvo: $arquivoBackup ($kb KB)"
    } catch {
        $destino = Join-Path $pai ("CentralOrcamentos-backup-$stamp")
        try {
            Copy-Item $pastaDados -Destination $destino -Recurse -Force
            Aviso "Não deu para compactar; a pasta foi copiada para $destino"
        } catch {
            Falhou "Não consegui criar o backup: $($_.Exception.Message)"
            Aviso 'Desinstalação cancelada para não perder os dados.'
            Write-Host ""
            if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' }
            return
        }
    }
}

# ------------------------------------------------------------------ 3. atalhos
Passo 3 'Removendo atalhos da área de trabalho'
$locais = @(
    [Environment]::GetFolderPath('Desktop'),
    (Join-Path $env:USERPROFILE 'Desktop'),
    (Join-Path $env:USERPROFILE 'OneDrive\Desktop'),
    (Join-Path $env:USERPROFILE 'OneDrive\Área de Trabalho')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -Unique

$removidos = 0
foreach ($local in $locais) {
    $lnk = Join-Path $local 'Central de Orçamentos.lnk'
    if (Test-Path $lnk) {
        try {
            Remove-Item $lnk -Force
            $removidos++
        } catch {
            Aviso "Não consegui remover $lnk"
        }
    }
}
if ($removidos -gt 0) { Ok "$removidos atalho(s) removido(s)" } else { Ok 'Nenhum atalho encontrado' }

# ------------------------------------------------------------------ 4. pasta
Passo 4 'Removendo os arquivos do programa'
if ($ManterDados -and (Test-Path $pastaDados)) {
    Get-ChildItem -Path $Pasta -Force | Where-Object { $_.Name -ne 'data' } | ForEach-Object {
        Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
    Ok 'Programa removido; a pasta data foi mantida'
} else {
    Remove-Item $Pasta -Recurse -Force
    Ok 'Pasta de instalação removida'
}

# ------------------------------------------------------------------ fim
Write-Host ""
Linha
Write-Host "  DESINSTALAÇÃO CONCLUÍDA" -ForegroundColor Green
Linha
Write-Host ""
if ($ManterDados -and (Test-Path $pastaDados)) {
    Info "Seus dados continuam em: $pastaDados"
    Info 'Reinstale apontando o instalador para a mesma pasta para reaproveitar.'
}
if ($arquivoBackup -and (Test-Path $arquivoBackup)) {
    Info "Backup do banco: $arquivoBackup"
}
Write-Host ""

if (-not $SemPausa) { Read-Host 'Pressione Enter para fechar' }
