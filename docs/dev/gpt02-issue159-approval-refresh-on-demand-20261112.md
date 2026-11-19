# GPT02 Issue #159 — DEV on-demand approval request refresh
Date: 2026-11-12. Scope: DEV standalone approval UI/API only.

## Observed cause
Supabase Hub/Core preparation expires 15 minutes after issue. The Super Admin approval nonce expires in 4 minutes. The old UI can only read a root-owned, mode 0600 pending request file. If the administrator returns after 4 minutes, the file remains expired even while the underlying preparation may still be valid.

Previously stored approval for Task 147 is now expired and the signer/nonce ledger is empty. That approval must NEVER be reissued, replayed, or treated as native signing authorization.

## Proposed additive capability
- Exact POST /api/gpt02/issue159/approval-intent/refresh requires signed-in Supabase Super Admin with an active matching Hub operator link; static tokens cannot authorize it.
- Requires an exact empty JSON object body. Client cannot supply task, command, attempt, actor, nonce, or expiry.
- Reuses the already persisted pending-claims file and the existing tested preparation script. It NEVER creates or modifies an AI Task, command, Core Task, approval, nonce receipt, lease, signer or dispatch.
- Existing active approval requests are idempotently returned unchanged. Only expired requests without ANY prior approval for that task/command/attempt can be rotated.
- The independent read-only Hub/Core pre-sign-facts socket must prove exact immutable lineage, live PIC assignment audit, active Super Admin, Core PENDING with zero commands/runs, Hub execution prepared without command or dispatch, trusted separate TLS-backed DB sessions and an unexpired preparation.
- Pre-sign facts and the local clock must agree within 5s. Preparation must have at least 250 seconds remaining, leaving a safety margin beyond the 240-second new request. Failed checks return HTTP 409 or 503 with NO_GO.
- Concurrent refreshes are serialized with a private flock; old request is archived, and restored if the new request cannot be prepared.
- The Super Admin UI exposes a manual refresh button only for PENDING_REQUEST_EXPIRED, and never submits an approval automatically. A fresh approval requires a separate explicit confirmation.

## Verification
- 13 isolated Python tests: new nonce, original immutable IDs, concurrency exactly-once, rollback, already approved lockout, wrong actor, mismatched Core/preparation, dispatch evidence denial, insufficient expiry, stale clock, missing file, unpinned operational paths, idempotent fresh request.
- 17 existing and new authenticated HTTP tests: real identity enforced, static token denied, no input fields, disabled gate, no approval writes.
- UI Node test: manual click only, refreshed request appears without POST approval, declined expired/previously approved requests. Existing stale-click and OTP tests remain PASS.
- Full GPT02 Issue159 local Python regression: 108/108 PASS.
- Read-only live socket check on already-expired Task 147 refused pre-sign facts with 409, as required. No live database changes made by this work.

## Release boundary
This stacked PR is based on the reviewed stale-click UI branch (PR 1732), which itself carries the canonical OTP redirect fix (PR 1731). Do not merge or deploy out of order.

For any future DEV service rollout, install this new module AND the existing unmodified scripts/dev/prepare_gpt02_issue159_approval_request.py alongside approval_api.py. Verify hashes/ownership before service restart; no other service requires restart.

No PROD, no private keys, no DB writer credential, no signer authorization, no worker dispatch, no TOTP requirement or fake Super Admin decision. A fresh official task/PIC audit/Core reservation is still necessary once all historic tasks have expired.

STATUS: Candidate only. DEV native lifecycle E2E NO-GO.
