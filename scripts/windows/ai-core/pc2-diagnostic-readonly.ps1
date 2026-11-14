# Read-only PC2 diagnostics. Does not open a browser, claim tasks, or access credentials.
# Intentionally not configurable at runtime: never inspect a different device.
$ExpectedHostname = 'DESKTOP-CPS76BH'

$ErrorActionPreference = 'Stop'

# Host identity is self-reported elsewhere. Never inspect a different machine by accident.
if ([string]::IsNullOrWhiteSpace($ExpectedHostname) -or
    -not [string]::Equals($env:COMPUTERNAME, $ExpectedHostname, [StringComparison]::OrdinalIgnoreCase)) {
  [pscustomobject]@{
    mode = 'READ_ONLY'
    targetMatched = $false
    status = 'WRONG_HOST'
    observedHostname = $env:COMPUTERNAME
  } | ConvertTo-Json -Compress
  exit 2
}

$taskNames = @(
  'AI Core OpenClaw PC2 DEV',
  'AI Core OpenClaw PC2 Consumer',
  'AI Core GPT02 Browser PC2 DEV'
)

$tasks = @(
  foreach ($taskName in $taskNames) {
    try {
      $task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
      $info = Get-ScheduledTaskInfo -TaskName $taskName -ErrorAction Stop
      [pscustomobject]@{
        name = $taskName
        state = [string]$task.State
        lastRunUtc = if ($info.LastRunTime.Year -gt 2000) { $info.LastRunTime.ToUniversalTime().ToString('o') } else { $null }
        lastResult = $info.LastTaskResult
      }
    } catch {
      [pscustomobject]@{ name = $taskName; state = 'NOT_FOUND_OR_INACCESSIBLE'; lastRunUtc = $null; lastResult = $null }
    }
  }
)

$consumers = @(
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'openclaw-pc2-consumer[.]mjs' } |
    ForEach-Object {
      [pscustomobject]@{
        pid = $_.ProcessId
        startedUtc = if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') } else { $null }
      }
    }
)

$knownPaths = @(
  [pscustomobject]@{ label='pc2-consumer'; path=(Join-Path $env:LOCALAPPDATA 'AI-Core\openclaw-pc2-consumer.mjs') },
  [pscustomobject]@{ label='chatgpt-helper'; path=(Join-Path $env:LOCALAPPDATA 'AI-Core\chatgpt-targeted-continue.mjs') },
  [pscustomobject]@{ label='portable-node'; path=(Join-Path $env:LOCALAPPDATA 'OpenClaw\deps\portable-node\node.exe') }
)
$installed = @(
  foreach ($item in $knownPaths) {
    [pscustomobject]@{ component = $item.label; exists = (Test-Path -LiteralPath $item.path -PathType Leaf) }
  }
)

$listeningPorts = @(
  Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in @(18789,18803,19001) } |
    Select-Object -ExpandProperty LocalPort -Unique |
    Sort-Object
)

[pscustomobject]@{
  mode = 'READ_ONLY'
  targetMatched = $true
  observedHostname = $env:COMPUTERNAME
  observedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  tasks = $tasks
  runningPc2Consumers = $consumers
  installedComponents = $installed
  localListeningPorts = $listeningPorts
  authSessionVerified = $false
  chatgptDeliveryVerified = $false
  dispatchPermitted = $false
  note = 'Presence/process checks do not grant permission to claim, replay or deliver pending work.'
} | ConvertTo-Json -Depth 6
