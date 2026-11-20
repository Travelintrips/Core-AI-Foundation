# CST-DEV DELL signer IPC identity boundary — source-only candidate

Project: xssrfshdrtdfupgqwfdw. Based on Core AI Draft PR #1769 head abfed13836ceb88cdcccf602c9890a4fea0244ba.
NO-GO for release, dispatch, credentials, Windows account activation or signer operations.

## What this patch adds

- Reusable Win32 named-pipe ACL and RunAsClient kernel-token peer SID checks, not self-declared client identifiers.
- Five pre-existing local Windows account identity checks. A signer must be enabled through **separately authorized** provisioning, non-admin and actually running under its expected SID. Disabled accounts reject runtime.
- A bounded, exact request-envelope *shape* check for one new Company-1 CST-DEV job, exact project, role, source SHA, approval/event IDs, payload hash and a five-minute window.
- Supplementary per-process nonce duplicate rejection. **Durable** replay prevention remains the existing PostgreSQL one-use receipt/nonce ledger, with independently reviewed grants.
- Windows-only kernel negative tests against all five disabled accounts, positive IPC canary using only the current interactive QA token, and explicit tests for wrong role/project/job, malformed claim, TTL, broad ACLs and duplicate nonce.
- No key provisioning, service installation, password, credential, signer daemon, signed release, Final ACK, job stage or database change.

## What this does NOT provide

This PowerShell module is a **transport boundary**, NOT an operational Ed25519 signing service or an independent custodian. Passing claim structure is never equivalent to verifying a signature. The module deliberately does not expose a Serve, Sign, EnableUser or Provision entrypoint. An independent release verifier, protected Windows service identity, audited key-protection design, and signed supervisor permit must be implemented and reviewed before any live signing can occur.

**Do not take a shortcut by enabling dormant users, creating plaintext private keys, assuming Windows CNG can hold nonexportable Ed25519 material, accepting a client-supplied SID or re-running a formerly blocked bootstrap through another account or tool.** Windows accounts share the DELL host/admin failure domain; separate account names alone are not proof of independent key custody.

The canonical Linux broker remains on VPS srv1792369 under SO_PEERCRED and distinct roles. The Core reconciliation is NOT the Hub four-agent-plus-reviewer Final ACK. Historical job #482 stays untouched. PROD is excluded.

## Verified testing, 21 November 2026

On authorized DELL, without elevation, from this source checkout:

    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\dev\cst-onejob-dell-signer-ipc-boundary.test.ps1

Expected output: status PASS, count 29, signatureIssued false, releaseDecision NO_GO, and every signer account remains disabled. No services or keys created.

The official existing cst-onejob-dell-native-ipc-preflight.ps1 also remains valid and unchanged. The additional module does not replace it.

On VPS, both previously deferred *isolated* gates have been executed using a sanitized copy of the exact PR #1769 source with Docker network none and ephemeral containers:
- cst-team-onejob-operational-broker-no-network-qa.sh: PASS; forged signed manifest rejected before bind, wrong UID rejected, one correct session relayed and all test containers cleaned.
- cst-team-onejob-subscriber-functional-rls-qa.py: PASS; disposable PG16 SCRAM, independent synthetic Ed25519 signer/receipt, duplicate rejection and cleanup.

Those are synthetic/disposable QA proofs only; not actual Supabase CST-DEV operations, not a real Owner click, and not a live four-agent Final ACK.

## Remaining operational gates

1. Independent security/operations authorization for approved provisioning (original previously blocked path remains blocked).
2. One reviewed, independently custodied Windows signer service adapter with a cryptographic preapproval/release verifier, real credential and key custody, true non-admin service run-as evidence, and fail-closed start/stop controls.
3. Exact-source runtime deployment, one real Owner-approved Company-1 NEW job, signed subscriber and four distinct agent attestations plus Hub reviewer Final ACK with matching source/event/job IDs.
4. Post-run rollback/relock and independently captured receipts.

Until then: releaseDecision NO_GO; never claim operational PASS.
