## Why this draft exists

GPT02-1782 Phase B requires the existing NOLOGIN table-owner role. The observed direct, non-superuser `postgres` session has ADMIN membership but effective SET/INHERIT false, so the existing Phase B authorization does not let that session act as the Owner. This draft prepares a concrete **new Owner security approval**; it does not apply SQL, enlarge existing approval, or claim custody E2E.

## Proposed new scope

On the verified CST DEV connection, temporarily create a separate postgres-granted membership with `SET TRUE, INHERIT FALSE, ADMIN FALSE`; use `SET LOCAL ROLE` solely to execute the pinned Phase B body; return with `SET LOCAL ROLE NONE`; revoke only that temporary grantor-specific row with RESTRICT **before the same transaction commits**. Preserve the bootstrap ADMIN-only row and every original membership OID/option. The whole candidate must use one pinned backend and one outer transaction.

The candidate rejects baseline drift and proves its temporary membership and grantor dependency were inserted by its own transaction, preventing accidental removal of a concurrent administrator's grant. It uses bounded lock/statement/idle/transaction timeouts and aborts on failed checks. The reader remains NOLOGIN/expired. Passwords, owners, RLS/FORCE RLS, Task190, services, custody publication and dispatch are outside this proposed change.

## Provenance

- Original Phase B: Core commit `522da5db476a513c469d700505507160eef73bfb`, blob `444bad054492ed77a565600d2d1bba02ba3dd1fe`.
- Embedded Phase B body is byte-identical, SHA256 `28e32bcdd5b68f8ffc03629e67626b63c9419c5e95d4753954685f9ac5bcdb4a`. The original source is unchanged; its BEGIN/COMMIT are replaced only in this new candidate by the enclosing transaction.
- Complete candidate SHA256: `7964cca8739db850ed91abdd6464d870085063c345a79e2c6ddb3010d034342e`.

## Verification

Four isolated PostgreSQL 17.12 cases passed: mid-phase error rollback, client-disconnect rollback, concurrent grant preservation by abort, and successful Phase B with concurrent warm/fresh postgres observers unable to SET ROLE. After success, exact memberships and role attributes were restored; intended 14/10 column grants and two original-challenge policies persisted; old-reader grants/policy, Owner/RLS and NOLOGIN/expiry remained unchanged. The runner connects directly as non-superuser postgres, not as a superuser that switches roles.

Used only the immutable cached image, network none, a new test volume, no host binds/ports, and bounded CPU/RAM/PIDs. Process 824987 exited 0; fixture container and volume were verified removed. Raw output and structured evidence are included. Earlier observer-lock timeout evidence is retained; correcting the test did not weaken candidate timeouts. No live database DDL was executed.

The live service is reported as PostgreSQL 17.6; PG17.6 source was reviewed, but the cached executable fixture is 17.12. Explicit new Owner approval, fresh live baseline review and confirmed single-connection transaction semantics are required before any application. Keep this PR **draft and review-only** until those decisions are made.
