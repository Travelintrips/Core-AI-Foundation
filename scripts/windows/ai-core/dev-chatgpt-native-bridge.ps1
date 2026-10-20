# Fixed native adapter entry point. JSON is data on stdin, never command text.
param([ValidateSet('resolve', 'submit', 'refresh', 'reader-resolve', 'reader-navigate')][string]$Action)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    $inputText = [Console]::In.ReadToEnd()
    if ($inputText.Length -gt 16384) { throw 'Native request exceeds limit' }
    $request = $inputText | ConvertFrom-Json -ErrorAction Stop
    $leaseProperty = $request.PSObject.Properties['leaseExpiresTickCount64']
    if ($null -eq $leaseProperty -or
        ($leaseProperty.Value -isnot [int] -and $leaseProperty.Value -isnot [long]) -or
        $leaseProperty.Value -le 0) { throw 'Native worker lease deadline is required' }
    $leaseExpires = [long]$leaseProperty.Value
    $target = @{}
    foreach ($field in @('AccountAlias', 'OwnerChannel', 'ConversationId', 'BrowserProfile', 'BindingFingerprint',
            'EventId', 'WorkerId', 'ComposerName', 'PageUrl', 'RawTargetId', 'Challenge', 'BrowserProcessId', 'WindowHandle')) {
        $property = $request.target.PSObject.Properties[$field]
        if ($null -ne $property) { $target[$field] = $property.Value }
    }
    Import-Module (Join-Path $PSScriptRoot 'dev-chatgpt-native-composer.psm1') -Force -ErrorAction Stop
    if ($Action -cin @('reader-resolve', 'reader-navigate')) {
        $reader = @{}
        foreach ($field in @('RawTargetId', 'WindowHandle')) {
            $property = $request.reader.PSObject.Properties[$field]
            if ($null -ne $property) { $reader[$field] = $property.Value }
        }
    }
    switch ($Action) {
        'resolve' {
            $resolved = Resolve-AiCoreNativeWindow -Target $target
            $result = @{ windowHandle = $resolved.WindowHandle; browserProcessId = $resolved.BrowserProcessId;
                pageUrl = $resolved.PageUrl; rawTargetId = $resolved.RawTargetId }
        }
        'submit' {
            if ($request.message -isnot [string] -or $request.receiptDirectory -isnot [string] -or
                $request.allowProviderLf -isnot [bool]) { throw 'Native request is invalid' }
            $result = Invoke-AiCoreNativeComposerOnce -Target $target -Message $request.message `
                -ReceiptDirectory $request.receiptDirectory -AllowProviderLf:$request.allowProviderLf `
                -LeaseExpiresTickCount64 $leaseExpires
        }
        'refresh' {
            if ($request.messageHash -isnot [string] -or $request.receiptDirectory -isnot [string]) { throw 'Native request is invalid' }
            $result = Invoke-AiCoreNativeRefreshOnce -Target $target -MessageHash $request.messageHash `
                -ReceiptDirectory $request.receiptDirectory -LeaseExpiresTickCount64 $leaseExpires
        }
        'reader-resolve' {
            $resolved = Resolve-AiCoreNativeReaderWindow -Target $target -Reader $reader
            $result = @{ windowHandle = $resolved.WindowHandle; browserProcessId = $target.BrowserProcessId;
                rawTargetId = $resolved.RawTargetId; address = 'about:blank' }
        }
        'reader-navigate' {
            if ($request.messageHash -isnot [string] -or $request.receiptDirectory -isnot [string]) { throw 'Native request is invalid' }
            $result = Invoke-AiCoreNativeReaderNavigationOnce -Target $target -Reader $reader -MessageHash $request.messageHash `
                -ReceiptDirectory $request.receiptDirectory -LeaseExpiresTickCount64 $leaseExpires
        }
        default { throw 'Native action is invalid' }
    }
    @{ ok = $true; result = $result } | ConvertTo-Json -Depth 5 -Compress
} catch {
    # Never echo native provider values, request data or arbitrary stderr.
    @{ ok = $false; reason = 'native_guard_failed'; message = 'Native action failed; preserve the attempt for reconciliation' } | ConvertTo-Json -Compress
    exit 1
}
