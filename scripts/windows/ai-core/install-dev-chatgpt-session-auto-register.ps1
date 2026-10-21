param(
  [Parameter(Mandatory=$true)][string]$AccountAlias,
  [Parameter(Mandatory=$true)][string]$OwnerChannel,
  [Parameter(Mandatory=$true)][string]$ConversationId,
  [Parameter(Mandatory=$true)][ValidateSet('openclaw-dell-chatgpt-wake-dev','openclaw-travelintrips-dev','openclaw-gpt02-session-dev')][string]$WorkerId,
  [Parameter(Mandatory=$true)][string]$BrowserProfile,
  [Parameter(Mandatory=$true)][string]$PrivateKeyFile,
  [Parameter(Mandatory=$true)][string]$WorkerEnvFile,
  [string]$AiCoreDir = "$env:LOCALAPPDATA\AI-Core",
  [string]$PythonExe = "python",
  [string]$TaskName = "AI Core ChatGPT Session Auto Register DEV"
)

$ErrorActionPreference = "Stop"
$helper = Join-Path $AiCoreDir "register-dev-chatgpt-session.py"
if (-not (Test-Path $helper)) { throw "Missing helper: $helper" }
if (-not (Test-Path $PrivateKeyFile)) { throw "Missing Ed25519 private key: $PrivateKeyFile" }
if (-not (Test-Path $WorkerEnvFile)) { throw "Missing worker env file: $WorkerEnvFile" }
if ($AccountAlias -notmatch '^GPT[0-9]{2,4}$' -or $AccountAlias -eq 'GPT01') { throw "Invalid account alias" }
if ($OwnerChannel -notmatch '^ai-engine-oauth:[a-f0-9]{64}$') { throw "Invalid owner channel" }
if ($ConversationId -notmatch '^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$') { throw "Invalid conversation ID" }
if ($BrowserProfile -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') { throw "Invalid browser profile" }

$runner = Join-Path $AiCoreDir "chatgpt-session-auto-register-dev.ps1"
$escapedHelper = $helper.Replace("'","''")
$escapedKey = $PrivateKeyFile.Replace("'","''")
$escapedWorkerEnv = $WorkerEnvFile.Replace("'","''")
$lines = @(
  '$ErrorActionPreference = "Stop"',
  '$env:AI_CORE_BASE_URL = "https://dev.cstlogistic.co.id/api"',
  '$env:AI_CORE_DEV_CHATGPT_ACCOUNT_ALIAS = "' + $AccountAlias + '"',
  '$env:AI_CORE_DEV_CHATGPT_OWNER_CHANNEL = "' + $OwnerChannel + '"',
  '$env:AI_CORE_DEV_CHATGPT_CONVERSATION_ID = "' + $ConversationId.ToLower() + '"',
  '$env:AI_CORE_DEV_WAKE_WORKER_ID = "' + $WorkerId + '"',
  '$env:AI_CORE_DEV_WAKE_BROWSER_PROFILE = "' + $BrowserProfile + '"',
  '$env:AI_CORE_DEV_WAKE_PRIVATE_KEY_FILE = ''' + $escapedKey + '''',
  '$env:AI_CORE_DEV_WAKE_ENV_FILE = ''' + $escapedWorkerEnv + '''',
  '$env:AI_CORE_DEV_SESSION_REGISTRATION_RETRY_SECONDS = "30"',
  '$env:AI_CORE_DEV_SESSION_REGISTRATION_MAX_WAIT_SECONDS = "3600"',
  '& "' + $PythonExe + '" ''' + $escapedHelper + ''' *>> (Join-Path $env:LOCALAPPDATA "AI-Core\session-auto-register.log")',
  'exit $LASTEXITCODE'
)
$lines | Set-Content -Path $runner -Encoding UTF8

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $runner + '"') -WorkingDirectory $AiCoreDir
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName,State
