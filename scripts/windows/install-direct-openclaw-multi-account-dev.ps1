param(
  [string]$AiCoreDir = "$env:LOCALAPPDATA\AI-Core",
  [string]$NodeExe = "$env:LOCALAPPDATA\OpenClaw\deps\portable-node\node.exe",
  [string]$Worker1Env = "$env:USERPROFILE\aicore-worker-bootstrap\ai-worker-dev.env",
  [string]$Worker2Env = "$env:LOCALAPPDATA\AI-Core\worker2-dev.env"
)

$ErrorActionPreference = "Stop"
$consumer = Join-Path $AiCoreDir "openclaw-direct-chatgpt-consumer.mjs"
$helper = Join-Path $AiCoreDir "chatgpt-e2e-helper.mjs"
$targetedHelper = Join-Path $AiCoreDir "chatgpt-targeted-continue-profiled.mjs"
foreach ($required in @($NodeExe,$consumer,$helper,$targetedHelper,$Worker1Env,$Worker2Env)) {
  if (-not (Test-Path $required)) { throw "Required file missing: $required" }
}

function Register-DirectWorker {
  param([string]$TaskName,[string]$WorkerId,[string]$EnvFile,[string]$Profile,[int]$CdpPort,[string]$ConversationId,[string]$LogFile)
  $runner = Join-Path $AiCoreDir (($TaskName -replace '[^A-Za-z0-9_-]','-') + '.ps1')
  $nodeArgs = '"' + $consumer + '" --worker ' + $WorkerId + ' --env "' + $EnvFile + '" --profile ' + $Profile + ' --cdp-port ' + $CdpPort + ' --conversation-id ' + $ConversationId + ' --helper "' + $helper + '"'
  $runnerLines = @(
    '$ErrorActionPreference = ''Continue''' ,
    '& ''' + $NodeExe + ''' ' + $nodeArgs + ' *>> ''' + $LogFile + '''',
    'exit $LASTEXITCODE'
  )
  $runnerLines | Set-Content -Path $runner -Encoding UTF8
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $runner + '"') -WorkingDirectory $AiCoreDir
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
}

Register-DirectWorker -TaskName 'AI Core OpenClaw PC1 DEV' -WorkerId 'openclaw-pc-worker-dev' -EnvFile $Worker1Env -Profile 'travelincars-dev' -CdpPort 18801 -ConversationId '6ad74b05-0580-83ec-956a-80aaf4587985' -LogFile (Join-Path $AiCoreDir 'pc1-scheduled.log')
Register-DirectWorker -TaskName 'AI Core OpenClaw PC2 DEV' -WorkerId 'openclaw-pc-worker-2' -EnvFile $Worker2Env -Profile 'admcst001-dev' -CdpPort 18802 -ConversationId '6ad87510-6dd8-83ec-a064-14e4a3438d46' -LogFile (Join-Path $AiCoreDir 'pc2-scheduled.log')

Stop-ScheduledTask -TaskName 'AI Core OpenClaw PC1 DEV' -ErrorAction SilentlyContinue
Stop-ScheduledTask -TaskName 'AI Core OpenClaw PC2 DEV' -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName 'AI Core OpenClaw PC1 DEV'
Start-ScheduledTask -TaskName 'AI Core OpenClaw PC2 DEV'
Get-ScheduledTask -TaskName 'AI Core OpenClaw PC1 DEV','AI Core OpenClaw PC2 DEV' | Select-Object TaskName,State
