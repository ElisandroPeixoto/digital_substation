# Cria o ambiente virtual (.venv), instala dependências, compila o frontend e sobe o simulador
# em http://127.0.0.1:8000
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $root '.venv'
$py = Join-Path $venv 'Scripts\python.exe'

if (-not (Test-Path $py)) {
    Write-Host '==> Criando ambiente virtual em .venv'
    python -m venv $venv
}

Write-Host '==> Dependências do backend'
& $py -m pip install --quiet -r "$root\backend\requirements.txt"

Push-Location "$root\frontend"
if (-not (Test-Path node_modules)) {
    Write-Host '==> npm install'
    npm install --no-audit --no-fund
}
if (-not (Test-Path dist)) {
    Write-Host '==> npm run build'
    npm run build
}
Pop-Location

Write-Host '==> Simulador em http://127.0.0.1:8000  (Ctrl+C para encerrar)'
Push-Location "$root\backend"
& $py -m uvicorn app.main:app --host 127.0.0.1 --port 8000
Pop-Location
