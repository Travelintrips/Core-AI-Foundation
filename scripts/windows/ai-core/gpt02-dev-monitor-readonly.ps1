$ErrorActionPreference='Stop'
$root=Join-Path $env:LOCALAPPDATA 'AI-Core'
$now=Get-Date
$task=Get-ScheduledTask -TaskName 'AI Core DELL Wake Executor DEV'
$worker=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'node.exe' -and $_.CommandLine -match 'dell-wake-(event-listener|executor).mjs'})
$metadata=Join-Path $root 'native-response-metadata.jsonl'
$recent429=@()
$recent24h429=@()
$unverifiable429=@()
$malformedMetadataRows=0
$metadataMissing= -not (Test-Path -LiteralPath $metadata -PathType Leaf)
$metadataEmpty= (-not $metadataMissing -and (Get-Item -LiteralPath $metadata).Length -eq 0)
if(-not $metadataMissing){
  foreach($line in @(Get-Content $metadata)){
    try{$row=$line|ConvertFrom-Json -ErrorAction Stop}catch{$malformedMetadataRows++;continue}
    if($row -isnot [pscustomobject] -or
       ($row.responseStatus -isnot [int] -and $row.responseStatus -isnot [long]) -or
       $row.responseStatus -lt 100 -or $row.responseStatus -gt 599){
      $malformedMetadataRows++;continue
    }
    if($row.responseStatus -ne 429){continue}
    if(-not $row.capturedAtUtc){$unverifiable429+=,$row;continue}
    try{$stamp=[DateTimeOffset]::Parse([string]$row.capturedAtUtc).UtcDateTime}catch{$unverifiable429+=,$row;continue}
    $age=($now.ToUniversalTime()-$stamp).TotalSeconds
    if($age -lt 0){$unverifiable429+=,$row;continue}
    if($age -lt 86400){
      $recent24h429+=,$row
      if($age -lt 3600){$recent429+=,$row}
    }
  }
}
# Reuse the same duplicate-key-safe JSONL validation as the JS preclaim gate.
# If Node, the read-only CLI, or its JSON output is unavailable, fail closed.
$strictAuditBlocked=$true
$strictAuditReason='STRICT_RATE_AUDIT_UNAVAILABLE'
try{
  $strictCli=Join-Path $PSScriptRoot 'gpt02-rate-log-monitor-bridge.cjs'
  if(-not (Test-Path -LiteralPath $strictCli -PathType Leaf)){throw 'STRICT_AUDIT_CLI_MISSING'}
  $node=(Get-Command node -ErrorAction Stop).Source
  $lines=@(& $node $strictCli $metadata 2>$null)
  if($LASTEXITCODE -ne 0 -or $lines.Count -ne 1){throw 'STRICT_AUDIT_BAD_RESULT'}
  $audit=$lines[0]|ConvertFrom-Json -ErrorAction Stop
  if($audit.scope -ne 'GPT02_DELL_DEV_MONITOR_READONLY' -or
     $audit.blocked -isnot [bool] -or -not $audit.reason){throw 'STRICT_AUDIT_RESULT_UNVERIFIED'}
  $strictAuditBlocked=$audit.blocked
  $strictAuditReason=[string]$audit.reason
}catch{}
# Informational pre-claim only; never overrides the strict operational circuit.
$preclaimGateClear=$false
$preclaimGateReason='PRECLAIM_OBSERVATION_UNAVAILABLE'
try{
  $preclaimCli=Join-Path $PSScriptRoot 'gpt02-preclaim-observer-readonly.mjs'
  $preclaimLines=@(& $node $preclaimCli 2>$null)
  if($LASTEXITCODE -ne 0 -or $preclaimLines.Count -ne 1){throw 'PRECLAIM_BAD_RESULT'}
  $preclaim=$preclaimLines[0]|ConvertFrom-Json -ErrorAction Stop
  if($preclaim.scope -ne 'GPT02_DEV_PRECLAIM_OBSERVATION' -or $preclaim.authorizesWorkerResume -ne $false){throw 'PRECLAIM_SCOPE_INVALID'}
  $preclaimGateClear=($preclaim.bothClear -eq $true)
  $preclaimGateReason=if($preclaimGateClear){'BOTH_EXECUTORS_CAPTURE_GATE_CLEAR'}else{'PRECLAIM_NOT_CLEAR'}
}catch{}
# Diagnostic-only effective audit; it must never override the official circuit.
$effectiveRateAuditAllowed=$false
$effectiveRateAuditReason='EFFECTIVE_AUDIT_UNAVAILABLE'
try{
  $effectiveCli=Join-Path $PSScriptRoot 'gpt02-effective-rate-audit-readonly.cjs'
  $effectiveLines=@(& $node $effectiveCli 2>$null)
  if($LASTEXITCODE -ne 0 -or $effectiveLines.Count -ne 1){throw 'EFFECTIVE_AUDIT_BAD_RESULT'}
  $effective=$effectiveLines[0]|ConvertFrom-Json -ErrorAction Stop
  if($effective.scope -ne 'GPT02_DEV_EFFECTIVE_RATE_AUDIT' -or
     $effective.authorizesWorkerResume -ne $false){throw 'EFFECTIVE_AUDIT_SCOPE_INVALID'}
  $effectiveRateAuditAllowed=($effective.effectiveAllowed -eq $true)
  $effectiveRateAuditReason=[string]$effective.reason
}catch{}
# Real recovery decision uses immutable source prefix + latest native HTTP 200 and
# independent exact ACK readback; no administrator-controlled override flag.
$recoveryAuthorized=$false
$recoveryReason='RECOVERY_POLICY_UNAVAILABLE'
try{
  $recoveryCli=Join-Path $PSScriptRoot 'gpt02-dev-recovery-policy.cjs'
  $recoveryLines=@(& $node $recoveryCli 2>$null)
  if($LASTEXITCODE -ne 0 -or $recoveryLines.Count -ne 1){throw 'RECOVERY_POLICY_BAD_RESULT'}
  $recovery=$recoveryLines[0]|ConvertFrom-Json -ErrorAction Stop
  if($recovery.scope -ne 'GPT02_DELL_DEV_RECOVERY' -or
     $recovery.authorized -isnot [bool]){throw 'RECOVERY_POLICY_UNVERIFIED'}
  $recoveryAuthorized=($recovery.authorized -eq $true)
  $recoveryReason=[string]$recovery.reason
}catch{}
$circuitOpen=(-not $recoveryAuthorized -or $metadataMissing -or $metadataEmpty -or $recent24h429.Count -ge 2 -or $malformedMetadataRows -gt 0)
if($recoveryAuthorized){
  # The legacy strict checker remains a diagnostic; the current effective rate
  # checker and independent recovery policy are both authoritative for resume.
  $strictAuditBlocked=$false
  $strictAuditReason='IMMUTABLE_LEGACY_QUARANTINED_NEW_RATE_AUDIT_CLEAR'
  $preclaimGateClear=$true
  $preclaimGateReason='BOTH_EXECUTORS_RECOVERY_EVIDENCE_CLEAR'
}
# Keep the old GET-capture rate circuit intact as historical evidence.
# The actual Task Scheduler action runs the SSE listener and one-shot executor,
# whose new exact local cache path performs no provider conversation GET.
$legacyGetCircuitOpen=$circuitOpen
$legacyGetStrictAuditBlocked=$strictAuditBlocked
$legacyGetRecoveryAuthorized=$recoveryAuthorized
$currentCacheRouteVerified=$false
try {
  $actionMatches=@($task.Actions | Where-Object { [string]$_.Arguments -match 'dell-wake-event-listener\.mjs' })
  if($actionMatches.Count -ne 1){throw 'CURRENT_LISTENER_ACTION_MISMATCH'}
  $cacheObserver=Join-Path $PSScriptRoot 'gpt02-current-listener-gate-readonly.mjs'
  if(-not (Test-Path -LiteralPath $cacheObserver -PathType Leaf)){throw 'CACHE_OBSERVER_MISSING'}
  $cacheLines=@(& $node $cacheObserver 2>$null)
  if($LASTEXITCODE -ne 0 -or $cacheLines.Count -ne 1){throw 'CACHE_OBSERVER_BAD_RESULT'}
  $cache=$cacheLines[0]|ConvertFrom-Json -ErrorAction Stop
  $currentCacheRouteVerified=(
    $cache.scope -eq 'GPT02_DEV_CURRENT_LISTENER_GATE_OBSERVATION' -and
    $cache.preclaimAllowed -eq $true -and $cache.resumeAllowed -eq $true -and
    $cache.cacheArchitectureVerified -eq $true -and
    $cache.reason -eq 'CURRENT_CACHE_WORKER_GATES_MATCH' -and
    $cache.authorizesDispatch -eq $false -and $cache.changesMade -eq $false -and
    $preclaimGateClear -eq $true -and
    -not $metadataMissing -and -not $metadataEmpty -and $malformedMetadataRows -eq 0
  )
}catch{$currentCacheRouteVerified=$false}
if($currentCacheRouteVerified){
  # Current worker gates are authoritative for GET-free cache mode.
  # Legacy GET 429s remain untouched, recorded separately below.
  $circuitOpen=$false
  $recoveryAuthorized=$true
  $recoveryReason='CURRENT_SSE_LOCAL_CACHE_GATES_VERIFIED'
  $strictAuditBlocked=$false
  $strictAuditReason='CURRENT_CACHE_MODE_VERIFIED_LEGACY_GET_429_RETAINED'
  $preclaimGateClear=$true
  $preclaimGateReason='CURRENT_SSE_LISTENER_LOCAL_CACHE_GATES_CLEAR'
}
$intentionalPause=($circuitOpen -and ($task.State -eq 'Ready' -or $task.State -eq 'Disabled') -and $worker.Count -eq 0)
$flags=@()
if($intentionalPause){$flags+='WORKER_PAUSED_BY_429_CIRCUIT'}
elseif($task.State -ne 'Running' -or $worker.Count -ne 1){$flags+='WORKER_NOT_RUNNING_OR_DUPLICATED'}
if($metadataMissing){$flags+='NATIVE_CAPTURE_RATE_LOG_MISSING'}
if($metadataEmpty){$flags+='NATIVE_CAPTURE_RATE_LOG_EMPTY'}
if($recent429.Count -gt 0){$flags+='NATIVE_429_LAST_HOUR'}
if($unverifiable429.Count -gt 0 -and -not $recoveryAuthorized){$flags+='NATIVE_429_TIMESTAMP_UNVERIFIED'}
if($malformedMetadataRows -gt 0){$flags+='NATIVE_CAPTURE_METADATA_MALFORMED'}
if($strictAuditBlocked){$flags+='NATIVE_CAPTURE_STRICT_AUDIT_BLOCKED'}
$result=[ordered]@{checkedAt=$now.ToUniversalTime().ToString('o');scope='DELL_DEV_LOCAL_ONLY';taskState=[string]$task.State;workerCount=$worker.Count;native429LastHour=$recent429.Count;native429Last24Hours=$recent24h429.Count;unverifiable429Count=$unverifiable429.Count;malformedMetadataRowCount=$malformedMetadataRows;nativeCaptureLogMissing=$metadataMissing;nativeCaptureLogEmpty=$metadataEmpty;strictRateAuditBlocked=$strictAuditBlocked;strictRateAuditReason=$strictAuditReason;preclaimGateClear=$preclaimGateClear;preclaimGateReason=$preclaimGateReason;effectiveRateAuditAllowed=$effectiveRateAuditAllowed;effectiveRateAuditReason=$effectiveRateAuditReason;operationalResumeAuthorized=$recoveryAuthorized;recoveryReason=$recoveryReason;rateLimitCircuitOpen=$circuitOpen;workerPauseExpected=$intentionalPause;flags=$flags;note='Local checks only. Server heartbeat and database pending ACK require separate Supabase checks.'}
$captureArchitecture='LEGACY_GET'
if($currentCacheRouteVerified){$captureArchitecture='LOCAL_CACHE_READBACK'}
$result['captureArchitecture']=$captureArchitecture
$result['currentCacheRouteVerified']=$currentCacheRouteVerified
$result['legacyGetRateCircuitOpen']=$legacyGetCircuitOpen
$result['legacyGetStrictAuditBlocked']=$legacyGetStrictAuditBlocked
$result['legacyGetRecoveryAuthorized']=$legacyGetRecoveryAuthorized
$json=$result|ConvertTo-Json -Compress -Depth 5
[IO.File]::WriteAllText((Join-Path $root 'gpt02-dev-monitor-latest.json'),$json)
$statePath=Join-Path $root 'gpt02-dev-monitor-alert-state.json'
$previous=@()
if(Test-Path $statePath){try{$previous=@((Get-Content $statePath -Raw|ConvertFrom-Json).flags)}catch{$previous=@()}}
$raised=@($flags|Where-Object {$_ -notin $previous})
$resolved=@($previous|Where-Object {$_ -notin $flags})
if($raised.Count -or $resolved.Count){
  $event=[ordered]@{at=$now.ToUniversalTime().ToString('o');raised=$raised;resolved=$resolved;flags=$flags;scope='DELL_DEV_LOCAL_ONLY'}|ConvertTo-Json -Compress
  [IO.File]::AppendAllText((Join-Path $root 'gpt02-dev-monitor-alerts.jsonl'),$event+[Environment]::NewLine)
}
[IO.File]::WriteAllText($statePath,([ordered]@{flags=$flags;checkedAt=$now.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress))
Write-Output $json