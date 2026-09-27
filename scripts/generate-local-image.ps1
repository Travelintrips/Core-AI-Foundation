param(
  [Parameter(Mandatory=$true)]
  [string]$Prompt,
  [string]$NegativePrompt = "blurry, low quality, distorted, deformed, artifacts",
  [int]$Width = 512,
  [int]$Height = 512,
  [int]$Steps = 12,
  [double]$Cfg = 6.5,
  [int]$Seed = 0,
  [int]$TimeoutMs = 180000
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".env.development"

$adminLine = Select-String -Path $envFile -Pattern "^ADMIN_API_KEY=" | Select-Object -First 1
if (-not $adminLine) { throw "ADMIN_API_KEY is missing from .env.development" }

$headers = @{
  "x-admin-api-key" = $adminLine.Line.Split("=", 2)[1].Trim()
  "Content-Type" = "application/json"
}

$body = @{
  prompt = $Prompt
  negativePrompt = $NegativePrompt
  width = $Width
  height = $Height
  steps = $Steps
  cfg = $Cfg
  timeoutMs = $TimeoutMs
  waitForResult = $true
}

if ($Seed -gt 0) {
  $body.seed = $Seed
}

Write-Host "Generating local image..."
Write-Host "Prompt: $Prompt"
Write-Host ""

$result = Invoke-RestMethod `
  -Method POST `
  -Uri "http://127.0.0.1:3000/api/ai/local-media/images/generate" `
  -Headers $headers `
  -Body ($body | ConvertTo-Json -Depth 10)

$result | ConvertTo-Json -Depth 10

if ($result.outputs) {
  Write-Host ""
  Write-Host "Completed. Output:"
  foreach ($output in $result.outputs) {
    Write-Host "  $($output.filename)"
    Write-Host "  $($output.viewUrl)"
  }
  Write-Host ""
  Write-Host "Folder:"
  Write-Host "  $env:USERPROFILE\ComfyUI\output"
}
