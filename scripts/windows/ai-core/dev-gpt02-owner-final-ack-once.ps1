#requires -Version 5.1
# Source-only DEV GPT02 trial2 final OWNER instruction, one supervised attempt.
# Requires a fresh, SHA-pinned ROOT verification of the real signed callback.
# This helper submits an owner prompt; it never calls MCP, signs, or verifies ACK.
# Use a separate supervisor with the existing 760000ms hard bound. UIA/SendWait
# and durable file flushes cannot be interrupted by the in-process stopwatch.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CallbackEvidenceFile,
    [Parameter(Mandatory)][ValidatePattern('\A[a-f0-9]{64}\z')][string]$ExpectedCallbackEvidenceSha256
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$finalBase = 'C:\Users\user\AppData\Local\Temp\gpt02-lease-review-20261020T1426'
$finalLocalRoot = 'C:\Users\user\AppData\Local'
$finalOperation = 'gpt02_trial2_20261020T1516'
$finalPhase = 'OWNER_FINAL_ACK'
$finalEvent = 'e8f45ed286cb3845d76311b10f72460aa585a9682a4f0a9f8fb864bfa974a645'
$finalOwner = 'ai-engine-oauth:48625572f3596a5eb60e1021b7dba25a26063a95583a991118f4d1d6c1861d86'
$finalFence = 'gpt02-takeover-20261020T153448Z-88837a97c333'
$finalCoordinator = 'chatgpt-root-88837a97c333'
$finalWorker = 'openclaw-dell-chatgpt-wake-dev'
$finalBinding = '494e4d2668b0003e166fce7022c34a53c97d63b5673c4f2caafc2e45154d86c9'
$finalWrapperSha = '375fbd8773a7899adb97efc8d3cafd303814c9285cc01202881d7e771c9d0637'
$finalModuleSha = '1c83bce21a937bc32bf26cc1086af8466c2061514ba3f1a880a167c5d040f816'
$finalPriorSha = 'bf7304bc2a6dcb96ce0174f4dedd6e2cea57d09afb9e2c61694f0ddb4250ed2d'
$finalWrapperPath = Join-Path $finalBase 'send-owner-prompt-once-v2.ps1'
$finalModulePath = Join-Path $finalLocalRoot 'AI-Core\dev-chatgpt-native-composer.psm1'
$finalBootstrapPath = Join-Path $finalBase ($finalOperation + '.owner-ui-reconcile.json')
$finalLeasePath = Join-Path $finalBase ($finalOperation + '.owner-ui-coordinator.lease.json')
$finalMarkerPath = Join-Path $finalBase ($finalOperation + '.owner-final-ack.jsonl')

# Names match ONLY the imported, pinned original wrapper declarations.
$ownerProfile = 'travelincars-dev'
$ownerConversationId = '6ad74b05-0580-83ec-956a-80aaf4587985'
$ownerPageUrl = 'https://chatgpt.com/c/' + $ownerConversationId
$ownerRawTargetId = '422144A861A73A19161672AEA8D3645F'
$ExpectedBrowserProcessId = 11688
$ExpectedBrowserProcessStartedAt = '2026-10-20T16:05:02.2898512Z'
$ExpectedWindowHandle = [long]658098
$ComposerName = 'Ask ChatGPT'
$AllowProviderLf = $true
$ownerClock = [Diagnostics.Stopwatch]::StartNew()
$ownerMaximumMilliseconds = [long]750000
$ownerCliMaximumMilliseconds = [long]75000
$ownerNativeGuardMilliseconds = [long]30000
$ownerNativeDeadlineMilliseconds = $null
$ownerSubmitMilliseconds = $null
$ownerModule = $null
$ownerPrompt = $null
$ownerNode = $null
$ownerOcEntry = $null
$ownerUserData = $null
$ownerRuntimeLockStream = $null
$ownerRuntimeLockHeld = $false
$finalExpiresAt = [DateTimeOffset]::UtcNow.AddMilliseconds($ownerMaximumMilliseconds)
$finalFrozen = [Collections.Generic.List[IO.FileStream]]::new()
$finalCleanup = [Collections.Generic.List[string]]::new()
$finalLeaseStream = $null
$finalLease = $null
$finalLeaseClaimed = $false
$finalLeaseReleased = $false
$finalMarker = $null
$finalRecord = $null
$finalPersisted = $false
$finalProof = $null
$finalInitialDraft = $null
$finalInitialSha = $null
$finalStage = 'VALIDATING_ROOT_CALLBACK_EVIDENCE'
$finalStatus = 'REFUSED_BEFORE_FINAL_ACK_RESERVATION'
$finalFailure = $null
$finalExitCode = 1

function Get-FinalAckSha {
    param([byte[]]$Bytes)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($hash.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() }
    finally { $hash.Dispose() }
}
function Read-FinalAckBytes {
    param([IO.FileStream]$Stream, [int]$MaximumBytes)
    if ($Stream.Length -lt 1 -or $Stream.Length -gt $MaximumBytes) { throw 'OWNER_FINAL_ACK_FILE_SIZE_INVALID' }
    $Stream.Position = 0
    $bytes = [byte[]]::new([int]$Stream.Length)
    $offset = 0
    while ($offset -lt $bytes.Length) {
        $read = $Stream.Read($bytes,$offset,$bytes.Length-$offset)
        if ($read -lt 1) { throw 'OWNER_FINAL_ACK_INCOMPLETE_READ' }
        $offset += $read
    }
    return ,$bytes
}
function Assert-FinalAckPath {
    param([string]$Path, [string]$Root = $finalBase, [bool]$MustExist = $true)
    if (-not [IO.Path]::IsPathRooted($Path)) { throw 'OWNER_FINAL_ACK_ABSOLUTE_PATH_REQUIRED' }
    $full = [IO.Path]::GetFullPath($Path)
    $allowed = [IO.Path]::GetFullPath($Root).TrimEnd([char]92)
    if (-not $full.StartsWith($allowed+'\',[StringComparison]::OrdinalIgnoreCase) -or
        -not [IO.Directory]::Exists($allowed) -or ($MustExist -and -not [IO.File]::Exists($full))) {
        throw 'OWNER_FINAL_ACK_FIXED_PATH_INVALID'
    }
    if ([IO.File]::Exists($full) -and (([IO.FileInfo]::new($full)).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw 'OWNER_FINAL_ACK_REPARSE_FILE_DENIED'
    }
    $directory = [IO.DirectoryInfo]::new([IO.Path]::GetDirectoryName($full))
    while ($null -ne $directory) {
        if (-not $directory.Exists -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'OWNER_FINAL_ACK_REPARSE_DIRECTORY_DENIED'
        }
        $directory = $directory.Parent
    }
    return $full
}
function Read-FinalAckPinned {
    param([string]$Path, [string]$Sha, [int]$MaximumBytes, [string]$Root = $finalBase)
    if ($Sha -cnotmatch '\A[a-f0-9]{64}\z') { throw 'OWNER_FINAL_ACK_HASH_REQUIRED' }
    $full = Assert-FinalAckPath $Path $Root
    $stream = [IO.File]::Open($full,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
        $null = Assert-FinalAckPath $full $Root
        $bytes = Read-FinalAckBytes $stream $MaximumBytes
        if ((Get-FinalAckSha $bytes) -cne $Sha) { throw 'OWNER_FINAL_ACK_PINNED_HASH_MISMATCH' }
        $value = [Text.UTF8Encoding]::new($false,$true).GetString($bytes)
        [void]$finalFrozen.Add($stream)
        return @{ Path=$full; Text=$value; Sha256=$Sha }
    } catch { $stream.Dispose(); throw }
}
function ConvertFrom-FinalAckObject {
    param([string]$Text)
    $value = $Text | ConvertFrom-Json -ErrorAction Stop
    if ($value -isnot [pscustomobject]) { throw 'OWNER_FINAL_ACK_JSON_OBJECT_REQUIRED' }
    return $value
}
function Assert-FinalAckTrue {
    param($Value)
    if ($Value -isnot [bool] -or -not $Value) { throw 'OWNER_FINAL_ACK_TRUE_EVIDENCE_REQUIRED' }
}
function Assert-FinalAckInteger {
    param($Value, [long]$Expected)
    if (($Value -isnot [int] -and $Value -isnot [long]) -or $Value -ne $Expected) {
        throw 'OWNER_FINAL_ACK_INTEGER_EVIDENCE_MISMATCH'
    }
}
function ConvertFrom-FinalAckUtc {
    param($Value)
    if ($Value -isnot [string] -or $Value -cnotmatch '\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z\z') {
        throw 'OWNER_FINAL_ACK_UTC_TIMESTAMP_REQUIRED'
    }
    return [DateTimeOffset]::Parse($Value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal)
}
function Assert-FinalAckFresh {
    param([long]$ReserveMilliseconds = 0)
    $now = [DateTimeOffset]::UtcNow
    $observed = ConvertFrom-FinalAckUtc $finalProof.observedAt
    $verified = ConvertFrom-FinalAckUtc $finalProof.verifiedAt
    $age = ($now-$observed).TotalMilliseconds
    if ($ReserveMilliseconds -lt 0 -or $age -lt 0 -or $age+$ReserveMilliseconds -gt 300000 -or $verified -gt $now) {
        throw 'OWNER_FINAL_ACK_CALLBACK_EVIDENCE_NOT_FRESH'
    }
}
function Assert-FinalAckGeneration {
    $browser = $null
    try {
        $browser = [Diagnostics.Process]::GetProcessById($ExpectedBrowserProcessId)
        if ($browser.HasExited -or $browser.StartTime.ToUniversalTime().Ticks -ne
            (ConvertFrom-FinalAckUtc $ExpectedBrowserProcessStartedAt).UtcDateTime.Ticks) {
            throw 'OWNER_FINAL_ACK_BROWSER_GENERATION_CHANGED'
        }
    } finally { if ($null -ne $browser) { $browser.Dispose() } }
}
function Assert-FinalAckBudget {
    param([long]$ReserveMilliseconds = 1)
    Assert-OwnerTimeBudget $ReserveMilliseconds
    if ([DateTimeOffset]::UtcNow.AddMilliseconds($ReserveMilliseconds) -ge $finalExpiresAt) {
        throw 'OWNER_FINAL_ACK_COORDINATOR_LEASE_EXPIRED'
    }
}
function Write-FinalAckLease {
    $finalLease.updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $bytes = [Text.Encoding]::UTF8.GetBytes(($finalLease | ConvertTo-Json -Depth 20 -Compress))
    $finalLeaseStream.Position = 0
    $finalLeaseStream.SetLength(0)
    $finalLeaseStream.Write($bytes,0,$bytes.Length)
    $finalLeaseStream.Flush($true)
}
function Write-FinalAckMarker {
    param([string]$Status)
    $script:finalPersisted = $false
    $finalRecord.status = $Status
    $finalRecord.stage = $finalStage
    $finalRecord.updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $finalRecord.elapsedMilliseconds = $ownerClock.ElapsedMilliseconds
    $bytes = [Text.Encoding]::UTF8.GetBytes(($finalRecord | ConvertTo-Json -Depth 12 -Compress) + [char]10)
    # The fixed marker is an append-only journal: no rewrites or truncation.
    $finalMarker.Write($bytes,0,$bytes.Length)
    $finalMarker.Flush($true)
    $script:finalPersisted = $true
}
function Assert-FinalAckInitialDraft {
    param($State)
    Assert-OwnerNativeIdle $State
    & $ownerModule { param($S,$N) Assert-AiCoreNativeInsertableDraft $S $N } $State $ComposerName
    if ($State.Draft -isnot [string] -or $State.Draft -cne $finalInitialDraft -or
        (Get-FinalAckSha ([Text.Encoding]::UTF8.GetBytes($State.Draft))) -cne $finalInitialSha) {
        throw 'OWNER_FINAL_ACK_INITIAL_DRAFT_CHANGED'
    }
}

try {
    if ($env:OS -cne 'Windows_NT' -or -not $env:LOCALAPPDATA -or -not $env:USERPROFILE -or
        -not [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd([char]92).Equals($finalLocalRoot,[StringComparison]::OrdinalIgnoreCase) -or
        -not [IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd([char]92).Equals('C:\Users\user',[StringComparison]::OrdinalIgnoreCase)) {
        throw 'OWNER_FINAL_ACK_FIXED_WINDOWS_ACCOUNT_REQUIRED'
    }
    $null = Assert-FinalAckPath $finalMarkerPath $finalBase $false
    if ([IO.File]::Exists($finalMarkerPath) -or [IO.Directory]::Exists($finalMarkerPath)) { throw 'OWNER_FINAL_ACK_ALREADY_RESERVED_NO_RETRY' }
    $proofFile = Read-FinalAckPinned $CallbackEvidenceFile $ExpectedCallbackEvidenceSha256 32768
    $finalProof = ConvertFrom-FinalAckObject $proofFile.Text
    $bindings = @{
        schema='ai-core-owner-final-ack-evidence/v1'; phase=$finalPhase; operationId=$finalOperation;
        coordinatorId=$finalCoordinator; coordinatorFence=$finalFence; ownerChannel=$finalOwner;
        targetConversationId=$ownerConversationId; eventId=$finalEvent; workerId=$finalWorker;
        bindingFingerprint=$finalBinding; browserProfile=$ownerProfile; rawTargetId=$ownerRawTargetId;
        browserProcessStartedAt=$ExpectedBrowserProcessStartedAt; signatureAlgorithm='Ed25519';
        commandStatus='COMPLETED'; responseKind='COMPLETED'; responseE2eCode='E2E_VERIFIED'
    }
    foreach ($key in $bindings.Keys) {
        if ($finalProof.$key -isnot [string] -or $finalProof.$key -cne $bindings[$key]) { throw 'OWNER_FINAL_ACK_CALLBACK_BINDING_MISMATCH' }
    }
    foreach ($key in @('signatureVerified','commandResponsePairVerified','browserConfirmed','browserPairingVerified','chatgptSubmitted','verifiedAssistantReply')) {
        Assert-FinalAckTrue $finalProof.$key
    }
    foreach ($key in @('commandId','responseId')) {
        if ($finalProof.$key -isnot [string] -or $finalProof.$key -cnotmatch '\A[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\z' -or
            [Guid]::Parse($finalProof.$key) -eq [Guid]::Empty) { throw 'OWNER_FINAL_ACK_ACTUAL_UUID_REQUIRED' }
    }
    if ($finalProof.commandId -ceq $finalProof.responseId -or $null -ne $finalProof.responseAcknowledgedAt) { throw 'OWNER_FINAL_ACK_UNACKNOWLEDGED_RESPONSE_REQUIRED' }
    Assert-FinalAckInteger $finalProof.browserProcessId $ExpectedBrowserProcessId
    Assert-FinalAckInteger $finalProof.windowHandle $ExpectedWindowHandle
    Assert-FinalAckInteger $finalProof.matchedCommandCount 1
    Assert-FinalAckInteger $finalProof.matchedResponseCount 1
    Assert-FinalAckInteger $finalProof.targetInflightCount 0
    Assert-FinalAckInteger $finalProof.exitCode 0
    $received = ConvertFrom-FinalAckUtc $finalProof.commandReceivedAt
    $created = ConvertFrom-FinalAckUtc $finalProof.responseCreatedAt
    if ($created -lt $received -or (ConvertFrom-FinalAckUtc $finalProof.observedAt) -lt $created -or
        (ConvertFrom-FinalAckUtc $finalProof.verifiedAt) -lt $created) { throw 'OWNER_FINAL_ACK_CALLBACK_CHRONOLOGY_INVALID' }
    Assert-FinalAckFresh

    $wrapper = Read-FinalAckPinned $finalWrapperPath $finalWrapperSha 262144
    $null = Read-FinalAckPinned $finalModulePath $finalModuleSha 262144 $finalLocalRoot
    $null = Read-FinalAckPinned (Join-Path $finalBase ($finalOperation+'.owner-ui-prompt.json')) $finalPriorSha 16384
    $bootstrapFile = Read-FinalAckPinned $finalBootstrapPath $finalProof.bootstrapReceiptSha256 32768
    $bootstrap = ConvertFrom-FinalAckObject $bootstrapFile.Text
    if ($bootstrap.schema -cne 'ai-core-owner-ui-reconciliation/v1' -or $bootstrap.purpose -cne 'TARGET_OWNER_UI_PROMPT_CONTINUATION' -or
        $bootstrap.operationId -cne $finalOperation -or $bootstrap.coordinatorId -cne $finalCoordinator -or
        $bootstrap.eventId -cne $finalEvent -or $bootstrap.ownerChannel -cne $finalOwner -or
        $bootstrap.conversationId -cne $ownerConversationId -or $bootstrap.coordinatorFence -cne $finalFence -or
        $bootstrap.status -cne 'SEND_INVOKED_DELIVERY_UNVERIFIED') {
        throw 'OWNER_FINAL_ACK_SUCCESSFUL_BOOTSTRAP_REQUIRED'
    }
    Assert-FinalAckTrue $bootstrap.sendInvoked
    Assert-FinalAckTrue $bootstrap.sendInvocationReturned
    Assert-FinalAckInteger $bootstrap.exactWholeReadbacks 2

    $tokens = $null; $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput($wrapper.Text,[ref]$tokens,[ref]$parseErrors)
    if ($parseErrors.Count -ne 0 -or $null -eq $ast.EndBlock) { throw 'OWNER_FINAL_ACK_WRAPPER_PARSE_FAILED' }
    $declarations = @($ast.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] })
    foreach ($name in @('Assert-OwnerTimeBudget','Get-OwnerCommandRemainingMilliseconds','Assert-OwnerRuntimeLockPath',
        'ConvertTo-OwnerWindowsArgument','Start-OwnerOpenClaw','Stop-OwnerOpenClaw','Receive-OwnerOpenClaw',
        'Invoke-OwnerOpenClaw','Assert-OwnerSession','Assert-OwnerIdleSnapshot','Assert-OwnerNativeIdle')) {
        $definition = @($declarations | Where-Object { $_.Name -ceq $name })
        if ($definition.Count -ne 1) { throw 'OWNER_FINAL_ACK_WRAPPER_DECLARATION_AMBIGUOUS' }
        . ([scriptblock]::Create($definition[0].Extent.Text))
    }
    $ownerNode = Join-Path $finalLocalRoot 'OpenClaw\deps\portable-node\node.exe'
    $ownerOcEntry = Join-Path $finalLocalRoot 'OpenClaw\deps\portable-node\node_modules\openclaw\openclaw.mjs'
    $ownerUserData = Join-Path $env:USERPROFILE '.openclaw\browser\travelincars-dev\user-data'
    if (-not [IO.File]::Exists($ownerNode) -or -not [IO.File]::Exists($ownerOcEntry)) { throw 'OWNER_FINAL_ACK_EXISTING_OPENCLAW_UNAVAILABLE' }
    # Only validated UUIDs are substituted. The signed wake's ATTEST_ACK-only
    # response remains separate from this later, authorized owner instruction.
    $ownerPrompt = 'OWNER_FINAL_ACK for GPT02 trial2, operation ' + $finalOperation + '. This is the separately authorized final owner instruction after the wake reply. Root verified the real worker Ed25519 callback for event ' + $finalEvent + ', command ' + $finalProof.commandId + ', response ' + $finalProof.responseId + ', target ' + $ownerConversationId + '. Use only your existing connected Travelincars app. Call read_ai_core_events once with conversationId=' + $finalOwner + ' and limit=100. Require returned conversationId to match exactly, and one event whose id=' + $finalProof.responseId + ', commandId=' + $finalProof.commandId + ', kind=COMPLETED, metadata.eventId=' + $finalEvent + ', metadata.conversationId=' + $ownerConversationId + ', metadata.e2eCode=E2E_VERIFIED and metadata.verifiedAssistantReply=true. Only if every check matches, call ack_ai_core_event once with responseId=' + $finalProof.responseId + ' and conversationId=' + $finalOwner + '. On missing data, mismatch, or tool error, stop and report the actual result without ACK. Report the actual acknowledged Boolean and responseId; never infer ACK from this instruction. Do not subscribe, dispatch commands, create another wake, or repeat an ACK.'
    if ($ownerPrompt.Length -gt 4096 -or $ownerPrompt -cmatch '[^\x20-\x7e]') { throw 'OWNER_FINAL_ACK_PROMPT_INVALID' }
    $promptSha = Get-FinalAckSha ([Text.Encoding]::UTF8.GetBytes($ownerPrompt))
    $ownerSubmitMilliseconds = [long](1000 * [Math]::Min(240,[Math]::Max(60,[Math]::Ceiling((30+0.051*$ownerPrompt.Length)/5)*5)))
    $ownerModule = Import-Module -Name $finalModulePath -Force -PassThru -ErrorAction Stop
    if ($ownerModule -isnot [Management.Automation.PSModuleInfo]) { throw 'OWNER_FINAL_ACK_MODULE_IMPORT_AMBIGUOUS' }
    $literal = & $ownerModule { param($Message) ConvertTo-AiCoreLiteralKeys $Message } $ownerPrompt
    $ownerTarget = @{ ConversationId=$ownerConversationId; PageUrl=$ownerPageUrl; ComposerName=$ComposerName;
        WindowHandle=$ExpectedWindowHandle; BrowserProcessId=$ExpectedBrowserProcessId }

    $finalStage = 'CLAIMING_RELEASED_BOOTSTRAP_COORDINATOR_LEASE'
    $null = Assert-FinalAckPath $finalLeasePath
    $finalLeaseStream = [IO.File]::Open($finalLeasePath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
    $null = Assert-FinalAckPath $finalLeasePath
    $leaseBytes = Read-FinalAckBytes $finalLeaseStream 65536
    if ($finalProof.coordinatorLeaseSha256 -isnot [string] -or $finalProof.coordinatorLeaseSha256 -cnotmatch '\A[a-f0-9]{64}\z' -or
        (Get-FinalAckSha $leaseBytes) -cne $finalProof.coordinatorLeaseSha256) { throw 'OWNER_FINAL_ACK_PREDECESSOR_LEASE_HASH_MISMATCH' }
    $previous = ConvertFrom-FinalAckObject ([Text.UTF8Encoding]::new($false,$true).GetString($leaseBytes))
    if ($previous.schema -cne 'ai-core-owner-coordinator-lease/v1' -or $previous.fenceToken -cne $finalFence -or
        $previous.coordinatorId -cne $finalCoordinator -or $previous.eventId -cne $finalEvent -or
        $previous.phase -cne 'OWNER_RECONCILIATION' -or $previous.terminalStatus -cne 'SEND_INVOKED_DELIVERY_UNVERIFIED' -or
        ($previous.ownerPid -isnot [int] -and $previous.ownerPid -isnot [long]) -or
        $previous.ownerPid -lt 1 -or $previous.ownerPid -gt [int]::MaxValue -or $previous.ownerPid -eq $PID -or
        $previous.ownerPid -ne $bootstrap.ownerPid) { throw 'OWNER_FINAL_ACK_PREDECESSOR_LEASE_NOT_TRANSFERABLE' }
    Assert-FinalAckTrue $previous.released
    $oldOwner = $null
    try { $oldOwner = [Diagnostics.Process]::GetProcessById([int]$previous.ownerPid) } catch [ArgumentException] { }
    if ($null -ne $oldOwner) { $oldOwner.Dispose(); throw 'OWNER_FINAL_ACK_PREDECESSOR_STILL_RUNNING' }
    $finalLease = [ordered]@{}
    foreach ($property in $previous.PSObject.Properties) { $finalLease[$property.Name] = $property.Value }
    $finalLease.finalAckPredecessorLease = $previous
    $finalLease.phase = $finalPhase; $finalLease.ownerPid = $PID
    $finalLease.acquiredAt = [DateTimeOffset]::UtcNow.ToString('o'); $finalLease.expiresAt = $finalExpiresAt.ToString('o')
    $finalLease.released = $false; $finalLease.terminalStatus = $null
    $finalLease.finalAckEvidenceSha256 = $ExpectedCallbackEvidenceSha256; $finalLease.finalAckMarkerPath = $finalMarkerPath
    Assert-FinalAckBudget 5000
    Write-FinalAckLease
    $finalLeaseClaimed = $true

    $finalStage = 'ACQUIRING_EXISTING_NATIVE_UI_LOCK'
    $ownerRuntimeLockPath = Join-Path $finalLocalRoot 'AI-Core\chatgpt-wake-dev-receipts\native-transport.lock'
    Assert-OwnerRuntimeLockPath $ownerRuntimeLockPath
    $ownerRuntimeLockStream = [IO.File]::Open($ownerRuntimeLockPath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
    Assert-OwnerRuntimeLockPath $ownerRuntimeLockPath
    if ($ownerRuntimeLockStream.Length -lt 1) { throw 'OWNER_FINAL_ACK_NATIVE_LOCK_EMPTY' }
    $ownerRuntimeLockStream.Lock(0,1); $ownerRuntimeLockHeld = $true
    Assert-FinalAckGeneration
    Assert-FinalAckBudget 5000
    Assert-FinalAckFresh
    $finalRecord = [ordered]@{
        schema='ai-core-owner-final-ack/v1'; phase=$finalPhase; operationId=$finalOperation;
        eventId=$finalEvent; ownerChannel=$finalOwner; conversationId=$ownerConversationId;
        commandId=$finalProof.commandId; responseId=$finalProof.responseId; workerId=$finalWorker;
        coordinatorId=$finalCoordinator; coordinatorFence=$finalFence; ownerPid=$PID;
        browserProfile=$ownerProfile; rawTargetId=$ownerRawTargetId; browserProcessId=$ExpectedBrowserProcessId;
        browserProcessStartedAt=$ExpectedBrowserProcessStartedAt; windowHandle=$ExpectedWindowHandle;
        callbackEvidenceSha256=$ExpectedCallbackEvidenceSha256; databaseObservedAt=$finalProof.observedAt;
        bootstrapReceiptSha256=$finalProof.bootstrapReceiptSha256; predecessorLeaseSha256=$finalProof.coordinatorLeaseSha256;
        wrapperSha256=$finalWrapperSha; moduleSha256=$finalModuleSha; promptSha256=$promptSha; promptBytes=$ownerPrompt.Length;
        createdAt=[DateTimeOffset]::UtcNow.ToString('o'); initialDraftClass=$null; initialDraftSha256=$null; initialDraftLength=$null;
        keyEndAttemptedAt=$null; keyEndInvoked=$false; literalInputAttemptedAt=$null; literalInputInvoked=$false;
        sendAttemptedAt=$null; sendInvoked=$false; sendInvocationReturned=$false; exactWholeReadbacks=0;
        signatureVerifiedByRoot=$true; signatureVerifiedByHelper=$false;
        focusAttemptedAt=$null; focusInvoked=$false; focusInvocationReturned=$false; focusVerified=$false;
        directMcpInvoked=$false; ownerAckVerified=$false; deliveryVerified=$false; realE2eVerified=$false; replayAllowed=$false;
        receiptPath=$finalMarkerPath
    }
    # Permanent phase reservation precedes even the read-only CLI preflight.
    $finalMarker = [IO.File]::Open($finalMarkerPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    Write-FinalAckMarker 'FINAL_ACK_RESERVED'
    $finalStage = 'OC_IDENTITY_AND_IDLE_READ'
    Assert-OwnerSession
    Assert-OwnerIdleSnapshot
    Assert-FinalAckBudget ($ownerSubmitMilliseconds+$ownerNativeGuardMilliseconds)
    $finalStage = 'NATIVE_INITIAL_DRAFT_READ'
    $state = & $ownerModule { param($T) Get-AiCoreNativeState $T $false } $ownerTarget
    Assert-OwnerNativeIdle $state
    if ($state.Draft -isnot [string]) { throw 'OWNER_FINAL_ACK_NATIVE_DRAFT_NOT_STRING' }
    if ($state.Draft -ceq '') { $finalRecord.initialDraftClass = 'EXPLICIT_EMPTY' }
    elseif ($state.Draft -ceq ($ComposerName+[char]10)) { $finalRecord.initialDraftClass = 'UNKNOWN_NAME_PLUS_LF_APPEND_ONLY' }
    else { throw 'OWNER_FINAL_ACK_EXISTING_DRAFT_PRESERVED' }
    $finalInitialDraft = $state.Draft
    $finalInitialSha = Get-FinalAckSha ([Text.Encoding]::UTF8.GetBytes($finalInitialDraft))
    $finalRecord.initialDraftSha256 = $finalInitialSha; $finalRecord.initialDraftLength = $finalInitialDraft.Length
    Assert-FinalAckInitialDraft $state
    Assert-FinalAckGeneration
    Assert-FinalAckBudget ($ownerSubmitMilliseconds+$ownerNativeGuardMilliseconds)
    # Reserve the whole input bound within the original DB observation's age.
    Assert-FinalAckFresh ($ownerSubmitMilliseconds+$ownerNativeGuardMilliseconds)
    $ownerNativeDeadlineMilliseconds = $ownerClock.ElapsedMilliseconds+$ownerSubmitMilliseconds+$ownerNativeGuardMilliseconds

    # The original module's normal composer SetFocus is the only focus action.
    # Reserve durably first; require the identical draft and strict focus after it.
    $finalStage = 'NATIVE_COMPOSER_FOCUS_INTENT'
    $finalRecord.focusAttemptedAt = [DateTimeOffset]::UtcNow.ToString('o'); $finalRecord.focusInvoked = $null
    Write-FinalAckMarker 'FOCUS_ATTEMPTING'
    $beforeFocus = & $ownerModule { param($T) Get-AiCoreNativeState $T $false } $ownerTarget
    Assert-FinalAckInitialDraft $beforeFocus
    Assert-FinalAckGeneration
    Assert-FinalAckBudget 5000
    Assert-FinalAckFresh
    & $ownerModule { param($S) Set-AiCoreNativeFocus $S } $beforeFocus
    $finalRecord.focusInvoked = $true; $finalRecord.focusInvocationReturned = $true
    $focused = & $ownerModule { param($T) Get-AiCoreNativeState $T $true } $ownerTarget
    Assert-FinalAckInitialDraft $focused
    $finalRecord.focusVerified = $true

    $finalStage = 'NATIVE_END_KEY_INTENT'
    $finalRecord.keyEndAttemptedAt = [DateTimeOffset]::UtcNow.ToString('o'); $finalRecord.keyEndInvoked = $null
    Write-FinalAckMarker 'INPUT_ATTEMPTING'
    $beforeEnd = & $ownerModule { param($T) Get-AiCoreNativeState $T $true } $ownerTarget
    Assert-FinalAckInitialDraft $beforeEnd
    Assert-FinalAckGeneration
    Assert-FinalAckBudget 5000
    Assert-FinalAckFresh
    & $ownerModule { Send-AiCoreNativeKeys '^{END}' }
    $finalRecord.keyEndInvoked = $true
    $finalStage = 'NATIVE_LITERAL_INPUT_INTENT'
    $finalRecord.literalInputAttemptedAt = [DateTimeOffset]::UtcNow.ToString('o'); $finalRecord.literalInputInvoked = $null
    Write-FinalAckMarker 'INPUT_ATTEMPTING'
    $beforeLiteral = & $ownerModule { param($T) Get-AiCoreNativeState $T $true } $ownerTarget
    Assert-FinalAckInitialDraft $beforeLiteral
    Assert-FinalAckGeneration
    Assert-FinalAckBudget $ownerSubmitMilliseconds
    Assert-FinalAckFresh $ownerSubmitMilliseconds
    & $ownerModule { param($Keys) Send-AiCoreNativeKeys $Keys } $literal
    $finalRecord.literalInputInvoked = $true
    $finalStage = 'NATIVE_FIRST_WHOLE_READBACK'
    Assert-FinalAckBudget 5000
    $first = & $ownerModule { param($T) Get-AiCoreNativeState $T $true } $ownerTarget
    & $ownerModule { param($S,$P,$Lf) Assert-AiCoreNativeReadback $S $P $Lf } $first $ownerPrompt $AllowProviderLf
    Assert-OwnerNativeIdle $first
    $finalRecord.exactWholeReadbacks = 1
    $finalRecord.firstWholeReadbackSha256 = Get-FinalAckSha ([Text.Encoding]::UTF8.GetBytes($first.Draft))
    $finalStage = 'NATIVE_SEND_INTENT'
    $finalRecord.sendAttemptedAt = [DateTimeOffset]::UtcNow.ToString('o'); $finalRecord.sendInvoked = $null
    Write-FinalAckMarker 'SEND_ATTEMPTING'
    Assert-FinalAckBudget 5000
    $second = & $ownerModule { param($T) Get-AiCoreNativeState $T $true } $ownerTarget
    & $ownerModule { param($S,$P,$Lf) Assert-AiCoreNativeReadback $S $P $Lf } $second $ownerPrompt $AllowProviderLf
    Assert-OwnerNativeIdle $second
    $finalRecord.exactWholeReadbacks = 2
    $finalRecord.secondWholeReadbackSha256 = Get-FinalAckSha ([Text.Encoding]::UTF8.GetBytes($second.Draft))
    $finalStage = 'NATIVE_TWO_WHOLE_READBACKS_VERIFIED'
    Write-FinalAckMarker 'SEND_ATTEMPTING'
    $send = & $ownerModule { param($S) Get-AiCoreNativeSendControl $S } $second
    Assert-FinalAckGeneration
    Assert-FinalAckBudget 5000
    Assert-FinalAckFresh
    & $ownerModule { param($Pattern) Invoke-AiCoreNativeSend $Pattern } $send
    $finalRecord.sendInvoked = $true; $finalRecord.sendInvocationReturned = $true
    $finalRecord.sendReturnedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $finalStage = 'OWNER_FINAL_ACK_INSTRUCTION_SUBMITTED_ONLY'
    $finalStatus = 'SEND_INVOKED_OWNER_ACK_UNVERIFIED'
    Write-FinalAckMarker $finalStatus
    $finalExitCode = 0
} catch {
    $finalStatus = 'FAILED_FINAL_ACK_PRESERVE_ATTEMPT'
    $finalFailure = 'OWNER_FINAL_ACK_GUARD_OR_NATIVE_ACTION_FAILED'
    if ($_.Exception.Message -cmatch '\AOWNER_[A-Z0-9_]{1,110}\z') { $finalFailure = $_.Exception.Message }
    # A failed append may have left a partial tail. Never append behind it.
    if ($null -ne $finalMarker -and $finalPersisted) {
        $finalRecord.failureCode = $finalFailure
        try { Write-FinalAckMarker $finalStatus } catch { }
    }
} finally {
    if ($finalLeaseClaimed) {
        try {
            $finalLease.released=$true; $finalLease.releasedAt=[DateTimeOffset]::UtcNow.ToString('o'); $finalLease.terminalStatus=$finalStatus
            Write-FinalAckLease
            $finalLeaseReleased=$true
        } catch { [void]$finalCleanup.Add('COORDINATOR_LEASE_RELEASE_FAILED') }
    }
    if ($null -ne $finalMarker) { try { $finalMarker.Dispose() } catch { [void]$finalCleanup.Add('FINAL_ACK_MARKER_DISPOSE_FAILED') } }
    foreach ($stream in $finalFrozen) { try { $stream.Dispose() } catch { [void]$finalCleanup.Add('PINNED_EVIDENCE_DISPOSE_FAILED') } }
    if ($null -ne $ownerRuntimeLockStream) {
        if ($ownerRuntimeLockHeld) { try { $ownerRuntimeLockStream.Unlock(0,1) } catch { [void]$finalCleanup.Add('NATIVE_LOCK_UNLOCK_FAILED') } }
        try { $ownerRuntimeLockStream.Dispose() } catch { [void]$finalCleanup.Add('NATIVE_LOCK_DISPOSE_FAILED') }
    }
    if ($null -ne $finalLeaseStream) { try { $finalLeaseStream.Dispose() } catch { [void]$finalCleanup.Add('COORDINATOR_LEASE_DISPOSE_FAILED') } }
    if ($finalCleanup.Count -gt 0) { $finalExitCode=1 }
}
@{ status=$finalStatus; stage=$finalStage; failureCode=$finalFailure; operationId=$finalOperation; phase=$finalPhase;
   eventId=$finalEvent; finalAckMarkerOwned=($null -ne $finalMarker); markerPath=$finalMarkerPath;
   record=$finalRecord; lastJournalWritePersisted=$finalPersisted; coordinatorLeaseReleased=$finalLeaseReleased;
   cleanupFailures=$finalCleanup.ToArray(); replayAllowed=$false; ownerAckVerified=$false; realE2eVerified=$false } | ConvertTo-Json -Depth 14 -Compress
exit $finalExitCode
