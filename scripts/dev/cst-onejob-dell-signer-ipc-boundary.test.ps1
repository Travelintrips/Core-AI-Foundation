#Requires -Version 5.1
# Real DELL kernel SID and negative-only signer-boundary QA.
# Never log in as disabled signers, create keys, activate service or sign.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'cst-onejob-dell-signer-ipc-boundary.psm1') -Force
$checks = New-Object 'System.Collections.Generic.List[string]'
function Pass([string]$Name) { $script:checks.Add($Name) }
function ExpectDenied([scriptblock]$Action,[string]$Expected,[string]$Label) {
  $denied=$false
  try { $null=& $Action }
  catch { $denied=($_.Exception.Message -like ('*'+$Expected+'*')) }
  if (-not $denied) { throw ('NEGATIVE_TEST_FAILED: '+$Label) }
  Pass $Label
}
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
if ($env:COMPUTERNAME -ne 'DELL' -or $null -eq $identity.User) {
  throw 'WRONG_QA_HOST'
}
$roles=@('coding','infrastructure','security','qa','reviewer')
$sids=New-Object 'System.Collections.Generic.List[string]'
foreach ($role in $roles) {
  $info=Get-CstDevSignerAccountInfo -Role $role
  if (-not $info.disabled -or -not $info.nonAdmin -or
      $identity.User.Value -eq $info.sid.Value) {
    throw ('DORMANT_SIGNER_BASELINE_INVALID: '+$role)
  }
  $sids.Add($info.sid.Value)
  ExpectDenied { Assert-CstDevSignerRuntimeIdentity -Role $role } 'CSTDEV_SIGNER_ACCOUNT_DISABLED' ('disabled_runtime_denied_'+$role)
  $acl=New-CstDevScopedPipeAcl -PinnedClientSid $info.sid
  $server=$null;$client=$null;$denied=$false
  try {
    $name='cstdev-qa-role-deny-'+[Guid]::NewGuid().ToString('N')
    $server=New-Object IO.Pipes.NamedPipeServerStream(
      $name,[IO.Pipes.PipeDirection]::InOut,1,
      [IO.Pipes.PipeTransmissionMode]::Byte,
      [IO.Pipes.PipeOptions]::Asynchronous,1024,1024,$acl)
    $client=New-Object IO.Pipes.NamedPipeClientStream(
      '.',$name,[IO.Pipes.PipeDirection]::InOut,
      [IO.Pipes.PipeOptions]::None)
    try { $client.Connect(1500) }
    catch [UnauthorizedAccessException] { $denied=$true }
    catch [IO.IOException] { $denied=(($_.Exception.HResult -band 0xffff) -eq 5) }
    $denied=($denied -and -not $client.IsConnected)
  } finally {
    if($client){$client.Dispose()}
    if($server){$server.Dispose()}
  }
  if (-not $denied) { throw ('WRONG_SID_NOT_DENIED_BY_KERNEL: '+$role) }
  Pass ('kernel_wrong_caller_denied_'+$role)
}
if (@($sids|Select-Object -Unique).Count -ne 5) {throw 'DUPLICATE_SIGNER_SID'}
Pass 'five_unique_sids'

# Positive transport canary: the CURRENT interactive SID, not a signer account.
$goodAcl=New-CstDevScopedPipeAcl -PinnedClientSid $identity.User
$server=$null;$client=$null
try {
  $name='cstdev-qa-current-user-'+[Guid]::NewGuid().ToString('N')
  $server=New-Object IO.Pipes.NamedPipeServerStream(
    $name,[IO.Pipes.PipeDirection]::InOut,1,
    [IO.Pipes.PipeTransmissionMode]::Byte,
    [IO.Pipes.PipeOptions]::Asynchronous,1024,1024,$goodAcl)
  $pending=$server.BeginWaitForConnection($null,$null)
  $client=New-Object IO.Pipes.NamedPipeClientStream(
    '.',$name,[IO.Pipes.PipeDirection]::InOut,[IO.Pipes.PipeOptions]::None)
  $client.Connect(1500)
  $server.EndWaitForConnection($pending)
  $client.WriteByte(42)
  $client.Flush()
  if($server.ReadByte() -ne 42) {throw 'KERNEL_PIPE_PAYLOAD_MISSING'}
  if(-not (Assert-CstDevKernelPipePeer -Pipe $server -PinnedClientSid $identity.User)){
    throw 'KERNEL_SID_READBACK_FAILED'
  }
  Pass 'kernel_current_token_verified'
  ExpectDenied {
    Assert-CstDevKernelPipePeer -Pipe $server -PinnedClientSid (
      (Get-CstDevSignerAccountInfo -Role coding).sid)
  } 'CSTDEV_KERNEL_PEER_SID_DENIED' 'kernel_claimed_signer_sid_denied'
} finally {
  if($client){$client.Dispose()}
  if($server){$server.Dispose()}
}
foreach($broad in @('S-1-1-0','S-1-5-11','S-1-5-32-545','S-1-5-18')) {
  $sid=New-Object Security.Principal.SecurityIdentifier($broad)
  ExpectDenied {New-CstDevScopedPipeAcl -PinnedClientSid $sid} 'CSTDEV_BROAD_PIPE_SID_DENIED' ('broad_sid_denied_'+$broad)
}
$now=[DateTimeOffset]::UtcNow
$base=[pscustomobject][ordered]@{
  version=1;domain='cst-onejob-dell-signer-transport/v1'
  project='xssrfshdrtdfupgqwfdw';companyId='1';jobId=483;role='coding'
  sourceSha=('a'*40)
  approvalId='123e4567-e89b-12d3-a456-426614174000'
  eventId='123e4567-e89b-12d3-a456-426614174001'
  payloadSha256=('b'*64);nonce=('c'*32)
  issuedAt=$now.AddSeconds(-5).ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
  expiresAt=$now.AddSeconds(45).ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
}
$valid=Assert-CstDevSignerEnvelopeShape -Envelope $base -Role coding -Now $now
if ($valid.status -ne 'STRUCTURE_ONLY_NOT_AUTHORIZED' -or
    $valid.signatureIssued -ne $false -or $valid.releaseDecision -ne 'NO_GO') {
  throw 'SHAPE_REVIEW_WAS_MISREPRESENTED_AS_AUTHORIZED'
}
Pass 'envelope_is_structure_only'
$negative=@(
  @{field='project';value='nzdweipzckfszczzqtuw';error='SCOPE'},
  @{field='role';value='qa';error='SCOPE'},
  @{field='jobId';value=482;error='SCOPE'},
  @{field='sourceSha';value=('f'*39);error='SCOPE'},
  @{field='payloadSha256';value='bad';error='SCOPE'},
  @{field='companyId';value='3';error='SCOPE'},
  @{field='issuedAt';value=$now.AddMinutes(-10).ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'");error='TIME'},
  @{field='expiresAt';value=$now.AddMinutes(10).ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'");error='TIME'}
)
foreach($test in $negative) {
  $copy=($base|ConvertTo-Json -Compress|ConvertFrom-Json)
  $copy.($test.field)=$test.value
  ExpectDenied {Assert-CstDevSignerEnvelopeShape -Envelope $copy -Role coding -Now $now} ('CSTDEV_ENVELOPE_'+$test.error+'_DENIED') ('envelope_denied_'+$test.field)
}
$extra=($base|ConvertTo-Json -Compress|ConvertFrom-Json)
$extra|Add-Member -NotePropertyName 'force' -NotePropertyValue $true
ExpectDenied {Assert-CstDevSignerEnvelopeShape -Envelope $extra -Role coding -Now $now} 'CSTDEV_UNEXPECTED_ENVELOPE_FIELDS' 'extra_fields_denied'
$nonces=New-Object 'System.Collections.Generic.HashSet[string]'
if (-not (Assert-CstDevNonceOnceInProcess -Nonce $base.nonce -SeenNonces $nonces)) {
  throw 'FIRST_NONCE_REJECTED'
}
Pass 'first_nonce_accepted_structure_only'
ExpectDenied {Assert-CstDevNonceOnceInProcess -Nonce $base.nonce -SeenNonces $nonces} 'CSTDEV_REPLAY_OR_NONCE_DENIED' 'repeat_nonce_denied_in_process'
$report=[pscustomobject]@{
  project='xssrfshdrtdfupgqwfdw'
  host='DELL'
  status='PASS'
  checks=$checks.ToArray()
  count=$checks.Count
  fiveSignerAccountsRemainDisabled=$true
  independentPrivateKeyCustodyVerified=$false
  actualSignerRuntimeRunAsVerified=$false
  signedOwnerReleaseVerified=$false
  signerServiceCreated=$false
  credentialsCreated=$false
  signatureIssued=$false
  e2eVerified=$false
  releaseDecision='NO_GO'
}
$report|ConvertTo-Json -Compress -Depth 4
