# GPT02 Issue #159 — incremental DEV issuer sidecar, no activation
Date: 2026-11-12

## Source of truth
The live Supabase DEV database already has four lifecycle RPCs:

| Schema | Routine | Definer | Permitted session_user |
| --- | --- | --- | --- |
| gpt02_stage | prepare_core_task(text,integer,text,text,text,text) | gpt02_core_prep_owner | gpt02_core_prep_login |
| gpt02_private | record_linked_approval(jsonb,text,text,jsonb,text,text,text) | gpt02_store_owner | dev_gpt02_attestor_evidence |
| gpt02_private | consume_linked_approval(jsonb,text,text,jsonb,text,text,text) | gpt02_store_owner | dev_gpt02_issuer_evidence |
| gpt02_private | reserve_post_consumption_fence(uuid,uuid,uuid,text) | gpt02_store_owner | dev_gpt02_issuer_evidence |

All three writer identities remain NOLOGIN. Reader identities are separate.
These four existing functions are **not replaced or edited** by this change.

## Proposed additive changes
`scripts/dev/gpt02_issue159_issuer_delta_DEV_ONLY.sql` adds only:

- `gpt02_private.issuer_evidences`
- `gpt02_private.issuer_lease_consumptions`
- `gpt02_private.record_issuer_evidence(jsonb,text,text)`
- `gpt02_private.consume_issuer_lease(uuid,uuid,uuid)`

Both tables are append-only, FORCE RLS, owner-only writer policy, and have a narrowly scoped SELECT-only issuer-reader policy. The RPCs run SECURITY DEFINER with a fixed pg_catalog search path, with explicit session_user = dev_gpt02_issuer_evidence, a role that remains NOLOGIN.

The migration confirms the existing owner/RLS/provenance policy and four RPC signatures before changing anything. The migration temporarily grants SET ROLE to the non-superuser migrations login and restores SET=FALSE before commit. No direct table DML is granted to readers or writer logins. Each inserted record has permanent false CHECK constraints for dispatch/signing.

## Offline verification
The disposable PostgreSQL 16 fixture recreates the existing table shape and **stubs** of the four official RPCs (same signatures/owners, but not their full bodies). It loads synthetic prior evidence through the disposable fixture superuser. The test runs the two new RPCs with synthetic issuer claims and verifies:

- Existing four function definition fingerprints are unmodified.
- New writer role stays NOLOGIN after migration, and temporary owner SET privilege is removed.
- No role outside the dedicated issuer has EXECUTE; issuer has no direct DML.
- Both new tables FORCE RLS and are owned by the NOLOGIN evidence owner.
- Issuer readback SELECT works and cannot create, edit or dispatch.
- Incorrect nonce digest and wrong fence are rejected.
- Duplicate issuer evidence and repeated lease consumption are rejected.
- Two concurrent consumers racing for one lease result in one successful consumption.
- Owner/superuser UPDATE/DELETE cannot change append-only evidence.
- Second application is rejected rather than overwriting live evidence.
- All persisted authorizing booleans remain false.

**This is not a cryptographic signing test.** The fixture uses fake signatures with the required shape. PostgreSQL checks immutable lineage and time bounds, but independent Ed25519 verification must take place in the issuer signer/broker before invoking these functions. Issuer signing stays DISABLED and worker dispatch stays NO_GO.

## Existing approval contract issue (outside this migration)
Read-only DEV catalog inspection identified `jsonb_object_length(jsonb)` in the existing `gpt02_private.record_linked_approval` function. `pg_catalog.jsonb_object_length(jsonb)` is not available on the DEV PostgreSQL instance. The currently stored function may fail when invoked. **Do not replace the function in this patch.** Create a separately reviewed, narrowly scoped correction based on its exact currently installed definition, replacing the two length checks with `(SELECT count(*) FROM pg_catalog.jsonb_object_keys(...))`. Preserve owner, EXECUTE grants, RLS and audited signer identity.

## Operational and promotion blockers
1. Independent authorization of the **one** logged-in Supabase Super Admin approval, persisted and read back; no extra AAL2/TOTP requirement.
2. Actual Ed25519 signer evidence, verified outside SQL against pinned four distinct public keys.
3. Restricted DEV writer/attestor/issuer credential provisioned without broad grants.
4. Correct existing approval JSON length contract, tested and read back.
5. One *new* authorized DEV task (never reuse 135/136/139), single command, ACK and read-back verified.
6. A separate audited dispatch-authorization design. This issuer-sidecar is explicitly non-dispatching.
7. PROD stays completely unchanged.

## Status
Migration proposal only; DO NOT APPLY automatically. Real DEV E2E: NO-GO.