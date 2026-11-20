#Requires -Version 5.1
# CST-DEV DELL signer: reusable Windows kernel-identity transport boundary.
# SOURCE ONLY. No service, key, signature, credential, account activation or job.
Set-StrictMode -Version Latest
$script:Project = 'xssrfshdrtdfupgqwfdw'
$script:Accounts = @{
  coding='cstdev_sign_coding'
  infrastructure='cstdev_sign_infra'
  security='cstdev_sign_security'
  qa='cstdev_sign_qa'
  reviewer='cstdev_sign_reviewer'
}
function Get-CstDevSignerAccountInfo {
  [CmdletBinding()]
  param([ValidateSet('coding','infrastructure','security','qa','reviewer')][string]$Role)
  if ($env:COMPUTERNAME -ne 'DELL' -or $env:OS -ne 'Windows_NT') {
    throw 'CSTDEV_WRONG_HOST'
  }
  $name = $script:Accounts[$Role]
  $account = Get-LocalUser -Name $name -ErrorAction Stop
  if ($null -eq $account.SID -or
      $account.Description -cne ('CSTDEV_DORMANT_SIGNER_' + $Role)) {
    throw 'CSTDEV_SIGNER_PROVENANCE_INVALID'
  }
  $admin = New-Object Security.Principal.SecurityIdentifier('S-1-5-32-544')
  $members = @(Get-LocalGroupMember -SID $admin -ErrorAction Stop |
    ForEach-Object { $_.SID.Value })
  [pscustomobject]@{
    role=$Role; account=$name; sid=$account.SID
    disabled=(-not $account.Enabled)
    nonAdmin=(-not ($members -contains $account.SID.Value))
  }
}
function Assert-CstDevSignerRuntimeIdentity {
  [CmdletBinding()]
  param([ValidateSet('coding','infrastructure','security','qa','reviewer')][string]$Role)
  $account = Get-CstDevSignerAccountInfo -Role $Role
  if ($account.disabled) { throw 'CSTDEV_SIGNER_ACCOUNT_DISABLED' }
  if (-not $account.nonAdmin) { throw 'CSTDEV_SIGNER_IS_ADMIN' }
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'CSTDEV_ADMIN_RUNTIME_FORBIDDEN'
  }
  if ($identity.User.Value -cne $account.sid.Value) {
    throw 'CSTDEV_SIGNER_WINDOWS_TOKEN_MISMATCH'
  }
  [pscustomobject]@{
    role=$Role; runtimeIdentityVerified=$true
    signatureIssued=$false; independentCustodyVerified=$false
    releaseDecision='NO_GO'
  }
}
function New-CstDevScopedPipeAcl {
  [CmdletBinding()]
  param([Parameter(Mandatory)][Security.Principal.SecurityIdentifier]$PinnedClientSid)
  # The SID must come from an independently authorized, protected configuration,
  # NEVER from a wire request. Do not allow wildcard or system identities.
  $generic = @('S-1-1-0','S-1-5-11','S-1-5-32-545','S-1-5-18')
  if ($generic -contains $PinnedClientSid.Value) {
    throw 'CSTDEV_BROAD_PIPE_SID_DENIED'
  }
  $acl = New-Object System.IO.Pipes.PipeSecurity
  $acl.SetAccessRuleProtection($true,$false)
  $rule = New-Object System.IO.Pipes.PipeAccessRule(
    $PinnedClientSid,[System.IO.Pipes.PipeAccessRights]::ReadWrite,
    [Security.AccessControl.AccessControlType]::Allow)
  $acl.AddAccessRule($rule)
  $rules = @($acl.GetAccessRules($true,$true,
    [Security.Principal.SecurityIdentifier]))
  if ($rules.Count -ne 1 -or
      $rules[0].IdentityReference.Value -cne $PinnedClientSid.Value -or
      $rules[0].AccessControlType -ne
        [Security.AccessControl.AccessControlType]::Allow) {
    throw 'CSTDEV_PIPE_ACL_NOT_EXCLUSIVE'
  }
  return $acl
}
function Assert-CstDevKernelPipePeer {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][System.IO.Pipes.NamedPipeServerStream]$Pipe,
    [Parameter(Mandatory)][Security.Principal.SecurityIdentifier]$PinnedClientSid
  )
  if (-not $Pipe.IsConnected) { throw 'CSTDEV_PIPE_NOT_CONNECTED' }
  $script:observedCstPipeSid = $null
  $callback = [System.IO.Pipes.PipeStreamImpersonationWorker]{
    $script:observedCstPipeSid =
      [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  }
  $Pipe.RunAsClient($callback)
  if ($script:observedCstPipeSid -cne $PinnedClientSid.Value) {
    throw 'CSTDEV_KERNEL_PEER_SID_DENIED'
  }
  return $true
}
function Assert-CstDevSignerEnvelopeShape {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][pscustomobject]$Envelope,
    [ValidateSet('coding','infrastructure','security','qa','reviewer')][string]$Role,
    [DateTimeOffset]$Now = [DateTimeOffset]::UtcNow
  )
  $fields = @('version','domain','project','companyId','jobId','role',
    'sourceSha','approvalId','eventId','payloadSha256','nonce','issuedAt','expiresAt')
  $present = @($Envelope.PSObject.Properties | ForEach-Object { $_.Name })
  if ($present.Count -ne $fields.Count -or
      @($present | Where-Object { $fields -cnotcontains $_ }).Count -ne 0) {
    throw 'CSTDEV_UNEXPECTED_ENVELOPE_FIELDS'
  }
  $uuid = '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$'
  if ($Envelope.version -isnot [int] -or $Envelope.version -ne 1 -or
      $Envelope.domain -cne 'cst-onejob-dell-signer-transport/v1' -or
      $Envelope.project -cne $script:Project -or
      $Envelope.companyId -cne '1' -or
      $Envelope.jobId -isnot [int] -or $Envelope.jobId -le 482 -or
      $Envelope.role -cne $Role -or
      $Envelope.sourceSha -cnotmatch '^[a-f0-9]{40}$' -or
      $Envelope.approvalId -cnotmatch $uuid -or
      $Envelope.eventId -cnotmatch $uuid -or
      $Envelope.payloadSha256 -cnotmatch '^[a-f0-9]{64}$' -or
      $Envelope.nonce -cnotmatch '^[a-f0-9]{32}$') {
    throw 'CSTDEV_ENVELOPE_SCOPE_DENIED'
  }
  $format = "yyyy-MM-ddTHH:mm:ss.fff'Z'"
  $start = [DateTimeOffset]::MinValue
  $end = [DateTimeOffset]::MinValue
  $style = [Globalization.DateTimeStyles]::AssumeUniversal
  $culture = [Globalization.CultureInfo]::InvariantCulture
  if (-not [DateTimeOffset]::TryParseExact($Envelope.issuedAt,$format,
      $culture,$style,[ref]$start) -or
      -not [DateTimeOffset]::TryParseExact($Envelope.expiresAt,$format,
      $culture,$style,[ref]$end) -or
      $start -gt $Now -or $end -le $Now -or
      $start -lt $Now.AddMinutes(-5) -or
      $end -gt $Now.AddMinutes(5) -or
      ($end-$start).TotalSeconds -gt 300) {
    throw 'CSTDEV_ENVELOPE_TIME_DENIED'
  }
  # A well-formed envelope is NOT a signed Owner approval, release or permit.
  [pscustomobject]@{
    status='STRUCTURE_ONLY_NOT_AUTHORIZED'
    project=$script:Project; role=$Role
    independentReleaseVerified=$false; signatureIssued=$false
    releaseDecision='NO_GO'
  }
}
function Assert-CstDevNonceOnceInProcess {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory)][string]$Nonce,
    [Parameter(Mandatory)][AllowEmptyCollection()][Collections.Generic.HashSet[string]]$SeenNonces
  )
  # This is only a supplementary per-process check. Replays across restarts
  # must be denied by the existing durable PostgreSQL receipt/nonce ledger.
  if ($Nonce -cnotmatch '^[a-f0-9]{32}$' -or
      -not $SeenNonces.Add($Nonce)) {
    throw 'CSTDEV_REPLAY_OR_NONCE_DENIED'
  }
  return $true
}
Export-ModuleMember -Function Get-CstDevSignerAccountInfo,
  Assert-CstDevSignerRuntimeIdentity,New-CstDevScopedPipeAcl,
  Assert-CstDevKernelPipePeer,Assert-CstDevSignerEnvelopeShape,
  Assert-CstDevNonceOnceInProcess
