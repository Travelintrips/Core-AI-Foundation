# CST-DEV one-job DELL — guarded native Windows Service installer

**Source-only candidate on the existing Draft PR #1769.** Exact Supabase DEV project: `xssrfshdrtdfupgqwfdw`. No PROD, dispatch, job, keys, account activation or SCM service installation has occurred.

## What is implemented

- `scripts/dev/cst-onejob-native-signer-service.cs`: a compiled native .NET Framework Windows `ServiceBase` wrapper for five *pre-existing* signer accounts. It refuses unknown roles, non-DELL host, an OS token that is not the expected local signer account SID, and administrator signer tokens. It never creates a private key or signs anything; only after a separately approved external `cstdev-protected-signer-host.mjs`, independent pinned public trust and signed per-role release are installed can it start that worker. The service executable itself is **not a real signing service without its protected worker and independent custody**.
- `scripts/dev/cst-onejob-native-signer-installer.ps1`: one five-role installer candidate. Default `-Mode Preflight` reads five account names/disabled status/unique SID and checks the locally compiled binary SHA-256. `-Mode InstallDisabled` requires an elevated Authenticode-verified installer **in protected Program Files**, five **already approved** Windows service credentials supplied only via `PSCredential`, independently protected trust/worker/release-verifier artifacts, signed change verification and an exact approved binary hash. It registers only **disabled** services and rolls back new registrations if readback fails. It never enables local users, launches Windows services, generates passwords, accesses databases or modifies PROD.
- Existing `cst-onejob-dell-signer-source-qa.yml` adds a source-only native compile/PowerShell parse check on Windows runner; no DELL secrets or deployment.

## DELL host verification (21 November 2026 WIB)

The actual Windows DELL has native Framework C# compiler `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, and Node.js v25.8.0 provides software Ed25519. The native source compiled successfully (7,680 bytes). The local compiled executable SHA-256 is `A040A4884CD5686894CDAAB618D51C3C6B47F8951EB4FB25915C4E55B258D3CB`. `--preflight` returned valid DELL host, five supported role names, `SIGNATURE_ISSUED=FALSE` and `RELEASE_DECISION=NO_GO`. PowerShell installer parsed with **0 errors** and confirmed five existing disabled accounts, five distinct SIDs and zero installed Windows signer services. A deliberate `-Mode InstallDisabled` negative attempt **correctly denied** with `INSTALL_DENIED_MISSING_OFFICIAL_CUSTODY_OR_ADMIN_APPROVAL`; 0 new services and 0 enabled signer accounts afterward.

User-writable, **non-elevated source staging only** is at `C:\Users\user\Documents\CSTDEV-OneJob-NativeSigner` on DELL. **Do not elevate this file from that folder.** This is not a one-click ready-to-run operational release; the installer rejects unsigned/unprotected staged files.

## Unfinished non-bypassable authorization and key custody

The protected Ed25519 signer worker, five independently authorized role-specific key providers, source/publisher approval, Windows SCM service logon custody, authentic signed operator release, independently verified real job/Owner/nonce evidence, and Hub 4+1 attestation are **not yet provisioned**. The host has not demonstrated a TPM or OS Ed25519 non-exportable provider; Node.js software Ed25519 availability does not establish independent secure private-key storage. Do not substitute plaintext PEM or merely copy a signable key into the user's profile. Separate Windows SIDs on one physical DELL still share the hardware/admin failure domain.

Database roles remain `NOLOGIN`; broker must not receive direct `UPDATE ai_jobs` grants bypassing external QA. Never claim the guarded Windows host, signed-release verifier or synthetic test as a real operational signature or Final ACK.

**Release decision: NO-GO until these dependencies are independently satisfied and one real Company-1 DEV E2E succeeds.**