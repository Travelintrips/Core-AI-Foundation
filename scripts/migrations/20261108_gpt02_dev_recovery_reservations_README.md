# GPT02 DEV — isolated reservation ledger (Job 135)

This is a **DEV-only, additive, fail-closed** migration. It does not make a GPT02 command,
issue a dispatch grant, create an executable lease, or change the parent FAILED command.

Before applying:
1. Verify the connected Supabase project is AI Core DEV, not PROD.
2. Run migration in one authenticated database session after executing:
   SET ai_core.dev_migration_authorized = 'true';
   The migration itself does not set this flag. Without it, it must fail before DDL.
3. Check existing schema/constraint drift before any change; avoid forcing/overwriting.
4. Run the migration twice in an isolated database, then test duplicate parent, attempted
   execution/lease, malformed identity, concurrent requests, and schema drift.
5. After DEV application, verify the table is empty, RLS is enabled, constraints are
   correct, and no public roles have access.

The server reservation service remains OFF by default via the
AI_CORE_DEV_GPT02_RESERVATIONS_ENABLED flag; it has no HTTP route or runtime caller.
Enabling the flag alone has no effect until a separate reviewed integration is added.

Permanent invariant in this phase: state always reserved; execution_authorized=false;
lease token/worker/expires fields must remain NULL. Never use this table as an execution
authorization or treat a candidate UUID as a real command. A later issuer must perform
transactional anti-replay, signed grant, exclusive lease fencing, HTTP 429
Retry-After clearance, worker health, and final attestation checks.

Isolated PostgreSQL 16 evidence from November 8, 2026:
- Migration first run and repeat: PASS.
- Parent unique under two concurrent INSERT attempts: exactly one row.
- Attempts to turn on execution_authorized or populate lease owner: rejected.
- Deliberate extra column caused GPT02_RESERVATION_SCHEMA_DRIFT error.
- Missing session authorization caused GPT02_DEV_MIGRATION_AUTHORIZATION_REQUIRED error.
- Temporary test database removed after completion.
