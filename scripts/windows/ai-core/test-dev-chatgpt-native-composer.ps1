# Behavioral component tests only. Native OS/browser functions are replaced in
# module scope before invocation; no window, account, clipboard or key is read.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$modulePath = Join-Path $PSScriptRoot 'dev-chatgpt-native-composer.psm1'
$parseErrors = $null
$tokens = $null
$null = [System.Management.Automation.Language.Parser]::ParseFile($modulePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Native composer module failed PowerShell parse' }
$null = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot 'dev-chatgpt-native-bridge.ps1'), [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Native bridge failed PowerShell parse' }
Import-Module $modulePath -Force
$nativeModule = Get-Module 'dev-chatgpt-native-composer'

& $nativeModule {
    function script:Get-AiCoreNativeState {
        param([hashtable]$Target, [bool]$RequireFocus = $false)
        $script:Fake.Reads++
        if ($script:Fake.FailRead -eq $script:Fake.Reads) { throw 'Synthetic native context changed' }
        if ($RequireFocus -and -not $script:Fake.Focused) { throw 'Synthetic focus lost' }
        $draft = $script:Fake.Draft
        if ($script:Fake.DriftRead -eq $script:Fake.Reads) { $draft += ' extra draft' }
        return @{ Draft = $draft }
    }
    function script:Set-AiCoreNativeFocus {
        param($State)
        $script:Fake.Trace.Add('focus')
        $script:Fake.Focused = -not $script:Fake.FailFocus
    }
    function script:Send-AiCoreNativeKeys {
        param([string]$Keys)
        $script:Fake.Trace.Add('keys:' + $Keys)
        if ($Keys -cne '^{END}' -and $Keys -cne '{F5}') {
            # Model a successful literal OS insertion independently of the
            # encoder assertions below. Keep any real prefix; never clear it.
            $script:Fake.Draft = $script:Fake.ActualPrefix + $script:Fake.Message + $script:Fake.ProviderSuffix
        }
    }
    function script:Get-AiCoreNativeSendControl {
        param($State)
        if ($script:Fake.FailSendControl) { throw 'Synthetic Send is missing or ambiguous' }
        return 'synthetic-invoke-pattern'
    }
    function script:Invoke-AiCoreNativeSend {
        param($Pattern)
        $script:Fake.Trace.Add('invoke')
        $script:Fake.Invokes++
        if ($script:Fake.FailInvoke) { throw 'Synthetic unknown Invoke result' }
    }
}

function Assert-True { param([bool]$Condition, [string]$Because) if (-not $Condition) { throw $Because } }
function Assert-Throws {
    param([scriptblock]$Action, [string]$Match)
    $caught = $false
    try { & $Action | Out-Null } catch {
        if ($_.Exception.Message -notmatch $Match) { throw }
        $caught = $true
    }
    if (-not $caught) { throw ('Expected failure: ' + $Match) }
}

function New-NativeFixture {
    $target = @{ AccountAlias = 'GPT02'; OwnerChannel = ('ai-engine-oauth:' + ('d' * 64));
        ConversationId = '22222222-2222-4222-8222-222222222222'; WorkerId = 'openclaw-dell-chatgpt-wake-dev';
        BrowserProfile = 'travelincars-dev'; BindingFingerprint = '4da956549aa62bb6e42bdc4ab13390d2b137d29940e2bb6a89134dfc2f0dbec1';
        EventId = ('b' * 64); Challenge = ('c' * 64); ComposerName = 'Ask ChatGPT'; WindowHandle = 1234; BrowserProcessId = 5678;
        PageUrl = 'https://chatgpt.com/c/22222222-2222-4222-8222-222222222222'; RawTargetId = ('A' * 32) }
    $directory = Join-Path ([IO.Path]::GetTempPath()) ('ai-core-native-component-' + [guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($directory)
    $fake = @{ Reads = 0; FailRead = 0; DriftRead = 0; Focused = $false; FailFocus = $false;
        FailSendControl = $false; FailInvoke = $false; Invokes = 0; ActualPrefix = ''; ProviderSuffix = '';
        Draft = "Ask ChatGPT`n"; Message = 'Safe [ack] + 100%'; Trace = [Collections.Generic.List[string]]::new() }
    & $nativeModule { param($State) $script:Fake = $State } $fake
    return @{ Target = $target; Directory = $directory; Fake = $fake;
        Marker = (Join-Path $directory ($target.BindingFingerprint + '-' + $target.EventId + '.native-input.json')) }
}

function Invoke-Fixture {
    param($Fixture, [switch]$AllowProviderLf)
    Invoke-AiCoreNativeComposerOnce -Target $Fixture.Target -Message $Fixture.Fake.Message `
        -ReceiptDirectory $Fixture.Directory -AllowProviderLf:$AllowProviderLf
}

$cases = [ordered]@{
    'SendKeys reserved characters are literal, including protocol brackets' = {
        $literal = & $nativeModule { ConvertTo-AiCoreLiteralKeys '+^%~(){}[]' }
        Assert-True ($literal -ceq '{+}{^}{%}{~}{(}{)}{{}{}}{[}{]}') 'Reserved character encoding changed'
        $attack = & $nativeModule { ConvertTo-AiCoreLiteralKeys '^{ENTER}~' }
        Assert-True ($attack -ceq '{^}{{}ENTER{}}{~}') 'Control syntax was not made literal'
    }
    'Control characters, non-ASCII, blank and excessive input fail before focus' = {
        foreach ($message in @("bad`nline", "bad`rline", "bad`tline", ([string][char]0), ([string][char]127), ([string][char]233), '   ', ('x' * 4097))) {
            $f.Fake.Message = $message
            Assert-Throws { Invoke-Fixture $f } 'bounded printable'
        }
        Assert-True ($f.Fake.Trace.Count -eq 0) 'Invalid message reached native input'
    }
    'Placeholder-shaped unknown is inserted without deletion and sent once after two exact reads' = {
        $result = Invoke-Fixture $f
        Assert-True ($f.Fake.Reads -eq 5) 'Required fresh context/readback checks were skipped'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'focus|keys:^{END}|keys:Safe {[}ack{]} {+} 100{%}|invoke') 'Input order or literal payload changed'
        Assert-True ($result.sendInvoked -and -not $result.deliveryVerified -and -not $result.verifiedAssistantReply) 'Invoke became delivery or assistant proof'
        $record = Get-Content -LiteralPath $f.Marker -Raw | ConvertFrom-Json
        Assert-True ($record.status -ceq 'SEND_INVOKED') 'Native attempt status was not persisted'
        Assert-True ($record.inputStartedAt -gt 0 -and $record.sendAttemptedAt -ge $record.inputStartedAt) 'Original attempt timestamps were not persisted'
        Assert-True ($result.sendAttemptedAt -eq $record.sendAttemptedAt -and $record.challenge -ceq $f.Target.Challenge) 'Returned attempt context differs from durable context'
        Assert-True (-not ((Get-Content -LiteralPath $f.Marker -Raw).Contains($f.Fake.Message))) 'Raw message leaked into native marker'
        Assert-Throws { Invoke-Fixture $f } 'already attempted'
        Assert-True ($f.Fake.Invokes -eq 1) 'Successful send was retried'
    }
    'Known nonempty and whitespace drafts are preserved before any insertion' = {
        foreach ($draft in @('my draft', ' ', "`n", "`t")) {
            $f.Fake.Draft = $draft
            Assert-Throws { Invoke-Fixture $f } 'preserving'
            Assert-True ($f.Fake.Draft -ceq $draft) 'Existing draft changed'
        }
        Assert-True ($f.Fake.Trace.Count -eq 0) 'Known draft reached input'
    }
    'A real placeholder-shaped draft is never erased or sent' = {
        $f.Fake.ActualPrefix = "Ask ChatGPT`n"
        Assert-Throws { Invoke-Fixture $f } 'exactly match'
        Assert-True ($f.Fake.Draft -ceq ($f.Fake.ActualPrefix + $f.Fake.Message)) 'Original prefix was erased'
        Assert-True ($f.Fake.Invokes -eq 0) 'A combined draft was sent'
        Assert-Throws { Invoke-Fixture $f } 'already attempted'
        Assert-True ($f.Fake.Trace.Count -eq 3) 'Uncertain insertion was retried'
    }
    'Second readback drift prevents Send and preserves attempted draft' = {
        $f.Fake.DriftRead = 5
        Assert-Throws { Invoke-Fixture $f } 'exactly match'
        Assert-True ($f.Fake.Invokes -eq 0) 'Changed draft was sent'
        Assert-True ([IO.File]::Exists($f.Marker)) 'Attempt marker was lost'
    }
    'A new draft reported after focus prevents CtrlEnd and payload insertion' = {
        $f.Fake.DriftRead = 2
        Assert-Throws { Invoke-Fixture $f } 'preserving'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'focus') 'Known draft was modified after focus'
        Assert-True ($f.Fake.Invokes -eq 0) 'Known draft was sent'
    }
    'A new draft reported after CtrlEnd prevents payload insertion' = {
        $f.Fake.DriftRead = 3
        Assert-Throws { Invoke-Fixture $f } 'preserving'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'focus|keys:^{END}') 'Known draft received the payload'
        Assert-True ($f.Fake.Invokes -eq 0) 'Known draft was sent'
    }
    'Context change before typing never emits the payload' = {
        $f.Fake.FailRead = 3
        Assert-Throws { Invoke-Fixture $f } 'context changed'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'focus|keys:^{END}') 'Literal payload escaped its target'
    }
    'Lost focus prevents all keyboard input' = {
        $f.Fake.FailFocus = $true
        Assert-Throws { Invoke-Fixture $f } 'focus lost'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'focus') 'Keystrokes escaped after lost focus'
    }
    'Ambiguous Send control is not replaced with Enter or an arbitrary button' = {
        $f.Fake.FailSendControl = $true
        Assert-Throws { Invoke-Fixture $f } 'missing or ambiguous'
        Assert-True ($f.Fake.Invokes -eq 0 -and $f.Fake.Trace.Count -eq 3) 'Send fallback was attempted'
    }
    'Unknown Invoke result is recorded and never retried' = {
        $f.Fake.FailInvoke = $true
        Assert-Throws { Invoke-Fixture $f } 'unknown Invoke'
        Assert-Throws { Invoke-Fixture $f } 'already attempted'
        Assert-True ($f.Fake.Invokes -eq 1) 'Uncertain Invoke was retried'
        $record = Get-Content -LiteralPath $f.Marker -Raw | ConvertFrom-Json
        Assert-True ($record.status -ceq 'SEND_ATTEMPTING') 'Uncertain send was marked delivered'
    }
    'An existing attempt marker is not overwritten or replayed' = {
        [IO.File]::WriteAllText($f.Marker, 'existing evidence')
        Assert-Throws { Invoke-Fixture $f } 'already attempted'
        Assert-True (([IO.File]::ReadAllText($f.Marker)) -ceq 'existing evidence') 'Existing evidence was overwritten'
        Assert-True ($f.Fake.Reads -eq 0 -and $f.Fake.Trace.Count -eq 0) 'Existing attempt reached native operations'
    }
    'Provider LF must be adopted before input; no trimming other whitespace' = {
        $f.Fake.ProviderSuffix = "`n"
        Assert-Throws { Invoke-Fixture $f } 'exactly match'
        Assert-True ($f.Fake.Invokes -eq 0) 'Unadopted LF was accepted'
    }
    'An explicitly adopted single provider LF permits exact readback' = {
        $f.Fake.ProviderSuffix = "`n"
        $result = Invoke-Fixture $f -AllowProviderLf
        Assert-True ($result.sendInvoked -and $f.Fake.Invokes -eq 1) 'Adopted LF rejected an exact payload'
    }
    'A mismatched binding fails before native reads' = {
        $f.Target.BrowserProfile = 'another-profile'
        Assert-Throws { Invoke-Fixture $f } 'fingerprint mismatch'
        Assert-True ($f.Fake.Reads -eq 0 -and $f.Fake.Trace.Count -eq 0) 'Mismatched binding reached native UI'
    }
    'Only the two observed native address strings match an authoritative HTTPS tab' = {
        & $nativeModule { param($Target) Assert-AiCoreNativeAddress $Target $Target.PageUrl } $f.Target
        & $nativeModule { param($Target) Assert-AiCoreNativeAddress $Target ('chatgpt.com/c/' + $Target.ConversationId) } $f.Target
        foreach ($address in @(($f.Target.PageUrl + '/'), ($f.Target.PageUrl + '?x=1'), ($f.Target.PageUrl + '#x'),
                $f.Target.PageUrl.Replace('https:', 'http:'), $f.Target.PageUrl.Replace('chatgpt.com', 'CHATGPT.COM'),
                $f.Target.PageUrl.Replace('chatgpt.com', 'other.example'), ('https://user@chatgpt.com/c/' + $f.Target.ConversationId),
                ('chatgpt.com/c/' + $f.Target.ConversationId + '/'), '', $null)) {
            Assert-Throws { & $nativeModule { param($Target, $Value) Assert-AiCoreNativeAddress $Target $Value } $f.Target $address } 'destination changed'
        }
    }
    'An elided native URL cannot replace the independent full HTTPS tab identity' = {
        $f.Target.PageUrl = 'chatgpt.com/c/' + $f.Target.ConversationId
        Assert-Throws { Invoke-Fixture $f } 'context is invalid'
        Assert-True ($f.Fake.Reads -eq 0 -and $f.Fake.Trace.Count -eq 0) 'Missing authoritative HTTPS identity reached UI'
    }
    'One explicit-empty native refresh retains original Send time and cannot repeat' = {
        $null = Invoke-Fixture $f
        $before = Get-Content -LiteralPath $f.Marker -Raw | ConvertFrom-Json
        $f.Fake.Draft = ''
        $f.Fake.Reads = 0
        $f.Fake.Trace.Clear()
        $result = Invoke-AiCoreNativeRefreshOnce -Target $f.Target -ReceiptDirectory $f.Directory -MessageHash $before.messageHash
        Assert-True ($result.refreshInvoked -and ($f.Fake.Trace -join '|') -ceq 'focus|keys:{F5}') 'Native refresh order changed'
        $after = Get-Content -LiteralPath $f.Marker -Raw | ConvertFrom-Json
        Assert-True ($after.sendAttemptedAt -eq $before.sendAttemptedAt -and $after.inputStartedAt -eq $before.inputStartedAt) 'Original timestamp was reset'
        Assert-True ($after.status -ceq 'REFRESH_INVOKED' -and $after.refreshAttemptedAt -ge $after.sendAttemptedAt) 'Refresh attempt was not persisted'
        Assert-Throws { Invoke-AiCoreNativeRefreshOnce -Target $f.Target -ReceiptDirectory $f.Directory -MessageHash $before.messageHash } 'already attempted'
        Assert-True ($f.Fake.Trace.Count -eq 2) 'Refresh was replayed'
    }
    'Unknown placeholder value never authorizes a draft-discarding refresh' = {
        $null = Invoke-Fixture $f
        $record = Get-Content -LiteralPath $f.Marker -Raw | ConvertFrom-Json
        $f.Fake.Draft = "Ask ChatGPT`n"
        $f.Fake.Trace.Clear()
        Assert-Throws { Invoke-AiCoreNativeRefreshOnce -Target $f.Target -ReceiptDirectory $f.Directory -MessageHash $record.messageHash } 'explicitly empty'
        Assert-True ($f.Fake.Trace.Count -eq 0) 'Unknown draft reached refresh'
    }
    'Draft change after refresh focus prevents F5' = {
        $null = Invoke-Fixture $f
        $record = Get-Content -LiteralPath $f.Marker -Raw | ConvertFrom-Json
        $f.Fake.Draft = ''
        $f.Fake.Reads = 0
        $f.Fake.DriftRead = 2
        $f.Fake.Trace.Clear()
        Assert-Throws { Invoke-AiCoreNativeRefreshOnce -Target $f.Target -ReceiptDirectory $f.Directory -MessageHash $record.messageHash } 'explicitly empty'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'focus') 'Changed draft was refreshed'
    }
    'Another message hash cannot refresh the original native attempt' = {
        $null = Invoke-Fixture $f
        $f.Fake.Draft = ''
        $f.Fake.Trace.Clear()
        Assert-Throws { Invoke-AiCoreNativeRefreshOnce -Target $f.Target -ReceiptDirectory $f.Directory -MessageHash ('0' * 64) } 'context mismatch'
        Assert-True ($f.Fake.Trace.Count -eq 0) 'Uncorrelated message reached refresh'
    }
    'A draft appearing during durable refresh marking prevents F5 and keeps the marker' = {
        $null = Invoke-Fixture $f
        $record = Get-Content -LiteralPath $f.Marker -Raw | ConvertFrom-Json
        $f.Fake.Draft = ''
        $f.Fake.Reads = 0
        $f.Fake.DriftRead = 3
        $f.Fake.Trace.Clear()
        Assert-Throws { Invoke-AiCoreNativeRefreshOnce -Target $f.Target -ReceiptDirectory $f.Directory -MessageHash $record.messageHash } 'explicitly empty'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'focus') 'Draft drift after durable write reached F5'
        $after = Get-Content -LiteralPath $f.Marker -Raw | ConvertFrom-Json
        Assert-True ($after.status -ceq 'REFRESH_ATTEMPTING') 'Uncertain refresh marker was removed'
    }
    'A PowerShell JSON epoch roundtrip accepts Decimal but rejects coerced timestamps' = {
        $null = Invoke-Fixture $f
        $record = Get-Content -LiteralPath $f.Marker -Raw | ConvertFrom-Json
        $roundtrip = @{ epoch = [double]1792494386.943 } | ConvertTo-Json -Compress | ConvertFrom-Json
        Assert-True ($roundtrip.epoch -is [decimal] -or $roundtrip.epoch -is [double]) 'Epoch JSON roundtrip lost numeric precision/type'
        $record.sendAttemptedAt = $roundtrip.epoch
        $record.inputStartedAt = [decimal]1792494386.900
        $valid = $record | ConvertTo-Json -Compress
        $f.Fake.Draft = ''
        $f.Fake.Trace.Clear()
        foreach ($invalid in @('1792494386.943', $true, 0, -1, ([double]253402300799))) {
            $record.sendAttemptedAt = $invalid
            [IO.File]::WriteAllText($f.Marker, ($record | ConvertTo-Json -Compress))
            Assert-Throws { Invoke-AiCoreNativeRefreshOnce -Target $f.Target -ReceiptDirectory $f.Directory -MessageHash $record.messageHash } 'original Send time unavailable'
        }
        Assert-True ($f.Fake.Trace.Count -eq 0) 'Invalid timestamp reached native focus or input'
        [IO.File]::WriteAllText($f.Marker, $valid)
        $result = Invoke-AiCoreNativeRefreshOnce -Target $f.Target -ReceiptDirectory $f.Directory -MessageHash $record.messageHash
        Assert-True ($result.refreshInvoked) 'Observed Decimal timestamp was rejected'
    }
}

$passed = 0
foreach ($case in $cases.GetEnumerator()) {
    $f = New-NativeFixture
    try {
        & $case.Value
        $passed++
        Write-Output ('PASS ' + $case.Key)
    } finally { [IO.Directory]::Delete($f.Directory, $true) }
}
Remove-Module $nativeModule
Write-Output ("Native composer component cases passed: $passed. No browser or E2E assertion.")
