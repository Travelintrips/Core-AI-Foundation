# DEV ChatGPT progress deadlines

The prior browser wake route could submit a confirmed manual event, but no live
service detected missed ChatGPT progress checkpoints. The continuity service now
connects a durable, explicitly registered job deadline to that existing wake path.

## Authorization and operation

The service runs only with `APP_ENV=development`, non-production `NODE_ENV`, and
`AI_CORE_DEV_CONTINUITY_ENABLED=true`. Existing browser wake enablement, owner
channel allowlist, conversation pairing and pinned Travelintrips DEV worker are
checked again before dispatch. The isolated gateway derives the owner channel
from its verified OAuth principal; no protocol field can choose another owner.

Send these exact messages through `send_ai_core_command`. Registration and
checkpoint updates require `confirmed=true`; status is read-only. IDs are UUIDs,
the checkpoint is a full 40-character Git SHA, and revision is the current version
returned by registration/status.

```text
DEV_CHATGPT_WATCH_V1 conversation=<uuid> job=<uuid> checkpoint=<sha> idle=180 ttl=900
DEV_CHATGPT_CHECKPOINT_V1 job=<uuid> revision=1 checkpoint=<sha> state=RUNNING
DEV_CHATGPT_WATCH_STATUS_V1 job=<uuid>
```

`idle` is 60–3600 seconds. `ttl` must exceed `idle` and cannot exceed 86400 seconds.
Registration is passive and idempotent for owner/job; retries do not reset its
deadline, expiry, revision or lifetime wake budget. The parent job represents
external ChatGPT work and does not create a coding task or invoke a coding model.

A `RUNNING` checkpoint moves the progress deadline. `WAITING_CI` and
`WAITING_APPROVAL` pause wake detection until a new checkpoint. `COMPLETED` and
`CANCELLED` terminate the watch. A claim already in `FIRING` or `WAKE_QUEUED` must
be reconciled before accepting a checkpoint, so progress and wake dispatch cannot
race. Terminal watches are not reopened; a separately authorized new job needs a
new identifier.

## Durable detection and evidence

The service uses one timer per registered job, with bounded startup restoration.
It has no new periodic global scanner. Passive `DEV_CONTINUITY_WATCH` bridge
records are excluded from worker claim, renewal and completion. A due deadline
atomically persists `PROGRESS_DEADLINE_EXPIRED`, revision, lease and deterministic
event before queueing a child wake. Concurrent replicas and crash recovery reuse
that event; child uniqueness and the browser receipt guard against duplicate sends.

Each watch permits at most three wakes across separate progress revisions. A
worker callback does not automatically initiate another wake. Expired watch child
commands cannot be claimed. Callback persistence has bounded event-driven retries;
status/checkpoint reads and startup restore reconcile the exact committed child
response without dispatching a replacement.

A missed checkpoint is evidence of absent reported progress. The OpenClaw helper
still checks the exact paired URL, active response and composer before sending.
A busy browser, draft or uncertain submission is surfaced as blocked/unverified;
the service never clears a draft, presses Stop, or blindly retries a browser send.

`browserDelivered` requires validated worker delivery evidence. It is separate
from `verifiedAssistantReply` and `workCompleted`. An independently observed
assistant response to the correlated browser wake is also valid wake evidence;
a queue ACK or process exit alone is not. Only a completion checkpoint closes the
tracked work as completed.

## DEV rollout

1. Complete PR `CI Verify`, then successful `develop` push runs of both `CI Verify`
   and `DEV Fast Verify` for the same exact commit.
2. Release the backend through the existing isolated DEV release process. Keep
   continuity disabled until its narrowly scoped database policy is approved and
   installed. Existing browser wake permissions remain unchanged.
3. Rebuild the dedicated gateway overlay with `BASE_IMAGE=core-ai-dev:vps-<sha12>`
   and `BUILD_SHA=<full-sha>`. The ordinary backend release does not update it. The
   new image must contain `devChatGptContinuityProtocol.ts`; preserve its OAuth
   credentials and DEV-only relay configuration.
4. Apply the separately reviewed DEV-only passive watch INSERT policy only after
   explicit scoped approval under the canonical communication SOP security gate.
   Existing runtime RLS permits executable worker commands but not the new passive
   record type. Do not relabel a watch as executable work to bypass that boundary.
5. Set only `AI_CORE_DEV_CONTINUITY_ENABLED=true` in the isolated backend. Startup
   restores bounded owner-scoped deadlines even when general DEV background
   workers are disabled. Setting the flag false and restarting stops the service.

The migration is manual and has no startup application hook. It adds no role,
table grant or PROD change. Its rollback removes only the named passive INSERT
policy; retained watch/receipt evidence is preserved.

## Live acceptance test

Register one paired canary with the deployed commit as its checkpoint. Do not send
a manual `DEV_CHATGPT_WAKE_V1` for that job. Let its progress deadline elapse, then
match the durable detection timestamp, child event/command, authenticated callback,
browser user turn and subsequent assistant response. Finish or cancel the canary
using its current revision after its result is reconciled. Component/CI results
do not substitute for this live evidence chain.
