param(
  [string]$RepoRoot = "$env:USERPROFILE\Core-AI-Foundation"
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Core AI Blender Local 3D Worker Setup ==="
Write-Host ""

$blender = Get-Command blender -ErrorAction SilentlyContinue

if (-not $blender) {
  $known = Get-ChildItem "C:\Program Files\Blender Foundation" -Directory -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending |
    ForEach-Object {
      Join-Path $_.FullName "blender.exe"
    } |
    Where-Object { Test-Path $_ } |
    Select-Object -First 1

  if ($known) {
    $blenderPath = $known
  } else {
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
      throw "Blender not found and winget is unavailable. Install Blender, then rerun this script."
    }

    Write-Host "[1/4] Installing Blender..."
    winget install --id BlenderFoundation.Blender --exact --accept-source-agreements --accept-package-agreements

    $known = Get-ChildItem "C:\Program Files\Blender Foundation" -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending |
      ForEach-Object { Join-Path $_.FullName "blender.exe" } |
      Where-Object { Test-Path $_ } |
      Select-Object -First 1

    if (-not $known) {
      throw "Blender installation completed but blender.exe could not be located."
    }
    $blenderPath = $known
  }
} else {
  $blenderPath = $blender.Source
}

Write-Host "[2/4] Blender found:"
Write-Host "  $blenderPath"

$workerScript = Join-Path $RepoRoot "scripts\blender\core_ai_blender_worker.py"
if (-not (Test-Path $workerScript)) {
  throw "Core AI Blender worker script not found: $workerScript. Run git pull first."
}

$envFile = Join-Path $RepoRoot ".env.development"
if (-not (Test-Path $envFile)) {
  throw ".env.development not found: $envFile"
}

Write-Host "[3/4] Updating local 3D runtime configuration..."

$lines = Get-Content $envFile
$settings = [ordered]@{
  "BLENDER_WORKER_RUNTIME_ENABLED" = "true"
  "BLENDER_EXECUTABLE_PATH" = $blenderPath
  "BLENDER_OUTPUT_DIR" = (Join-Path $env:USERPROFILE "Core-AI-3D-Output")
  "BLENDER_WORKER_SCRIPT" = $workerScript
}

foreach ($key in $settings.Keys) {
  $value = $settings[$key]
  $pattern = "^" + [regex]::Escape($key) + "="
  $found = $false
  $lines = $lines | ForEach-Object {
    if ($_ -match $pattern) {
      $found = $true
      "$key=$value"
    } else {
      $_
    }
  }
  if (-not $found) {
    $lines += "$key=$value"
  }
}

$lines | Set-Content $envFile -Encoding UTF8

Write-Host "[4/4] Verifying Blender headless mode..."
& $blenderPath --background --version
if ($LASTEXITCODE -ne 0) {
  throw "Blender headless verification failed with exit code $LASTEXITCODE"
}

Write-Host ""
Write-Host "Setup complete."
Write-Host "Restart Core AI so dispatcher-5 (3d_worker) is registered."
Write-Host ""
Write-Host "Then verify:"
Write-Host '  Invoke-RestMethod http://127.0.0.1:3000/api/ai/local-3d/status -Headers $headers | ConvertTo-Json -Depth 10'
