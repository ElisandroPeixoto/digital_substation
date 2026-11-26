# Cria o ambiente virtual (.venv), instala dependências, compila o frontend e sobe o simulador
# em http://127.0.0.1:8000
#   ./run.ps1              -> porta 8000
#   ./run.ps1 -Port 8001   -> outra porta (os dados salvos no navegador – diagramas, ajustes de tela – são separados por porta)
param([int]$Port = 8000)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $root '.venv'
$py = Join-Path $venv 'Scripts\python.exe'

# porta ocupada (ex.: um servidor anterior que ficou aberto): avisa quem está usando em vez de falhar no meio do uvicorn
$busy = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($busy) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($busy.OwningProcess)" -ErrorAction SilentlyContinue
    Write-Host "A porta $Port já está em uso pelo processo $($busy.OwningProcess) ($($proc.Name), iniciado em $($proc.CreationDate))." -ForegroundColor Yellow
    Write-Host "  - Encerre-o:  Stop-Process -Id $($busy.OwningProcess) -Force   (se der 'Acesso negado', use o Gerenciador de Tarefas > Detalhes" -ForegroundColor Yellow
    Write-Host "    ou um PowerShell como Administrador)" -ForegroundColor Yellow
    Write-Host "  - ou use outra porta:  ./run.ps1 -Port 8001" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path $py)) {
    Write-Host '==> Criando ambiente virtual em .venv'
    python -m venv $venv
}

Write-Host '==> Dependências do backend'
& $py -m pip install --quiet --disable-pip-version-check -r "$root\backend\requirements.txt"

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

Write-Host "==> Simulador em http://127.0.0.1:$Port  (Ctrl+C para encerrar)"
Push-Location "$root\backend"
& $py -m uvicorn app.main:app --host 127.0.0.1 --port $Port
Pop-Location
