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

The source-only `issue238_qa_preflight.py` now composes the three existing
modules: exact authenticated worker/job matching (identity must come from a
separately authenticated adapter), pinned source/image verification, signed
permit check, and atomic durable reservation. It returns
`RESERVED_NOT_EXECUTED` and never launches Docker, opens a database connection,
or issues a new authorization. The caller must still independently authenticate
OpenClaw, authenticate the trusted Docker inspection and signing key, snapshot
immutable sources, and provide a separately approved host runner. Do not
expose this function as a public API or treat a caller-provided identity as
proof of authentication.

The source-only `issue238_qa_executor.py` is a constrained subprocess
adapter for an *already* verified RESERVED command. It requires the durable
signed-claims digest to match its receipt, checks the reviewed source manifest
and trusted image metadata again, snapshots all four sources into a private
read-only staging directory, and passes a fixed minimal environment to a
fixed `/usr/bin/bash` binary. Only the named QA scripts may run. It records
the command's final exit status and output digest exactly once. A timeout or
unexpected crash leaves a RESERVED record needing manual reconciliation;
it never silently reports PASS or retries.

**Deployment is still NOT authorized.** A signed custodian permit and genuine
authenticated OpenClaw work item must be bound by the existing trusted
control plane before this adapter can ever be invoked. The holder of this
Python module alone cannot prove identity or permissions. The Docker engine
must be restricted to the local immutable image, network-none synthetic QA,
and an exclusive execution/cleanup lifecycle, preventing image replacement
or source TOCTOU. Keep the live root host executor `host:read` only.
Unit tests inject a fake process runner and do not execute PostgreSQL.

**No disposable PostgreSQL runtime test has been executed by this module.**

## Trusted AI Core claim binding (source-only addition, 26 Nov 2026)

`bind_claimed_ai_core_work` rejects token-principal/claimed-worker mismatch,
missing `agent:work`, inactive credentials, missing active claim token,
and unbound `commandId` or `taskId` before the original signed-permit preflight.
The adapter requires **separately authenticated** credential and durable AI
Core claim records; the function does **not** authenticate caller-supplied dicts.
The control-plane implementation must verify the token's canonical `name`
and claim lease against the AI Core database, and bind the actual command/task
identifiers to a *new* exact Owner-signed QA approval. The older BizPortal
consent UI generates independent random `CMD-`/`JOB-` fields and therefore
cannot be assumed to match an existing durable AI Core work claim. Do not
forge those IDs or recycle the short-lived receipt. The existing generic
`agent:work` claim route must not be treated as QA authorization.

This addition only supplies a failing-closed parser for a future trusted
adapter. **It is not a host runner, cannot provision Docker or keys, and has
not executed PostgreSQL**. No active service, Finance or PROD modifications.

## CST-DEV verified credential / canonical worker mapping (26 Nov 2026)

Read-only hosted AI Core metadata confirms that canonical registry worker
`openclaw-vps-main` and its active scoped **service token record**
`openclaw-vps-dev-consumer` have distinct names. The prior source-only
adapter incorrectly required both names to be identical. The corrected QA-only
policy requires the exact scoped token record name
`openclaw-vps-dev-consumer`, separately requires active `agent:work`, and
requires the claimed/assigned worker identity to be `openclaw-vps-main`.
A future trusted adapter must prove the credential is the actual verified
token record (not caller JSON), verify token expiry/current claim lease from
the authoritative AI Core DB, and refuse all other workers. This mapping
is not permission to perform QA, sign Owner receipts or mutate DB roles.

Hosted read-only inspection found **zero PROCESSING** canonical VPS commands
and **zero likely Issue238** assigned VPS commands. No real QA work item was
claimed, no signed permit issued, and no PG17 fixture executed.
