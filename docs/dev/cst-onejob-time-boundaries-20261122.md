# CST-DEV one-job: separate Owner approval, database lease and job execution

**Source-only change; no operational authorization.** PROD, live LOGIN,
signer, broker, dispatcher activation and database migrations are out of scope.

## What was fixed

1. **Super Admin click after login.** The explicit one-job approval action no
   longer requires that the existing signed application session was issued
   within the previous 20 minutes. The normal 12-hour signed session still
   must be unexpired, with numeric user ID, active internal Owner role verified
   from the database, correct DEV same-origin, exact click intent and pinned
   candidate fingerprint. Wrong role, expired session, long-lived forged JWT,
   different user and extra request fields are denied. No extra OTP is minted.
2. **Healthy job continuation.** The exact single-job CST-DEV remote model
   pilot is not marked failed solely because `started_at` is old. Both the
   dispatcher recovery query and remote Ollama recovery query exclude it
   only while the specifically claimed worker has a valid live lease,
   matching current job, fresh 60-second heartbeat, expected DEV identity
   and runtime model, and `busy` status. On heartbeat loss, expired lease,
   offline status or missing/mismatched ownership, normal recovery resumes.
   All other jobs and production behavior retain existing timeouts.
3. **Technical LOGIN permit.** The Gate A preapproval manifest still has a
   maximum 10-minute technical scope. Its expiry is **not** a limit on how
   long the human can decide or on how long a separately running job can
   continue. The independent watchdog/relock is still necessary for
   residual database sessions if the VPS dies.

## Known limitation not waived

The currently persisted `cst_onejob_owner_approvals` entry has a 20-minute
`expires_at`. The CST-DEV DB CHECK constraint currently also requires
`expires_at <= approved_at + interval '30 minutes'`. The independent QA
admission/signed approval checks still enforce that expiration. This turn did
**not** silently extend or bypass it, since that would change a one-use
authorization boundary requiring separate schema/transaction review.
A previously staged WAITING approval that expires before admission is NOT
automatically treated as new consent.

The remote Ollama invocation's own 50-second model-call bound also remains
unchanged for this source-only change. The 20-minute PostgreSQL disposable
test proves recovery will not falsely kill an otherwise healthy synthetic
pilot job on age alone; it is not proof that a live model call can run for
20 minutes without an application-level timeout.

## Evidence / gates

- Owner click with 21-minute, 4-hour and 11-hour **still-valid** signed app
  sessions: accepted in isolated tests; future/expired/wrong role/forged and
  >12-hour-lifetime sessions: denied.
- PostgreSQL 16 disposable, network none: 20-minute synthetic pilot job
  with fresh worker heartbeat/lease was excluded from age recovery; stale
  heartbeat, expired lease and offline worker were recoverable; PROD SQL
  branch and unrelated jobs unchanged.
- Watchdog boot candidate has no installed unit and requires missing
  independent approval, scoped credentials, verified namespace and runner.
- All source tests remain **NO-GO operational** until independently approved
  credentials, Supavisor draining, real authenticated WAITING admission and
  independent Final ACK are demonstrated.
