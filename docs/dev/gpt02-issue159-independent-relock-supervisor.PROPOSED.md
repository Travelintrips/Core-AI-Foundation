# GPT02 Issue159 — Independent relock supervisor DEV (staged, NO-GO)

This extends the existing tested two-phase PostgreSQL watchdog. It does not replace the signer, issuer reader, Hub/Core readbacks or historical evidence.

## Sources

- gpt02_issue159_relock_catalog_supervisor.mjs: one-shot Node program, reusing the already-installed PostgreSQL driver, exact DEV hostname and TLS verification. It cannot send DELL commands.
- gpt02-issue159-relock-catalog-auditor.service: independent DynamicUser and systemd encrypted credential binding. No shell.
- gpt02-issue159-relock-catalog-auditor.timer: proposed 5-second cadence; NOT ENABLED.
- Existing gpt02_issue159_relock_admin_custody.READONLY.py verifies exact pinned [Service] settings.

## Mandatory release gates not currently satisfied

1. Independent PostgreSQL login dev_gpt02_relock_catalog_auditor with NO CREATEROLE, SUPERUSER, BYPASSRLS, or GPT02 table access.
2. An encrypted host-bound relock-catalog-dsn credential provisioned through an approved credential-management action, not chat, environment variables, or reused issuer secrets.
3. Separate owner-reviewed, restricted private PostgreSQL functions gpt02_relock_audit.relock_expired_phase_a() and gpt02_relock_audit.relock_expired_phase_b() returning bounded integer counts, callable ONLY by the independent role. Phase A commits NOLOGIN/PASSWORD NULL before phase B terminates sessions and records the durable cleanup. NO arbitrary SQL identifiers are passed from the service.
4. A live DEV expired-issuance test proving exact-role custody, session termination, revoke/readback, independent crash recovery, plus a complete review of RLS/function grants and password lifecycle.
5. Explicit service activation review; do not enable its timer until these gates PASS.

The current source performs NO privilege creation, installs NO database routines, reads no private keys, grants no signing or dispatch permission, and makes no change to PROD. The release decision remains NO_GO.

## Synthetic tests

- Node 4/4 service contract checks using only fixtures
- Python existing role custody metadata guard 13/13 PASS
- systemd-analyze verify on the proposed unit and timer

The service can be installed on the DEV host as an INACTIVE, DISABLED unit guarded by ConditionPathExists for the encrypted credential. That is staging, not proof of operational readiness.
