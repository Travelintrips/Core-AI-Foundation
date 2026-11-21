# CST-DEV one-job — one Super Admin human approval

**Decision confirmed 21 November 2026: Super Admin saja.**
Scope: CST-DEV project xssrfshdrtdfupgqwfdw, Company 1, a single new
qwen2.5:3b job (not historic #482). Draft Core PR #1769.

## Exactly one human, one business action

The existing Core AI application currently has database-backed internal
roles: owner (one active user), admin (one active), manager (one active).
Its current top-level route guard for this one-job pilot is
requireInternalRole("owner"), and the app's signed session is rechecked
against current internal_users. For THIS Core AI workflow, display
**"Super Admin"** while preserving the pre-existing privileged role
**owner** as the backend authorization mapping. An ordinary role admin,
manager, generic API key, chat text, or a Hub role string is NOT implicitly
equivalent to that verified Super Admin account. No new database role,
user, password, OTP flow, TOTP, or impersonation is created here.

The Super Admin sees exactly one button in the existing authenticated DEV
session. A fresh session plus the exact intent
APPROVE_ONE_NEW_CST_DEV_MODEL_JOB creates only a one-time Company-1 Owner
approval record and new WAITING job atomically. A second click is rejected
by the existing unique active-approval index. This is NOT general dispatch
or a blanket authorization for a different job or tenant.

**No additional human Security/Operations sign-off is requested.** Any
earlier wording requiring a distinct human Security or Operations reviewer
is superseded by this single Super Admin decision for the pilot.
Security checks still happen, but as **technical gates**, not extra people
or new approval screens.

## Important technical boundaries that do not disappear

- The independently verifiable Operations public-key signature on the
  job authorization is a separate technical trust-root check. A logged-in
  Super Admin's words or a mutable boolean are not a cryptographic signature.
  Root custody, source pin, signed job claims, and per-stage permits require
  truthful implementation and evidence; do not invent a root or self-issue
  an "independent" reviewer attestation.
- Existing independent QA PRE/POST receipts, dedicated NOLOGIN broker role,
  RLS, one-use nonce, matching actual payload SHA, event/subscriber evidence,
  four actual agent work records, reviewer Final ACK and relock remain.
  The eight Linux signer keys on VPS are reused, not regenerated.
- The signers and technical checks must never treat "same Super Admin human"
  as proof of physically independent key custody; that property has NOT
  been established and must be reflected truthfully in the audit.
- The QA/Operations technical process can run under separately scoped
  service identities with source-pinned signatures, without requiring
  another person to click anything. It must fail closed if those verified
  signatures or independent evidence are absent.
- The current legacy Core role owner is not the same literal role string
  as Hub super_admin. Cross-app role mapping cannot be assumed merely
  because the user-facing label says "Super Admin". Cross-app authentication
  must be verified before accepting a Hub session in Core.
- No KMS, no second human approver, no redeploy to PROD, no extra signer
  accounts, no DEV database privilege widening.

## Source and live operational status

The Core frontend and comments now say Super Admin, with existing owner-only
database role gates unchanged. The one-human contract is covered by a
source-only regression test added to the one-pass matrix.

**Not yet deployed:** DEV website frontend still serves the older build.
The real Operations signed root/job package and admission capability are
missing, signer units inactive, and no Owner approval has yet been recorded.
No user should be told to click an absent or disabled button. Real E2E and
reviewer Final ACK remain **NO-GO** until verified with real data.
