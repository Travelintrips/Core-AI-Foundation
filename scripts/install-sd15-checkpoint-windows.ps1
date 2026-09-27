param(
  [string]$ComfyRoot = "$env:USERPROFILE\ComfyUI",
  [string]$FileName = "v1-5-pruned-emaonly.safetensors"
)

$ErrorActionPreference = "Stop"

$checkpointDir = Join-Path $ComfyRoot "models\checkpoints"
$target = Join-Path $checkpointDir $FileName
$url = "https://huggingface.co/stable-diffusion-v1-5/stable-diffusion-v1-5/resolve/main/v1-5-pruned-emaonly.safetensors?download=true"
$expectedSha256 = "6ce0161689b3853acaa03779ec93eafe75a02f4ced659bee03f50797806fa2fa"

New-Item -ItemType Directory -Path $checkpointDir -Force | Out-Null

if (Test-Path $target) {
  Write-Host "Checkpoint already exists:"
  Write-Host "  $target"
} else {
  Write-Host "Downloading SD 1.5 checkpoint (~4.27 GB)..."
  Write-Host "Destination:"
  Write-Host "  $target"

  $bits = Get-Command Start-BitsTransfer -ErrorAction SilentlyContinue
  if ($bits) {
    Start-BitsTransfer -Source $url -Destination $target -DisplayName "SD 1.5 checkpoint"
  } else {
    Invoke-WebRequest -Uri $url -OutFile $target -UseBasicParsing
  }
}

Write-Host ""
Write-Host "Verifying SHA256..."
$actual = (Get-FileHash $target -Algorithm SHA256).Hash.ToLowerInvariant()

if ($actual -ne $expectedSha256) {
  throw "Checkpoint SHA256 mismatch. Expected $expectedSha256 but got $actual"
}

$sizeGb = [math]::Round((Get-Item $target).Length / 1GB, 2)
Write-Host "Checkpoint verified."
Write-Host "File: $target"
Write-Host "Size: $sizeGb GB"
Write-Host "SHA256: $actual"
Write-Host ""
Write-Host "Restart ComfyUI after this download so the checkpoint list refreshes."
