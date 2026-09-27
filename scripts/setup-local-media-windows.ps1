param(
  [string]$InstallRoot = "$env:USERPROFILE\ComfyUI",
  [switch]$SkipFfmpeg
)

$ErrorActionPreference = "Stop"

function Assert-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found."
  }
}

Write-Host ""
Write-Host "=== Core AI Local Media Setup (Windows / CPU-safe) ==="
Write-Host "ComfyUI path: $InstallRoot"
Write-Host ""

Assert-Command git

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  $python = Get-Command py -ErrorAction SilentlyContinue
}
if (-not $python) {
  throw "Python was not found. Install Python 3.11 or 3.12, then rerun this script."
}

if (-not $SkipFfmpeg) {
  if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
      Write-Warning "FFmpeg is not installed and winget is unavailable. Install FFmpeg manually, then rerun with -SkipFfmpeg."
    } else {
      Write-Host "[1/6] Installing FFmpeg..."
      winget install --id Gyan.FFmpeg --exact --accept-source-agreements --accept-package-agreements
    }
  } else {
    Write-Host "[1/6] FFmpeg already installed."
  }
} else {
  Write-Host "[1/6] FFmpeg step skipped."
}

if (-not (Test-Path $InstallRoot)) {
  Write-Host "[2/6] Cloning ComfyUI..."
  git clone https://github.com/comfyanonymous/ComfyUI.git $InstallRoot
} else {
  Write-Host "[2/6] ComfyUI folder already exists."
}

Push-Location $InstallRoot
try {
  if (-not (Test-Path ".venv")) {
    Write-Host "[3/6] Creating Python virtual environment..."
    if ((Get-Command py -ErrorAction SilentlyContinue)) {
      py -3 -m venv .venv
    } else {
      python -m venv .venv
    }
  } else {
    Write-Host "[3/6] Virtual environment already exists."
  }

  $venvPython = Join-Path $InstallRoot ".venv\Scripts\python.exe"
  if (-not (Test-Path $venvPython)) {
    throw "Virtual environment Python not found at $venvPython"
  }

  Write-Host "[4/6] Updating pip..."
  & $venvPython -m pip install --upgrade pip setuptools wheel

  Write-Host "[5/6] Installing CPU PyTorch and ComfyUI dependencies..."
  & $venvPython -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
  & $venvPython -m pip install -r requirements.txt

  $launcher = Join-Path $InstallRoot "start-core-ai-comfyui.ps1"
  @'
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $root ".venv\Scripts\python.exe"
Set-Location $root
& $python .\main.py --cpu --listen 127.0.0.1 --port 8188
'@ | Set-Content $launcher -Encoding UTF8

  Write-Host "[6/6] Launcher created:"
  Write-Host "  $launcher"
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "Setup complete."
Write-Host ""
Write-Host "Start ComfyUI with:"
Write-Host "  powershell -ExecutionPolicy Bypass -File \"$InstallRoot\start-core-ai-comfyui.ps1\""
Write-Host ""
Write-Host "Then verify:"
Write-Host "  Invoke-RestMethod http://127.0.0.1:8188/system_stats"
Write-Host ""
Write-Host "Model checkpoints are NOT downloaded by this script."
Write-Host "This prevents unexpected multi-GB downloads on machines with limited storage."
