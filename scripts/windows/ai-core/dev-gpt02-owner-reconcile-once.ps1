#requires -Version 5.1
# DEV GPT02 trial2 OWNER bootstrap continuation, exactly once.
# Run only as a reviewed, separately supervised PowerShell process. This helper
# does not focus a window, clear a draft, dispatch MCP, sign, or acknowledge.
# A supervisor must bound this process: UIA/SendWait/Flush cannot be preempted
# by an in-process stopwatch. A killed/partial continuation marker is retained.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$DatabaseEvidenceFile,
    [Parameter(Mandatory)][ValidatePattern('\A[a-f0-9]{64}\z')][string]$ExpectedDatabaseEvidenceSha256,
    [Parameter(Mandatory)][string]$FocusReceiptFile,
    [Parameter(Mandatory)][ValidatePattern('\A[a-f0-9]{64}\z')][string]$ExpectedFocusReceiptSha256
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

# This is one named continuation of the old OWNER operation, not a new trial.
$reconcileBase = 'C:\Users\user\AppData\Local\Temp\gpt02-lease-review-20261020T1426'
$reconcileLocalRoot = 'C:\Users\user\AppData\Local'
$reconcileOperation = 'gpt02_trial2_20261020T1516'
$reconcileEvent = 'e8f45ed286cb3845d76311b10f72460aa585a9682a4f0a9f8fb864bfa974a645'
$reconcileOwner = 'ai-engine-oauth:48625572f3596a5eb60e1021b7dba25a26063a95583a991118f4d1d6c1861d86'
$reconcileFence = 'gpt02-takeover-20261020T153448Z-88837a97c333'
$reconcileCoordinator = 'chatgpt-root-88837a97c333'
$reconcileWrapperSha = '375fbd8773a7899adb97efc8d3cafd303814c9285cc01202881d7e771c9d0637'
$reconcilePriorSha = 'bf7304bc2a6dcb96ce0174f4dedd6e2cea57d09afb9e2c61694f0ddb4250ed2d'
$reconcileHandoffSha = '3effead9795e45c824c367a6a01c74ce32d12a7784a7548021906ea91b2fd4fd'
$reconcilePromptSha = '42f2d03e2e6375a1f6576005eb0459120a0b9377c1203c1d278db111451543e3'
$reconcileModuleSha = '1c83bce21a937bc32bf26cc1086af8466c2061514ba3f1a880a167c5d040f816'
$reconcileDraftSha = 'c0fae6a6c1582f13454101d3c2da4f5d951c84a31cff3f6206f6585b2ae6b747'
$reconcilePriorInputStartedAt = '2026-10-20T15:18:45.8052018Z'
$reconcilePriorUpdatedAt = '2026-10-20T15:18:46.3283691Z'

# These names deliberately match the reviewed wrapper declarations' scope.
$ownerProfile = 'travelincars-dev'
$ownerConversationId = '6ad74b05-0580-83ec-956a-80aaf4587985'
$ownerPageUrl = 'https://chatgpt.com/c/' + $ownerConversationId
$ownerRawTargetId = '59AA1F162AC14EDC94078CDC18EE54B9'
$ExpectedBrowserProcessId = 12056
$ExpectedWindowHandle = [long]3147448
$ComposerName = 'Ask ChatGPT'
$AllowProviderLf = $true
$ownerClock = [Diagnostics.Stopwatch]::StartNew()
$reconcileWallStart = [DateTimeOffset]::UtcNow
$ownerMaximumMilliseconds = [long]750000
$ownerCliMaximumMilliseconds = [long]75000
$ownerNativeGuardMilliseconds = [long]30000
$ownerNativeDeadlineMilliseconds = $null
$ownerSubmitMilliseconds = $null
$reconcileLeaseExpiresAt = $reconcileWallStart.AddMilliseconds($ownerMaximumMilliseconds)
$ownerModule = $null
$ownerPrompt = $null
$ownerTarget = $null
$ownerNode = $null
$ownerOcEntry = $null
$ownerUserData = $null
$ownerRuntimeLockStream = $null
$ownerRuntimeLockHeld = $false
$reconcileFrozenStreams = [Collections.Generic.List[IO.FileStream]]::new()
$reconcileLeaseStream = $null
$reconcileLease = $null
$reconcileLeaseClaimed = $false
$reconcileLeaseReleasePersisted = $false
$reconcileMarkerStream = $null
$reconcileRecord = $null
$reconcileLastWritePersisted = $false
$reconcileDatabase = $null
$reconcileStage = 'VALIDATING_FIXED_INPUTS'
$reconcileStatus = 'REFUSED_BEFORE_CONTINUATION'
$reconcileFailureCode = $null
$reconcileExitCode = 1
$reconcileCleanupFailures = [Collections.Generic.List[string]]::new()

$reconcileWrapperPath = Join-Path $reconcileBase 'send-owner-prompt-once-v2.ps1'
$reconcilePriorPath = Join-Path $reconcileBase ($reconcileOperation + '.owner-ui-prompt.json')
$reconcileHandoffPath = Join-Path $reconcileBase 'gpt02-trial2-owner-handoff-20261020T153448.json'
$reconcilePromptPath = Join-Path $reconcileBase 'gpt02-trial2-owner-bootstrap.txt'
$reconcileModulePath = Join-Path $reconcileLocalRoot 'AI-Core\dev-chatgpt-native-composer.psm1'
$reconcileLeasePath = Join-Path $reconcileBase ($reconcileOperation + '.owner-ui-coordinator.lease.json')
$reconcileMarkerPath = Join-Path $reconcileBase ($reconcileOperation + '.owner-ui-reconcile.json')
$reconcileExpectedFocusPath = Join-Path $reconcileBase 'gpt02-trial2-foreground-recovery-result-20261020T1541.json'

function Get-ReconcileSha256 {
    param([byte[]]$Bytes)
    $digest = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($digest.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant() }
    finally { $digest.Dispose() }
}

function Assert-ReconcilePath {
    param([string]$Path, [string]$AllowedRoot, [bool]$MustExist = $true)
    if (-not [IO.Path]::IsPathRooted($Path)) { throw 'OWNER_RECONCILE_ABSOLUTE_PATH_REQUIRED' }
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetFullPath($AllowedRoot).TrimEnd([char]92)
    if (-not $full.StartsWith($root + '\',[StringComparison]::OrdinalIgnoreCase) -or
        -not [IO.Directory]::Exists($root)) { throw 'OWNER_RECONCILE_PATH_OUTSIDE_FIXED_ROOT' }
    if ($MustExist -and -not [IO.File]::Exists($full)) { throw 'OWNER_RECONCILE_REQUIRED_FILE_MISSING' }
    if ([IO.File]::Exists($full)) {
        $file = [IO.FileInfo]::new($full)
        if (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'OWNER_RECONCILE_REPARSE_FILE_DENIED' }
    }
    $directory = [IO.DirectoryInfo]::new([IO.Path]::GetDirectoryName($full))
    while ($null -ne $directory) {
        if (-not $directory.Exists -or ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'OWNER_RECONCILE_REPARSE_OR_MISSING_DIRECTORY'
        }
        $directory = $directory.Parent
    }
    return $full
}

function Read-ReconcileBytes {
    param([IO.FileStream]$Stream, [int]$MaximumBytes)
    if ($Stream.Length -lt 1 -or $Stream.Length -gt $MaximumBytes) { throw 'OWNER_RECONCILE_FILE_SIZE_INVALID' }
    $Stream.Position = 0
    $bytes = [byte[]]::new([int]$Stream.Length)
    $offset = 0
    while ($offset -lt $bytes.Length) {
        $read = $Stream.Read($bytes,$offset,$bytes.Length-$offset)
        if ($read -lt 1) { throw 'OWNER_RECONCILE_INCOMPLETE_READ' }
        $offset += $read
    }
    return ,$bytes
}

function Read-ReconcilePinnedFile {
    param([string]$Path, [string]$ExpectedSha256, [int]$MaximumBytes, [string]$AllowedRoot = $reconcileBase)
    $full = Assert-ReconcilePath $Path $AllowedRoot
    $stream = [IO.File]::Open($full,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    try {
        $null = Assert-ReconcilePath $full $AllowedRoot
        $bytes = Read-ReconcileBytes $stream $MaximumBytes
        if ((Get-ReconcileSha256 $bytes) -cne $ExpectedSha256) { throw 'OWNER_RECONCILE_PINNED_HASH_MISMATCH' }
        $value = [Text.UTF8Encoding]::new($false,$true).GetString($bytes)
        [void]$reconcileFrozenStreams.Add($stream)
        return @{ Path=$full; Bytes=$bytes; Text=$value; Sha256=$ExpectedSha256 }
    } catch {
        $stream.Dispose()
        throw
    }
}

function ConvertFrom-ReconcileObject {
    param([string]$Text)
    $value = $Text | ConvertFrom-Json -ErrorAction Stop
    if ($null -eq $value -or $value -isnot [pscustomobject]) { throw 'OWNER_RECONCILE_JSON_OBJECT_REQUIRED' }
    return $value
}

function Assert-ReconcileBoolean {
    param($Value, [bool]$Expected)
    if ($Value -isnot [bool] -or $Value -ne $Expected) { throw 'OWNER_RECONCILE_BOOLEAN_EVIDENCE_INVALID' }
}

function Assert-ReconcileZeroCount {
    param($Value)
    if (($Value -isnot [int] -and $Value -isnot [long]) -or $Value -ne 0) {
        throw 'OWNER_RECONCILE_DATABASE_WORK_ALREADY_PRESENT_OR_INVALID'
    }
}

function ConvertFrom-ReconcileUtc {
    param($Value)
    if ($Value -isnot [string] -or $Value -cnotmatch '\A\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z\z') {
        throw 'OWNER_RECONCILE_UTC_TIMESTAMP_REQUIRED'
    }
    $date = [DateTimeOffset]::Parse($Value,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::AssumeUniversal)
    if ($date.Offset -ne [TimeSpan]::Zero) { throw 'OWNER_RECONCILE_UTC_TIMESTAMP_REQUIRED' }
    return $date
}

function Assert-ReconcileDatabaseFresh {
    if ($reconcileDatabase.eventId -cne $reconcileEvent -or
        $reconcileDatabase.conversationId -cne $ownerConversationId) { throw 'OWNER_RECONCILE_DATABASE_TUPLE_MISMATCH' }
    Assert-ReconcileZeroCount $reconcileDatabase.commandCount
    Assert-ReconcileZeroCount $reconcileDatabase.responseCount
    Assert-ReconcileZeroCount $reconcileDatabase.targetInflightCount
    $observed = ConvertFrom-ReconcileUtc $reconcileDatabase.observedAt
    $age = ([DateTimeOffset]::UtcNow - $observed).TotalSeconds
    # No future-clock allowance, timestamp rewrite, or refreshed observation.
    if ($age -lt 0 -or $age -gt 300) { throw 'OWNER_RECONCILE_DATABASE_EVIDENCE_NOT_FRESH' }
}

function Assert-ReconcileOldExecutorsAbsent {
    foreach ($oldPid in @(8412,18316,10816)) {
        $old = $null
        try { $old = [Diagnostics.Process]::GetProcessById($oldPid) }
        catch [ArgumentException] { }
        if ($null -ne $old) {
            $old.Dispose()
            throw 'OWNER_RECONCILE_PRIOR_CHILD_STILL_PRESENT'
        }
    }
    # Only the already-observed idle console host may remain under the old
    # coordinator. No command line, environment, or credential data is read.
    $children = @(Get-CimInstance -ClassName Win32_Process -Filter 'ParentProcessId = 24424' -Property ProcessId,ParentProcessId,Name -OperationTimeoutSec 10 -ErrorAction Stop)
    foreach ($child in $children) {
        if ([int]$child.ProcessId -ne 16788 -or [int]$child.ParentProcessId -ne 24424 -or
            -not ([string]$child.Name).Equals('conhost.exe',[StringComparison]::OrdinalIgnoreCase)) {
            throw 'OWNER_RECONCILE_PRIOR_COORDINATOR_HAS_ACTIVE_CHILD'
        }
    }
    if ($children.Count -gt 1) { throw 'OWNER_RECONCILE_PRIOR_COORDINATOR_CHILDREN_AMBIGUOUS' }
}

function Assert-ReconcileBudget {
    param([long]$ReserveMilliseconds = 1)
    Assert-OwnerTimeBudget $ReserveMilliseconds
    if ([DateTimeOffset]::UtcNow.AddMilliseconds($ReserveMilliseconds) -ge $reconcileLeaseExpiresAt) {
        throw 'OWNER_RECONCILE_COORDINATOR_LEASE_EXPIRED'
    }
}

function Write-ReconcileLease {
    $reconcileLease.updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $bytes = [Text.Encoding]::UTF8.GetBytes(($reconcileLease | ConvertTo-Json -Depth 12 -Compress))
    $reconcileLeaseStream.Position = 0
    $reconcileLeaseStream.SetLength(0)
    $reconcileLeaseStream.Write($bytes,0,$bytes.Length)
    $reconcileLeaseStream.Flush($true)
}

function Write-ReconcileReceipt {
    param([string]$Status)
    $script:reconcileLastWritePersisted = $false
    $reconcileRecord.status = $Status
    $reconcileRecord.stage = $reconcileStage
    $reconcileRecord.updatedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $reconcileRecord.elapsedMilliseconds = $ownerClock.ElapsedMilliseconds
    $bytes = [Text.Encoding]::UTF8.GetBytes(($reconcileRecord | ConvertTo-Json -Depth 12 -Compress))
    $reconcileMarkerStream.Position = 0
    $reconcileMarkerStream.SetLength(0)
    $reconcileMarkerStream.Write($bytes,0,$bytes.Length)
    $reconcileMarkerStream.Flush($true)
    $script:reconcileLastWritePersisted = $true
}

function Assert-ReconcileUnchangedPlaceholder {
    param($State)
    Assert-OwnerNativeIdle $State
    & $ownerModule { param($Value,$Name) Assert-AiCoreNativeInsertableDraft $Value $Name } $State $ComposerName
    # The provider's name+LF is UNKNOWN. Accept only its exact previously
    # observed bytes for this continuation; never relabel it as empty.
    if ($State.Draft -cne ($ComposerName + [char]10) -or
        (Get-ReconcileSha256 ([Text.Encoding]::UTF8.GetBytes($State.Draft))) -cne $reconcileDraftSha) {
        throw 'OWNER_RECONCILE_DRAFT_CHANGED_PRESERVE_NO_INPUT'
    }
}

try {
    if ($env:OS -cne 'Windows_NT' -or -not $env:LOCALAPPDATA -or -not $env:USERPROFILE -or
        -not [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd([char]92).Equals($reconcileLocalRoot,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'OWNER_RECONCILE_FIXED_WINDOWS_ACCOUNT_REQUIRED'
    }
    $null = Assert-ReconcilePath $reconcileMarkerPath $reconcileBase $false
    if ([IO.File]::Exists($reconcileMarkerPath) -or [IO.Directory]::Exists($reconcileMarkerPath)) {
        throw 'OWNER_RECONCILE_CONTINUATION_ALREADY_RESERVED'
    }
    if (-not [IO.Path]::GetFullPath($FocusReceiptFile).Equals($reconcileExpectedFocusPath,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'OWNER_RECONCILE_FOCUS_RECEIPT_PATH_MISMATCH'
    }

    $wrapperFile = Read-ReconcilePinnedFile $reconcileWrapperPath $reconcileWrapperSha 262144
    $priorFile = Read-ReconcilePinnedFile $reconcilePriorPath $reconcilePriorSha 16384
    $handoffFile = Read-ReconcilePinnedFile $reconcileHandoffPath $reconcileHandoffSha 16384
    $promptFile = Read-ReconcilePinnedFile $reconcilePromptPath $reconcilePromptSha 4096
    $moduleFile = Read-ReconcilePinnedFile $reconcileModulePath $reconcileModuleSha 262144 $reconcileLocalRoot
    $focusFile = Read-ReconcilePinnedFile $FocusReceiptFile $ExpectedFocusReceiptSha256 32768
    $databaseFile = Read-ReconcilePinnedFile $DatabaseEvidenceFile $ExpectedDatabaseEvidenceSha256 16384
    $prior = ConvertFrom-ReconcileObject $priorFile.Text
    $handoff = ConvertFrom-ReconcileObject $handoffFile.Text
    $focusEvidence = ConvertFrom-ReconcileObject $focusFile.Text
    $reconcileDatabase = ConvertFrom-ReconcileObject $databaseFile.Text

    $reconcileStage = 'VERIFYING_PRIOR_TERMINAL_NO_SEND'
    if ($prior.schema -cne 'ai-core-owner-ui-prompt/v1' -or $prior.purpose -cne 'TARGET_OWNER_UI_PROMPT' -or
        $prior.operationId -cne $reconcileOperation -or $prior.status -cne 'FAILED_RECONCILIATION_REQUIRED' -or
        $prior.stage -cne 'NATIVE_APPEND_ONLY' -or $prior.exactWholeReadbacks -ne 0 -or
        $null -ne $prior.sendAttemptedAt -or $prior.inputStartedAt -cne $reconcilePriorInputStartedAt -or
        $prior.updatedAt -cne $reconcilePriorUpdatedAt -or
        $prior.initialDraftClass -cne 'UNKNOWN_NAME_PLUS_LF_APPEND_ONLY' -or
        $prior.failureCode -cne 'OWNER_GUARD_OR_NATIVE_ACTION_FAILED' -or
        $prior.disposition -cne 'PRESERVE_ATTEMPT_AND_DRAFT_NO_REPLAY' -or
        $prior.promptSha256 -cne $reconcilePromptSha -or $prior.promptBytes -ne 1126 -or
        $prior.composerModuleSha256 -cne $reconcileModuleSha -or
        $prior.browserProfile -cne $ownerProfile -or $prior.conversationId -cne $ownerConversationId -or
        $prior.pageUrl -cne $ownerPageUrl -or $prior.rawTargetId -cne $ownerRawTargetId -or
        $prior.browserProcessId -ne $ExpectedBrowserProcessId -or $prior.windowHandle -ne $ExpectedWindowHandle -or
        $prior.composerName -cne $ComposerName -or
        -not ([string]$prior.receiptPath).Equals($reconcilePriorPath,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'OWNER_RECONCILE_PRIOR_NO_SEND_PROOF_INVALID'
    }
    foreach ($field in @('sendInvoked','sendInvocationReturned','replayAllowed','deliveryVerified','mcpDispatchVerified','workerAttestationCreated','realE2eVerified')) {
        Assert-ReconcileBoolean $prior.$field $false
    }
    Assert-ReconcileBoolean $prior.allowProviderLf $true

    if ($handoff.schema -cne 'ai-core-owner-explicit-handoff/v1' -or $handoff.eventId -cne $reconcileEvent -or
        $handoff.operationId -cne $reconcileOperation -or $handoff.conversationId -cne $ownerConversationId -or
        $handoff.ownerChannel -cne $reconcileOwner -or $handoff.authorizedBy -cne 'Boss' -or
        $handoff.authorization -cne 'ambil alih di sini' -or $handoff.authorizedAt -cne '2026-10-20T15:34:48Z' -or
        $handoff.coordinatorId -cne $reconcileCoordinator -or $handoff.fenceToken -cne $reconcileFence -or
        $handoff.priorReceiptSha256 -cne $reconcilePriorSha -or $handoff.priorConsoleHostPid -ne 16788) {
        throw 'OWNER_RECONCILE_EXPLICIT_HANDOFF_INVALID'
    }
    foreach ($field in @('priorAttemptChildrenTerminated','priorCoordinatorTaskChildrenAbsent','priorOwnerReceiptPreserved','nativeLockRequiredForEveryAction','inputContinuationRequiresSeparateReviewedReconciliation')) {
        Assert-ReconcileBoolean $handoff.$field $true
    }
    Assert-ReconcileBoolean $handoff.inputReplayAuthorized $false
    Assert-ReconcileBoolean $handoff.realE2eVerified $false
    if ($focusEvidence.schema -cne 'ai-core-owner-native-foreground-recovery/v1' -or
        $focusEvidence.status -cne 'FOREGROUND_ONLY_VERIFIED_NO_INPUT' -or
        $focusEvidence.coordinatorFence -cne $reconcileFence -or $focusEvidence.handoffSha256 -cne $reconcileHandoffSha) {
        throw 'OWNER_RECONCILE_FOCUS_EVIDENCE_INVALID'
    }
    foreach ($field in @('finalStrictFocusedReadPassed','trialReceiptUnchanged')) { Assert-ReconcileBoolean $focusEvidence.$field $true }
    foreach ($field in @('keyboardInputInvoked','sendInvoked','inputReplayAttempted','realE2eVerified')) { Assert-ReconcileBoolean $focusEvidence.$field $false }
    Assert-ReconcileDatabaseFresh
    Assert-ReconcileOldExecutorsAbsent

    # Parse the frozen wrapper, import ONLY named top-level function
    # declarations. Never execute its parameter/main block or receipt guard.
    $reconcileStage = 'IMPORTING_PINNED_WRAPPER_DECLARATIONS'
    $tokens = $null
    $parseErrors = $null
    $wrapperAst = [Management.Automation.Language.Parser]::ParseInput($wrapperFile.Text,[ref]$tokens,[ref]$parseErrors)
    if ($parseErrors.Count -ne 0 -or $null -eq $wrapperAst.EndBlock) { throw 'OWNER_RECONCILE_WRAPPER_PARSE_FAILED' }
    $declarations = @($wrapperAst.EndBlock.Statements | Where-Object { $_ -is [Management.Automation.Language.FunctionDefinitionAst] })
    foreach ($name in @('Assert-OwnerTimeBudget','Get-OwnerCommandRemainingMilliseconds','Assert-OwnerRuntimeLockPath',
        'ConvertTo-OwnerWindowsArgument','Start-OwnerOpenClaw','Stop-OwnerOpenClaw','Receive-OwnerOpenClaw',
        'Invoke-OwnerOpenClaw','Assert-OwnerSession','Assert-OwnerNativeIdle')) {
        $definition = @($declarations | Where-Object { $_.Name -ceq $name })
        if ($definition.Count -ne 1) { throw 'OWNER_RECONCILE_WRAPPER_DECLARATION_AMBIGUOUS' }
        . ([scriptblock]::Create($definition[0].Extent.Text))
    }
    $ownerNode = Join-Path $reconcileLocalRoot 'OpenClaw\deps\portable-node\node.exe'
    $ownerOcEntry = Join-Path $reconcileLocalRoot 'OpenClaw\deps\portable-node\node_modules\openclaw\openclaw.mjs'
    $ownerUserData = Join-Path $env:USERPROFILE '.openclaw\browser\travelincars-dev\user-data'
    if (-not [IO.File]::Exists($ownerNode) -or -not [IO.File]::Exists($ownerOcEntry)) { throw 'OWNER_RECONCILE_EXISTING_OPENCLAW_UNAVAILABLE' }
    $ownerPrompt = $promptFile.Text
    if ($promptFile.Bytes.Length -ne 1126 -or [string]::IsNullOrWhiteSpace($ownerPrompt) -or
        $ownerPrompt -cmatch '[^\x20-\x7e]' -or
        -not $ownerPrompt.Contains('DEV_CHATGPT_WAKE_V1 conversation=' + $ownerConversationId + ' event=' + $reconcileEvent)) {
        throw 'OWNER_RECONCILE_FROZEN_PROMPT_INVALID'
    }
    $ownerSubmitMilliseconds = [long](1000 * [Math]::Min(240,[Math]::Max(60,[Math]::Ceiling((30 + 0.051 * $ownerPrompt.Length) / 5) * 5)))
    $ownerModule = Import-Module -Name $reconcileModulePath -Force -PassThru -ErrorAction Stop
    if ($ownerModule -isnot [System.Management.Automation.PSModuleInfo]) { throw 'OWNER_RECONCILE_MODULE_IMPORT_AMBIGUOUS' }
    $literal = & $ownerModule { param($Message) ConvertTo-AiCoreLiteralKeys $Message } $ownerPrompt
    $ownerTarget = @{ ConversationId=$ownerConversationId; PageUrl=$ownerPageUrl; ComposerName=$ComposerName;
        WindowHandle=$ExpectedWindowHandle; BrowserProcessId=$ExpectedBrowserProcessId }

    # Open existing lease with an exclusive writer handle. The focus-only
    # predecessor must have released it successfully and exited. Never delete
    # the lease, accept another fence, or extend the fixed continuation expiry.
    $reconcileStage = 'CLAIMING_EXISTING_COORDINATOR_LEASE'
    $null = Assert-ReconcilePath $reconcileLeasePath $reconcileBase
    $reconcileLeaseStream = [IO.File]::Open($reconcileLeasePath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
    $null = Assert-ReconcilePath $reconcileLeasePath $reconcileBase
    $leaseBytes = Read-ReconcileBytes $reconcileLeaseStream 32768
    $leaseObject = ConvertFrom-ReconcileObject ([Text.UTF8Encoding]::new($false,$true).GetString($leaseBytes))
    if ($leaseObject.schema -cne 'ai-core-owner-coordinator-lease/v1' -or $leaseObject.fenceToken -cne $reconcileFence -or
        $leaseObject.coordinatorId -cne $reconcileCoordinator -or $leaseObject.eventId -cne $reconcileEvent -or
        $leaseObject.phase -cne 'FOCUS_ONLY' -or $leaseObject.terminalStatus -cne 'FOREGROUND_ONLY_VERIFIED_NO_INPUT' -or
        ($leaseObject.ownerPid -isnot [int] -and $leaseObject.ownerPid -isnot [long]) -or
        $leaseObject.ownerPid -lt 1 -or $leaseObject.ownerPid -gt [int]::MaxValue -or $leaseObject.ownerPid -eq $PID) {
        throw 'OWNER_RECONCILE_COORDINATOR_LEASE_NOT_TRANSFERABLE'
    }
    Assert-ReconcileBoolean $leaseObject.released $true
    $previousLeaseOwner = $null
    try { $previousLeaseOwner = [Diagnostics.Process]::GetProcessById([int]$leaseObject.ownerPid) }
    catch [ArgumentException] { }
    if ($null -ne $previousLeaseOwner) {
        $previousLeaseOwner.Dispose()
        throw 'OWNER_RECONCILE_PREVIOUS_LEASE_OWNER_STILL_PRESENT'
    }
    $reconcileLease = [ordered]@{}
    foreach ($property in $leaseObject.PSObject.Properties) { $reconcileLease[$property.Name] = $property.Value }
    $reconcileLease.previousOwnerPid = $leaseObject.ownerPid
    $reconcileLease.previousAcquiredAt = $leaseObject.acquiredAt
    $reconcileLease.previousExpiresAt = $leaseObject.expiresAt
    $reconcileLease.previousTerminalStatus = $leaseObject.terminalStatus
    $reconcileLease.phase = 'OWNER_RECONCILIATION'
    $reconcileLease.ownerPid = $PID
    $reconcileLease.acquiredAt = [DateTimeOffset]::UtcNow.ToString('o')
    $reconcileLease.expiresAt = $reconcileLeaseExpiresAt.ToString('o')
    $reconcileLease.released = $false
    $reconcileLease.terminalStatus = $null
    $reconcileLease.focusReceiptSha256 = $ExpectedFocusReceiptSha256
    $reconcileLease.priorReceiptSha256 = $reconcilePriorSha
    $reconcileLease.continuationReceiptPath = $reconcileMarkerPath
    Assert-ReconcileBudget 5000
    Write-ReconcileLease
    $reconcileLeaseClaimed = $true

    $reconcileStage = 'ACQUIRING_EXISTING_NATIVE_UI_LOCK'
    $ownerRuntimeLockPath = Join-Path $reconcileLocalRoot 'AI-Core\chatgpt-wake-dev-receipts\native-transport.lock'
    Assert-OwnerRuntimeLockPath $ownerRuntimeLockPath
    $ownerRuntimeLockStream = [IO.File]::Open($ownerRuntimeLockPath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
    Assert-OwnerRuntimeLockPath $ownerRuntimeLockPath
    if ($ownerRuntimeLockStream.Length -lt 1) { throw 'OWNER_RECONCILE_RUNTIME_LOCK_EMPTY' }
    $ownerRuntimeLockStream.Lock(0,1)
    $ownerRuntimeLockHeld = $true
    if ([IO.File]::Exists($reconcileMarkerPath) -or [IO.Directory]::Exists($reconcileMarkerPath)) {
        throw 'OWNER_RECONCILE_CONTINUATION_ALREADY_RESERVED'
    }
    Assert-ReconcileOldExecutorsAbsent
    Assert-ReconcileBudget ($ownerSubmitMilliseconds + $ownerNativeGuardMilliseconds)

    # Identity/snapshot reads only. Focus repair belongs to the completed
    # foreground helper; this continuation never calls focus or SetFocus.
    $reconcileStage = 'OC_IDENTITY_READ'
    Assert-OwnerSession
    $reconcileStage = 'OC_IDLE_READ'
    $snapshot = Invoke-OwnerOpenClaw 'snapshot'
    $names = [regex]::Matches($snapshot,'(?m)^[ \t]*- textbox "(Ask ChatGPT|Tanya ChatGPT)"[^\r\n]*$')
    if ($names.Count -ne 1 -or $names[0].Groups[1].Value -cne $ComposerName -or
        $snapshot -match '(?i)\bbutton\s+"(?:Stop(?: generating| responding| streaming)?|Hentikan(?: pembuatan| respons| jawaban)?)"' -or
        $snapshot.Contains($ownerPrompt) -or $snapshot.Contains($reconcileEvent)) {
        throw 'OWNER_RECONCILE_VISIBLE_TRIAL_OR_NONIDLE_COMPOSER'
    }
    Assert-ReconcileBudget ($ownerSubmitMilliseconds + $ownerNativeGuardMilliseconds)
    $ownerNativeDeadlineMilliseconds = $ownerClock.ElapsedMilliseconds + $ownerSubmitMilliseconds + $ownerNativeGuardMilliseconds
    $reconcileStage = 'NATIVE_UNCHANGED_PLACEHOLDER_READ'
    $state = & $ownerModule { param($Target) Get-AiCoreNativeState $Target $true } $ownerTarget
    Assert-ReconcileUnchangedPlaceholder $state
    Assert-ReconcileDatabaseFresh
    Assert-ReconcileOldExecutorsAbsent
    Assert-ReconcileBudget 5000

    # One fixed CreateNew reservation before the first possible key. Original
    # OWNER receipt stays open READ ONLY and is never rewritten or removed.
    $reconcileStage = 'CREATING_EXCLUSIVE_OWNER_CONTINUATION'
    $reconcileRecord = [ordered]@{
        schema='ai-core-owner-ui-reconciliation/v1'; purpose='TARGET_OWNER_UI_PROMPT_CONTINUATION';
        operationId=$reconcileOperation; eventId=$reconcileEvent; ownerChannel=$reconcileOwner;
        coordinatorId=$reconcileCoordinator; coordinatorFence=$reconcileFence; ownerPid=$PID;
        handoffSha256=$reconcileHandoffSha; priorWrapperSha256=$reconcileWrapperSha;
        priorReceiptPath=$reconcilePriorPath; priorReceiptSha256=$reconcilePriorSha;
        priorStatus=$prior.status; priorStage=$prior.stage; priorUpdatedAt=$prior.updatedAt;
        inputStartedAt=$prior.inputStartedAt; continuationInputStartedAt=$null;
        promptSha256=$reconcilePromptSha; promptBytes=$promptFile.Bytes.Length; composerModuleSha256=$reconcileModuleSha;
        browserProfile=$ownerProfile; conversationId=$ownerConversationId; pageUrl=$ownerPageUrl;
        rawTargetId=$ownerRawTargetId; browserProcessId=$ExpectedBrowserProcessId; windowHandle=$ExpectedWindowHandle;
        composerName=$ComposerName; allowProviderLf=$AllowProviderLf;
        initialDraftClass='UNKNOWN_NAME_PLUS_LF_APPEND_ONLY'; initialDraftSha256=$reconcileDraftSha;
        focusReceiptPath=$focusFile.Path; focusReceiptSha256=$ExpectedFocusReceiptSha256;
        databaseEvidencePath=$databaseFile.Path; databaseEvidenceSha256=$ExpectedDatabaseEvidenceSha256;
        databaseObservedAt=$reconcileDatabase.observedAt; leaseExpiresAt=$reconcileLease.expiresAt;
        createdAt=[DateTimeOffset]::UtcNow.ToString('o'); status='CONTINUATION_RESERVED'; stage=$reconcileStage;
        keyEndAttemptedAt=$null; keyEndInvoked=$false; literalInputAttemptedAt=$null; literalInputInvoked=$false;
        sendAttemptedAt=$null; sendInvoked=$false; sendInvocationReturned=$false; exactWholeReadbacks=0;
        replayAllowed=$false; deliveryVerified=$false; mcpDispatchVerified=$false;
        workerAttestationCreated=$false; realE2eVerified=$false; receiptPath=$reconcileMarkerPath
    }
    $reconcileMarkerStream = [IO.File]::Open($reconcileMarkerPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    Write-ReconcileReceipt 'CONTINUATION_RESERVED'

    $reconcileStage = 'NATIVE_END_KEY_INTENT'
    $reconcileRecord.continuationInputStartedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $reconcileRecord.keyEndAttemptedAt = $reconcileRecord.continuationInputStartedAt
    $reconcileRecord.keyEndInvoked = $null
    Write-ReconcileReceipt 'INPUT_ATTEMPTING'
    Assert-ReconcileBudget 5000
    $beforeEnd = & $ownerModule { param($Target) Get-AiCoreNativeState $Target $true } $ownerTarget
    Assert-ReconcileUnchangedPlaceholder $beforeEnd
    Assert-ReconcileBudget 5000
    Assert-ReconcileDatabaseFresh
    & $ownerModule { Send-AiCoreNativeKeys '^{END}' }
    $reconcileRecord.keyEndInvoked = $true
    $reconcileRecord.keyEndReturnedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $reconcileStage = 'NATIVE_END_KEY_RETURNED'
    Write-ReconcileReceipt 'INPUT_ATTEMPTING'

    $reconcileStage = 'NATIVE_LITERAL_KEY_INTENT'
    $reconcileRecord.literalInputAttemptedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $reconcileRecord.literalInputInvoked = $null
    Write-ReconcileReceipt 'INPUT_ATTEMPTING'
    Assert-ReconcileBudget 5000
    $beforeLiteral = & $ownerModule { param($Target) Get-AiCoreNativeState $Target $true } $ownerTarget
    Assert-ReconcileUnchangedPlaceholder $beforeLiteral
    Assert-ReconcileBudget 5000
    Assert-ReconcileDatabaseFresh
    & $ownerModule { param($Keys) Send-AiCoreNativeKeys $Keys } $literal
    $reconcileRecord.literalInputInvoked = $true
    $reconcileRecord.literalInputReturnedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $reconcileStage = 'NATIVE_LITERAL_KEY_RETURNED'
    Write-ReconcileReceipt 'INPUT_ATTEMPTING'

    Assert-ReconcileBudget 5000
    $first = & $ownerModule { param($Target) Get-AiCoreNativeState $Target $true } $ownerTarget
    & $ownerModule { param($State,$Message,$AllowLf) Assert-AiCoreNativeReadback $State $Message $AllowLf } $first $ownerPrompt $AllowProviderLf
    Assert-OwnerNativeIdle $first
    $reconcileRecord.exactWholeReadbacks = 1
    $reconcileRecord.firstWholeReadbackSha256 = Get-ReconcileSha256 ([Text.Encoding]::UTF8.GetBytes($first.Draft))

    # This durable intent becomes UNKNOWN until the sole Invoke returns.
    # Any crash/exception after reservation preserves the one-shot marker.
    $reconcileStage = 'NATIVE_SEND_INTENT'
    $reconcileRecord.sendAttemptedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $reconcileRecord.sendInvoked = $null
    Write-ReconcileReceipt 'SEND_ATTEMPTING'
    Assert-ReconcileBudget 5000
    $second = & $ownerModule { param($Target) Get-AiCoreNativeState $Target $true } $ownerTarget
    & $ownerModule { param($State,$Message,$AllowLf) Assert-AiCoreNativeReadback $State $Message $AllowLf } $second $ownerPrompt $AllowProviderLf
    Assert-OwnerNativeIdle $second
    $reconcileRecord.exactWholeReadbacks = 2
    $reconcileRecord.secondWholeReadbackSha256 = Get-ReconcileSha256 ([Text.Encoding]::UTF8.GetBytes($second.Draft))
    $reconcileStage = 'NATIVE_SECOND_WHOLE_READBACK_VERIFIED'
    Write-ReconcileReceipt 'SEND_ATTEMPTING'
    $send = & $ownerModule { param($State) Get-AiCoreNativeSendControl $State } $second
    Assert-ReconcileBudget 5000
    Assert-ReconcileDatabaseFresh
    & $ownerModule { param($Pattern) Invoke-AiCoreNativeSend $Pattern } $send
    $reconcileRecord.sendInvoked = $true
    $reconcileRecord.sendInvocationReturned = $true
    $reconcileRecord.sendReturnedAt = [DateTimeOffset]::UtcNow.ToString('o')
    $reconcileStage = 'COMPLETE_OWNER_INPUT_ONLY'
    $reconcileStatus = 'SEND_INVOKED_DELIVERY_UNVERIFIED'
    Write-ReconcileReceipt $reconcileStatus
    $reconcileExitCode = 0
} catch {
    $reconcileStatus = 'FAILED_RECONCILIATION_REQUIRED'
    $reconcileFailureCode = 'OWNER_RECONCILE_GUARD_OR_NATIVE_ACTION_FAILED'
    $message = $_.Exception.Message
    if ($message -cmatch '\AOWNER_[A-Z0-9_]{1,110}\z') { $reconcileFailureCode = $message }
    if ($null -ne $reconcileMarkerStream -and $null -ne $reconcileRecord) {
        $reconcileRecord.failureCode = $reconcileFailureCode
        $reconcileRecord.disposition = 'PRESERVE_ORIGINAL_CONTINUATION_AND_DRAFT_NO_REPLAY'
        try { Write-ReconcileReceipt $reconcileStatus } catch { }
    }
} finally {
    # Lease expiry is never renewed, including while cleaning up. A missing or
    # partial release remains nontransferable. Keep both marker files forever.
    if ($reconcileLeaseClaimed) {
        try {
            $reconcileLease.released = $true
            $reconcileLease.releasedAt = [DateTimeOffset]::UtcNow.ToString('o')
            $reconcileLease.terminalStatus = $reconcileStatus
            Write-ReconcileLease
            $reconcileLeaseReleasePersisted = $true
        } catch {
            [void]$reconcileCleanupFailures.Add('COORDINATOR_LEASE_RELEASE_WRITE_FAILED')
        }
    }
    # Every resource gets a cleanup attempt even if a previous one failed.
    # Do not reset sendInvoked=null or infer delivery from successful cleanup.
    if ($null -ne $reconcileMarkerStream) {
        try { $reconcileMarkerStream.Dispose() }
        catch { [void]$reconcileCleanupFailures.Add('CONTINUATION_RECEIPT_DISPOSE_FAILED') }
    }
    foreach ($stream in $reconcileFrozenStreams) {
        try { $stream.Dispose() }
        catch { [void]$reconcileCleanupFailures.Add('FROZEN_EVIDENCE_DISPOSE_FAILED') }
    }
    if ($null -ne $ownerRuntimeLockStream) {
        if ($ownerRuntimeLockHeld) {
            try { $ownerRuntimeLockStream.Unlock(0,1) }
            catch { [void]$reconcileCleanupFailures.Add('NATIVE_LOCK_UNLOCK_FAILED') }
        }
        try { $ownerRuntimeLockStream.Dispose() }
        catch { [void]$reconcileCleanupFailures.Add('NATIVE_LOCK_DISPOSE_FAILED') }
    }
    if ($null -ne $reconcileLeaseStream) {
        try { $reconcileLeaseStream.Dispose() }
        catch { [void]$reconcileCleanupFailures.Add('COORDINATOR_LEASE_DISPOSE_FAILED') }
    }
    if ($reconcileCleanupFailures.Count -gt 0) { $reconcileExitCode = 1 }
}
# No prompt, native text, arbitrary stderr, credentials, or private key data.
if ($null -ne $reconcileMarkerStream -and $null -ne $reconcileRecord) {
    @{ record=$reconcileRecord; receiptWritePersisted=$reconcileLastWritePersisted;
       coordinatorLeaseReleasePersisted=$reconcileLeaseReleasePersisted;
       cleanupFailed=($reconcileCleanupFailures.Count -gt 0); cleanupFailures=$reconcileCleanupFailures.ToArray() } | ConvertTo-Json -Depth 14 -Compress
} else {
    @{ ok=$false; status=$reconcileStatus; stage=$reconcileStage; failureCode=$reconcileFailureCode;
       operationId=$reconcileOperation; eventId=$reconcileEvent; receiptPath=$reconcileMarkerPath;
       continuationMarkerOwned=$false; thisInvocationKeyboardInputInvoked=$false; thisInvocationSendInvoked=$false;
       priorAttemptOutcome='BOUND_TERMINAL_OWNER_NO_SEND_PROOF_ONLY_IF_VALIDATED';
       coordinatorLeaseReleasePersisted=$reconcileLeaseReleasePersisted; replayAllowed=$false;
       cleanupFailed=($reconcileCleanupFailures.Count -gt 0); cleanupFailures=$reconcileCleanupFailures.ToArray();
       deliveryVerified=$false; mcpDispatchVerified=$false; realE2eVerified=$false } | ConvertTo-Json -Compress
}
exit $reconcileExitCode

