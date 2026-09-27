param(
  [string]$Prompt = "a modern office workspace, clean desk, laptop, natural light, realistic photo",
  [string]$NegativePrompt = "blurry, low quality, distorted, deformed",
  [string]$Checkpoint = "v1-5-pruned-emaonly.safetensors",
  [int]$Width = 512,
  [int]$Height = 512,
  [int]$Steps = 12,
  [int]$Seed = 42
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".env.development"

if (-not (Test-Path $envFile)) {
  throw ".env.development was not found at $envFile"
}

$adminLine = Select-String -Path $envFile -Pattern "^ADMIN_API_KEY=" | Select-Object -First 1
if (-not $adminLine) {
  throw "ADMIN_API_KEY is missing from .env.development"
}

$adminKey = $adminLine.Line.Split("=", 2)[1].Trim()
if (-not $adminKey) {
  throw "ADMIN_API_KEY is empty in .env.development"
}

$checkpointPath = Join-Path $env:USERPROFILE "ComfyUI\models\checkpoints\$Checkpoint"
if (-not (Test-Path $checkpointPath)) {
  throw "Checkpoint not found: $checkpointPath"
}

$workflow = @{
  "1" = @{
    class_type = "CheckpointLoaderSimple"
    inputs = @{
      ckpt_name = $Checkpoint
    }
  }
  "2" = @{
    class_type = "CLIPTextEncode"
    inputs = @{
      text = $Prompt
      clip = @("1", 1)
    }
  }
  "3" = @{
    class_type = "CLIPTextEncode"
    inputs = @{
      text = $NegativePrompt
      clip = @("1", 1)
    }
  }
  "4" = @{
    class_type = "EmptyLatentImage"
    inputs = @{
      width = $Width
      height = $Height
      batch_size = 1
    }
  }
  "5" = @{
    class_type = "KSampler"
    inputs = @{
      seed = $Seed
      steps = $Steps
      cfg = 6.5
      sampler_name = "euler"
      scheduler = "normal"
      denoise = 1.0
      model = @("1", 0)
      positive = @("2", 0)
      negative = @("3", 0)
      latent_image = @("4", 0)
    }
  }
  "6" = @{
    class_type = "VAEDecode"
    inputs = @{
      samples = @("5", 0)
      vae = @("1", 2)
    }
  }
  "7" = @{
    class_type = "SaveImage"
    inputs = @{
      filename_prefix = "core-ai-local"
      images = @("6", 0)
    }
  }
}

$headers = @{
  "x-admin-api-key" = $adminKey
  "Content-Type" = "application/json"
}

$body = @{
  workflow = $workflow
  clientId = "core-ai-local-test"
} | ConvertTo-Json -Depth 20

Write-Host "Submitting local image generation..."
Write-Host "Prompt: $Prompt"
Write-Host "Checkpoint: $Checkpoint"
Write-Host "Resolution: $Width x $Height"
Write-Host "Steps: $Steps"
Write-Host ""

$result = Invoke-RestMethod `
  -Method POST `
  -Uri "http://127.0.0.1:3000/api/ai/local-media/comfyui/workflows" `
  -Headers $headers `
  -Body $body

$result | ConvertTo-Json -Depth 10

if ($result.prompt_id) {
  Write-Host ""
  Write-Host "Queued successfully."
  Write-Host "Prompt ID: $($result.prompt_id)"
  Write-Host ""
  Write-Host "ComfyUI output folder:"
  Write-Host "  $env:USERPROFILE\ComfyUI\output"
}
