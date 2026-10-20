# Synthetic behavioral tests. The real submit/focus/lease/draft/once-marker
# functions run against model native controls; no OS window, browser, key,
# account, clipboard or server is accessed. This is not an E2E attestation.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($PSVersionTable.PSEdition -cne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5 -or
    $PSVersionTable.PSVersion.Minor -ne 1) { throw 'Focus component gate requires Windows PowerShell 5.1 Desktop' }
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes -ErrorAction Stop
$modulePath = Join-Path $PSScriptRoot 'dev-chatgpt-native-composer.psm1'
$tokens = $null; $parseErrors = $null
$null = [Management.Automation.Language.Parser]::ParseFile($modulePath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count -ne 0) { throw 'Focus module failed PowerShell parse' }
$nativeModule = Import-Module $modulePath -Force -PassThru

& $nativeModule {
    function script:Initialize-AiCoreNativeUia { throw 'An actual OS boundary escaped the component model' }
    function script:Get-AiCoreNativeTickCount64 { return [long]$script:Fake.Tick }
    function script:Get-AiCoreNativeForegroundWindow { return [IntPtr]$script:Fake.ForegroundHandle }
    function script:Get-AiCoreNativeState {
        param([hashtable]$Target, [bool]$RequireFocus = $false)
        $f = $script:Fake
        $f.Reads++
        if ($f.Reads -eq $f.ExpireAtRead) { $f.Tick = 10000 }
        if ($f.Reads -eq $f.FailRead) { throw 'Synthetic native identity changed' }
        if ($f.Reads -eq $f.DraftAtRead) { $f.Draft = 'preserved other draft' }
        if ($f.Reads -eq $f.GenerationAtRead) { $f.Generating = $true }
        if ($f.Reads -eq $f.AddressAtRead) { $f.AddressValue = $Target.PageUrl + '?changed=1' }
        Assert-AiCoreNativeAddress $Target $f.AddressValue
        if ($RequireFocus -and ($f.ForegroundHandle -ne $Target.WindowHandle -or -not $f.Composer.Current.HasKeyboardFocus)) {
            throw 'Native composer lost foreground or keyboard focus'
        }
        $draft = $f.Draft
        if ($f.Reads -eq $f.DriftReadback) { $draft += ' extra' }
        $f.ReadDrafts.Add($draft)
        return @{ Window = $f.Window; Composer = $f.Composer; Draft = $draft }
    }
    function script:Find-AiCoreNativeControl {
        param($Window, [string]$Name, $ControlType)
        if (-not [object]::ReferenceEquals($Window, $script:Fake.Window) -or
            $Name -cne 'Address and search bar' -or $ControlType -ne [System.Windows.Automation.ControlType]::Edit) {
            throw 'Unexpected native control lookup in focus model'
        }
        if ($script:Fake.AddressUnavailable) { throw 'Native control is missing or ambiguous' }
        return $script:Fake.Address
    }
    function script:Get-AiCoreNativeValue {
        param($Element)
        if (-not [object]::ReferenceEquals($Element, $script:Fake.Address)) { throw 'Unexpected model value read' }
        return $script:Fake.AddressValue
    }
    function script:Set-AiCoreNativeComposerValue {
        param($State, [string]$Value)
        $script:Fake.Trace.Add('composer-set')
        $script:Fake.Draft = $Value
        if ($script:Fake.ExpireAfterTyping) { $script:Fake.Tick = 10000 }
    }
    function script:Send-AiCoreNativeKeys {
        param([string]$Keys)
        $script:Fake.Trace.Add('keys:' + $Keys)
        if ($Keys -cne '^{END}') {
            $script:Fake.Draft = $script:Fake.Message
            if ($script:Fake.ExpireAfterTyping) { $script:Fake.Tick = 10000 }
        }
    }
    function script:Get-AiCoreNativeSendControl { param($State) return $script:Fake.Send }
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

function New-FocusFixture {
    $target = @{ AccountAlias = 'GPT02'; OwnerChannel = ('ai-engine-oauth:' + ('d' * 64));
        ConversationId = '22222222-2222-4222-8222-222222222222'; WorkerId = 'openclaw-dell-chatgpt-wake-dev';
        BrowserProfile = 'travelincars-dev'; BindingFingerprint = '4da956549aa62bb6e42bdc4ab13390d2b137d29940e2bb6a89134dfc2f0dbec1';
        EventId = ('b' * 64); Challenge = ('c' * 64); ComposerName = 'Ask ChatGPT'; WindowHandle = 1234; BrowserProcessId = 5678;
        PageUrl = 'https://chatgpt.com/c/22222222-2222-4222-8222-222222222222'; RawTargetId = ('A' * 32) }
    $directory = Join-Path ([IO.Path]::GetTempPath()) ('ai-core-focus-model-' + [guid]::NewGuid().ToString('N'))
    [void][IO.Directory]::CreateDirectory($directory)
    $fake = @{ Reads = 0; Tick = 1000; ForegroundHandle = 9999; TargetHandle = 1234;
        Draft = "Ask ChatGPT`n"; Message = 'Synthetic focus [ACK]'; AddressValue = $target.PageUrl;
        ComposerCalls = 0; AddressCalls = 0; SendCalls = 0; KeepComposerUnfocused = $false;
        ThrowComposerCall = 0; RefocusFails = $false; AddressNoForeground = $false; AddressNoFocus = $false;
        ThrowAddress = $false; AddressUnavailable = $false; Generating = $false;
        ExpireAtRead = 0; ExpireAfterAddress = $false; ExpireAfterRefocus = $false; ExpireAfterTyping = $false;
        FailRead = 0; DraftAtRead = 0; GenerationAtRead = 0; AddressAtRead = 0; DriftReadback = 0;
        ThrowSend = $false; Trace = [Collections.Generic.List[string]]::new();
        ReadDrafts = [Collections.Generic.List[string]]::new() }
    $composer = [pscustomobject]@{ State = $fake; Current = [pscustomobject]@{ HasKeyboardFocus = $false; IsKeyboardFocusable = $true } }
    $composer | Add-Member -MemberType ScriptMethod -Name SetFocus -Value {
        $f = $this.State; $f.ComposerCalls++; $f.Trace.Add('composer-focus')
        if ($f.ComposerCalls -eq $f.ThrowComposerCall) { throw 'Synthetic composer focus exception' }
        $this.Current.HasKeyboardFocus = -not $f.KeepComposerUnfocused -and -not ($f.ComposerCalls -gt 1 -and $f.RefocusFails)
        $f.Address.Current.HasKeyboardFocus = $false
        if ($f.ComposerCalls -gt 1 -and $f.ExpireAfterRefocus) { $f.Tick = 10000 }
    }
    $address = [pscustomobject]@{ State = $fake; Current = [pscustomobject]@{ HasKeyboardFocus = $false; IsKeyboardFocusable = $true } }
    $address | Add-Member -MemberType ScriptMethod -Name SetFocus -Value {
        $f = $this.State; $f.AddressCalls++; $f.Trace.Add('address-focus')
        if ($f.ThrowAddress) { throw 'Synthetic address focus exception' }
        if (-not $f.AddressNoForeground) { $f.ForegroundHandle = $f.TargetHandle }
        $this.Current.HasKeyboardFocus = -not $f.AddressNoFocus
        $f.Composer.Current.HasKeyboardFocus = $false
        if ($f.ExpireAfterAddress) { $f.Tick = 10000 }
    }
    $window = [pscustomobject]@{ State = $fake }
    $window | Add-Member -MemberType ScriptMethod -Name FindAll -Value {
        param($Scope, $Condition)
        if ($Scope -ne [System.Windows.Automation.TreeScope]::Descendants -or
            $Condition -isnot [System.Windows.Automation.PropertyCondition] -or
            $Condition.Property.Id -ne ([System.Windows.Automation.AutomationElement]::ControlTypeProperty).Id -or
            $Condition.Value -isnot [int] -or
            $Condition.Value -ne ([System.Windows.Automation.ControlType]::Button).Id) { throw 'Unexpected native idle query' }
        if ($this.State.Generating) {
            return [pscustomobject]@{ Current = [pscustomobject]@{ IsEnabled = $true; IsOffscreen = $false; Name = 'Stop generating' } }
        }
        return @()
    }
    $send = [pscustomobject]@{ State = $fake }
    $send | Add-Member -MemberType ScriptMethod -Name Invoke -Value {
        $this.State.SendCalls++; $this.State.Trace.Add('send')
        if ($this.State.ThrowSend) { throw 'Synthetic unknown Send outcome' }
    }
    $fake.Composer = $composer; $fake.Address = $address; $fake.Window = $window; $fake.Send = $send
    & $nativeModule { param($State) $script:Fake = $State } $fake
    return @{ Target = $target; Fake = $fake; Directory = $directory;
        Marker = (Join-Path $directory ($target.BindingFingerprint + '-' + $target.EventId + '.native-input.json')) }
}

function Invoke-FocusFixture {
    param($Fixture, [long]$LeaseExpiresTickCount64 = 10000)
    Invoke-AiCoreNativeComposerOnce -Target $Fixture.Target -Message $Fixture.Fake.Message `
        -ReceiptDirectory $Fixture.Directory -LeaseExpiresTickCount64 $LeaseExpiresTickCount64
}
function Assert-NoKeysOrSend {
    param($Fixture)
    Assert-True (@($Fixture.Fake.Trace | Where-Object { $_.StartsWith('keys:') -or $_ -ceq 'composer-set' -or $_ -ceq 'send' }).Count -eq 0) 'Failure reached keys or Send'
}
function Assert-PreservedAttempt {
    param($Fixture)
    Assert-True ([IO.File]::Exists($Fixture.Marker)) 'Input attempt evidence was removed'
    $before = [IO.File]::ReadAllText($Fixture.Marker)
    $traceCount = $Fixture.Fake.Trace.Count
    # A fresh synthetic lease reaches the existing marker without resetting
    # the expired fake clock or altering the original attempt.
    Assert-Throws { Invoke-FocusFixture $Fixture -LeaseExpiresTickCount64 ([long]$Fixture.Fake.Tick + 1000) } 'already attempted'
    Assert-True ([IO.File]::ReadAllText($Fixture.Marker) -ceq $before -and $Fixture.Fake.Trace.Count -eq $traceCount) 'Attempt was rewritten or replayed'
}

$cases = [ordered]@{
    'Background composer recovers through one exact address focus, two readbacks and one Send' = {
        $result = Invoke-FocusFixture $f
        Assert-True ($f.Fake.ComposerCalls -eq 2 -and $f.Fake.AddressCalls -eq 1 -and $f.Fake.SendCalls -eq 1) 'Recovery repeated or skipped an action'
        Assert-True (($f.Fake.Trace -join '|') -ceq 'composer-focus|address-focus|composer-focus|composer-set|send') 'Focus did not precede literal input'
        Assert-True ($f.Fake.Reads -eq 8 -and @($f.Fake.ReadDrafts | Where-Object { $_ -ceq $f.Fake.Message }).Count -eq 2) 'Two complete readbacks did not survive recovery'
        Assert-True ($result.sendInvoked -and -not $result.deliveryVerified -and -not $result.verifiedAssistantReply) 'Synthetic Send became delivery proof'
        Assert-PreservedAttempt $f
    }
    'Already-foreground path retains the original one focus and five reads' = {
        $f.Fake.ForegroundHandle = $f.Target.WindowHandle
        $null = Invoke-FocusFixture $f
        Assert-True ($f.Fake.ComposerCalls -eq 1 -and $f.Fake.AddressCalls -eq 0 -and $f.Fake.Reads -eq 5 -and $f.Fake.SendCalls -eq 1) 'Normal path unnecessarily activated the address'
    }
    'The original one-argument private owner primitive still needs no worker context' = {
        & $nativeModule { param($State) Set-AiCoreNativeFocus $State } @{ Composer = $f.Fake.Composer }
        Assert-True ($f.Fake.ComposerCalls -eq 1 -and $f.Fake.Reads -eq 0 -and $f.Fake.AddressCalls -eq 0) 'Owner private-call compatibility changed'
        Assert-True (-not [IO.File]::Exists($f.Marker)) 'Owner focus fabricated a worker input receipt'
    }
    'An initial composer-focus exception does not activate the address' = {
        $f.Fake.ThrowComposerCall = 1
        Assert-Throws { Invoke-FocusFixture $f } 'composer focus exception'
        Assert-True ($f.Fake.AddressCalls -eq 0) 'An arbitrary focus exception entered recovery'
        Assert-NoKeysOrSend $f; Assert-PreservedAttempt $f
    }
    'A missing composer keyboard focus is not the observed recovery state' = {
        $f.Fake.KeepComposerUnfocused = $true
        Assert-Throws { Invoke-FocusFixture $f } 'observed background composer state'
        Assert-True ($f.Fake.AddressCalls -eq 0) 'Missing keyboard focus entered address recovery'
        Assert-NoKeysOrSend $f; Assert-PreservedAttempt $f
    }
    'Fresh address drift fails before address activation' = {
        $f.Fake.AddressAtRead = 3
        Assert-Throws { Invoke-FocusFixture $f } 'destination changed'
        Assert-True ($f.Fake.AddressCalls -eq 0) 'A changed address was focused'
        Assert-NoKeysOrSend $f; Assert-PreservedAttempt $f
    }
    'Fresh native generation blocks recovery' = {
        $f.Fake.GenerationAtRead = 3
        Assert-Throws { Invoke-FocusFixture $f } 'generation is active'
        Assert-True ($f.Fake.AddressCalls -eq 0) 'Active generation reached address focus'
        Assert-NoKeysOrSend $f; Assert-PreservedAttempt $f
    }
    'Fresh draft drift is preserved before address activation' = {
        $f.Fake.DraftAtRead = 3
        Assert-Throws { Invoke-FocusFixture $f } 'preserving it'
        Assert-True ($f.Fake.AddressCalls -eq 0 -and $f.Fake.Draft -ceq 'preserved other draft') 'A nonempty draft was modified'
        Assert-NoKeysOrSend $f; Assert-PreservedAttempt $f
    }
    'Lease expiry before address activation allows no second focus action' = {
        $f.Fake.ExpireAtRead = 3
        Assert-Throws { Invoke-FocusFixture $f } 'lease is expired or invalid'
        Assert-True ($f.Fake.ComposerCalls -eq 1 -and $f.Fake.AddressCalls -eq 0) 'Expired lease activated the address'
        Assert-NoKeysOrSend $f; Assert-PreservedAttempt $f
    }
    'Address focus must establish the real foreground window' = {
        $f.Fake.AddressNoForeground = $true
        Assert-Throws { Invoke-FocusFixture $f } 'did not establish foreground and keyboard focus'
        Assert-True ($f.Fake.ComposerCalls -eq 1 -and $f.Fake.AddressCalls -eq 1) 'Foreground failure reached composer refocus'
        Assert-NoKeysOrSend $f; Assert-PreservedAttempt $f
    }
    'Address focus must also establish address keyboard focus' = {
        $f.Fake.AddressNoFocus = $true
        Assert-Throws { Invoke-FocusFixture $f } 'did not establish foreground and keyboard focus'
        Assert-True ($f.Fake.ComposerCalls -eq 1 -and $f.Fake.AddressCalls -eq 1) 'Address focus failure reached composer refocus'
        Assert-NoKeysOrSend $f; Assert-PreservedAttempt $f
    }
    'Lease expiry after address focus blocks composer refocus' = {
        $f.Fake.ExpireAfterAddress = $true
        Assert-Throws { Invoke-FocusFixture $f } 'lease is expired or invalid'
        Assert-True ($f.Fake.ComposerCalls -eq 1 -and $f.Fake.AddressCalls -eq 1) 'Expired lease reached composer refocus'
        Assert-NoKeysOrSend $f; Assert-PreservedAttempt $f
    }
    'Final strict composer focus failure blocks every key' = {
        $f.Fake.RefocusFails = $true
        Assert-Throws { Invoke-FocusFixture $f } 'lost foreground or keyboard focus'
        Assert-True ($f.Fake.ComposerCalls -eq 2 -and $f.Fake.AddressCalls -eq 1) 'Recovery was repeated'
        Assert-NoKeysOrSend $f; Assert-PreservedAttempt $f
    }
    'Lease expiry after successful refocus still blocks CtrlEnd' = {
        $f.Fake.ExpireAfterRefocus = $true
        Assert-Throws { Invoke-FocusFixture $f } 'lease is expired or invalid'
        Assert-NoKeysOrSend $f; Assert-PreservedAttempt $f
    }
    'Second complete readback drift after focus recovery prevents Send' = {
        $f.Fake.DriftReadback = 8
        Assert-Throws { Invoke-FocusFixture $f } 'exactly match'
        Assert-True ($f.Fake.SendCalls -eq 0 -and $f.Fake.Draft -ceq $f.Fake.Message) 'Readback mismatch was sent or erased'
        Assert-PreservedAttempt $f
    }
    'Unknown Send after recovery is retained and cannot be replayed' = {
        $f.Fake.ThrowSend = $true
        Assert-Throws { Invoke-FocusFixture $f } 'unknown Send outcome'
        Assert-PreservedAttempt $f
        $record = [IO.File]::ReadAllText($f.Marker) | ConvertFrom-Json
        Assert-True ($f.Fake.SendCalls -eq 1 -and $record.status -ceq 'SEND_ATTEMPTING') 'Uncertain Send was retried or declared delivered'
    }
}

$passed = 0
foreach ($entry in $cases.GetEnumerator()) {
    $f = New-FocusFixture
    try { & $entry.Value; $passed++; Write-Output ('PASS: ' + $entry.Key) }
    finally { Remove-Item -LiteralPath $f.Directory -Recurse -Force }
}
Write-Output ('Native focus activation component tests passed: ' + $passed + ' (synthetic, no OS input or E2E claim)')
