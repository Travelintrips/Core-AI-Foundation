# GPT02 DEV lease release receipts

Additive **DEV-only** migration. Do not apply to PROD.

Depends on `20261108_gpt02_dev_recovery_reservations.sql` and `20261108_gpt02_dev_recovery_lineage_lease.sql`. Migration requires explicit authorized DEV DB session setting `SET ai_core.dev_migration_authorized=true`. Runtime role grants are intentionally absent and the feature flag `AI_CORE_DEV_GPT02_LEASE_MUTATIONS_ENABLED` remains OFF.

The receipt is append-only: `(reservation_id, fencing_token)` uniquely identifies a completed lease release and stores the previous worker owner. The service releases using a transactional CAS followed by inserting the receipt in the **same** transaction; missing receipt throws to force rollback. A second request is idempotent only if this exact worker owns the receipt and the current lease still has that same token and remains unowned. Expired, replaced or foreign-owner tokens fail closed. A receipt is not permission to execute.

Isolated PostgreSQL 16 tests: apply migration twice (schema drift and idempotence), insert reserved candidate, CAS release plus receipt, read exact-owner receipt, reject other-owner, UPDATE blocked by immutable trigger, advance token to a new owner and reject old receipt as current lease. RLS enabled; test database disposed.

Still missing before runtime: authorized DEV migration and DB privileges, durable legacy attempt exclusion, atomic child issuer, separate dispatch approval, signed native ACK and full E2E verification. Do **not** enable flag or call worker based on this component.
