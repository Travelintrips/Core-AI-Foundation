# CST-DEV DELL — self-hosted signing-key custody candidate (no Google KMS)

**Architecture decision:** Owner rejected Google KMS. No Google Cloud, external
KMS, service-account key or cloud signing API is necessary for this candidate.
Reuse the existing DELL and VPS, existing Core draft PR #1769 / Hub draft PR #202.

**Status: SOURCE QA ONLY — release NO-GO.** This document is not a credential,
Windows service installer, deployment authorization, or approval to create a key.

## Windows protection option

Windows DPAPI with `CurrentUser` scope is a built-in local encryption
facility that can protect data using the logged-in user's context. A different
local Windows user should not normally be able to decrypt that data, unlike
DPAPI `LocalMachine` scope. The proposed per-role design is:

1. Five existing local identities (coding, infrastructure, security, QA,
   reviewer), each non-admin with its own unique SID and restricted file ACL.
   None should share runtime credentials or a writable key directory.
2. Ed25519 key material, **once separately authorized**, would be generated
   directly in that role's protected signer process, wrapped for that user with
   DPAPI CurrentUser, stored in an owner/SYSTEM-restricted location with an
   integrity-checked envelope binding the project, company, role, Windows SID,
   source SHA, public-key fingerprint, change ID and version.
3. Private material may be decrypted only inside the right signer identity
   *after* an independently verified signed release and a one-job authorization.
   Never print a key, pass it on the command line, commit it or share it with
   Core AI, broker, chat, issue comments or logs.
4. The existing independent QA and Hub verifier checks remain unchanged:
   signed one-use evidence, Owner approval, new Company-1 job, subscriber
   receipt, then four independent agent attestations and reviewer Final ACK.
   Single-signing failure must fail closed locally, not stop unrelated apps.
5. Maintain verified secure backup / recovery of DPAPI-bound blobs and profile
   master keys. Resetting the Windows signer user's password as an administrator
   can make DPAPI data unrecoverable. Handle compromised key revocation and
   relock procedures before issuing any operational key.

**Security qualification:** DPAPI CurrentUser is software/user-context
protection, **not** a hardware non-exportable HSM/TPM key. Anyone who gains
the same Windows security token (and some elevated/local administrator
compromise scenarios) may retrieve the plaintext while the process is
running. All five accounts share DELL's OS and physical failure domain.
Signers must not be labelled fully independent on the basis of five SID
strings alone. CST Security/Operations must decide whether this risk is
acceptable before rollout.

## What was actually verified on physical DELL

- Windows 11 Pro, five local signer accounts present, still **disabled**.
- Windows PowerShell/.NET DPAPI `CurrentUser` round-trip on a synthetic
  random in-memory byte buffer: **PASS**. Incorrect optional entropy was
  rejected. No key or protected blob was written to disk.
- A deliberately source-only .NET Framework helper
  `scripts/dev/cst-onejob-dell-dpapi-custody.cs` compiled successfully.
  It has **only** `--synthetic-selftest`; it does not expose operational
  seal/unseal, key generation, persistence, or signing.
- **Important OS security block:** invoking the new unsigned test executable
  from DELL's temporary source checkout was refused by Windows Application
  Control. Read-only Code Integrity event **3077**, policy
  `VerifiedAndReputableDesktop`, was observed. No bypass, policy changes,
  alternative execution path, allowlisting, or signer activation was attempted.
  As a result **the compiled helper has NOT passed live DELL execution**.
- On an independent hosted Windows CI runner the helper can be compiled and
  exercised only as synthetic source QA. A CI PASS is **not a substitute for**
  an approved signer executable on physical DELL.

## One-batch operational gate (not yet authorized)

Before operational rollout, independent CST Security/Operations must:
- Approve the self-hosted DPAPI risk model and a publisher-signed/allowed
  Windows service binary through the **existing legitimate Application
  Control procedure** — no policy weakening or sneaking around it.
- Approve bounded signer-role credentials, loaded user profiles, protected
  per-role key containers and recoverability, plus DELL security isolation.
- Prove five actual non-admin service tokens, mutually denied cross-role
  access, exact source hash + signed change approval, narrow broker RLS
  capability and signed QA receipt chain.
- Only then perform one authenticated Owner approval for a *new* Company-1
  CST-DEV job, complete the 4+1 signed Final ACK, rollback/relock and audit.
- No PROD changes, no historic job #482 replay, no external Google dependency.

This is a direct, actionable security review scope, not another request for a
fictitious permission button. The last known production runtime is unchanged.

References:
- Microsoft CryptProtectData: https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata
- Microsoft DataProtectionScope: https://learn.microsoft.com/en-us/dotnet/api/system.security.cryptography.dataprotectionscope
- Microsoft DPAPI profile/recovery caveats: https://learn.microsoft.com/en-us/windows/win32/seccrypto/example-c-program-using-cryptprotectdata
