# Fixed native adapter entry point. JSON is data on stdin, never command text.
param([ValidateSet('resolve', 'submit', 'refresh')][string]$Action)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    $inputText = [Console]::In.ReadToEnd()
    if ($inputText.Length -gt 16384) { throw 'Native request exceeds limit' }
    $request = $inputText | ConvertFrom-Json -ErrorAction Stop
    $target = @{}
    foreach ($field in @('AccountAlias', 'OwnerChannel', 'ConversationId', 'BrowserProfile', 'BindingFingerprint',
            'EventId', 'WorkerId', 'ComposerName', 'PageUrl', 'RawTargetId', 'Challenge', 'BrowserProcessId', 'WindowHandle')) {
        $property = $request.target.PSObject.Properties[$field]
        if ($null -ne $property) { $target[$field] = $property.Value }
    }
    Import-Module (Join-Path $PSScriptRoot 'dev-chatgpt-native-composer.psm1') -Force -ErrorAction Stop
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
                -ReceiptDirectory $request.receiptDirectory -AllowProviderLf:$request.allowProviderLf
        }
        'refresh' {
            if ($request.messageHash -isnot [string] -or $request.receiptDirectory -isnot [string]) { throw 'Native request is invalid' }
            $result = Invoke-AiCoreNativeRefreshOnce -Target $target -MessageHash $request.messageHash `
                -ReceiptDirectory $request.receiptDirectory
        }
        default { throw 'Native action is invalid' }
    }
    @{ ok = $true; result = $result } | ConvertTo-Json -Depth 5 -Compress
} catch {
    # Never echo native provider values, request data or arbitrary stderr.
    @{ ok = $false; reason = 'native_guard_failed'; message = 'Native action failed; preserve the attempt for reconciliation' } | ConvertTo-Json -Compress
    exit 1
}
