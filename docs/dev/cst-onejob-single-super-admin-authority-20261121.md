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

## Actual DEV Nginx frontend and API route proof (21 Nov 2026)

The public DEV Nginx server serves /dev-onejob and /assets/* from its
AI Platform static root, and proxies only /api/* to the Core backend.
The API's own bundled api-server/dist/public SPA is a DIFFERENT frontend:
its HTTP 200 fallback does NOT establish that the Super Admin screen
exists. The runtime image smoke therefore checks the actual compiled
AI Platform index.html, uniquely referenced Super Admin JS and CSS,
build metadata pinned to exact source SHA, and rehearses a combined
same-origin static/API route in network-none Docker. The protected
GET readiness and POST approval routes must both deny anonymous traffic.
Do not advertise a button based solely on a generic SPA fallback.

VPS proof, original official GitHub CI artifact head
0bdf03f71fe6a7b3129e6a458e77dae57add2721:
the ZIP, UI/API and rollback are staged in the existing
/opt/cst-onejob-superadmin-dev-candidates/ private folder. The isolated
--network none --read-only parallel combined route test returned
CSTDEV_SUPER_ADMIN_PARALLEL_ROUTE_QA_PASS with exact frontend and backend
hashes, expected HTTP 200 and anonymous 401. The container was removed.
Neither public Nginx nor active shared Core was changed.

Live cutover is NOT cleared: the dedicated staging login, independently
signed QA PRE, Operations root/job release, admission capability, genuine
authenticated Super Admin job and Final ACK are absent. Routing an
unready button could break unrelated working DEV features; preserve the
original site until the coherent cutover and rollback gates can pass.

## No circular QA dependency before the one-click WAITING stage

The single signed Super Admin session sends ONE explicit request containing
the existing business intent plus a **public** Operations root candidate
fingerprint. Exact source-pinned value:
65aa7599c60cc0acc71d72f9f3bd5bd810873aad725fa64856e36639c995f71b.
It identifies the already-encrypted dormant VPS candidate; no private key
is imported into the application. The API checks the value EXACTLY, rejects
admin/manager/unrecognized keys, and binds the choice to the new Company-1
WAITING job, active owner, specific requestId/sourceSha/worker and the single
transactional audit. The audit marks operationsRootTrusted=false,
independentQaAdmissionVerified=false, dispatchPermitted=false.

**Important sequencing correction:** the original pre-Owner QA receipt can
attest general readiness, but **job-specific QA PRE cannot be issued for an
unknown jobId/approvalId**. Therefore a missing QA preapproval must not
block creation of the non-claimable WAITING job. The signed QA PRE, actual
Operations signed job release, narrow independent DB admission capability,
one-use nonce, authentic subscriber, 4-agent work and reviewer Final ACK
remain mandatory **before queue promotion/dispatch**. The current worker
claim query only selects QUEUED or due RETRYING jobs, never WAITING.

The signed preapproval helper remains an advisory verifier, not bypassed or
used as a fake authorization. The dedicated scoped staging database login,
source pin, worker name, feature default-OFF, exact project, fresh Owner
session and RLS must still pass for a WAITING job to be created.

The one-click root selection is only an audit-bound public identifier. It
does NOT approve the Operations private key, install the trusted public
root, assert independent hardware custody, sign an Operations permit, or
make a real database readback. The new pure
cstOneJobOperationsRootSelectionReview module verifies matching fields
from a *separately authenticated* database result and always returns
operationsRootTrusted=false, authenticatedDbReadbackVerified=false and
releaseDecision=NO_GO. A synthetic fixture is never E2E proof.

No new login, OTP/TOTP, second human sign-off, KMS, grant widening,
signer activation, active DEV cutover or PROD change is authorized.

## Additional RLS enforcement: exact Operations candidate fingerprint

The previous CST-DEV staging audit RLS allows an extra, unverified
operationsRootCandidateSha256 JSON field. To avoid trusting arbitrary
client or DB-writer text, add one **RESTRICTIVE INSERT-only** policy scoped
to the already-existing NOLOGIN staging writer, as a separate migration:
cst-onejob-ops-root-audit-guard.CSTDEV-ONLY.sql.

It combines with (does not replace) the already-installed permissive
staging audit policy, and allows only:
- source-pinned candidate SHA-256
  65aa7599c60cc0acc71d72f9f3bd5bd810873aad725fa64856e36639c995f71b
- sameSuperAdminRootSelection=true
- operationsRootTrusted=false
- independentQaAdmissionVerified=false
- dispatchPermitted=false
- existing owner_approved_waiting_job audit identity and resource

No new role/login, privileges, broad grants, RLS disable, signer activation
or PROD change. The policy is a necessary row-integrity guard, not proof
of a legitimate authenticated Owner session or of independent custody.
A matching audit is not an Operations signature or a live E2E PASS.
The guarded rollback refuses removal after any Owner approval exists.

Disposable PostgreSQL 16 network-none evidence uses the exact DEV-only
migration and guarded rollback, confirms success, fails on duplicate
migration, confirms rollback only before any approval, and refuses wrong
Operations fingerprint or forged trust booleans. This does not establish
any live CST-DEV migration until separately applied and read back.

## Runtime Supabase public CA preflight (21 November 2026)

The actual VPS host already has the public Supabase Root 2021 CA at
`/etc/cst-onejob-dev/trust/prod-ca-2021.crt`. A passwordless
PostgreSQL SSLRequest + verified TLS 1.3 handshake to CST-DEV succeeded
on the existing transaction pooler port 6543 and direct PostgreSQL
port 5432. This proves network reachability and certificate trust,
**not** role authentication, job approval or authority for dispatch.

The dedicated one-job connection source intentionally loads that
exact pinned public CA from the *container runtime* path
`/run/cst-onejob-dev-db/ca/prod-ca-2021.crt`. It is **not mounted**
in the original shared DEV container, whose stage URL/feature are also
disabled. Before any future authorized separate DEV backend promotion,
bind-mount the **public CA** read-only into that exact runtime path.
Do not copy or move private credentials as part of this CA prerequisite.

The authenticated Owner GET readiness endpoint now validates the
source-pinned CA **before opening the dedicated staging DB connection**.
If the runtime mount is missing, writable, a symlink, an invalid PEM,
or a fingerprint mismatch, it reports
`STAGING_PINNED_CA_NOT_INSTALLED_OR_INVALID` and remains NO-GO.
It never falls back to system trust, disables TLS verification,
tries shared-runtime DB credentials, or mistakes this for password failure.
The existing feature flags, locked role login, Operations signing root
and one-use real Owner approval remain independently required.
