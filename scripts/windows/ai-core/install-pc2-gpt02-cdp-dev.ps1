param(
  [Parameter(Mandatory=$true)][string]$OwnerChannel,
  [Parameter(Mandatory=$true)][string]$ConversationId,
  [string]$AccountAlias = "GPT02",
  [string]$BrowserProfile = "gpt02-vmsc",
  [int]$CdpPort = 18802,
  [string]$WorkerId = "openclaw-pc-worker-2",
  [string]$AiCoreDir = "$env:LOCALAPPDATA\AI-Core",
  [string]$WorkerEnvFile = "$env:USERPROFILE\aicore-worker-bootstrap\ai-workers.env",
  [string]$PrivateKeyFile = "$env:LOCALAPPDATA\AI-Core\pc2-chatgpt-wake-attestation-ed25519.pem"
)

$ErrorActionPreference = "Stop"
if ($WorkerId -ne "openclaw-pc-worker-2") { throw "This installer is scoped to PC2 only." }
if ($AccountAlias -ne "GPT02") { throw "This installer is scoped to GPT02 failover." }
if ($OwnerChannel -notmatch '^ai-engine-oauth:[a-f0-9]{64}$') { throw "Invalid GPT02 owner channel." }
if ($ConversationId -notmatch '^[A-Za-z0-9-]{30,64}$') { throw "Invalid conversation ID." }
if ($BrowserProfile -notmatch '^[a-z0-9][a-z0-9-]{0,63}$') { throw "OpenClaw profile name must be lowercase letters/numbers/hyphens." }
if ($CdpPort -lt 1024 -or $CdpPort -gt 65535) { throw "Invalid CDP port." }

$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$openclaw = (Get-Command openclaw.cmd -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$python = (Get-Command python.exe -ErrorAction Stop).Source
$executor = Join-Path $AiCoreDir "dell-wake-executor.mjs"
$registrationInstaller = Join-Path $AiCoreDir "install-dev-chatgpt-session-auto-register.ps1"
$required = @(
  $chrome, $openclaw, $node, $python, $executor, $registrationInstaller, $WorkerEnvFile, $PrivateKeyFile,
  (Join-Path $AiCoreDir "register-dev-chatgpt-session.py"),
  (Join-Path $AiCoreDir "dev-chatgpt-wake-once.py"),
  (Join-Path $AiCoreDir "dev_chatgpt_native_lease.py"),
  (Join-Path $AiCoreDir "dev_chatgpt_native_reader.py"),
  (Join-Path $AiCoreDir "dev_chatgpt_native_transport.py"),
  (Join-Path $AiCoreDir "dev-chatgpt-native-bridge.ps1"),
  (Join-Path $AiCoreDir "dev-chatgpt-native-composer.psm1")
)
foreach ($path in $required) {
  if (-not (Test-Path $path)) { throw "Required PC2 bound-worker file missing: $path" }
}

$envRows = @{}
Get-Content $WorkerEnvFile | ForEach-Object {
  if ($_ -match '^\s*([A-Z0-9_]+)=(.*)$') {
    $envRows[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
  }
}
if ($envRows['AI_CORE_OPENCLAW_CLIENT_ID'] -ne $WorkerId) { throw "Worker env identity mismatch." }
if ($envRows['AI_CORE_BASE_URL'] -ne 'https://dev.cstlogistic.co.id/api') { throw "DEV-only AI Core base URL required." }
if (-not $envRows['AI_CORE_SCOPED_AGENT_TOKEN']) { throw "Scoped PC2 agent token is missing." }

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

$gatewayRunner = Join-Path $AiCoreDir "run-openclaw-gateway-pc2.ps1"
@(
  '$ErrorActionPreference = "Continue"',
  '& "' + $openclaw + '" gateway run --allow-unconfigured --bind loopback --port 18789 --auth none *>> "' + (Join-Path $AiCoreDir "openclaw-gateway-pc2.log") + '"',
  'exit $LASTEXITCODE'
) | Set-Content -Path $gatewayRunner -Encoding UTF8

$bytes = [Text.Encoding]::UTF8.GetBytes("dev-chatgpt-wake-binding/v1|" + $AccountAlias + "|" + $OwnerChannel + "|" + $ConversationId.ToLower() + "|" + $WorkerId + "|" + $BrowserProfile)
$sha = [Security.Cryptography.SHA256]::Create()
$fingerprint = -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString("x2") })
$allowlist = @{
  enabled = $true
  bindings = @(@{
    accountAlias = $AccountAlias
    ownerChannel = $OwnerChannel
    targetConversationId = $ConversationId.ToLower()
    workerId = $WorkerId
    browserProfile = $BrowserProfile
    bindingFingerprint = $fingerprint
    enabled = $true
  })
} | ConvertTo-Json -Depth 6
$allowlistPath = Join-Path $AiCoreDir "pc2-chatgpt-wake-allowlist.json"
$allowlist | Set-Content -Path $allowlistPath -Encoding UTF8

$executorRunner = Join-Path $AiCoreDir "run-pc2-bound-wake-executor.ps1"
@(
  '$ErrorActionPreference = "Continue"',
  '$env:AI_CORE_DEV_WAKE_WORKER_ID = "' + $WorkerId + '"',
  '$env:AI_CORE_DEV_WAKE_ENV_FILE = "' + $WorkerEnvFile + '"',
  '$env:AI_CORE_DEV_WAKE_ALLOWLIST_FILE = "pc2-chatgpt-wake-allowlist.json"',
  '$env:AI_CORE_DEV_WAKE_PRIVATE_KEY_FILE = "' + [IO.Path]::GetFileName($PrivateKeyFile) + '"',
  '$env:AI_CORE_OPENCLAW_CMD = "' + $openclaw + '"',
  '& "' + $node + '" "' + $executor + '" *>> "' + (Join-Path $AiCoreDir "pc2-bound-wake-executor.log") + '"',
  'exit $LASTEXITCODE'
) | Set-Content -Path $executorRunner -Encoding UTF8

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME

foreach ($task in @(
  @{Name="AI Core GPT02 Browser PC2 DEV"; Runner=$browserRunner},
  @{Name="AI Core OpenClaw Gateway PC2 DEV"; Runner=$gatewayRunner},
  @{Name="AI Core Bound Wake Executor PC2 DEV"; Runner=$executorRunner}
)) {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $task.Runner + '"') -WorkingDirectory $AiCoreDir
  Register-ScheduledTask -TaskName $task.Name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
}

Stop-ScheduledTask -TaskName "AI Core OpenClaw PC2 DEV" -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName "AI Core GPT02 Browser PC2 DEV"
Start-ScheduledTask -TaskName "AI Core OpenClaw Gateway PC2 DEV"
Start-Sleep -Seconds 4

& $openclaw browser create-profile --name $BrowserProfile --driver existing-session --cdp-url ("http://127.0.0.1:" + $CdpPort) --user-data-dir $profileDir 2>$null
if ($LASTEXITCODE -ne 0) {
  $profiles = & $openclaw browser profiles --json
  if ($profiles -notmatch ('"' + [Regex]::Escape($BrowserProfile) + '"')) {
    throw "Unable to create or verify OpenClaw PC2 browser profile."
  }
}

Start-ScheduledTask -TaskName "AI Core Bound Wake Executor PC2 DEV"

& $registrationInstaller -AccountAlias $AccountAlias -OwnerChannel $OwnerChannel -ConversationId $ConversationId -WorkerId $WorkerId -BrowserProfile $BrowserProfile -PrivateKeyFile $PrivateKeyFile -WorkerEnvFile $WorkerEnvFile -AiCoreDir $AiCoreDir -PythonExe $python -TaskName "AI Core GPT02 Session Auto Register PC2 DEV"

Get-ScheduledTask -TaskName "AI Core GPT02 Browser PC2 DEV","AI Core OpenClaw Gateway PC2 DEV","AI Core Bound Wake Executor PC2 DEV","AI Core GPT02 Session Auto Register PC2 DEV" | Select-Object TaskName,State
