# Native input component. Importing the module performs no UI operation.
# The caller must first resolve the exact local binding and the OpenClaw
# profile's live PID, unique target tab and window. Navigation is limited to a
# durably owned blank reader. No account selection, page script or receipt.
Set-StrictMode -Version Latest

function Get-AiCoreTextHash {
    param([string]$Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-', '').ToLowerInvariant()
    } finally { $sha.Dispose() }
}

function ConvertTo-AiCoreLiteralKeys {
    param([string]$Message)
    # A bounded printable ASCII subset avoids unsupported keyboard layouts and
    # control characters. Readback remains authoritative; SendWait is not one.
    if ([string]::IsNullOrWhiteSpace($Message) -or $Message.Length -gt 4096 -or $Message -cmatch '[^\x20-\x7e]') {
        throw 'Native input requires a bounded printable single-line message'
    }
    $literal = [Text.StringBuilder]::new()
    foreach ($character in $Message.ToCharArray()) {
        # Microsoft SendKeys syntax: braces protect these literal characters,
        # including braces themselves ({{} and {}}) and square brackets.
        if ('+^%~(){}[]'.Contains([string]$character)) {
            [void]$literal.Append('{').Append($character).Append('}')
        } else { [void]$literal.Append($character) }
    }
    return $literal.ToString()
}

function Assert-AiCoreNativeTarget {
    param([hashtable]$Target)
    foreach ($field in @('AccountAlias', 'OwnerChannel', 'ConversationId', 'BrowserProfile', 'BindingFingerprint', 'EventId', 'WorkerId', 'ComposerName', 'PageUrl', 'RawTargetId', 'Challenge')) {
        if (-not $Target.ContainsKey($field) -or $Target[$field] -isnot [string]) { throw 'Native target context is incomplete' }
    }
    if ($Target.AccountAlias -cnotmatch '\AGPT[0-9]{2,4}\z' -or $Target.AccountAlias -ceq 'GPT01' -or
        $Target.OwnerChannel -cnotmatch '\Aai-engine-oauth:[a-f0-9]{64}\z' -or
        $Target.ConversationId -cnotmatch '\A[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\z' -or
        $Target.BrowserProfile -cnotmatch '\A[A-Za-z0-9][A-Za-z0-9_-]{0,63}\z' -or
        $Target.BindingFingerprint -cnotmatch '\A[a-f0-9]{64}\z' -or $Target.EventId -cnotmatch '\A[a-f0-9]{64}\z' -or
        $Target.Challenge -cnotmatch '\A[a-f0-9]{64}\z' -or $Target.RawTargetId -cnotmatch '\A[A-Fa-f0-9]{32}\z' -or
        $Target.PageUrl -cne ('https://chatgpt.com/c/' + $Target.ConversationId) -or
        $Target.WorkerId -cne 'openclaw-dell-chatgpt-wake-dev' -or
        $Target.ComposerName -cnotin @('Ask ChatGPT', 'Tanya ChatGPT')) { throw 'Native target context is invalid' }
    foreach ($field in @('WindowHandle', 'BrowserProcessId')) {
        if (-not $Target.ContainsKey($field) -or ($Target[$field] -isnot [int] -and $Target[$field] -isnot [long]) -or $Target[$field] -le 0) {
            throw 'Native window identity is invalid'
        }
    }
    $canonical = @('dev-chatgpt-wake-binding/v1', $Target.AccountAlias, $Target.OwnerChannel,
        $Target.ConversationId, $Target.WorkerId, $Target.BrowserProfile) -join '|'
    if ((Get-AiCoreTextHash $canonical) -cne $Target.BindingFingerprint) { throw 'Native binding fingerprint mismatch' }
}

function Assert-AiCoreNativeAddress {
    param([hashtable]$Target, $Address)
    # The independent OpenClaw tab URL must remain full HTTPS. Chrome's native
    # address provider has been observed returning exactly these two strings.
    $expected = 'https://chatgpt.com/c/' + $Target.ConversationId
    if ($Target.PageUrl -cne $expected -or $Address -isnot [string] -or
        ($Address -cne $expected -and $Address -cne ('chatgpt.com/c/' + $Target.ConversationId))) {
        throw 'Native browser destination changed'
    }
}

function Initialize-AiCoreNativeUia {
    if ($env:OS -ne 'Windows_NT') { throw 'Native composer requires Windows' }
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms -ErrorAction Stop
    if (-not ('AiCoreNativeComposerWindow' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class AiCoreNativeComposerWindow {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
}
'@ -ErrorAction Stop
    }
}

function Find-AiCoreNativeControl {
    param($Window, [string]$Name, $ControlType)
    $condition = [System.Windows.Automation.AndCondition]::new(
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $Name),
        [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, $ControlType))
    # A native exact role/name query scoped to this window; no full page dump.
    $matches = @($Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition) |
        Where-Object { $_.Current.IsEnabled -and -not $_.Current.IsOffscreen })
    if ($matches.Count -ne 1) { throw 'Native control is missing or ambiguous' }
    if ($matches[0].Current.IsPassword) { throw 'Native password control cannot be used' }
    return $matches[0]
}

function Get-AiCoreNativeValue {
    param($Element)
    $pattern = $null
    if (-not $Element.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern)) {
        throw 'Native ValuePattern is unavailable'
    }
    $value = $Element.GetCurrentPropertyValue([System.Windows.Automation.ValuePattern]::ValueProperty, $true)
    if ($value -isnot [string]) { throw 'Native value was not supplied by the provider' }
    return $value
}

function Get-AiCoreNativeState {
    param([hashtable]$Target, [bool]$RequireFocus = $false)
    Initialize-AiCoreNativeUia
    $handle = [IntPtr]$Target.WindowHandle
    [uint32]$actualProcess = 0
    [void][AiCoreNativeComposerWindow]::GetWindowThreadProcessId($handle, [ref]$actualProcess)
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    if ($null -eq $window -or $actualProcess -ne $Target.BrowserProcessId -or
        $window.Current.ProcessId -ne $Target.BrowserProcessId -or $window.Current.IsOffscreen -or -not $window.Current.IsEnabled) {
        throw 'Native browser window identity changed'
    }
    $address = Find-AiCoreNativeControl $window 'Address and search bar' ([System.Windows.Automation.ControlType]::Edit)
    Assert-AiCoreNativeAddress $Target (Get-AiCoreNativeValue $address)
    $composer = Find-AiCoreNativeControl $window $Target.ComposerName ([System.Windows.Automation.ControlType]::Edit)
    if ($RequireFocus -and ([AiCoreNativeComposerWindow]::GetForegroundWindow() -ne $handle -or -not $composer.Current.HasKeyboardFocus)) {
        throw 'Native composer lost foreground or keyboard focus'
    }
    return @{ Window = $window; Composer = $composer; Draft = (Get-AiCoreNativeValue $composer) }
}

function Resolve-AiCoreNativeWindow {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Target)
    # A temporary positive handle permits validation of the remaining supplied
    # context. Only the unique native result below is returned to the caller.
    $checked = $Target.Clone()
    $checked.WindowHandle = 1
    Assert-AiCoreNativeTarget $checked
    Initialize-AiCoreNativeUia
    $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$Target.BrowserProcessId)
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Children, $condition)
    $matched = [Collections.Generic.List[object]]::new()
    foreach ($window in $windows) {
        if ($window.Current.IsOffscreen -or -not $window.Current.IsEnabled -or $window.Current.NativeWindowHandle -le 0) { continue }
        try {
            $address = Find-AiCoreNativeControl $window 'Address and search bar' ([System.Windows.Automation.ControlType]::Edit)
            Assert-AiCoreNativeAddress $Target (Get-AiCoreNativeValue $address)
            $matched.Add($window)
        } catch {
            # A different visible window is not selected or brought forward.
            continue
        }
    }
    if ($matched.Count -ne 1) { throw 'Native target window is missing or ambiguous' }
    $resolved = $Target.Clone()
    $resolved.WindowHandle = [long]$matched[0].Current.NativeWindowHandle
    Assert-AiCoreNativeTarget $resolved
    $null = Get-AiCoreNativeState $resolved
    return $resolved
}

function Set-AiCoreNativeFocus { param($State) $State.Composer.SetFocus() }
function Send-AiCoreNativeKeys { param([string]$Keys) [System.Windows.Forms.SendKeys]::SendWait($Keys) }
function Get-AiCoreNativeSendControl {
    param($State)
    $button = Find-AiCoreNativeControl $State.Window 'Send' ([System.Windows.Automation.ControlType]::Button)
    $pattern = $null
    if (-not $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
        throw 'Native Send InvokePattern is unavailable'
    }
    return $pattern
}
function Invoke-AiCoreNativeSend { param($Pattern) $Pattern.Invoke() }

function Assert-AiCoreNativeReadback {
    param($State, [string]$Message, [bool]$AllowProviderLf)
    if ($State.Draft -isnot [string] -or
        ($State.Draft -cne $Message -and (-not $AllowProviderLf -or $State.Draft -cne ($Message + "`n")))) {
        throw 'Native draft does not exactly match the intended message; leave it for reconciliation'
    }
}

function Assert-AiCoreNativeInsertableDraft {
    param($State, [string]$ComposerName)
    if ($State.Draft -isnot [string] -or
        ($State.Draft -cne '' -and $State.Draft -cne ($ComposerName + "`n"))) {
        throw 'Native composer has a draft or unavailable value; preserving it'
    }
}

function Write-AiCoreNativeAttempt {
    param([System.IO.FileStream]$Stream, [hashtable]$Record, [string]$Status)
    $Record.status = $Status
    $bytes = [Text.Encoding]::UTF8.GetBytes(($Record | ConvertTo-Json -Compress))
    $Stream.Position = 0
    $Stream.SetLength(0)
    $Stream.Write($bytes, 0, $bytes.Length)
    $Stream.Flush($true)
}

function Invoke-AiCoreNativeComposerOnce {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][hashtable]$Target,
        [Parameter(Mandatory)][string]$Message,
        [Parameter(Mandatory)][string]$ReceiptDirectory,
        [switch]$AllowProviderLf
    )
    Assert-AiCoreNativeTarget $Target
    $literal = ConvertTo-AiCoreLiteralKeys $Message
    if (-not [IO.Directory]::Exists($ReceiptDirectory)) { throw 'Native receipt directory must already exist' }
    $path = Join-Path $ReceiptDirectory ($Target.BindingFingerprint + '-' + $Target.EventId + '.native-input.json')
    if ([IO.File]::Exists($path)) { throw 'Native input already attempted; reconciliation required' }
    $state = Get-AiCoreNativeState $Target
    # The actual Chrome provider can expose Name + LF for a placeholder. This
    # is UNKNOWN, not empty: only append, then require exact full readback. If
    # that string is real draft text, the later equality fails without erasing
    # or sending it. Other nonempty drafts are preserved before any input.
    Assert-AiCoreNativeInsertableDraft $state $Target.ComposerName
    $record = @{ version = 1; status = 'INPUT_ATTEMPTING'; eventId = $Target.EventId; bindingFingerprint = $Target.BindingFingerprint;
        browserProfile = $Target.BrowserProfile; conversationId = $Target.ConversationId;
        accountAlias = $Target.AccountAlias; ownerChannel = $Target.OwnerChannel; workerId = $Target.WorkerId;
        pageUrl = $Target.PageUrl; rawTargetId = $Target.RawTargetId; challenge = $Target.Challenge;
        messageHash = (Get-AiCoreTextHash $Message); allowProviderLf = [bool]$AllowProviderLf;
        inputStartedAt = ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0); sendAttemptedAt = $null }
    # Exclusive creation also blocks a second insertion after a timeout. Hold
    # this file open through Invoke; neither input nor uncertain Send is retried.
    $attempt = [IO.File]::Open($path, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        Write-AiCoreNativeAttempt $attempt $record 'INPUT_ATTEMPTING'
        Set-AiCoreNativeFocus $state
        $focused = Get-AiCoreNativeState $Target $true
        Assert-AiCoreNativeInsertableDraft $focused $Target.ComposerName
        Send-AiCoreNativeKeys '^{END}'
        $atEnd = Get-AiCoreNativeState $Target $true
        Assert-AiCoreNativeInsertableDraft $atEnd $Target.ComposerName
        Send-AiCoreNativeKeys $literal
        $readback = Get-AiCoreNativeState $Target $true
        Assert-AiCoreNativeReadback $readback $Message ([bool]$AllowProviderLf)
        $record.sendAttemptedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0
        Write-AiCoreNativeAttempt $attempt $record 'SEND_ATTEMPTING'
        $fresh = Get-AiCoreNativeState $Target $true
        Assert-AiCoreNativeReadback $fresh $Message ([bool]$AllowProviderLf)
        $send = Get-AiCoreNativeSendControl $fresh
        Invoke-AiCoreNativeSend $send
        Write-AiCoreNativeAttempt $attempt $record 'SEND_INVOKED'
        return @{ sendInvoked = $true; deliveryVerified = $false; verifiedAssistantReply = $false;
            bindingFingerprint = $Target.BindingFingerprint; eventId = $Target.EventId;
            inputStartedAt = $record.inputStartedAt; sendAttemptedAt = $record.sendAttemptedAt }
    } finally { $attempt.Dispose() }
}

function Invoke-AiCoreNativeRefreshOnce {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory)][hashtable]$Target,
        [Parameter(Mandatory)][string]$MessageHash,
        [Parameter(Mandatory)][string]$ReceiptDirectory
    )
    Assert-AiCoreNativeTarget $Target
    if ($MessageHash -cnotmatch '\A[a-f0-9]{64}\z') { throw 'Native refresh message context is invalid' }
    $path = Join-Path $ReceiptDirectory ($Target.BindingFingerprint + '-' + $Target.EventId + '.native-input.json')
    # Only the original attempt may be inspected. No marker creation, replay,
    # timestamp reset or second refresh after an uncertain outcome is allowed.
    $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        if ($stream.Length -gt 8192) { throw 'Native attempt record is invalid' }
        $bytes = [byte[]]::new([int]$stream.Length)
        if ($stream.Read($bytes, 0, $bytes.Length) -ne $bytes.Length) { throw 'Native attempt record is unavailable' }
        $stored = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json -ErrorAction Stop
        $record = @{}
        foreach ($property in $stored.PSObject.Properties) { $record[$property.Name] = $property.Value }
        $expected = @{ version = 1; eventId = $Target.EventId; challenge = $Target.Challenge;
            bindingFingerprint = $Target.BindingFingerprint; browserProfile = $Target.BrowserProfile;
            conversationId = $Target.ConversationId; pageUrl = $Target.PageUrl; rawTargetId = $Target.RawTargetId;
            accountAlias = $Target.AccountAlias; ownerChannel = $Target.OwnerChannel; workerId = $Target.WorkerId;
            messageHash = $MessageHash }
        foreach ($key in $expected.Keys) {
            if (-not $record.ContainsKey($key) -or $record[$key] -cne $expected[$key]) { throw 'Native attempt context mismatch' }
        }
        if ($record.status -cnotin @('SEND_ATTEMPTING', 'SEND_INVOKED') -or
            -not $record.ContainsKey('sendAttemptedAt') -or
            ($record.sendAttemptedAt -isnot [double] -and $record.sendAttemptedAt -isnot [decimal] -and
                $record.sendAttemptedAt -isnot [long] -and $record.sendAttemptedAt -isnot [int]) -or
            [double]::IsNaN([double]$record.sendAttemptedAt) -or [double]::IsInfinity([double]$record.sendAttemptedAt) -or
            $record.sendAttemptedAt -le 0 -or
            [double]$record.sendAttemptedAt -gt ([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0) -or
            $record.ContainsKey('refreshAttemptedAt')) {
            throw 'Native refresh already attempted or original Send time unavailable'
        }
        $state = Get-AiCoreNativeState $Target
        # Refresh can discard a draft. Unlike append-only input, UNKNOWN
        # placeholder-shaped text is insufficient: require an explicit empty
        # ValuePattern value both before and after focus.
        if ($state.Draft -isnot [string] -or $state.Draft -cne '') { throw 'Native refresh requires an explicitly empty draft' }
        Set-AiCoreNativeFocus $state
        $fresh = Get-AiCoreNativeState $Target $true
        if ($fresh.Draft -isnot [string] -or $fresh.Draft -cne '') { throw 'Native refresh requires an explicitly empty draft' }
        $record.refreshAttemptedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0
        Write-AiCoreNativeAttempt $stream $record 'REFRESH_ATTEMPTING'
        $immediate = Get-AiCoreNativeState $Target $true
        if ($immediate.Draft -isnot [string] -or $immediate.Draft -cne '') { throw 'Native refresh requires an explicitly empty draft' }
        Send-AiCoreNativeKeys '{F5}'
        Write-AiCoreNativeAttempt $stream $record 'REFRESH_INVOKED'
        return @{ refreshInvoked = $true; eventId = $Target.EventId; bindingFingerprint = $Target.BindingFingerprint }
    } finally { $stream.Dispose() }
}

function Assert-AiCoreNativeReader {
    param([hashtable]$Target, [hashtable]$Reader)
    Assert-AiCoreNativeTarget $Target
    if ($Reader.RawTargetId -isnot [string] -or $Reader.RawTargetId -cnotmatch '\A[A-Fa-f0-9]{32}\z' -or
        $Reader.RawTargetId -ieq $Target.RawTargetId -or
        ($Reader.WindowHandle -isnot [int] -and $Reader.WindowHandle -isnot [long]) -or $Reader.WindowHandle -le 0) {
        throw 'Owned reader identity is invalid'
    }
}

function Get-AiCoreNativeReaderState {
    param([hashtable]$Target, [hashtable]$Reader, [string]$ExpectedAddress, [bool]$RequireFocus = $false)
    Assert-AiCoreNativeReader $Target $Reader
    if ($ExpectedAddress -cnotin @('about:blank', $Target.PageUrl)) { throw 'Owned reader destination is invalid' }
    Initialize-AiCoreNativeUia
    $handle = [IntPtr]$Reader.WindowHandle
    [uint32]$actualProcess = 0
    [void][AiCoreNativeComposerWindow]::GetWindowThreadProcessId($handle, [ref]$actualProcess)
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    if ($null -eq $window -or $actualProcess -ne $Target.BrowserProcessId -or
        $window.Current.ProcessId -ne $Target.BrowserProcessId -or $window.Current.IsOffscreen -or
        -not $window.Current.IsEnabled -or $window.Current.Name -cne 'about:blank - Google Chrome' -or
        ($RequireFocus -and [AiCoreNativeComposerWindow]::GetForegroundWindow() -ne $handle)) {
        throw 'Owned reader window identity or foreground changed'
    }
    # Even after its omnibox contains the conversation URL, the active native
    # document must still be the observed blank window. Background UIA Document
    # elements are not reliable evidence of which browser tab is selected.
    # Read-only resolution can start behind a terminal. Address.SetFocus must
    # establish foreground and keyboard focus before SetValue or Enter.
    $address = Find-AiCoreNativeControl $window 'Address and search bar' ([System.Windows.Automation.ControlType]::Edit)
    if ((Get-AiCoreNativeValue $address) -cne $ExpectedAddress -or
        ($RequireFocus -and -not $address.Current.HasKeyboardFocus)) {
        throw 'Owned reader address or keyboard focus changed'
    }
    return @{ Window = $window; Address = $address }
}

function Resolve-AiCoreNativeReaderWindow {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Target, [Parameter(Mandatory)][hashtable]$Reader)
    $checked = $Reader.Clone()
    $checked.WindowHandle = 1
    Assert-AiCoreNativeReader $Target $checked
    Initialize-AiCoreNativeUia
    $condition = [System.Windows.Automation.PropertyCondition]::new(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$Target.BrowserProcessId)
    $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
        [System.Windows.Automation.TreeScope]::Children, $condition)
    $matched = [Collections.Generic.List[object]]::new()
    foreach ($window in $windows) {
        if ($window.Current.IsOffscreen -or -not $window.Current.IsEnabled -or $window.Current.NativeWindowHandle -le 0) { continue }
        try {
            $address = Find-AiCoreNativeControl $window 'Address and search bar' ([System.Windows.Automation.ControlType]::Edit)
            if ((Get-AiCoreNativeValue $address) -ceq 'about:blank') { $matched.Add($window) }
        } catch { continue }
    }
    if ($matched.Count -ne 1) { throw 'Owned blank native window is missing or ambiguous' }
    $resolved = $Reader.Clone()
    $resolved.WindowHandle = [long]$matched[0].Current.NativeWindowHandle
    $null = Get-AiCoreNativeReaderState $Target $resolved 'about:blank'
    return $resolved
}

function Set-AiCoreNativeReaderFocus { param($State) $State.Address.SetFocus() }
function Set-AiCoreNativeReaderAddress {
    param($State, [string]$Address)
    $pattern = $null
    if (-not $State.Address.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$pattern) -or
        $pattern.Current.IsReadOnly) { throw 'Owned blank address is not writable' }
    $pattern.SetValue($Address)
}

function Invoke-AiCoreNativeReaderNavigationOnce {
    [CmdletBinding()]
    param([Parameter(Mandatory)][hashtable]$Target, [Parameter(Mandatory)][hashtable]$Reader,
        [Parameter(Mandatory)][string]$MessageHash, [Parameter(Mandatory)][string]$ReceiptDirectory)
    Assert-AiCoreNativeReader $Target $Reader
    if ($MessageHash -cnotmatch '\A[a-f0-9]{64}\z') { throw 'Native message hash is invalid' }
    $path = Join-Path $ReceiptDirectory ($Target.BindingFingerprint + '-' + $Target.EventId + '.native-reader.json')
    # The caller has persisted a new raw ID and sole-blank inventory proof.
    # The exclusive record fences uncertain SetValue/Enter outcomes forever.
    $stream = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        if ($stream.Length -le 0 -or $stream.Length -gt 32768) { throw 'Owned reader record is invalid' }
        $bytes = [byte[]]::new([int]$stream.Length)
        if ($stream.Read($bytes, 0, $bytes.Length) -ne $bytes.Length) { throw 'Owned reader record could not be read' }
        $stored = [Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json -ErrorAction Stop
        $record = @{}
        foreach ($property in $stored.PSObject.Properties) { $record[$property.Name] = $property.Value }
        $expected = @{ version = 1; eventId = $Target.EventId; challenge = $Target.Challenge;
            bindingFingerprint = $Target.BindingFingerprint; browserProfile = $Target.BrowserProfile;
            conversationId = $Target.ConversationId; pageUrl = $Target.PageUrl; originalRawTargetId = $Target.RawTargetId;
            browserProcessId = $Target.BrowserProcessId; accountAlias = $Target.AccountAlias; ownerChannel = $Target.OwnerChannel;
            workerId = $Target.WorkerId; messageHash = $MessageHash; readerRawTargetId = $Reader.RawTargetId;
            readerWindowHandle = $Reader.WindowHandle }
        foreach ($key in $expected.Keys) {
            if (-not $record.ContainsKey($key) -or $record[$key] -cne $expected[$key]) { throw 'Owned reader context mismatch' }
        }
        if ($record.status -cne 'BLANK_VERIFIED' -or $record.ContainsKey('navigationAttemptedAt')) {
            throw 'Owned reader navigation was already attempted or not authorized'
        }
        if ($record.preopenTargetIds -isnot [array] -or $record.preopenTargetIds.Count -lt 1 -or
            $record.preopenTargetIds.Count -gt 128 -or $record.preopenTargetIds -contains $Reader.RawTargetId -or
            $record.preopenTargetIds -cnotcontains $Target.RawTargetId) { throw 'Owned reader was not a new tab' }
        $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() / 1000.0
        foreach ($field in @('blankVerifiedAt', 'sendAttemptedAt')) {
            if (-not $record.ContainsKey($field) -or
                ($record[$field] -isnot [double] -and $record[$field] -isnot [decimal] -and
                    $record[$field] -isnot [long] -and $record[$field] -isnot [int]) -or
                [double]::IsNaN([double]$record[$field]) -or [double]::IsInfinity([double]$record[$field]) -or
                $record[$field] -le 0 -or $record[$field] -gt $now) { throw 'Owned reader timestamp is unavailable' }
        }
        if ($now - $record.blankVerifiedAt -gt 30 -or $record.sendAttemptedAt -gt $record.blankVerifiedAt) {
            throw 'Owned blank inventory proof is stale'
        }
        $state = Get-AiCoreNativeReaderState $Target $Reader 'about:blank'
        Set-AiCoreNativeReaderFocus $state
        $null = Get-AiCoreNativeReaderState $Target $Reader 'about:blank' $true
        $record.navigationAttemptedAt = $now
        Write-AiCoreNativeAttempt $stream $record 'NAVIGATION_ATTEMPTING'
        $fresh = Get-AiCoreNativeReaderState $Target $Reader 'about:blank' $true
        Set-AiCoreNativeReaderAddress $fresh $Target.PageUrl
        $null = Get-AiCoreNativeReaderState $Target $Reader $Target.PageUrl $true
        Send-AiCoreNativeKeys '{ENTER}'
        Write-AiCoreNativeAttempt $stream $record 'NAVIGATION_INVOKED'
        return @{ navigationInvoked = $true; rawTargetId = $Reader.RawTargetId; pageUrl = $Target.PageUrl }
    } finally { $stream.Dispose() }
}

Export-ModuleMember -Function Invoke-AiCoreNativeComposerOnce, Resolve-AiCoreNativeWindow, Invoke-AiCoreNativeRefreshOnce, Resolve-AiCoreNativeReaderWindow, Invoke-AiCoreNativeReaderNavigationOnce
