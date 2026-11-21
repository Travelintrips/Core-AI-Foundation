#Requires -Version 5.1
<#
  CST-DEV native DELL signer service installer.
  Default Preflight is read-only; InstallDisabled is intentionally gated.
  No password, key, login, service startup, dispatch or PROD operation.
  No source-only success implies independent custody or live Final ACK.
#>
[CmdletBinding()]
param(
 [ValidateSet('Preflight','InstallDisabled')][string]$Mode='Preflight',
 [System.Collections.IDictionary]$ServiceCredentials=$null
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$Project='xssrfshdrtdfupgqwfdw'
$UnsignedReferenceSha='A040A4884CD5686894CDAAB618D51C3C6B47F8951EB4FB25915C4E55B258D3CB'
$dir=Split-Path -Parent $MyInvocation.MyCommand.Path
$bin=Join-Path $dir 'CstDevSignerService.exe'
$roles=@(
 @{role='coding';account='cstdev_sign_coding'},
 @{role='infrastructure';account='cstdev_sign_infra'},
 @{role='security';account='cstdev_sign_security'},
 @{role='qa';account='cstdev_sign_qa'},
 @{role='reviewer';account='cstdev_sign_reviewer'}
)
function Assert-ExistingAccount {
 param([hashtable]$Spec)
 $user=Get-LocalUser -Name $Spec.account -ErrorAction Stop
 if ($user.Description -cne ('CSTDEV_DORMANT_SIGNER_'+$Spec.role)) {
   throw 'DORMANT_IDENTITY_PROVENANCE_MISMATCH'
 }
 if ($null -eq $user.SID) {throw 'LOCAL_SIGNER_SID_MISSING'}
 return $user
}
if($env:COMPUTERNAME -cne 'DELL'){throw 'CSTDEV_WRONG_HOST'}
if(-not (Test-Path -LiteralPath $bin -PathType Leaf)){
 throw 'NATIVE_SIGNER_SERVICE_NOT_COMPILED'
}
$hash=(Get-FileHash -LiteralPath $bin -Algorithm SHA256).Hash
$unsignedReferenceMatches=($hash -ceq $UnsignedReferenceSha)
# An unsigned build hash is an informational source preflight, not an
# installation authorization. A signed executable has a DIFFERENT hash.
$users=@($roles | ForEach-Object {Assert-ExistingAccount $_})
if(($users|ForEach-Object{$_.SID.Value}|Sort-Object -Unique).Count -ne 5){
 throw 'FIVE_DISTINCT_SIGNER_SIDS_REQUIRED'
}
$adminSids=@(Get-LocalGroupMember -SID 'S-1-5-32-544' -ErrorAction Stop |
 ForEach-Object {$_.SID.Value})
if(@($users|Where-Object {$adminSids -contains $_.SID.Value}).Count -gt 0){
 throw 'SIGNER_IDENTITY_IS_ADMINISTRATOR'
}
$svc=@($roles|ForEach-Object {Get-Service -Name ('CSTDEVOneJobSigner_'+$_.role) -ErrorAction SilentlyContinue})
$elevated=([Security.Principal.WindowsPrincipal]::new(
 [Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole(
 [Security.Principal.WindowsBuiltInRole]::Administrator)
$trustDir=Join-Path $env:ProgramData 'CSTDEV\OneJob\custody'
$protectedExecutable=Join-Path $env:ProgramFiles 'CSTDEV\OneJobSigner\CstDevSignerService.exe'
$protectedApprovalVerifier=Join-Path $env:ProgramFiles 'CSTDEV\OneJobSigner\verify-authorized-change.ps1'
$trustedApproval=Join-Path $env:ProgramData 'CSTDEV\OneJob\approvals\signed-install-change.json'
$signerWorker=Join-Path $env:ProgramFiles 'CSTDEV\OneJobSigner\cstdev-protected-signer-host.mjs'
$ready=($elevated -and
 (@($users|Where-Object{-not $_.Enabled}).Count -eq 0) -and
 ($null -ne $ServiceCredentials) -and
 (Test-Path -LiteralPath $trustDir -PathType Container) -and
 (Test-Path -LiteralPath $signerWorker -PathType Leaf) -and
 (Test-Path -LiteralPath $protectedExecutable -PathType Leaf) -and
 (Test-Path -LiteralPath $protectedApprovalVerifier -PathType Leaf) -and
 (Test-Path -LiteralPath $trustedApproval -PathType Leaf) -and
 ($svc.Count -eq 0))
$report=[ordered]@{
 project=$Project;host=$env:COMPUTERNAME;mode=$Mode
 accountsPresent=$users.Count
 accountsDisabled=@($users|Where-Object{-not $_.Enabled}).Count
 distinctSids=(@($users|ForEach-Object{$_.SID.Value}|Sort-Object -Unique).Count -eq 5)
 nativeServiceHashVerified=$false
 unsignedReferenceBuildShaVerified=$unsignedReferenceMatches
 signedPublisherVerified=$false
 currentlyElevated=$elevated
 servicesAlreadyPresent=$svc.Count
 authorizedTrustAndWorkerInstalled=(
   (Test-Path -LiteralPath $trustDir -PathType Container) -and
   (Test-Path -LiteralPath $signerWorker -PathType Leaf) -and
   (Test-Path -LiteralPath $protectedExecutable -PathType Leaf) -and
   (Test-Path -LiteralPath $protectedApprovalVerifier -PathType Leaf) -and
   (Test-Path -LiteralPath $trustedApproval -PathType Leaf))
 changeAuthorizationVerified=$false
 canInstallDisabledServices=$false
 signerKeysProvisioned=$false
 signatureIssued=$false
 releaseDecision='NO_GO'
 prodChanged=$false
}
if($Mode -eq 'Preflight'){
 [pscustomobject]$report | ConvertTo-Json -Compress
 return
}
if(-not $ready){throw 'INSTALL_DENIED_MISSING_OFFICIAL_CUSTODY_OR_ADMIN_APPROVAL'}
# Never run an elevated installer from a user-writable source tree.
# An independently signed approval must bind the approved source hash.
$trustedRoot=Join-Path $env:ProgramFiles 'CSTDEV\OneJobSigner'
$scriptPath=[IO.Path]::GetFullPath($MyInvocation.MyCommand.Path)
if(-not $scriptPath.StartsWith(($trustedRoot+'\'),
  [StringComparison]::OrdinalIgnoreCase)){
 throw 'ELEVATED_INSTALLER_MUST_BE_STAGED_IN_PROTECTED_PROGRAM_FILES'
}
$auth=Get-AuthenticodeSignature -LiteralPath $scriptPath
if($auth.Status -ne 'Valid'){throw 'ELEVATED_INSTALLER_SIGNATURE_NOT_VALID'}
$exeSignature=Get-AuthenticodeSignature -LiteralPath $protectedExecutable
if($exeSignature.Status -ne 'Valid' -or -not $exeSignature.SignerCertificate){
 throw 'PROTECTED_NATIVE_BINARY_AUTHENTICODE_NOT_VALID'
}
$protectedFiles=@($protectedExecutable,$protectedApprovalVerifier,
  $trustedApproval,$signerWorker)
foreach($artifact in $protectedFiles){
 $acl=Get-Acl -LiteralPath $artifact
 $owner=([Security.Principal.NTAccount]$acl.Owner).Translate(
   [Security.Principal.SecurityIdentifier]).Value
 if($owner -notin @('S-1-5-18','S-1-5-32-544')){
   throw 'UNTRUSTED_PROTECTED_ARTIFACT_OWNER'
 }
 $bad=@($acl.Access|Where-Object {
   $_.AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
   ($_.IdentityReference.Value -in @('Everyone','BUILTIN\Users',
     'NT AUTHORITY\Authenticated Users')) -and
   (($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Write) -ne 0 -or
    ($_.FileSystemRights -band [Security.AccessControl.FileSystemRights]::Modify) -ne 0)
 })
 if($bad.Count -gt 0){throw 'PROTECTED_ARTIFACT_WRITABLE_BY_USERS'}
}
# The reviewer is an externally installed, root-owned enterprise verifier.
# It must independently validate the signed change/allowlist. A copied JSON
# flag or local administrator claim must NOT grant authorization.
# Protected independent verifier MUST validate the signed change record,
# approved source SHA, project, immutable binary digest and allowed publisher.
# Output one exact line: CST_DEV_SIGNER_SERVICE_CHANGE_SIGNATURE_VALID|SHA256
# The old unsigned SHA may NOT be accepted as a signed-artifact permit.
$check=@(& $protectedApprovalVerifier -ApprovalPath $trustedApproval -BinaryPath $protectedExecutable -Project $Project)
if($LASTEXITCODE -ne 0 -or $check.Count -ne 1 -or $check[0] -isnot [string]){
 throw 'INDEPENDENT_SIGNED_CHANGE_APPROVAL_NOT_VERIFIED'
}
$verdict=[regex]::Match($check[0],
 '^CST_DEV_SIGNER_SERVICE_CHANGE_SIGNATURE_VALID\|([A-F0-9]{64})$')
if(-not $verdict.Success){
 throw 'INDEPENDENT_SIGNED_CHANGE_APPROVAL_NOT_VERIFIED'
}
$approvedSignedHash=$verdict.Groups[1].Value
$actualSignedHash=(Get-FileHash -LiteralPath $protectedExecutable -Algorithm SHA256).Hash
if($approvedSignedHash -cne $actualSignedHash){
 throw 'APPROVED_SIGNED_BINARY_HASH_MISMATCH'
}
$report.nativeServiceHashVerified=$true
$report.signedPublisherVerified=$true
$report.changeAuthorizationVerified=$true
foreach($spec in $roles){
 $cred=$ServiceCredentials[$spec.role]
 if($null -eq $cred -or $cred -isnot [pscredential] -or
    $cred.UserName -cne ('.\'+$spec.account)){
   throw 'MISSING_EXACT_WINDOWS_LOCAL_SERVICE_CREDENTIAL'
 }
}
# Register only DISABLED services, never Start-Service or enable accounts.
# An SCM credential is an OS protected input, never written to this script.
$created=New-Object System.Collections.ArrayList
try {
 foreach($spec in $roles){
   $name='CSTDEVOneJobSigner_'+$spec.role
   $binaryPath='"'+$protectedExecutable+'" --service '+$spec.role
   New-Service -Name $name -DisplayName ('CST-DEV OneJob Signer '+$spec.role) `
      -BinaryPathName $binaryPath -Credential $ServiceCredentials[$spec.role] `
      -StartupType Disabled -ErrorAction Stop | Out-Null
   [void]$created.Add($name)
 }
 foreach($name in $created){
   $service=Get-CimInstance Win32_Service -Filter ("Name='"+$name+"'")
   if($service.StartMode -ne 'Disabled' -or $service.State -ne 'Stopped'){
     throw 'WINDOWS_SCM_DISABLED_READBACK_FAILED'
   }
 }
 $report.canInstallDisabledServices=$true
 [pscustomobject]$report | ConvertTo-Json -Compress
} catch {
 foreach($name in $created){sc.exe delete $name | Out-Null}
 throw
}
