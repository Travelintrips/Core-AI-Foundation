# DEV account-binding registry migration: security review design

> **Review-only proposal — not a migration, grant, execution authorization, or deployment.**
>
> Related tracking issue: [#1516](https://github.com/Travelintrips/Core-AI-Foundation/issues/1516).
> This repository is public. **Never commit account owner identifiers, real conversation IDs,
> binding fingerprints, session materials, production values, or database connection strings.**
> The approved tuple and pre/post hashes belong in a restricted change record.

## Goal and boundary

Correct **one existing additional-account ChatGPT binding** in AI Core **DEV** so
the server registry and the authorized DELL OpenClaw worker point to the same
user-confirmed destination. Preserve both legacy GPT01 owners and the complete
production environment. Use REST/HTTPS for AI Core; **do not add an MCP server
to AI Core**.

The worker's normal database role intentionally has SELECT privilege but no
UPDATE privilege on the shared settings registry, and RLS is enabled. An
authenticated provisioning endpoint can validate a replacement but cannot
persist it under that role. This is an **authorization boundary**, not a reason
to relax RLS or issue broad UPDATE grants.

An owner has authorized requesting an appropriately scoped DEV security review.
**That does not constitute DBA approval, browser-session inspection approval,
or permission to execute a privileged migration.**

## Threat model and non-goals

- One registry value can contain multiple account bindings. A whole-value
  update without compare-and-swap may destroy another account's update.
- User-visible ChatGPT ACK text does **not** attest the browser identity,
  ownership, signed session, or end-to-end transport.
- A stale or partially changed server/local tuple can route work to the wrong
  destination. Fail closed; never silently fall back to another browser profile.
- An UPDATE privilege on the full settings table would extend the runtime's
  authority well beyond the one intended correction.
- A privileged SECURITY DEFINER function or disabled RLS is **not** the fix.
- No automatic CDP/tab/snapshot inspection of authenticated ChatGPT sessions.
  Previously screened operations remain blocked.
- No live DB mutation, worker restart, migration deployment, secret rotation,
  or production change is included in this PR.

## Proposed review and deployment sequence

**Gate A — Review, before any mutation**

1. Identify a DBA/security reviewer authorized for the **DEV project only**.
   Obtain their separate, recorded decision and the approved deployment lane.
2. In a private review record, pin the DEV project identity; the exact expected
   existing registry value/hash; the account alias, owner, worker and browser
   profile; the approved new conversation target; and the expected new
   v2 fingerprint. Do not place these values in GitHub.
3. Show that exactly one registry row and exactly one intended non-GPT01
   binding match. Confirm the existing GPT01 owners and any other bindings
   remain untouched. Reconfirm the worker is the intended one.
4. Verify independently that the executing migration principal has only the
   privileges necessary for the approved migration. The regular runtime role
   must stay unable to UPDATE the registry.
5. Agree on backup location, audit/change ticket, failure criteria,
   maintenance ownership and a safe conditional rollback plan.

**Gate B — Approved migration, only after Gate A**

1. Open a transaction in the **verified DEV database** through an
   administrator-approved migration pipeline. Do not reuse the worker token.
2. Lock the single settings row and enforce an exact compare-and-swap against
   the approved baseline, including all non-target bindings. Abort on drift,
   missing row, extra rows or collisions.
3. Replace only the approved additional-account target while keeping its
   owner identity, worker and browser profile unchanged. Force its new state
   to **`enabled: false`** pending approved session attestation.
4. Validate the complete updated registry using the canonical account-binding
   validator, including its current `account-binding/v2` fingerprint
   formulation. Preserve any unrelated bindings byte-for-byte where feasible
   and structurally identical otherwise.
5. Require exactly one modified registry row, commit, and save an audit
   receipt containing redacted pre/post hashes and a change identifier.
   Re-read from a separate DEV connection. Preserve all RLS policies,
   grants and role assignments.
6. Only after independently confirming the server state, prepare a reviewed
   local DELL binding update with pinned original backup and atomic replace.
   Verify the two legacy GPT01 bindings are identical, and avoid a second
   competing worker process. Any required controlled worker restart is a
   distinct approved maintenance operation.

**Gate C — Verification and release**

1. In isolated tests, demonstrate that the runtime role still cannot UPDATE
   the settings table. Audit existing RLS policies and security advisors.
2. Run existing account-provisioning and session-activation unit tests,
   plus cases for stale baselines, duplicate owner/target, wrong DEV project,
   missing row, concurrent changes, and preserved GPT01 owners.
3. Check the fresh registry from a separate DEV reader. Confirm the new
   account stays disabled until a legally supported and independently
   verified session-activation method is authorized.
4. Perform only an independently approved, correlated REST/HTTPS E2E test
   with real command, worker, result and return-path evidence. An HTTP
   queue ACK or a manual ChatGPT response does not establish E2E.
5. Do not claim `SESSION_ACTIVE`, `DELIVERY_CONFIRMED` or
   `E2E_VERIFIED` without their required signed receipts.

## Fail-closed and rollback rules

- Before commit: any failed precondition means **ROLLBACK**, leaving the
  existing database and local worker files unchanged.
- After server commit but before local coordination: preserve the new
  binding as **disabled** and stop; do not enable it or dispatch work.
- Never replay a failed write without first reading back the registry and
  reconciling whether the original transaction committed.
- Conditional rollback requires its own comparison against the exact
  post-migration value. Do **not** blindly restore an old
  `enabled: true` mapping, since its authorization may now be stale.
- No retries of authenticated ChatGPT browser inspection through alternative
  agents, shells, machines, or wrappers.

## Evidence checklist for the reviewer

- [ ] Named DEV DBA/security reviewer and recorded approval
- [ ] Verified DEV project identity and change ticket
- [ ] Private exact baseline/target tuple and immutable backup
- [ ] Compare-and-swap plan and single-row accounting
- [ ] Proof GPT01 and all unrelated bindings remain unchanged
- [ ] Proof runtime role retains **no broad UPDATE grant**
- [ ] RLS/advisor review and regression test results
- [ ] Deployment and conditional rollback procedure approved
- [ ] Registry and local-worker readback receipts
- [ ] Separate lawful activation and correlated E2E test evidence

**Current disposition:** awaiting administrator review. The account
reconciliation is not deployed, and live session activation / E2E remain
**unverified**.
