# Issue #238 — Scoped OpenClaw disposable QA authorization contract

**Source-only proposal. Not deployed. No DBA permission is granted.**

The existing AI Core/OpenClaw work stream authenticates the scoped worker
`openclaw-vps-main`. The existing host executor is limited to host-read
operations and must remain so. Do not grant the OpenClaw container the Docker
socket or root.

The new `deploy/ai-workers/issue238_qa_permit.py` module verifies an
Ed25519-signed, narrowly scoped permit before a future host-side execution
adapter could select a QA script. The source pins CST-DEV project, operation,
worker identifier, exact reviewed relock SQL SHA, exact local Docker image
digest, and the only three approved script names.

Before any *runtime* execution is allowed, the custodian must separately
implement and verify all of the following:

1. Authenticate the requesting OpenClaw worker via the existing AI Core
   control plane and bind that identity to the signed `worker_id`, durable
   `command_id`, and `job_id`. Never trust those JSON fields alone.
2. Provision a custodian-approved **public** verification key to the isolated
   runner. A new permit must be signed by the actual authorized custodian;
   do not fabricate the signature or reuse another project's signer.
3. Consume the `nonce` in a durable, atomic, exclusive store before execution
   to prevent replay across workers or restarts. The permit module's in-memory
   set is only a unit-test interface. The separate source-only SQLite ledger
   (`issue238_qa_ledger.py`) now implements exclusive durable reservation,
   one-time result finalization, and rejection of duplicate command IDs.
   A future trusted runner must wire the ledger **after permit verification**,
   use an owner-only persistent directory, and treat `RESERVED` after crash as
   UNKNOWN/blocked until independently reconciled, never auto-retry it.
4. Verify the local image's actual digest, root ownership of QA sources,
   contents of **every** script against an approved manifest, and the exact
   SQL SHA. The source-only `issue238_qa_integrity.py` preflight now pins all
   four file hashes and the local image ID and checks owner/mode/symlinks.
   It verifies an externally supplied Docker inspection record; it does not
   authenticate Docker itself or prevent a file/image replacement between
   inspection and launch. The custodian must independently approve these
   exact script hashes and bind immutable source snapshots at execution.
   The verified permit alone does not prove image integrity.
5. Execute only the reviewed isolated fixtures, with Docker network `none`,
   no exposed ports, synthetic data, no live Supabase credentials, bounded
   resources, and fail-closed audit / command-result correlation. Do not
   extend the existing root host executor or its read-only scope without
   separate security review.
6. Reconcile a partial test failure, stale lease, restart, or duplicate
   command ID before a retry. An OpenClaw-generated narrative is not a QA PASS.
7. Keep the installed CST-DEV relock, AR source actor, Invoice #108, and PROD
   unchanged until full exact-SHA QA and a separately approved hosted DBA
   installation gate have passed.

Current unit evidence: nine synthetic permit-verification tests PASS.
**No disposable PostgreSQL runtime test has been executed by this module.**
