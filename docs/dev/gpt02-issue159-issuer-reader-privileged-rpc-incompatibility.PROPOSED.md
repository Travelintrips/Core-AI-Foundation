# Issue159 DEV — operational reader / SECURITY DEFINER incompatibility (NO APPLY)

**Status: confirmed blocking contract; no migration, credential, service or PROD changes.** Verified 14 Nov 2026 against checked-in source and a disposable, network-isolated PostgreSQL 16 container on srv1792369.

## Exact compatibility issue

The installed reader code originates in `artifacts/api-server/src/services/gpt02Issue159IssuerLedgerReadOnly.ts`, packaged by `scripts/dev/gpt02-issuer-reader-runtime.ts` into the VPS runtime. The runtime's `GPT02_ISSUE159_ISSUER_LEDGER_SQL` expects **one full row with named columns** from five direct joins. It then recalculates approval and operator-link canonical SHA-256 digests, maps receipt and fence fields, and calls the original issuer evidence contract validator. Do not replace this behavior with a reduced JSON proof: an earlier disposable proof-of-concept intentionally did not implement these downstream checks.

The same file's **native identity query** enforces `no_privileged_routines`:

```sql
NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
    AND p.prosecdef
    AND has_schema_privilege(current_user,n.oid,'USAGE')
    AND has_function_privilege(current_user,p.oid,'EXECUTE')
) AS no_privileged_routines
```

It also checks `no_relation_writes`, `no_memberships`, NOINHERIT, transaction read-only, pinned TLS and native role identity. Giving the issuer reader EXECUTE on a private `SECURITY DEFINER` RPC would make `no_privileged_routines=false`, causing **native identity check failure** before any evidence query. This was reproduced with a disposable NOLOGIN/NOINHERIT role and a specifically granted SECURITY DEFINER RPC in PostgreSQL 16: `EXPECTED_IDENTITY_GATE_DENY_SECURITY_DEFINER`. A prototype proving that restricted RPC itself can return a row is therefore *not* evidence of compatible operational reader deployment.

## Least-authority review options (choose one, then implement + test exact contract)

**A. Preferred candidate for further review:** Keep the existing native identity predicate unchanged, and use narrowly scoped column SELECT + strictly bounded RLS for all five required relations, with explicit no-enumeration tests for receipts/identity/fences. Their existing issuer-reader policies `USING (true)` are inadequate for direct SELECT; they must be replaced with reviewed row predicates tied to immutable DEV/default/task/command lineage, or a nonleaking relationship-based security barrier. Confirm all joined aliases/fields remain unchanged. A normal direct SQL query then requires no privileged RPC.

**B. Alternative requiring a separate security design:** An isolated, least-privilege trusted read interface may use SECURITY DEFINER only if the native identity proof is deliberately redesigned and independently reviewed to authenticate precisely this one pinned, safe function. **Do not simply exempt all privileged routines** or remove `no_privileged_routines`. Require dedicated NOLOGIN function owner without BYPASSRLS, narrow RLS for its own table access, fixed search_path, no dynamic SQL, exact-lookup semantics, strict signature/lineage binding, EXECUTE revoked from PUBLIC, replay/cross-tenant negative tests, and an identity-readback allowance only for the inspected exact schema/owner/function OID or signature. This is not approved by this document.

## Additional release acceptance gates

- The existing six? seven positional query arguments are **seven**: hub task, company, command, attempt, link, receipt, fence. A scoped replacement must preserve them and return the same aliased columns, data types, and uniqueness (LIMIT 2 and exact one-row assertion).
- Verify approval and operator-link digest recomputation and `inspectGpt02Issue159IssuerAuthorizerEvidence` validation still run unchanged. Fake DB proof is never elevated to persisted trusted provenance.
- Run disposable PostgreSQL tests matching the native identity query, privilege enumeration, RLS, wrong company, task, command, attempt, receipt, link, fence, worker, epoch, expired lease, replay, and no row-enumeration.
- Confirm unchanged negative authority flags: signingPermitted=false, authorizationGranted=false, dispatchPermitted=false; worker send and Final ACK are not tested by this stage.
- Only after review and verified source-runtime parity may owner-authorized one-shot encrypted credential proof begin. The reader must then be re-locked NOLOGIN / 0 connections / PASSWORD NULL with zero sessions.

**Conclusion: `PROTOTYPE_SCOPE_PASS` but `RUNTIME_INTEGRATION_NO_GO`.** No live CST-DEV grants or login changes should be made from the prior prototype.
