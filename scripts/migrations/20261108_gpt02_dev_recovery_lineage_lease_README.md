# Job 135 DEV recovery lineage and fencing ledger

This is an **additive DEV-only migration**. It must not be applied to PROD. It does not issue commands, create reservations, authorize execution, create active leases, or dispatch GPT02. Existing reservation flags remain OFF.

Prerequisite: `20261108_gpt02_dev_recovery_reservations.sql` installed and reviewed in DEV. Apply in a separate explicitly authorized DEV migration session with `SET ai_core.dev_migration_authorized = 'true';`, after testing against a disposable PostgreSQL database. No pipeline auto-apply.

The `gpt02_dev_recovery_command_links` table retains a mandatory unique parent/child/reservation triple. A row trigger validates that the child equals the reserved candidate and the parent agrees with the reservation. The issuer must additionally create the actual child command and link **atomically**, recheck authorization under lock, and rule out legacy untagged attempts. No issuer is part of this change.

The `gpt02_dev_recovery_leases` table has monotonic `fencing_token` and optional owner/expiry, but no active rows are created and no runtime grants are made. Separate implementation must implement CAS acquisition, heartbeat, stale token rejection, idempotent release, timeout takeover, 429 circuit breaker, and native attestation before dispatch.

For isolated tests, create stub `ai_platform.ai_coding_bridge_commands(id uuid primary key)` and `ai_platform.ai_human_tasks(id integer primary key)`, apply the prerequisite reservation migration and then this migration twice, with the guard enabled in the session. Run `20261108_gpt02_dev_recovery_lineage_lease_test.sql` in that disposable DB. Ensure all tests pass and destroy the database. Test fixture is intentionally not for production or DEV live.
