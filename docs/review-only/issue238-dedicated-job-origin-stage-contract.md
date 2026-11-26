# Issue238 — cryptographically bound dedicated job origin (source-only)

The real CST-DEV database has no Issue238 task in `ai_platform.ai_coding_tasks`.
`ai_platform.ai_coding_bridge_commands.task_id` has an FK to that table; a
user-supplied or random task UUID is not a valid durable work identity.
Generic bridge submission/claims have already been quarantined for
`issue238QaPurpose` and MUST remain so.

`verifyIssue238OwnerOrigin` verifies a **new**, signed Owner OTP consent from
BizPortal DEV for a specific trusted command/task reservation. The trusted
reservation must be retrieved from independently authenticated, durable
server-side staging (not an HTTP body), with the exact state
`AWAITING_OWNER_APPROVAL`. It must contain canonical command and task UUIDs.
The function rejects changed IDs, wrong purpose/worker/project/test/source or
image hashes, tampered Ed25519 signatures, wrong pinned BizPortal Owner public
key, nonce/timestamp errors, and approvals older than the agreed 90-second
window. It returns immutable verified metadata **without** mutating SQL,
registering a command, sending a permit or launching a runner.

The trusted signer public PEM fingerprint is pinned to the one already enrolled
in the Issue238 VPS issuer. This is a PUBLIC key fingerprint, no private key
or Owner OTP/password is stored in the repository.

## Remaining before any QA execution

1. Create an isolated, durable **staging** implementation that atomically
   reserves task and command identities under a dedicated, authenticated
   Owner-controlled API without exposing commands to the generic worker claim.
2. Obtain the fresh BizPortal Owner-signed consent for those *exact* IDs.
3. Verify signature and persistent staging identity, then use the existing
   independent Issue238 issuer's one-time nonce ledger and scoped permit.
4. Provide the reviewed digest-pinned disposable PG17 image and trusted runner
   with claim-lease/receipt checks. Never use the live CST-DEV/PROD finance
   database to run QA scripts.
5. Verify actual PG17 tests, relock, rollback and Invoice #108 release gates
   separately before enabling the CST DEV writer and posting any invoice.

No task/command was inserted, no live Owner receipt was issued or consumed,
no runner installed, and no finance or PROD changes were made by this patch.
