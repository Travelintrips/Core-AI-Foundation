#Requires -Version 5.1
<#
CST-DEV DELL-only Windows named-pipe identity boundary preflight.
Read-only w.r.t. machine configuration and database. Creates only ephemeral
in-memory named-pipe endpoints, which are disposed before exit.
NEVER creates users/services/keys/secrets, opens outbound network, or signs.
A PASS here is not independent signer custody, an E2E test, or release GO.
#>
$ErrorActionPreference = "Stop"
$project = "xssrfshdrtdfupgqwfdw"
$checks = [ordered]@{
  windowsDell = $false
  positiveKernelClientSid = $false
  explicitOwnerOnlyPipeAcl = $false
  unauthorizedClientDeniedByOsAcl = $false
}
$positiveServer = $null
$positiveClient = $null
$negativeServer = $null
$negativeClient = $null
$failure = ""
try {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $sid = $identity.User
  $checks.windowsDell = ($env:OS -eq "Windows_NT" -and
    $env:COMPUTERNAME -eq "DELL" -and
    $null -ne $sid -and $sid.Value -ne "S-1-5-18")
  if (-not $checks.windowsDell) { throw "WRONG_HOST_OR_PRIVILEGED_IDENTITY" }

  $acl = New-Object System.IO.Pipes.PipeSecurity
  $acl.AddAccessRule((New-Object System.IO.Pipes.PipeAccessRule(
    $sid, [System.IO.Pipes.PipeAccessRights]::ReadWrite,
    [System.Security.AccessControl.AccessControlType]::Allow)))
  $rules = @($acl.GetAccessRules($true, $true,
    [System.Security.Principal.SecurityIdentifier]))
  $checks.explicitOwnerOnlyPipeAcl = (
    $rules.Count -eq 1 -and
    $rules[0].IdentityReference.Value -eq $sid.Value -and
    $rules[0].AccessControlType -eq
      [System.Security.AccessControl.AccessControlType]::Allow)
  if (-not $checks.explicitOwnerOnlyPipeAcl) { throw "PIPE_ACL_NOT_RESTRICTED" }

  $name = "cst-onejob-deny-default-" + [Guid]::NewGuid().ToString("N")
  $positiveServer = New-Object System.IO.Pipes.NamedPipeServerStream(
    $name, [System.IO.Pipes.PipeDirection]::InOut, 1,
    [System.IO.Pipes.PipeTransmissionMode]::Byte,
    [System.IO.Pipes.PipeOptions]::Asynchronous, 1024, 1024, $acl)
  $pending = $positiveServer.BeginWaitForConnection($null, $null)
  $positiveClient = New-Object System.IO.Pipes.NamedPipeClientStream(
    ".", $name, [System.IO.Pipes.PipeDirection]::InOut,
    [System.IO.Pipes.PipeOptions]::None)
  $positiveClient.Connect(3000)
  $positiveServer.EndWaitForConnection($pending)
  $positiveClient.WriteByte(42)
  $positiveClient.Flush()
  $received = $positiveServer.ReadByte()
  $script:observedSid = $null
  $worker = [System.IO.Pipes.PipeStreamImpersonationWorker]{
    $script:observedSid =
      [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  }
  $positiveServer.RunAsClient($worker)
  $checks.positiveKernelClientSid = (
    $received -eq 42 -and $script:observedSid -eq $sid.Value)
  if (-not $checks.positiveKernelClientSid) { throw "KERNEL_PEER_IDENTITY_NOT_VERIFIED" }

  $system = New-Object System.Security.Principal.SecurityIdentifier("S-1-5-18")
  $sysAcl = New-Object System.IO.Pipes.PipeSecurity
  $sysAcl.AddAccessRule((New-Object System.IO.Pipes.PipeAccessRule(
    $system, [System.IO.Pipes.PipeAccessRights]::ReadWrite,
    [System.Security.AccessControl.AccessControlType]::Allow)))
  $denyName = "cst-onejob-deny-nonsecret-" + [Guid]::NewGuid().ToString("N")
  $negativeServer = New-Object System.IO.Pipes.NamedPipeServerStream(
    $denyName, [System.IO.Pipes.PipeDirection]::InOut, 1,
    [System.IO.Pipes.PipeTransmissionMode]::Byte,
    [System.IO.Pipes.PipeOptions]::Asynchronous, 1024, 1024, $sysAcl)
  $negativeClient = New-Object System.IO.Pipes.NamedPipeClientStream(
    ".", $denyName, [System.IO.Pipes.PipeDirection]::InOut,
    [System.IO.Pipes.PipeOptions]::None)
  $accessDenied = $false
  try {
    $negativeClient.Connect(1500)
  } catch [System.UnauthorizedAccessException] {
    $accessDenied = $true
  } catch [System.IO.IOException] {
    $accessDenied = (($_.Exception.HResult -band 0xffff) -eq 5)
  }
  $checks.unauthorizedClientDeniedByOsAcl = (
    $accessDenied -and -not $negativeClient.IsConnected)
  if (-not $checks.unauthorizedClientDeniedByOsAcl) {
    throw "OS_ACCESS_DENIAL_NOT_PROVEN"
  }
} catch {
  # Intentionally never print SID, process token, connection, or private config.
  $failure = $_.Exception.Message
} finally {
  if ($positiveClient) { $positiveClient.Dispose() }
  if ($positiveServer) { $positiveServer.Dispose() }
  if ($negativeClient) { $negativeClient.Dispose() }
  if ($negativeServer) { $negativeServer.Dispose() }
}
$pass = (@($checks.Values | Where-Object { $_ -ne $true }).Count -eq 0)
[pscustomobject]@{
  project = $project
  host = "DELL"
  scope = "WINDOWS_NAMED_PIPE_KERNEL_IDENTITY_ONLY"
  status = $(if ($pass) { "PASS" } else { "FAIL" })
  checks = $checks
  failure = $(if ($pass) { $null } else { $failure })
  windowsSignerCustodyVerified = $false
  independentFourAgentsVerified = $false
  independentHubFinalAckVerified = $false
  credentialProvisioningAuthorized = $false
  liveOperationalE2eVerified = $false
  releaseDecision = "NO_GO"
  changes = "NONE"
} | ConvertTo-Json -Depth 4 -Compress
if (-not $pass) { exit 2 }
