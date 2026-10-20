# Behavioral component tests only. Native OS/browser functions are replaced in
# module scope before invocation; no window, account, clipboard or key is read.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or
    $PSVersionTable.PSVersion.Minor -ne 1) { throw 'Native component gate requires Windows PowerShell 5.1 Desktop' }
$PSVersionTable | Format-Table -AutoSize | Out-String | Write-Output
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
    function script:Assert-AiCoreNativeIdle { param($State) }
    function script:Get-AiCoreNativeTickCount64 { return [long]$script:Fake.Tick }
    function script:Get-AiCoreNativeUnixSeconds {
        if ($script:Fake.UnixNow -eq 0) { $script:Fake.UnixNow = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0 }
        return $script:Fake.UnixNow
    }
    function script:Get-AiCoreNativeState {
        param([hashtable]$Target, [bool]$RequireFocus = $false)
        $script:Fake.Reads++
        if ($script:Fake.ExpireAtRead -eq $script:Fake.Reads) { $script:Fake.Tick = 10000 }
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
    function script:Set-AiCoreNativeComposerValue {
        param($State, [string]$Value)
        $script:Fake.Trace.Add('composer-set')
        # Model provider-side readback independently. A synthetic hidden prefix
        # still proves that exact readback, not SetValue success, authorizes Send.
        $script:Fake.Draft = $script:Fake.ActualPrefix + $Value + $script:Fake.ProviderSuffix
        if ($script:Fake.ExpireAfterTyping) { $script:Fake.Tick = 10000 }
    }
    function script:Send-AiCoreNativeKeys {
        param([string]$Keys)
        $script:Fake.Trace.Add('keys:' + $Keys)
        if ($Keys -ceq '{ENTER}') {
            $script:Fake.ReaderEnters++
            if ($script:Fake.FailReaderEnter) { throw 'Synthetic unknown reader Enter' }
        } elseif ($Keys -cne '^{END}' -and $Keys -cne '{F5}') {
            # Model a successful literal OS insertion independently of the
            # encoder assertions below. Keep any real prefix; never clear it.
            $script:Fake.Draft = $script:Fake.ActualPrefix + $script:Fake.Message + $script:Fake.ProviderSuffix
            if ($script:Fake.ExpireAfterTyping) { $script:Fake.Tick = 10000 }
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
    function script:Get-AiCoreNativeReaderState {
        param([hashtable]$Target, [hashtable]$Reader, [string]$ExpectedAddress, [bool]$RequireFocus = $false)
        $script:Fake.ReaderReads++
        if ($script:Fake.AgeProofAtReaderRead -eq $script:Fake.ReaderReads) { $script:Fake.UnixNow += 31 }
        if ($script:Fake.FailReaderRead -eq $script:Fake.ReaderReads) { throw 'Synthetic reader PID title or address changed' }
        if ($script:Fake.ReaderAddress -cne $ExpectedAddress) { throw 'Synthetic reader address changed' }
        if ($RequireFocus -and (-not $script:Fake.ReaderForeground -or -not $script:Fake.ReaderFocused)) { throw 'Synthetic reader focus lost' }
        return @{ Address = 'synthetic-address-control' }
    }
    function script:Set-AiCoreNativeReaderFocus {
        param($State)
        $script:Fake.Trace.Add('reader-focus')
        $script:Fake.ReaderFocused = -not $script:Fake.FailReaderFocus
        $script:Fake.ReaderForeground = -not $script:Fake.FailReaderForeground
    }
    function script:Set-AiCoreNativeReaderAddress {
        param($State, [string]$Address)
        if ($script:Fake.ReaderReadOnly) { throw 'Synthetic address is not writable' }
        $script:Fake.Trace.Add('reader-set')
        $script:Fake.ReaderAddress = $Address
        if ($script:Fake.ExpireAfterAddress) { $script:Fake.Tick = 10000 }
        if ($script:Fake.AgeProofAfterAddress) { $script:Fake.UnixNow += 31 }
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
        Draft = "Ask ChatGPT`n"; Message = 'Safe [ack] + 100%'; Trace = [Collections.Generic.List[string]]::new();
        ReaderReads = 0; FailReaderRead = 0; ReaderAddress = 'about:blank'; ReaderFocused = $false;
        FailReaderFocus = $false; ReaderForeground = $false; FailReaderForeground = $false;
        ReaderReadOnly = $false; ReaderEnters = 0; FailReaderEnter = $false;
        Tick = 1000; ExpireAtRead = 0; ExpireAfterTyping = $false; ExpireAfterAddress = $false;
        UnixNow = 0; AgeProofAtReaderRead = 0; AgeProofAfterAddress = $false }
    & $nativeModule { param($State) $script:Fake = $State } $fake
    return @{ Target = $target; Directory = $directory; Fake = $fake;
        Marker = (Join-Path $directory ($target.BindingFingerprint + '-' + $target.EventId + '.native-input.json')) }
}

function New-ReaderMarker {
    param($Fixture)
    $t = $Fixture.Target
    $reader = @{ RawTargetId = ('B' * 32); WindowHandle = $t.WindowHandle }
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0
    $record = @{ version = 1; status = 'BLANK_VERIFIED'; eventId = $t.EventId; challenge = $t.Challenge;
        bindingFingerprint = $t.BindingFingerprint; browserProfile = $t.BrowserProfile; conversationId = $t.ConversationId;
        pageUrl = $t.PageUrl; originalRawTargetId = $t.RawTargetId; browserProcessId = $t.BrowserProcessId;
        accountAlias = $t.AccountAlias; ownerChannel = $t.OwnerChannel; workerId = $t.WorkerId;
        messageHash = ('f' * 64); readerRawTargetId = $reader.RawTargetId; readerWindowHandle = $reader.WindowHandle;
        preopenTargetIds = @($t.RawTargetId); blankVerifiedAt = $now; sendAttemptedAt = ($now - 5) }
    $path = Join-Path $Fixture.Directory ($t.BindingFingerprint + '-' + $t.EventId + '.native-reader.json')
    [IO.File]::WriteAllText($path, ($record | ConvertTo-Json -Compress))
    return @{ Reader = $reader; Record = $record; Path = $path }
}

function Invoke-ReaderFixture {
    param($Fixture, $Owned, [long]$LeaseExpiresTickCount64 = 0)
    Invoke-AiCoreNativeReaderNavigationOnce -Target $Fixture.Target -Reader $Owned.Reader `
        -MessageHash $Owned.Record.messageHash -ReceiptDirectory $Fixture.Directory `
        -LeaseExpiresTickCount64 $LeaseExpiresTickCount64
}

function Invoke-Fixture {
    param($Fixture, [switch]$AllowProviderLf, [long]$LeaseExpiresTickCount64 = 0)
    Invoke-AiCoreNativeComposerOnce -Target $Fixture.Target -Message $Fixture.Fake.Message `
        -ReceiptDirectory $Fixture.Directory -AllowProviderLf:$AllowProviderLf `
        -LeaseExpiresTickCount64 $LeaseExpiresTickCount64
}

$cases = [ordered]@{
    'Expired or overlong worker lease stops before input and marker creation' = {
        foreach ($expires in @(999, 1000, 301001)) {
            Assert-Throws { Invoke-Fixture $f -LeaseExpiresTickCount64 $expires } 'lease is expired or invalid'
        }
        Assert-True ($f.Fake.Trace.Count -eq 0 -and -not [IO.File]::Exists($f.Marker)) 'Invalid lease reached input'
    }
    'Valid worker lease preserves both exact reads and single Send' = {
        $result = Invoke-Fixture $f -LeaseExpiresTickCount64 10000
        Assert-True ($result.sendInvoked -and $f.Fake.Reads -eq 5 -and $f.Fake.Invokes -eq 1) 'Leased input changed exact readbacks'
    }
    'Lease expiry after typing blocks Send and preserves uncertain attempt' = {
        $f.Fake.ExpireAfterTyping = $true
        Assert-Throws { Invoke-Fixture $f -LeaseExpiresTickCount64 10000 } 'lease is expired or invalid'
        $record = Get-Content -LiteralPath $f.Marker -Raw | ConvertFrom-Json
        Assert-True ($f.Fake.Invokes -eq 0 -and $f.Fake.Draft -ceq $f.Fake.Message) 'Expired input was sent or erased'
        Assert-True ($record.status -ceq 'SEND_ATTEMPTING') 'Expired Send lost its durable marker'
    }
    'Lease expiry after address staging blocks Enter without erasing address' = {
        $owned = New-ReaderMarker $f
        $f.Fake.ExpireAfterAddress = $true
        Assert-Throws { Invoke-ReaderFixture $f $owned -LeaseExpiresTickCount64 10000 } 'lease is expired or invalid'
        $record = Get-Content -LiteralPath $owned.Path -Raw | ConvertFrom-Json
        Assert-True ($f.Fake.ReaderEnters -eq 0 -and $f.Fake.ReaderAddress -ceq $f.Target.PageUrl) 'Expired navigation was sent or erased'
        Assert-True ($record.status -ceq 'NAVIGATION_ATTEMPTING') 'Expired Enter lost its durable marker'
    }
    'Lease expiry during refresh marking prevents F5 and preserves original Send' = {
        $null = Invoke-Fixture $f
        $before = Get-Content -LiteralPath $f.Marker -Raw | ConvertFrom-Json
        $f.Fake.Draft = ''
        $f.Fake.ExpireAtRead = $f.Fake.Reads + 3
        Assert-Throws {
            Invoke-AiCoreNativeRefreshOnce -Target $f.Target -MessageHash $before.messageHash `
                -ReceiptDirectory $f.Directory -LeaseExpiresTickCount64 10000
        } 'lease is expired or invalid'
        $after = Get-Content -LiteralPath $f.Marker -Raw | ConvertFrom-Json
        Assert-True (-not $f.Fake.Trace.Contains('keys:{F5}')) 'Expired refresh emitted F5'
        Assert-True ($after.status -ceq 'REFRESH_ATTEMPTING' -and $after.sendAttemptedAt -eq $before.sendAttemptedAt) 'Expired refresh lost its original attempt'
    }
    'A blank proof aging during focus and durable marking blocks address staging' = {
        $owned = New-ReaderMarker $f
        $f.Fake.AgeProofAtReaderRead = 3
        Assert-Throws { Invoke-ReaderFixture $f $owned } 'proof is stale'
        $after = Get-Content -LiteralPath $owned.Path -Raw | ConvertFrom-Json
        Assert-True ($f.Fake.ReaderAddress -ceq 'about:blank' -and $f.Fake.ReaderEnters -eq 0) 'Stale proof authorized address input'
        Assert-True ($after.blankVerifiedAt -eq $owned.Record.blankVerifiedAt -and $after.status -ceq 'NAVIGATION_ATTEMPTING') 'Original proof was redated or forgotten'
    }
    'A blank proof aging after address staging blocks Enter and keeps the address' = {
        $owned = New-ReaderMarker $f
        $f.Fake.AgeProofAfterAddress = $true
        Assert-Throws { Invoke-ReaderFixture $f $owned } 'proof is stale'
        $after = Get-Content -LiteralPath $owned.Path -Raw | ConvertFrom-Json
        Assert-True ($f.Fake.ReaderAddress -ceq $f.Target.PageUrl -and $f.Fake.ReaderEnters -eq 0) 'Stale proof authorized Enter or erased staged address'
        Assert-True ($after.blankVerifiedAt -eq $owned.Record.blankVerifiedAt) 'Original blank proof was redated'
    }
    'SendKeys reserved characters are literal, including protocol brackets' = {
        $literal = & $nativeModule { ConvertTo-AiCoreLiteralKeys '+^%~(){}[]' }
        Assert-True ($literal -ceq '{+}{^}{%}{~}{(}{)}{{}{}}{[}{]}') 'Reserved character encoding changed'
        $attack = & $nativeModule { ConvertTo-AiCoreLiteralKeys '^{ENTER}~' }
        Assert-True ($attack -ceq '{^}{{}ENTER{}}{~}') 'Control syntax was not made literal'
    }
    'Composer payload uses exact writable ValuePattern rather than global SendKeys' = {
        $source = Get-Content -LiteralPath $modulePath -Raw
        Assert-True ($source.Contains('function Set-AiCoreNativeComposerValue')) 'Composer ValuePattern setter is missing'
        Assert-True ($source.Contains('Set-AiCoreNativeComposerValue $prewrite $Message')) 'Composer payload still lacks exact ValuePattern insertion'
    }
    'Control characters, non-ASCII, blank and excessive input fail before focus' = {
        foreach ($message in @("bad`nline", "bad`rline", "bad`tline", ([string][char]0), ([string][char]127), ([string][char]233), '   ', ('x' * 4097))) {
            $f.Fake.Message = $message
            Assert-Throws { Invoke-Fixture $f } 'bounded printable'
        }
        Assert-True ($f.Fake.Trace.Count -eq 0) 'Invalid message reached native input'
    }
    'Placeholder-shaped unknown is set by exact composer ValuePattern and sent once after two exact reads' = {
        $result = Invoke-Fixture $f
        Assert-True ($f.Fake.Reads -eq 5) 'Required fresh context/readback checks were skipped'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'focus|composer-set|invoke') 'Input order or literal payload changed'
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
        Assert-True ($f.Fake.Trace.Count -eq 2) 'Uncertain insertion was retried'
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
    'A new draft reported at the final prewrite guard prevents payload insertion' = {
        $f.Fake.DriftRead = 3
        Assert-Throws { Invoke-Fixture $f } 'preserving'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'focus') 'Known draft received the payload'
        Assert-True ($f.Fake.Invokes -eq 0) 'Known draft was sent'
    }
    'Context change before typing never emits the payload' = {
        $f.Fake.FailRead = 3
        Assert-Throws { Invoke-Fixture $f } 'context changed'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'focus') 'Composer ValuePattern escaped its target'
    }
    'Lost focus prevents all keyboard input' = {
        $f.Fake.FailFocus = $true
        Assert-Throws { Invoke-Fixture $f } 'focus lost'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'focus') 'Composer mutation escaped after lost focus'
    }
    'Ambiguous Send control is not replaced with Enter or an arbitrary button' = {
        $f.Fake.FailSendControl = $true
        Assert-Throws { Invoke-Fixture $f } 'missing or ambiguous'
        Assert-True ($f.Fake.Invokes -eq 0 -and $f.Fake.Trace.Count -eq 2) 'Send fallback was attempted'
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
    'An initially background owned blank is focused and checked four times while retaining Send time' = {
        $owned = New-ReaderMarker $f
        Assert-True (-not $f.Fake.ReaderForeground -and -not $f.Fake.ReaderFocused) 'Fixture must begin in the background'
        $result = Invoke-ReaderFixture $f $owned
        Assert-True ($f.Fake.ReaderReads -eq 4) 'Reader state was not checked before every native action'
        Assert-True ($f.Fake.ReaderForeground -and $f.Fake.ReaderFocused) 'Native focus was not restored before input'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'reader-focus|reader-set|keys:{ENTER}') 'Owned reader input order changed'
        Assert-True ($result.navigationInvoked -and $result.rawTargetId -ceq $owned.Reader.RawTargetId) 'Reader navigation identity changed'
        Assert-True ($f.Fake.Draft -ceq "Ask ChatGPT`n" -and $f.Fake.Invokes -eq 0) 'Original composer was touched'
        $after = Get-Content -LiteralPath $owned.Path -Raw | ConvertFrom-Json
        Assert-True ($after.status -ceq 'NAVIGATION_INVOKED' -and $after.sendAttemptedAt -eq $owned.Record.sendAttemptedAt) 'Original Send time or navigation record changed'
        Assert-Throws { Invoke-ReaderFixture $f $owned } 'already attempted'
        Assert-True ($f.Fake.ReaderEnters -eq 1) 'Owned reader navigation was repeated'
    }
    'A different native PID title or address after focus prevents address editing' = {
        $owned = New-ReaderMarker $f
        $f.Fake.FailReaderRead = 2
        Assert-Throws { Invoke-ReaderFixture $f $owned } 'reader PID title or address changed'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'reader-focus') 'Changed blank received an address'
        Assert-True ($f.Fake.ReaderAddress -ceq 'about:blank' -and $f.Fake.ReaderEnters -eq 0) 'Changed tab was navigated'
    }
    'Reader drift during durable marking prevents SetValue and cannot repeat' = {
        $owned = New-ReaderMarker $f
        $f.Fake.FailReaderRead = 3
        Assert-Throws { Invoke-ReaderFixture $f $owned } 'reader PID title or address changed'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'reader-focus') 'Changed blank received an address after marking'
        $after = Get-Content -LiteralPath $owned.Path -Raw | ConvertFrom-Json
        Assert-True ($after.status -ceq 'NAVIGATION_ATTEMPTING') 'Uncertain reader attempt was not retained'
        Assert-Throws { Invoke-ReaderFixture $f $owned } 'already attempted'
    }
    'Reader drift after address SetValue blocks Enter and retains the owned tab' = {
        $owned = New-ReaderMarker $f
        $f.Fake.FailReaderRead = 4
        Assert-Throws { Invoke-ReaderFixture $f $owned } 'reader PID title or address changed'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'reader-focus|reader-set') 'Enter escaped its blank document guard'
        Assert-True ($f.Fake.ReaderEnters -eq 0 -and $f.Fake.ReaderAddress -ceq $f.Target.PageUrl) 'Staged address was erased or navigated'
        Assert-Throws { Invoke-ReaderFixture $f $owned } 'already attempted'
    }
    'Lost native reader focus and read-only address cannot reach Enter' = {
        $owned = New-ReaderMarker $f
        $f.Fake.FailReaderFocus = $true
        Assert-Throws { Invoke-ReaderFixture $f $owned } 'reader focus lost'
        Assert-True ($f.Fake.ReaderEnters -eq 0 -and $f.Fake.ReaderAddress -ceq 'about:blank') 'Focus loss reached reader input'
        $f.Fake.FailReaderFocus = $false
        $f.Fake.ReaderReadOnly = $true
        Assert-Throws { Invoke-ReaderFixture $f $owned } 'not writable'
        Assert-True ($f.Fake.ReaderEnters -eq 0 -and $f.Fake.ReaderAddress -ceq 'about:blank') 'Read-only address reached Enter'
    }
    'Address keyboard focus alone cannot authorize input without native foreground' = {
        $owned = New-ReaderMarker $f
        $f.Fake.FailReaderForeground = $true
        Assert-Throws { Invoke-ReaderFixture $f $owned } 'reader focus lost'
        Assert-True ($f.Fake.ReaderFocused -and -not $f.Fake.ReaderForeground) 'Fixture did not isolate foreground loss'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'reader-focus' -and $f.Fake.ReaderEnters -eq 0) 'Lost foreground reached address input'
    }
    'A preexisting reader raw ID or stale blank proof fails before native focus' = {
        $owned = New-ReaderMarker $f
        $owned.Record.preopenTargetIds = @($f.Target.RawTargetId, $owned.Reader.RawTargetId)
        [IO.File]::WriteAllText($owned.Path, ($owned.Record | ConvertTo-Json -Compress))
        Assert-Throws { Invoke-ReaderFixture $f $owned } 'not a new tab'
        $owned.Record.preopenTargetIds = @($f.Target.RawTargetId)
        $owned.Record.blankVerifiedAt -= 31
        $owned.Record.sendAttemptedAt -= 40
        [IO.File]::WriteAllText($owned.Path, ($owned.Record | ConvertTo-Json -Compress))
        Assert-Throws { Invoke-ReaderFixture $f $owned } 'proof is stale'
        Assert-True ($f.Fake.ReaderReads -eq 0 -and $f.Fake.Trace.Count -eq 0) 'Unproven ownership reached native focus'
    }
    'Unknown reader Enter is retained and never replayed' = {
        $owned = New-ReaderMarker $f
        $f.Fake.FailReaderEnter = $true
        Assert-Throws { Invoke-ReaderFixture $f $owned } 'unknown reader Enter'
        $after = Get-Content -LiteralPath $owned.Path -Raw | ConvertFrom-Json
        Assert-True ($after.status -ceq 'NAVIGATION_ATTEMPTING' -and $f.Fake.ReaderEnters -eq 1) 'Unknown Enter was marked complete or forgotten'
        Assert-Throws { Invoke-ReaderFixture $f $owned } 'already attempted'
        Assert-True ($f.Fake.ReaderEnters -eq 1) 'Unknown Enter was replayed'
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
