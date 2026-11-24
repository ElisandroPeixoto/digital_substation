# Gera o executável do Eclipse (pasta com Eclipse.exe, sem console, com ícone) e o .zip para distribuição.
#   ./build-exe.ps1              -> roda frontend (build), testes, PyInstaller e compacta em release\Eclipse-<data>-<commit>.zip
#   ./build-exe.ps1 -SkipTests   -> pula o pytest
# Requer: .venv com as dependências do backend (run.ps1 a cria), Node/npm e acesso à internet na primeira vez (pip install pyinstaller).
param([switch]$SkipTests)
$ErrorActionPreference = 'Continue'   # comandos nativos escrevem avisos em stderr; os códigos de saída são verificados abaixo
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$py = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { throw 'Crie o ambiente primeiro: ./run.ps1 (cria a .venv).' }

Write-Host '==> Frontend (npm run build)'
Push-Location "$root\frontend"
if (-not (Test-Path node_modules)) { npm install --no-audit --no-fund }
npm run build
if ($LASTEXITCODE -ne 0) { throw 'Falha no build do frontend.' }
Pop-Location

if (-not $SkipTests) {
    Write-Host '==> Testes do backend'
    Push-Location "$root\backend"
    & $py -m pytest -q
    if ($LASTEXITCODE -ne 0) { throw 'Testes falharam: executável não gerado.' }
    Pop-Location
}

Write-Host '==> PyInstaller'
& $py -m pip install --quiet --disable-pip-version-check pyinstaller
if ($LASTEXITCODE -ne 0) { throw "pip install pyinstaller falhou." }
$out = Join-Path $root 'release'
if (Test-Path $out) { Remove-Item -Recurse -Force $out }
New-Item -ItemType Directory $out | Out-Null
& $py -m PyInstaller --noconfirm --clean --onedir --noconsole --name Eclipse `
    --icon "$root\assets\eclipse.ico" `
    --distpath "$out\dist" --workpath "$out\build" --specpath $out `
    --paths "$root\backend" `
    --add-data "$root\frontend\dist;frontend\dist" `
    --add-data "$root\assets\eclipse.ico;assets" `
    --collect-submodules uvicorn --collect-submodules anyio `
    --hidden-import multipart --hidden-import python_multipart --hidden-import h11 `
    "$root\launcher.py"
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller falhou.' }

$dir = "$out\dist\Eclipse"
@"
Eclipse - simulador de sistemas elétricos de potência (versão local)

Como usar
  1. Extraia este .zip em qualquer pasta (ex.: Documentos\Eclipse).
  2. Dê duplo clique em Eclipse.exe. O navegador abre em http://127.0.0.1:8000.
  3. Para encerrar, feche a janelinha "Eclipse em execução" (ou use o botão Encerrar).

Observações
  - Não precisa instalar Python nem Node. Roda só no seu computador (127.0.0.1).
  - Diagramas e configurações ficam guardados no navegador, na porta 8000; use sempre o mesmo navegador.
  - O Windows (SmartScreen) ou o antivírus podem avisar sobre um programa desconhecido: Mais informações > Executar assim mesmo.
  - Registro de erros: %LOCALAPPDATA%\Eclipse\eclipse.log
"@ | Set-Content -Encoding UTF8 "$dir\LEIAME.txt"

$hash = (git -C $root rev-parse --short HEAD) 2>$null
if (-not $hash) { $hash = 'local' }
$zip = Join-Path $out ("Eclipse-{0}-{1}.zip" -f (Get-Date -Format 'yyyyMMdd'), $hash)
Write-Host "==> Compactando $zip"
Compress-Archive -Path $dir -DestinationPath $zip -CompressionLevel Optimal
Write-Host ("Pronto: {0} ({1:N1} MB)" -f $zip, ((Get-Item $zip).Length / 1MB))
