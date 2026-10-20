# DEV GPT02 ordinary foreground recovery after the owner's explicit handoff.
# No keys, text, Send, worker context or attestation. Preserve trial2 evidence.
# Run in a no-window child with a 420-second outer bound.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$OwnerWrapperPath,
    [Parameter(Mandatory)][string]$ComposerModulePath,
    [Parameter(Mandatory)][string]$TrialPromptFile,
    [Parameter(Mandatory)][string]$TrialReceiptPath,
    [Parameter(Mandatory)][string]$ResultPath,
    [ValidateSet(12056)][int]$ExpectedBrowserProcessId=12056,
    [ValidateSet(3147448)][long]$ExpectedWindowHandle=3147448,
    [ValidateSet('Ask ChatGPT')][string]$ComposerName='Ask ChatGPT'
)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$utf8=[Text.UTF8Encoding]::new($false,$true)
$wrapperSha='375fbd8773a7899adb97efc8d3cafd303814c9285cc01202881d7e771c9d0637'
$composerSha='1c83bce21a937bc32bf26cc1086af8466c2061514ba3f1a880a167c5d040f816'
$promptSha='42f2d03e2e6375a1f6576005eb0459120a0b9377c1203c1d278db111451543e3'
$trialReceiptSha='bf7304bc2a6dcb96ce0174f4dedd6e2cea57d09afb9e2c61694f0ddb4250ed2d'
$trialEvent='e8f45ed286cb3845d76311b10f72460aa585a9682a4f0a9f8fb864bfa974a645'
$ownerProfile='travelincars-dev'
$ownerConversationId='6ad74b05-0580-83ec-956a-80aaf4587985'
$ownerPageUrl='https://chatgpt.com/c/'+$ownerConversationId
$ownerRawTargetId='59AA1F162AC14EDC94078CDC18EE54B9'
$ownerClock=[Diagnostics.Stopwatch]::StartNew()
$ownerMaximumMilliseconds=400000
$ownerCliMaximumMilliseconds=75000
$ownerNativeDeadlineMilliseconds=$null
$ownerNode=$null;$ownerOcEntry=$null;$ownerUserData=$null
$wrapperStream=$null;$composerStream=$null;$promptStream=$null;$trialStream=$null
$resultStream=$null;$nativeLock=$null;$nativeLocked=$false;$composer=$null
$handoffStream=$null;$coordinatorLeaseStream=$null;$coordinatorLeaseRecord=$null
$handoffSha='3effead9795e45c824c367a6a01c74ce32d12a7784a7548021906ea91b2fd4fd'
$fenceToken='gpt02-takeover-20261020T153448Z-88837a97c333'
$exitCode=1
$record=@{
    schema='ai-core-owner-native-foreground-recovery/v1';purpose='FOREGROUND_ONLY_RECOVERY';status='PREPARING';operation='VALIDATE_INPUTS';
    coordinatorFence=$fenceToken;handoffSha256=$handoffSha;coordinatorLeaseAcquired=$false;nativeActivationAccepted=$null;foregroundSettleMs=$null;
    startedAt=[DateTime]::UtcNow.ToString('o');updatedAt=$null;totalLimitMs=400000;cliLimitMs=75000;
    wrapperSha256=$wrapperSha;composerSha256=$composerSha;trialReceiptSha256=$trialReceiptSha;
    pinnedSourcesVerified=$false;trialReceiptInitiallyVerified=$false;trialReceiptUnchanged=$null;
    nativeLockAcquired=$false;sessionBeforeVerified=$false;sessionAfterVerified=$false;
    rawFocusAttempted=$false;rawFocusReturned=$false;snapshotIdleVerified=$false;
    snapshotTrialEventAbsent=$null;snapshotExactPromptAbsent=$null;
    firstComposerFocusAttempted=$false;firstComposerFocusReturned=$false;firstStrictFocusedReadPassed=$false;
    windowFocusAttempted=$false;windowFocusReturned=$false;secondComposerFocusAttempted=$false;secondComposerFocusReturned=$false;
    finalStrictFocusedReadPassed=$false;observations=@();failures=@();
    keyboardInputInvoked=$false;sendInvoked=$false;inputReplayAttempted=$false;workerAttestationCreated=$false;
    deliveryVerified=$false;realE2eVerified=$false;replayAllowed=$false
}

function Need-Diagnostic([bool]$Condition,[string]$Code){if(-not $Condition){throw $Code}}
function Hash-DiagnosticBytes([byte[]]$Bytes){$h=[Security.Cryptography.SHA256]::Create();try{return ([BitConverter]::ToString($h.ComputeHash($Bytes))).Replace('-','').ToLowerInvariant()}finally{$h.Dispose()}}
function Assert-DiagnosticNoReparse([string]$Path){
    $item=Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    while($null -ne $item){
        Need-Diagnostic (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) 'DIAG_REPARSE_PATH_DENIED'
        if($item -is [IO.FileInfo]){$item=$item.Directory}else{$item=$item.Parent}
    }
}
function Assert-DiagnosticTempPath([string]$Path,[bool]$MustExist=$true){
    $full=[IO.Path]::GetFullPath($Path);$temp=[IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([char]92)
    Need-Diagnostic ($full.StartsWith($temp+'\',[StringComparison]::OrdinalIgnoreCase)) 'DIAG_TEMP_PATH_REQUIRED'
    Assert-DiagnosticNoReparse ([IO.Path]::GetDirectoryName($full))
    if($MustExist){Assert-DiagnosticNoReparse $full}else{Need-Diagnostic (-not(Test-Path -LiteralPath $full)) 'DIAG_RESULT_ALREADY_EXISTS'}
    return $full
}
function Read-DiagnosticLocked([IO.FileStream]$Stream,[int]$Limit){
    $length=$Stream.Length;Need-Diagnostic ($length -gt 0 -and $length -le $Limit) 'DIAG_FILE_SIZE_INVALID'
    $Stream.Position=0;$bytes=[byte[]]::new([int]$length);$offset=0
    while($offset -lt $bytes.Length){$n=$Stream.Read($bytes,$offset,$bytes.Length-$offset);Need-Diagnostic ($n -gt 0) 'DIAG_FILE_READ_INCOMPLETE';$offset+=$n}
    Need-Diagnostic ($Stream.ReadByte() -eq -1) 'DIAG_FILE_SIZE_CHANGED';return ,$bytes
}
function Write-Diagnostic([string]$Operation){
    $record.operation=$Operation;$record.updatedAt=[DateTime]::UtcNow.ToString('o')
    if($null -ne $resultStream){
        $bytes=$utf8.GetBytes(($record|ConvertTo-Json -Depth 8 -Compress));$resultStream.Position=0;$resultStream.SetLength(0)
        $resultStream.Write($bytes,0,$bytes.Length);$resultStream.Flush($true)
    }
}
function Write-CoordinatorLease([bool]$Released){
    if($null -eq $coordinatorLeaseStream){return}
    $coordinatorLeaseRecord.released=$Released
    $coordinatorLeaseRecord.updatedAt=[DateTime]::UtcNow.ToString('o')
    $coordinatorLeaseRecord.terminalStatus=if($Released){$record.status}else{$null}
    $bytes=$utf8.GetBytes(($coordinatorLeaseRecord|ConvertTo-Json -Depth 4 -Compress))
    $coordinatorLeaseStream.Position=0;$coordinatorLeaseStream.SetLength(0)
    $coordinatorLeaseStream.Write($bytes,0,$bytes.Length);$coordinatorLeaseStream.Flush($true)
}
function Add-DiagnosticFailure($ErrorRecord,[string]$Operation){
    # Compare messages only in memory against fixed source literals. Never emit
    # Message, ErrorDetails, InvocationInfo.Line, StackTrace or native text.
    $known=@{
        'Native composer lost foreground or keyboard focus'='NATIVE_FOCUS_LOST';
        'Native browser window identity changed'='NATIVE_WINDOW_CHANGED';
        'Native browser destination changed'='NATIVE_ADDRESS_CHANGED';
        'Native control is missing or ambiguous'='NATIVE_CONTROL_AMBIGUOUS';
        'Native password control cannot be used'='NATIVE_PASSWORD_BLOCKED';
        'Native ValuePattern is unavailable'='NATIVE_VALUE_UNAVAILABLE';
        'Native value was not supplied by the provider'='NATIVE_VALUE_TYPE_INVALID';
        'Native composer has a draft or unavailable value; preserving it'='NATIVE_DRAFT_NOT_INSERTABLE'
    }
    foreach($code in @('OWNER_TIME_BUDGET_INSUFFICIENT_PRESERVE_ATTEMPT','OWNER_OC_TIMEOUT_PRESERVE_ATTEMPT',
        'OWNER_OC_STDOUT_DRAIN_TIMEOUT','OWNER_OC_STDERR_DRAIN_TIMEOUT','OWNER_OC_TERMINATION_UNCONFIRMED',
        'OWNER_OC_RESULT_INVALID','OWNER_OC_ENVELOPE_INVALID','OWNER_PROFILE_IDENTITY_CHANGED','OWNER_TAB_INVENTORY_INVALID',
        'OWNER_RAW_TARGET_INVENTORY_AMBIGUOUS','OWNER_EXACT_RAW_DESTINATION_NOT_UNIQUE','OWNER_NATIVE_GENERATION_ACTIVE',
        'OWNER_EXISTING_RUNTIME_LOCK_UNAVAILABLE','OWNER_RUNTIME_LOCK_PATH_INVALID','OWNER_RUNTIME_LOCK_REPARSE_PATH_DENIED',
        'OWNER_RUNTIME_LOCK_ANCESTRY_INVALID','DIAG_WINDOWS_PS51_DELL_REQUIRED','DIAG_TEMP_PATH_REQUIRED','DIAG_RESULT_ALREADY_EXISTS',
        'DIAG_REPARSE_PATH_DENIED','DIAG_FILE_SIZE_INVALID','DIAG_FILE_READ_INCOMPLETE','DIAG_FILE_SIZE_CHANGED',
        'DIAG_COMPOSER_PATH_INVALID','DIAG_WRAPPER_HASH_MISMATCH','DIAG_COMPOSER_HASH_MISMATCH','DIAG_PROMPT_HASH_MISMATCH',
        'DIAG_TRIAL_RECEIPT_HASH_MISMATCH','DIAG_TRIAL_RECEIPT_CHANGED','DIAG_PROMPT_INVALID','DIAG_PARSE_FAILED',
        'DIAG_WRAPPER_DEFINITION_INVALID','DIAG_MODULE_IMPORT_AMBIGUOUS','DIAG_RUNTIME_LOCK_EMPTY','DIAG_RAW_FOCUS_FAILED',
        'DIAG_SNAPSHOT_NOT_IDLE','DIAG_TRIAL_CONTENT_VISIBLE','DIAG_UNSAFE_DRAFT','DIAG_FOREGROUND_ONLY_CONDITION_FAILED',
        'DIAG_FINAL_FOCUS_NOT_ESTABLISHED','DIAG_RESULT_PATH_INVALID','DIAG_TRIAL_RECEIPT_PATH_INVALID',
        'DIAG_HANDOFF_HASH_MISMATCH','DIAG_HANDOFF_INVALID','DIAG_PRIOR_EXECUTION_ACTIVE','DIAG_WINDOW_NOT_VISIBLE',
        'FOREGROUND_ACTIVATION_DENIED','FOREGROUND_ACTIVATION_NOT_OBSERVED')){$known[$code]=$code}
    $code='UNCLASSIFIED_NATIVE_OR_GUARD_EXCEPTION';$chain=@();$exception=$ErrorRecord.Exception
    for($i=0;$null -ne $exception -and $i -lt 3;$i++){
        $type=$exception.GetType().FullName
        if($type -cnotmatch '\A[A-Za-z][A-Za-z0-9_.+]{0,159}\z'){$type='UnclassifiedExceptionType'}
        $chain+=,@{type=$type;hresult=[int]$exception.HResult}
        if($known.ContainsKey([string]$exception.Message)){$code=$known[[string]$exception.Message]}
        $exception=$exception.InnerException
    }
    $record.failures+=,@{operation=$Operation;code=$code;exceptions=$chain}
    return $code
}
function Observe-DiagnosticNative([string]$Label){
    Assert-OwnerTimeBudget 1000
    $state=& $composer {param($Target) Get-AiCoreNativeState $Target} $ownerTarget
    Assert-OwnerNativeIdle $state
    & $composer {param($State,$Name) Assert-AiCoreNativeInsertableDraft $State $Name} $state $ComposerName
    $draftClass=if($state.Draft -ceq ''){'EXPLICIT_EMPTY'}elseif($state.Draft -ceq ($ComposerName+"`n")){'UNKNOWN_NAME_PLUS_LF'}else{'OTHER'}
    Need-Diagnostic ($draftClass -cne 'OTHER' -and -not $state.Draft.Contains($trialEvent) -and -not $state.Draft.Contains($ownerPrompt)) 'DIAG_UNSAFE_DRAFT'
    $foreground=& $composer {[long][AiCoreNativeComposerWindow]::GetForegroundWindow()}
    $observation=@{operation=$Label;windowAndAddressVerified=$true;nativeIdleVerified=$true;draftClass=$draftClass;
        foregroundMatches=($foreground -eq $ExpectedWindowHandle);composerHasKeyboardFocus=[bool]$state.Composer.Current.HasKeyboardFocus;
        composerIsKeyboardFocusable=[bool]$state.Composer.Current.IsKeyboardFocusable;
        draftTrialEventAbsent=$true;draftExactPromptAbsent=$true}
    $record.observations+=,$observation
    Write-Diagnostic $Label
    return @{state=$state;safe=$observation}
}
function Test-DiagnosticStrictFocus([string]$Operation){
    Write-Diagnostic $Operation;Assert-OwnerTimeBudget 1000
    try{
        $state=& $composer {param($Target) Get-AiCoreNativeState $Target $true} $ownerTarget
        Assert-OwnerNativeIdle $state
        & $composer {param($State,$Name) Assert-AiCoreNativeInsertableDraft $State $Name} $state $ComposerName
        return $true
    }catch{
        $code=Add-DiagnosticFailure $_ $Operation;Write-Diagnostic $Operation
        if($code -cne 'NATIVE_FOCUS_LOST'){throw}
        return $false
    }
}

try{
    Need-Diagnostic ($env:OS -ceq 'Windows_NT' -and $env:COMPUTERNAME -ieq 'DELL' -and
        $PSVersionTable.PSEdition -ceq 'Desktop' -and $PSVersionTable.PSVersion.Major -eq 5 -and $PSVersionTable.PSVersion.Minor -eq 1) 'DIAG_WINDOWS_PS51_DELL_REQUIRED'
    $OwnerWrapperPath=Assert-DiagnosticTempPath $OwnerWrapperPath
    $TrialPromptFile=Assert-DiagnosticTempPath $TrialPromptFile
    $TrialReceiptPath=Assert-DiagnosticTempPath $TrialReceiptPath
    Need-Diagnostic ([IO.Path]::GetFileName($TrialReceiptPath) -ceq 'gpt02_trial2_20261020T1516.owner-ui-prompt.json') 'DIAG_TRIAL_RECEIPT_PATH_INVALID'
    $ResultPath=Assert-DiagnosticTempPath $ResultPath $false
    Need-Diagnostic ([IO.Path]::GetExtension($ResultPath) -ieq '.json') 'DIAG_RESULT_PATH_INVALID'
    $ComposerModulePath=[IO.Path]::GetFullPath($ComposerModulePath)
    $expectedComposer=Join-Path $env:LOCALAPPDATA 'AI-Core\dev-chatgpt-native-composer.psm1'
    Need-Diagnostic ($ComposerModulePath.Equals($expectedComposer,[StringComparison]::OrdinalIgnoreCase)) 'DIAG_COMPOSER_PATH_INVALID'
    Assert-DiagnosticNoReparse $ComposerModulePath
    $resultStream=[IO.File]::Open($ResultPath,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::Read)
    Write-Diagnostic 'PIN_INPUTS'
    $wrapperStream=[IO.File]::Open($OwnerWrapperPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $composerStream=[IO.File]::Open($ComposerModulePath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $promptStream=[IO.File]::Open($TrialPromptFile,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $trialStream=[IO.File]::Open($TrialReceiptPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $wrapperBytes=Read-DiagnosticLocked $wrapperStream 262144;$composerBytes=Read-DiagnosticLocked $composerStream 262144
    $promptBytes=Read-DiagnosticLocked $promptStream 4096;$trialBytes=Read-DiagnosticLocked $trialStream 32768
    Need-Diagnostic ($wrapperBytes.Length -eq 23332 -and (Hash-DiagnosticBytes $wrapperBytes) -ceq $wrapperSha) 'DIAG_WRAPPER_HASH_MISMATCH'
    Need-Diagnostic ($composerBytes.Length -eq 28302 -and (Hash-DiagnosticBytes $composerBytes) -ceq $composerSha) 'DIAG_COMPOSER_HASH_MISMATCH'
    Need-Diagnostic ($promptBytes.Length -eq 1126 -and (Hash-DiagnosticBytes $promptBytes) -ceq $promptSha) 'DIAG_PROMPT_HASH_MISMATCH'
    Need-Diagnostic ((Hash-DiagnosticBytes $trialBytes) -ceq $trialReceiptSha) 'DIAG_TRIAL_RECEIPT_HASH_MISMATCH'
    $ownerPrompt=$utf8.GetString($promptBytes)
    Need-Diagnostic ($ownerPrompt -cmatch '\A[\x20-\x7e]{1,4096}\z' -and $ownerPrompt.Contains($trialEvent)) 'DIAG_PROMPT_INVALID'
    $record.pinnedSourcesVerified=$true;$record.trialReceiptInitiallyVerified=$true
    $handoffPath=Join-Path ([IO.Path]::GetDirectoryName($TrialReceiptPath)) 'gpt02-trial2-owner-handoff-20261020T153448.json'
    $handoffPath=Assert-DiagnosticTempPath $handoffPath
    $handoffStream=[IO.File]::Open($handoffPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)
    $handoffBytes=Read-DiagnosticLocked $handoffStream 16384
    Need-Diagnostic ((Hash-DiagnosticBytes $handoffBytes) -ceq $handoffSha) 'DIAG_HANDOFF_HASH_MISMATCH'
    $handoff=$utf8.GetString($handoffBytes)|ConvertFrom-Json
    Need-Diagnostic ($handoff.fenceToken -ceq $fenceToken -and $handoff.eventId -ceq $trialEvent -and
        $handoff.coordinatorId -ceq 'chatgpt-root-88837a97c333' -and
        $handoff.priorReceiptSha256 -ceq $trialReceiptSha) 'DIAG_HANDOFF_INVALID'
    foreach($priorPid in @(8412,18316,10816)){
        Need-Diagnostic ($null -eq (Get-Process -Id $priorPid -ErrorAction SilentlyContinue)) 'DIAG_PRIOR_EXECUTION_ACTIVE'
    }
    $taskChildren=@(Get-CimInstance Win32_Process -Filter 'ParentProcessId=24424'|
        Where-Object {-not($_.Name -ceq 'conhost.exe' -and $_.ProcessId -eq 16788 -and
            $_.CreationDate.ToUniversalTime() -lt [datetime]'2026-10-20T13:42:01Z')})
    Need-Diagnostic ($taskChildren.Count -eq 0) 'DIAG_PRIOR_EXECUTION_ACTIVE'
    $coordinatorLeasePath=Join-Path ([IO.Path]::GetDirectoryName($TrialReceiptPath)) 'gpt02_trial2_20261020T1516.owner-ui-coordinator.lease.json'
    $coordinatorLeasePath=Assert-DiagnosticTempPath $coordinatorLeasePath $false
    $coordinatorLeaseStream=[IO.File]::Open($coordinatorLeasePath,[IO.FileMode]::CreateNew,[IO.FileAccess]::ReadWrite,[IO.FileShare]::Read)
    $coordinatorLeaseRecord=@{schema='ai-core-owner-coordinator-lease/v1';fenceToken=$fenceToken;
        coordinatorId='chatgpt-root-88837a97c333';eventId=$trialEvent;ownerPid=$PID;
        acquiredAt=[DateTime]::UtcNow.ToString('o');expiresAt=[DateTime]::UtcNow.AddSeconds(400).ToString('o');
        phase='FOCUS_ONLY';released=$false;terminalStatus=$null;updatedAt=$null}
    Write-CoordinatorLease $false
    $record.coordinatorLeaseAcquired=$true
    $tokens=$null;$errors=$null
    $ast=[Management.Automation.Language.Parser]::ParseInput($utf8.GetString($wrapperBytes),$OwnerWrapperPath,[ref]$tokens,[ref]$errors)
    Need-Diagnostic (@($errors).Count -eq 0) 'DIAG_PARSE_FAILED'
    # Load declarations only from the pinned AST. Never run the wrapper's main,
    # receipt creation, native-input block, exit, or arbitrary script sections.
    foreach($name in @('Assert-OwnerTimeBudget','Get-OwnerCommandRemainingMilliseconds','Assert-OwnerRuntimeLockPath',
        'ConvertTo-OwnerWindowsArgument','Start-OwnerOpenClaw','Stop-OwnerOpenClaw','Receive-OwnerOpenClaw',
        'Invoke-OwnerOpenClaw','Assert-OwnerSession','Assert-OwnerNativeIdle')){
        $definitions=@($ast.EndBlock.Statements|Where-Object {$_ -is [Management.Automation.Language.FunctionDefinitionAst] -and $_.Name -ceq $name})
        Need-Diagnostic ($definitions.Count -eq 1) 'DIAG_WRAPPER_DEFINITION_INVALID'
        . ([ScriptBlock]::Create($definitions[0].Extent.Text))
    }
    $ownerNode=Join-Path $env:LOCALAPPDATA 'OpenClaw\deps\portable-node\node.exe'
    $ownerOcEntry=Join-Path $env:LOCALAPPDATA 'OpenClaw\deps\portable-node\node_modules\openclaw\openclaw.mjs'
    $ownerUserData=Join-Path $env:USERPROFILE '.openclaw\browser\travelincars-dev\user-data'
    $lockPath=Join-Path $env:LOCALAPPDATA 'AI-Core\chatgpt-wake-dev-receipts\native-transport.lock'
    Write-Diagnostic 'ACQUIRE_EXISTING_NATIVE_LOCK';Assert-OwnerTimeBudget 1000;Assert-OwnerRuntimeLockPath $lockPath
    $nativeLock=[IO.File]::Open($lockPath,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::ReadWrite)
    Assert-OwnerRuntimeLockPath $lockPath;Need-Diagnostic ($nativeLock.Length -ge 1) 'DIAG_RUNTIME_LOCK_EMPTY'
    $nativeLock.Lock(0,1);$nativeLocked=$true;$record.nativeLockAcquired=$true
    $composer=Import-Module -Name $ComposerModulePath -Force -PassThru -ErrorAction Stop
    Need-Diagnostic ($composer -is [Management.Automation.PSModuleInfo]) 'DIAG_MODULE_IMPORT_AMBIGUOUS'
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AiCoreOwnerForegroundV1 {
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();
}
'@ -ErrorAction Stop
    $ownerTarget=@{ConversationId=$ownerConversationId;PageUrl=$ownerPageUrl;ComposerName=$ComposerName;
        WindowHandle=$ExpectedWindowHandle;BrowserProcessId=$ExpectedBrowserProcessId}
    Write-Diagnostic 'OC_SESSION_BEFORE';Assert-OwnerSession;$record.sessionBeforeVerified=$true
    $record.rawFocusAttempted=$true;Write-Diagnostic 'OC_EXACT_RAW_FOCUS';Assert-OwnerTimeBudget 1000
    $focus=Invoke-OwnerOpenClaw 'focus';Need-Diagnostic ($focus.ok -is [bool] -and $focus.ok) 'DIAG_RAW_FOCUS_FAILED';$record.rawFocusReturned=$true
    Write-Diagnostic 'OC_SESSION_AFTER';Assert-OwnerSession;$record.sessionAfterVerified=$true
    Write-Diagnostic 'OC_SNAPSHOT';$snapshot=Invoke-OwnerOpenClaw 'snapshot'
    $names=[regex]::Matches($snapshot,'(?m)^[ \t]*- textbox "(Ask ChatGPT|Tanya ChatGPT)"[^\r\n]*$')
    $record.snapshotTrialEventAbsent=-not $snapshot.Contains($trialEvent);$record.snapshotExactPromptAbsent=-not $snapshot.Contains($ownerPrompt)
    Need-Diagnostic ($names.Count -eq 1 -and $names[0].Groups[1].Value -ceq $ComposerName -and
        $snapshot -notmatch '(?i)\bbutton\s+"(?:Stop(?: generating| responding| streaming)?|Hentikan(?: pembuatan| respons| jawaban)?)"') 'DIAG_SNAPSHOT_NOT_IDLE'
    Need-Diagnostic ($record.snapshotTrialEventAbsent -and $record.snapshotExactPromptAbsent) 'DIAG_TRIAL_CONTENT_VISIBLE'
    $record.snapshotIdleVerified=$true;$snapshot=$null
    $observation=Observe-DiagnosticNative 'NATIVE_INITIAL'
    $record.firstComposerFocusAttempted=$true;Write-Diagnostic 'FIRST_COMPOSER_FOCUS';Assert-OwnerTimeBudget 1000
    & $composer {param($State) Set-AiCoreNativeFocus $State} $observation.state
    $record.firstComposerFocusReturned=$true
    $observation=Observe-DiagnosticNative 'AFTER_FIRST_COMPOSER_FOCUS'
    $record.firstStrictFocusedReadPassed=Test-DiagnosticStrictFocus 'FIRST_STRICT_FOCUSED_READ'
    if(-not $record.firstStrictFocusedReadPassed){
        # Only a fresh, otherwise valid native state with keyboard focus true
        # and OS foreground false authorizes this single window-focus attempt.
        $observation=Observe-DiagnosticNative 'BEFORE_WINDOW_FOCUS'
        Need-Diagnostic (-not $observation.safe.foregroundMatches -and $observation.safe.composerHasKeyboardFocus -and
            $observation.safe.composerIsKeyboardFocusable) 'DIAG_FOREGROUND_ONLY_CONDITION_FAILED'
        $record.windowFocusAttempted=$true;Write-Diagnostic 'WINDOW_FOCUS_ONCE';Assert-OwnerTimeBudget 1000
        Need-Diagnostic ($observation.state.Window.Current.IsEnabled -and -not $observation.state.Window.Current.IsOffscreen) 'DIAG_WINDOW_NOT_VISIBLE'
        $record.nativeActivationAccepted=[AiCoreOwnerForegroundV1]::SetForegroundWindow([IntPtr]$ExpectedWindowHandle)
        $record.windowFocusReturned=$true
        Write-Diagnostic 'WINDOW_FOCUS_RETURNED'
        Need-Diagnostic $record.nativeActivationAccepted 'FOREGROUND_ACTIVATION_DENIED'
        $settle=[Diagnostics.Stopwatch]::StartNew()
        while(([long][AiCoreOwnerForegroundV1]::GetForegroundWindow()) -ne $ExpectedWindowHandle -and $settle.ElapsedMilliseconds -lt 1000){
            Assert-OwnerTimeBudget 100
            Start-Sleep -Milliseconds 50
        }
        $record.foregroundSettleMs=$settle.ElapsedMilliseconds
        Need-Diagnostic (([long][AiCoreOwnerForegroundV1]::GetForegroundWindow()) -eq $ExpectedWindowHandle) 'FOREGROUND_ACTIVATION_NOT_OBSERVED'
        $observation=Observe-DiagnosticNative 'AFTER_WINDOW_FOCUS'
        $record.secondComposerFocusAttempted=$true;Write-Diagnostic 'SECOND_COMPOSER_FOCUS';Assert-OwnerTimeBudget 1000
        & $composer {param($State) Set-AiCoreNativeFocus $State} $observation.state
        $record.secondComposerFocusReturned=$true
        $observation=Observe-DiagnosticNative 'AFTER_SECOND_COMPOSER_FOCUS'
        $record.finalStrictFocusedReadPassed=Test-DiagnosticStrictFocus 'FINAL_STRICT_FOCUSED_READ'
        Need-Diagnostic $record.finalStrictFocusedReadPassed 'DIAG_FINAL_FOCUS_NOT_ESTABLISHED'
    }else{$record.finalStrictFocusedReadPassed=$true}
    Assert-OwnerTimeBudget 1000
    $record.status='FOREGROUND_ONLY_VERIFIED_NO_INPUT';Write-Diagnostic 'COMPLETE_FOCUS_ONLY';$exitCode=0
}catch{
    $null=Add-DiagnosticFailure $_ $record.operation;$record.status='FAILED_FOCUS_ONLY_PRESERVE_ATTEMPT'
    try{Write-Diagnostic $record.operation}catch{}
}finally{
    if($null -ne $trialStream){
        try{
            $record.trialReceiptUnchanged=((Hash-DiagnosticBytes (Read-DiagnosticLocked $trialStream 32768)) -ceq $trialReceiptSha)
            if(-not $record.trialReceiptUnchanged){throw 'DIAG_TRIAL_RECEIPT_CHANGED'}
        }catch{$null=Add-DiagnosticFailure $_ 'VERIFY_TRIAL_RECEIPT_UNCHANGED';$record.status='FAILED_FOCUS_ONLY_PRESERVE_ATTEMPT';$exitCode=1}
    }
    try{Write-Diagnostic $record.operation}catch{$exitCode=1}
    if($null -ne $nativeLock){try{if($nativeLocked){$nativeLock.Unlock(0,1)}}finally{$nativeLock.Dispose()}}
    try{Write-CoordinatorLease $true}catch{$exitCode=1}
    foreach($stream in @($handoffStream,$coordinatorLeaseStream,$trialStream,$promptStream,$composerStream,$wrapperStream,$resultStream)){if($null -ne $stream){$stream.Dispose()}}
}
$record|ConvertTo-Json -Depth 8 -Compress
exit $exitCode
