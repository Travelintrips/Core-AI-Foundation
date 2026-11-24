#Requires -Version 5.1
<#
CST-DEV OFFLINE, READ-ONLY signing package verifier.
Does not sign code, issue private keys, grant authority, alter Smart App Control,
install Windows services, change DB/PROD, or grant one-job admission.
Run only on DELL by an ordinary (non-admin) user.
#>
[CmdletBinding()]
param(
 [string]$ReviewFolder='C:\Users\user\Desktop\CSTDEV_SIGNER_CODE_SIGNING_REVIEW_20261121',
 [string]$SignedFolder='C:\Users\user\Desktop\CSTDEV_SIGNER_SIGNED_ARTIFACTS_20261121'
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$ExpectedProject='xssrfshdrtdfupgqwfdw'
$ExpectedSource='2cf9ef7083a27a61ac6bfcf771906f3ef90629fa'
$ExpectedZip='d934f93fdd2218bbd98593187f9dc56cfd3d849a8d9bc0b63368981a9898ff03'
$ExpectedTemplate='a040a4884cd5686894cdaab618d51c3c6b47f8951eb4fb25915c4e55b258d3cb'
$ExpectedFiles=@(
 'ToBeSigned\CstDevSignerService.exe',
 'ToBeSigned\cst-onejob-native-signer-installer.ps1',
 'ReviewSources\cst-onejob-native-signer-service.cs',
 'ReviewSources\cst-onejob-dell-dpapi-custody.cs',
 'ReviewSources\cst-onejob-dell-native-service-installer.md',
 'ReviewSources\cst-onejob-dell-selfhosted-dpapi-custody-20261121.md'
)
$report=[ordered]@{
 project=$ExpectedProject
 host=$env:COMPUTERNAME
 mode='READ_ONLY'
 sourceSha=$ExpectedSource
 reviewPackageValid=$false
 codeSigningCertificateVerified=$false
 signedExecutableVerified=$false
 signedInstallerVerified=$false
 officialChangeApprovalVerified=$false
 signerKeysProvisioned=$false
 windowsSignerServiceInstalled=$false
 smartAppControlChanged=$false
 googleKmsRequired=$false
 releaseDecision='NO_GO'
 status='DENIED'
 reason='REVIEW_PACKAGE_NOT_VERIFIED'
}
function Reply([string]$Status,[string]$Reason){
 $report.status=$Status
 $report.reason=$Reason
 [pscustomobject]$report|ConvertTo-Json -Depth 6 -Compress
}
function Sha([string]$Path) {
 (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
if($env:COMPUTERNAME -cne 'DELL'){
 Reply 'DENIED' 'WRONG_HOST'
 return
}
$parent=Split-Path -Parent $ReviewFolder
$zip=Join-Path $parent 'CSTDEV_SIGNER_CODE_SIGNING_REVIEW_20261121.zip'
if(-not (Test-Path -LiteralPath $zip -PathType Leaf) -or
   (Sha $zip) -cne $ExpectedZip){
 Reply 'DENIED' 'ORIGINAL_REVIEW_ZIP_SHA_NOT_VERIFIED'
 return
}
$mf=Join-Path $ReviewFolder 'manifest.json'
if(-not (Test-Path -LiteralPath $mf -PathType Leaf)){
 Reply 'DENIED' 'REVIEW_MANIFEST_MISSING'
 return
}
# Bind the on-disk manifest to the pinned original ZIP SHA. Without this,
# a modified folder AND modified manifest could deceive the file hash check.
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead($zip)
try {
 $entry=@($archive.Entries|Where-Object{$_.FullName -ceq 'manifest.json'})
 if($entry.Count -ne 1) {
  Reply 'DENIED' 'ZIP_MANIFEST_NOT_UNIQUE'
  return
 }
 $reader=[IO.StreamReader]::new($entry[0].Open(),[Text.Encoding]::UTF8)
 try { $zipManifest=$reader.ReadToEnd() }
 finally { $reader.Dispose() }
}
finally { $archive.Dispose() }
$diskManifest=[IO.File]::ReadAllText($mf,[Text.Encoding]::UTF8)
if($diskManifest -cne $zipManifest){
 Reply 'DENIED' 'REVIEW_MANIFEST_NOT_EQUAL_TO_PINNED_ZIP'
 return
}
$manifest=$diskManifest|ConvertFrom-Json
if($manifest.project -cne $ExpectedProject -or
   $manifest.sourceSha -cne $ExpectedSource -or
   $manifest.scope -cne 'CST_DEV_ONLY' -or
   $manifest.releaseDecision -cne 'NO_GO' -or
   @($manifest.artifacts).Count -ne 6){
 Reply 'DENIED' 'REVIEW_MANIFEST_SCOPE_INVALID'
 return
}
$items=@($manifest.artifacts)
foreach($relative in $ExpectedFiles) {
 $matches=@($items|Where-Object{$_.relativePath -ceq $relative})
 if($matches.Count -ne 1) {
  Reply 'DENIED' 'REVIEW_FILE_ALLOWLIST_MISMATCH'
  return
 }
 $file=Join-Path $ReviewFolder $relative
 if(-not (Test-Path -LiteralPath $file -PathType Leaf) -or
    (Get-Item -LiteralPath $file).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint) -or
    (Sha $file) -cne $matches[0].sha256) {
  Reply 'DENIED' 'REVIEW_SOURCE_HASH_MISMATCH'
  return
 }
}
$template=Join-Path $ReviewFolder 'ToBeSigned\CstDevSignerService.exe'
if((Sha $template) -cne $ExpectedTemplate){
 Reply 'DENIED' 'UNSIGNED_TEMPLATE_SHA_MISMATCH'
 return
}
$report.reviewPackageValid=$true
if(-not(Test-Path -LiteralPath $SignedFolder -PathType Container)){
 Reply 'PENDING_OFFICIAL_SIGNING' 'SIGNED_ARTIFACTS_NOT_PRESENT'
 return
}
$exe=Join-Path $SignedFolder 'CstDevSignerService.exe'
$installer=Join-Path $SignedFolder 'cst-onejob-native-signer-installer.ps1'
if(-not(Test-Path -LiteralPath $exe -PathType Leaf) -or
   -not(Test-Path -LiteralPath $installer -PathType Leaf)){
 Reply 'DENIED' 'BOTH_SIGNED_ARTIFACTS_REQUIRED'
 return
}
foreach($file in @($exe,$installer)){
 if((Get-Item -LiteralPath $file).Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)){
  Reply 'DENIED' 'SIGNED_ARTIFACT_SYMLINK_FORBIDDEN'
  return
 }
 $signature=Get-AuthenticodeSignature -FilePath $file
 if($signature.Status -ne 'Valid' -or -not $signature.SignerCertificate){
  Reply 'DENIED' 'INVALID_AUTHENTICODE_SIGNED_ARTIFACT'
  return
 }
}
if((Sha $exe) -ceq $ExpectedTemplate){
 Reply 'DENIED' 'SIGNED_EXECUTABLE_IDENTICAL_TO_UNSIGNED_TEMPLATE'
 return
}
$report.signedExecutableVerified=$true
$report.signedInstallerVerified=$true
$report.codeSigningCertificateVerified=$true
# This stage merely checks Authenticode. It cannot issue or verify the
# separately signed CST Security change order, trusted publisher authorization,
# five-user custody, or actual Smart App Control runtime permission on DELL.
Reply 'SIGNATURES_VERIFIED_RELEASE_NOT_AUTHORIZED' 'INDEPENDENT_APPROVED_CHANGE_AND_CUSTODY_STILL_REQUIRED'
