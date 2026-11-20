# CST-DEV One-Job — Integrated Single-Package Delivery & Acceptance
**Scope:** Supabase CST-DEV `xssrfshdrtdfupgqwfdw` only. PR #1767 remains Draft; operational release decision is **NO-GO**. This is one complete delivery plan, not an authorization to deploy, provision secrets or sign.

## What is already built and must be reused
- One internal authenticated Owner decision; stage creates a new **WAITING** model job, one approval and audit atomically. Dedicated staging config and scoped RLS/roles exist. Generic jobs cannot impersonate reserved pilot.
- Synthetic Ed25519 verification, pinned public-trust checks, signed evidence/locked-row digest binding and 5-minute receipt TTL.
- Disposable PostgreSQL receipt consumption, fault-injected rollback, sequential and concurrent replay rejection.
- Proposed broker still intentionally denies authorization and uses SECURITY INVOKER. No operational grant or queue permit.

## All remaining components — build as **one reviewed implementation package**
| Gate | Implementation/output to deliver | Exact acceptance evidence | External authorization |
| --- | --- | --- | --- |
| Staging service | Dedicated DEV-only service login, securely provisioned secret, bound single-connection pool; no shared fallback | TLS verify-full, port 6543, project, session_user/current_user, SET LOCAL ROLE reset after commit+rollback, negative RLS probes | Approved security/ops secret custody. Earlier blocked bootstrap MUST NOT be bypassed |
| Independent QA | Separately operated verifier, verified artifact/image/network/DB scope, SHA/digest and source byte capture, pinned root-owned public key and independently custodied signing private key | Capture provenance, signed PRE_ADMISSION, reject forged/stale/tampered receipts and wrong worker/job/source; independent operator record | Independent QA custody, not a second human Owner approval |
| Receipt persistence | Reviewed private schema, unique nonce/digest/job, forced RLS, scoped verifier-only write path, immutable consumed record | Exact-row constraints, dedicated-role RLS, private schema/data API exclusions, replay and concurrent attempts | Reviewed migration and least-privilege grants |
| Admission broker | Distinct non-login broker identity and scoped invoker, locked Owner/WAITING job/receipt, signature provenance reverified in trusted service, atomic consume→queue→approval→audit | Two concurrent callers yield exactly one successful commit; injected crash leaves no write; no worker/signer authority from receipt alone | Approved issuer/broker role custody and security review |
| Execution & subscriber | Isolated single-job candidate and scoped dispatch only after admission; event persisted and delivered to expected subscriber with independently checked durable receipt | One new job, exact image SHA, event/audit correlation, subscriber acknowledgement from actual target | Dedicated one-job runtime and network approval |
| Final ACK & rollback | Independently reconcile job/model output with approval, receipt, audit and subscriber; Final ACK issued only after all observed | Real end-to-end evidence and one Final ACK; historical #482 unchanged; no unexpected queued jobs; cleanup/rollback evidence | Final authorization from designated operations gate |

## Single acceptance sequence — no more piecemeal tests
1. Freeze exact PR SHA and agreed custody/permission design. Implement **all five missing operating components in the same reviewed branch**, not scattered unrelated PRs. Existing PASS code must be reused.
2. Run one offline command after a complete candidate is built:
   `node scripts/dev/cst-onejob-onepass-acceptance.mjs --offline`
   This runs the existing full set of one-job tests (including disposable network-none PostgreSQL), produces one structured matrix and always issues **NO_GO** for operations.
3. After approved provisioning, run on an authorized DEV QA host with existing DEV-only environment:
   `node scripts/dev/cst-onejob-onepass-acceptance.mjs --full-readonly`
   This adds actual READ-ONLY catalog readiness. It is not a substitute for staging authentication, independent key custody or E2E.
4. Only after staging, QA, broker, subscriber and Final ACK have been implemented as a complete package, run one controlled, **new** pilot job under the release gate. Owner approves once. Verify each step against immutable independent evidence. Do not reuse historical job #482.
5. One consolidated PASS/FAIL report must include exact build/CI SHAs, runtime image digest, project ID, role/TLS inspection, nonce evidence (never private keys), job/approval/audit IDs, subscriber receipt, Final ACK, independent reviewers, timestamps and rollback. Missing evidence yields NO-GO and a single blocker report, not partial release.

## Controls that cannot be automated away
A previously blocked credential-bootstrap attempt is **not permission to try other identities or a backdoor**. Dedicated secrets must be provisioned by an explicitly approved secure channel, never pasted into GitHub/chat/logs or sourced from an existing shared production credential. QA must independently custody its key; don't reuse GPT02 signer custody. Actual database migrations and privileged role activation must be explicitly authorized and reviewed for DEV. No PROD changes.

## Technical authority boundary
The Owner's business approval remains **one approval only**. Independent QA is an automated technical evidence validator. The staged job is not claimable; a PRE_ADMISSION receipt is not a queue permit; queue acceptance is not dispatch; a subscriber receipt is not Final ACK. Every transition requires its own cryptographically/transactionally grounded evidence. The acceptance runner intentionally cannot return operational GO.

## Integrated POST_EXECUTION evidence candidate (not deployed)

The package now includes `scripts/dev/cst-onejob-postexecution-review.mjs`, tests, and `docs/dev/cst-onejob-postexecution-ledgers.PROPOSED.sql`. It requires a persisted completion event and audit, **a real subscriber acknowledgement from the pinned recipient**, exact independently captured model response and evidence bytes signed as `POST_EXECUTION` by the independent QA key. It never issues Final ACK or authorizes dispatch, and the new private RLS ledgers have no live grants or deployments. A valid `PRE_ADMISSION` proof cannot substitute. These are implementation candidates pending audited custody and approved DEV execution.

## Verified-admission broker candidate (unapplied)

`docs/dev/cst-onejob-broker-operational.CANDIDATE.sql` and its network-none PostgreSQL test add row-locked one-use admission, atomic `waiting` to `queued`, approval/receipt consumption, audit and durable admission-event outbox, with concurrency/replay/error-rollback checks. The SQL remains `SECURITY INVOKER`, revokes PUBLIC EXECUTE, and grants no runtime role permission. It does not verify Ed25519 internally; a separately approved, independent QA process must verify the detached signature and external evidence bytes before broker use. Synthetic PASS cannot unlock operational dispatch.

## Trusted independent QA and locked broker transaction candidate (default-off)

The new `scripts/dev/cst-onejob-trusted-admission-bridge.mjs` connects the existing independently signed PRE_ADMISSION evidence verifier to authoritative approval/job/receipt rows locked with `FOR UPDATE` in the **same transaction** as the atomic SQL broker call. The CLI only accepts pinned root-owned QA inputs and an operator release record, exactly scoped CST-DEV broker identity, TLS verify-full and a dedicated pooler credential. It cannot use the shared Core AI runtime or a caller-supplied public-key path. It is default-OFF; no credentials, broker roles, grants, trust files or runtime changes were installed. Its ephemeral-key unit tests prove an invalid signature, tampered captured evidence, wrong role or source SHA cannot reach admission. This is a source candidate awaiting approved independent custody and a real DEV E2E; it is not a dispatch permit.

## Subscriber signed receipt and independent Final ACK writer candidate

The candidate now cryptographically verifies an Ed25519 subscriber-delivery acknowledgement (distinct domain and trust root from QA), recomputes the digest of independently captured delivery bytes, correlates it to the persisted subscriber row, and reconciles QA-signed POST_EXECUTION proof with locked job/approval/admission receipt/event/audit and actual `result_json.output.text`. A separate Ed25519 Final ACK issuer signs the exact reconciliation claim. The new transaction writes post-execution QA receipt, unique Final ACK record, and audit atomically; rollback on any failure. These are default-unprovisioned source components: no live subscriber receiver, signer private key, service credential, role grant, or deployment is included. An offline PASS cannot claim a real subscriber delivery or Final ACK. The signer and trust keys require approved separate custody before a controlled DEV end-to-end run.
