param(
  [Parameter(Mandatory=$true)][string]$ConversationId,
  [string]$BrowserProfile = "gpt02-vmsc",
  [int]$CdpPort = 18802,
  [string]$WorkerId = "openclaw-pc-worker-2",
  [string]$AiCoreDir = "$env:LOCALAPPDATA\AI-Core",
  [string]$WorkerEnvFile = "$env:LOCALAPPDATA\AI-Core\worker2-dev.env"
)

$ErrorActionPreference = "Stop"
if ($WorkerId -ne "openclaw-pc-worker-2") { throw "This installer is scoped to PC2 only." }
if ($ConversationId -notmatch '^[A-Za-z0-9-]{30,64}$') { throw "Invalid conversation ID." }
if ($BrowserProfile -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') { throw "Invalid browser profile." }
if ($CdpPort -lt 1024 -or $CdpPort -gt 65535) { throw "Invalid CDP port." }

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$consumer = Join-Path $AiCoreDir "openclaw-direct-chatgpt-consumer.mjs"
$e2eHelper = Join-Path $AiCoreDir "chatgpt-e2e-helper.mjs"
$profiledHelper = Join-Path $AiCoreDir "chatgpt-targeted-continue-profiled.mjs"
foreach ($required in @($chrome,$consumer,$e2eHelper,$profiledHelper,$WorkerEnvFile)) {
  if (-not (Test-Path $required)) { throw "Required file missing: $required" }
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$profileDir = Join-Path $AiCoreDir ("ChromeProfiles\" + $BrowserProfile)
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$browserRunner = Join-Path $AiCoreDir "start-gpt02-pc2-browser.ps1"
@(
  '$ErrorActionPreference = "Stop"',
  '$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"',
  '$profileDir = "' + $profileDir.Replace('"','\"') + '"',
  '$listening = $false',
  'try { $listening = [bool](Get-NetTCPConnection -LocalPort ' + $CdpPort + ' -State Listen -ErrorAction Stop) } catch {}',
  'if (-not $listening) {',
  '  Start-Process -FilePath $chrome -ArgumentList @(',
  '    "--remote-debugging-address=127.0.0.1",',
  '    "--remote-debugging-port=' + $CdpPort + '",',
  '    (''--user-data-dir="'' + $profileDir + ''"''),',
  '    "--no-first-run", "--no-default-browser-check",',
  '    "https://chatgpt.com/c/' + $ConversationId.ToLower() + '"',
  '  )',
  '}'
) | Set-Content -Path $browserRunner -Encoding UTF8

$consumerRunner = Join-Path $AiCoreDir "run-pc2-chatgpt-consumer.ps1"
@(
  '$ErrorActionPreference = "Continue"',
  '& "' + $node + '" "' + $consumer + '" --worker ' + $WorkerId +
    ' --env "' + $WorkerEnvFile + '" --profile ' + $BrowserProfile +
    ' --cdp-port ' + $CdpPort + ' --conversation-id ' + $ConversationId.ToLower() +
    ' --helper "' + $e2eHelper + '" *>> "' + (Join-Path $AiCoreDir "pc2-chatgpt-consumer.log") + '"',
  'exit $LASTEXITCODE'
) | Set-Content -Path $consumerRunner -Encoding UTF8

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

$browserAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $browserRunner + '"') -WorkingDirectory $AiCoreDir
Register-ScheduledTask -TaskName "AI Core GPT02 Browser PC2 DEV" -Action $browserAction -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

$consumerAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $consumerRunner + '"') -WorkingDirectory $AiCoreDir
Register-ScheduledTask -TaskName "AI Core OpenClaw PC2 DEV" -Action $consumerAction -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Start-ScheduledTask -TaskName "AI Core GPT02 Browser PC2 DEV"
Start-Sleep -Seconds 3
Start-ScheduledTask -TaskName "AI Core OpenClaw PC2 DEV"
Get-ScheduledTask -TaskName "AI Core GPT02 Browser PC2 DEV","AI Core OpenClaw PC2 DEV" | Select-Object TaskName,State
