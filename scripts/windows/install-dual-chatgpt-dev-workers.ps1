param(
  [string]$AiCoreDir = (Join-Path $env:LOCALAPPDATA 'AI-Core'),
  [string]$NodePath = (Join-Path $env:LOCALAPPDATA 'OpenClaw\deps\portable-node\node.exe'),
  [string]$Worker1Script = 'openclaw-pc1-dev-consumer.mjs',
  [string]$Worker2Script = 'openclaw-pc2-dev-consumer.mjs'
)

$ErrorActionPreference = 'Stop'

function Require-File([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "Required file not found: $Path"
  }
}

Require-File $NodePath

$worker1Path = Join-Path $AiCoreDir $Worker1Script
$worker2Path = Join-Path $AiCoreDir $Worker2Script
Require-File $worker1Path
Require-File $worker2Path

$wrapper1 = Join-Path $AiCoreDir 'run-pc1-dev.ps1'
$wrapper2 = Join-Path $AiCoreDir 'run-pc2-dev.ps1'
$log1 = Join-Path $AiCoreDir 'pc1-scheduled.log'
$log2 = Join-Path $AiCoreDir 'pc2-scheduled.log'

$wrapperTemplate = @'
$ErrorActionPreference = 'Continue'
$node = '__NODE__'
$script = '__SCRIPT__'
$log = '__LOG__'
& $node $script *>> $log
exit $LASTEXITCODE
'@

$wrapper1Content = $wrapperTemplate.Replace('__NODE__', $NodePath).Replace('__SCRIPT__', $worker1Path).Replace('__LOG__', $log1)
$wrapper2Content = $wrapperTemplate.Replace('__NODE__', $NodePath).Replace('__SCRIPT__', $worker2Path).Replace('__LOG__', $log2)

[IO.File]::WriteAllText($wrapper1, $wrapper1Content, (New-Object Text.UTF8Encoding($false)))
[IO.File]::WriteAllText($wrapper2, $wrapper2Content, (New-Object Text.UTF8Encoding($false)))

$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

function Install-DevWorkerTask([string]$TaskName, [string]$WrapperPath) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $WrapperPath + '"') -WorkingDirectory $AiCoreDir
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
}

Install-DevWorkerTask 'AI Core OpenClaw PC1 DEV' $wrapper1
Install-DevWorkerTask 'AI Core OpenClaw PC2 DEV' $wrapper2

# Intentionally do not stop, edit, or replace PC3 or any non-DEV task.
Get-ScheduledTask -TaskName 'AI Core OpenClaw PC1 DEV','AI Core OpenClaw PC2 DEV' |
  Select-Object TaskName, State
