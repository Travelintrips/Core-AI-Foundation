# Issue159 DEV — original issuer reader SQL with scoped column SELECT/RLS

**Evidence:** 14 November 2026; disposable PostgreSQL 16 via `postgres:16-alpine` in `--network none` container on authorized VPS `srv1792369`. Container was `--rm` and cleaned up by EXIT trap. **No live CST-DEV SQL mutation, LOGIN, credential change, service activation, signer, dispatch, or PROD action.**

## What was exercised

The precise concatenated `GPT02_ISSUE159_ISSUER_LEDGER_SQL` expression was extracted from the current Draft PR source `artifacts/api-server/src/services/gpt02Issue159IssuerLedgerReadOnly.ts` at HEAD `04d482f1fd25e0edc4e5aa6e0cb518a5a8e15656`. It was executed unchanged as a seven-parameter SQL statement in a synthetic PG16 schema with the same relation names and columns referenced by that query.

The disposable `reader_test` role was `NOLOGIN NOINHERIT`, had `USAGE` on the private schema, and only column-scoped SELECT on the five needed tables. Each table had `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`. Restrictive test policies on approvals and operator_links checked company/task/environment. Receipts used a correlated approved-claim relationship, identity receipts an allowed receipt relationship with negative authority flags, and fences verified the expected DELL worker, epoch, unexpired lease, negative authority flags and allowed receipt/link relationships. This is only a candidate design; live policies require independent review for exact semantics, performance and side-channel leakage.

## Observed assertions (all passed)

```text
PASS_ORIGINAL_JOIN_ONE_ROW
PASS_CROSS_TENANT_DENIED
PASS_CROSS_RECEIPT_DENIED
PASS_RECEIPT_ENUMERATION_SCOPED
PASS_IDENTITY_ENUMERATION_SCOPED
PASS_FENCE_ENUMERATION_SCOPED
PASS_NO_WRITES_OR_PRIVILEGED_ROUTINES
EXIT CODE 0
```

Two fully synthetic task lineages were seeded, one `default`/DEV for DELL and one `other` tenant/worker. The approved row's exact joins produced one result; the other tenant and swapped receipt produced zero. Direct SELECT of receipt, identity and fence tables under the role returned only the matching lineage, not the other tenant. INSERT privilege, schema CREATE and any accessible SECURITY DEFINER function were checked absent.

## Important limits and next acceptance gates

- This **does not** execute the full `gpt02Issue159IssuerLedgerReadOnly.ts` application function, canonical digest verifiers, cryptographic signature validation, or a native TLS session. The fixture was shape-compatible with the SQL, not a byte-identical live schema dump.
- RLS via correlated EXISTS across five tables must be reviewed against actual indexes, permission semantics, policy composition and all existing readers; live issuer RLS on receipts/identity/fences currently uses `USING (true)` and must NOT be widened by direct GRANT without a safe replacement.
- Create a committed, repeatable disposable test with more adversarial fixtures: cross-command/attempt/link/fence, expired lease, wrong worker, replay, malformed digest and task, role memberships, unapproved flags, and direct exposure via unrelated relations/functions. Verify existing source's `no_privileged_routines` and no-memberships requirements still PASS.
- Evaluate performance / statement_timeout against actual indexes with no live-data edits; compare query shape and canonical digest validation via existing Node.js reader regression tests.
- Require independent review of exact proposed SQL before any **separate** approved DEV-only migration and ephemeral reader LOGIN proof. The prior owner authorization was conditioned on preflight PASS. This result alone does **not** satisfy the full native authentication preflight or authorize DB changes.

**Disposition: `ISOLATED_SQL_CONTRACT_PASS`; `LIVE_READER_NO_GO`; `E2E_FINAL_ACK_NO_GO`.**
