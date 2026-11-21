#Requires -Version 5.1
# Portable Windows source QA: synthetic-only IPC and claim-shape negative tests.
# Runs on GitHub Windows hosted runner; no DELL account, service, key or login.
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'cst-onejob-dell-signer-ipc-boundary.psm1') -Force
$checks=New-Object 'System.Collections.Generic.List[string]'
function Record([string]$name){$script:checks.Add($name)}
function MustDeny([scriptblock]$action,[string]$reason,[string]$name){
  $blocked=$false
  try {$null=& $action} catch {$blocked=($_.Exception.Message -like ('*'+$reason+'*'))}
  if(-not $blocked){throw 'SOURCE_QA_NOT_DENIED'}
  Record $name
}
$me=[Security.Principal.WindowsIdentity]::GetCurrent()
if($env:OS -ne 'Windows_NT' -or -not $me.User){throw 'WINDOWS_HOST_REQUIRED'}
$acl=New-CstDevScopedPipeAcl -PinnedClientSid $me.User
$rules=@($acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
if($rules.Count -ne 1 -or $rules[0].IdentityReference.Value -ne $me.User.Value){
  throw 'EXCLUSIVE_CURRENT_USER_ACL_MISSING'
}
Record 'acl_exact_current_user'
$server=$null;$client=$null
try {
  $pipeName='cstdev-hosted-ci-'+[Guid]::NewGuid().ToString('N')
  $server=New-Object IO.Pipes.NamedPipeServerStream(
    $pipeName,[IO.Pipes.PipeDirection]::InOut,1,
    [IO.Pipes.PipeTransmissionMode]::Byte,
    [IO.Pipes.PipeOptions]::Asynchronous,1024,1024,$acl)
  $wait=$server.BeginWaitForConnection($null,$null)
  $client=New-Object IO.Pipes.NamedPipeClientStream(
    '.',$pipeName,[IO.Pipes.PipeDirection]::InOut,[IO.Pipes.PipeOptions]::None)
  $client.Connect(1800)
  $server.EndWaitForConnection($wait)
  $client.WriteByte(42);$client.Flush()
  if($server.ReadByte() -ne 42){throw 'EXPECTED_KERNEL_PAYLOAD_ABSENT'}
  if(-not(Assert-CstDevKernelPipePeer -Pipe $server -PinnedClientSid $me.User)){
    throw 'KERNEL_TOKEN_NOT_VERIFIED'
  }
  Record 'kernel_peer_current_user'
  $other=New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
  MustDeny {Assert-CstDevKernelPipePeer -Pipe $server -PinnedClientSid $other} 'CSTDEV_KERNEL_PEER_SID_DENIED' 'kernel_wrong_peer'
} finally {
  if($client){$client.Dispose()}
  if($server){$server.Dispose()}
}
foreach($sidText in @('S-1-1-0','S-1-5-11','S-1-5-32-545','S-1-5-18')){
  $sid=New-Object Security.Principal.SecurityIdentifier($sidText)
  MustDeny {New-CstDevScopedPipeAcl -PinnedClientSid $sid} 'CSTDEV_BROAD_PIPE_SID_DENIED' ('broad_acl_'+$sidText)
}
# The real signer identities may exist only on authorized DELL. Hosted CI
# must NOT create them or claim that it exercised their RunAs tokens.
if($env:COMPUTERNAME -ne 'DELL'){
  MustDeny {Assert-CstDevSignerRuntimeIdentity -Role coding} 'CSTDEV_WRONG_HOST' 'non_dell_runtime_denied'
}
$now=[DateTimeOffset]::UtcNow
$base=[pscustomobject][ordered]@{
  version=1;domain='cst-onejob-dell-signer-transport/v1';
  project='xssrfshdrtdfupgqwfdw';companyId='1';jobId=483;role='coding';
  sourceSha=('a'*40);
  approvalId='123e4567-e89b-12d3-a456-426614174000';
  eventId='123e4567-e89b-12d3-a456-426614174001';
  payloadSha256=('b'*64);nonce=('c'*32);
  issuedAt=$now.AddSeconds(-3).ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'");
  expiresAt=$now.AddSeconds(45).ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
}
$r=Assert-CstDevSignerEnvelopeShape -Envelope $base -Role coding -Now $now
if($r.status -ne 'STRUCTURE_ONLY_NOT_AUTHORIZED' -or
   $r.signatureIssued -ne $false -or $r.releaseDecision -ne 'NO_GO'){
  throw 'STRUCTURE_REVIEW_MISREPRESENTED_AS_SIGNING_AUTHORITY'
}
Record 'envelope_structure_only'
$bad=$base |ConvertTo-Json|ConvertFrom-Json
$bad.project='invalid-project'
MustDeny {Assert-CstDevSignerEnvelopeShape -Envelope $bad -Role coding -Now $now} 'CSTDEV_ENVELOPE_SCOPE_DENIED' 'project_mismatch'
$old=$base |ConvertTo-Json|ConvertFrom-Json
$old.expiresAt=$now.AddSeconds(-1).ToString("yyyy-MM-ddTHH:mm:ss.fff'Z'")
MustDeny {Assert-CstDevSignerEnvelopeShape -Envelope $old -Role coding -Now $now} 'CSTDEV_ENVELOPE_TIME_DENIED' 'expired'
$cache=New-Object 'System.Collections.Generic.HashSet[string]'
if(-not (Assert-CstDevNonceOnceInProcess -Nonce $base.nonce -SeenNonces $cache)){
  throw 'NONCE_FIRST_INSTANCE_REJECTED'
}
Record 'nonce_first_occurrence'
MustDeny {Assert-CstDevNonceOnceInProcess -Nonce $base.nonce -SeenNonces $cache} 'CSTDEV_REPLAY_OR_NONCE_DENIED' 'nonce_replay_denied'
[pscustomobject]@{
  status='PASS';scope='WINDOWS_HOSTED_SYNTHETIC_SOURCE_QA_ONLY';
  tests=$checks.ToArray();passCount=$checks.Count;
  realDellAccountsExercised=$false;privateKeyProvisioned=$false;
  signerServiceStarted=$false;signatureIssued=$false;
  liveE2eVerified=$false;releaseDecision='NO_GO'
}|ConvertTo-Json -Compress -Depth 4
