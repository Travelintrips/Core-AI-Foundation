# DEV terminal callback fanout replay

Continuation of issue #1359 after the atomic command/response change in PR #1360.

## Active integration

A separate bounded DEV worker installs an AFTER INSERT trigger on the existing
`ai_platform.ai_coding_bridge_responses` table. Terminal response inserts queue
`CHAT_INBOX` and `MCP_EVENT_QUEUE` projections in the SAME PostgreSQL transaction.
The trigger runs with the caller's existing privileges; no grants, RLS changes,
credential changes, or SECURITY DEFINER functions are introduced.

The existing active callback handler remains the source of truth. Its immediate
fanout and the replay worker can overlap safely because Inbox uses unique
`response_id` and MCP deliveries use the stable subscription/response event ID.
The worker neither changes command status nor acknowledges a user's event.

Startup/reconnect drains durable pending work. LISTEN/NOTIFY wakes the worker for
new work. A persisted retry or lease-expiry deadline installs a bounded timer;
an empty queue does not poll. Competing workers use SKIP LOCKED and a fenced
claim token. Expired claims can resume. After eight failed attempts the ledger
retains BLOCKED work for investigation; no job or response is deleted.

`PROJECTED` means inserted/reconciled into an internal destination, NOT receiver
ACK, browser delivery, or ChatGPT session ownership. A zero-count MCP enqueue
may mean no matching active webhook subscription; OAuth Inbox still reads the
canonical stored response. WA and GitHub external resends are deliberately not
part of this worker because they need provider-side idempotency/receipt handling.
No historical response is backfilled automatically during installation.

## Deployment

Only after this exact commit passes CI, extract it to a new release directory.
Set `AI_CORE_DEV_IMAGE` to the verified immutable image of the current DEV API
(`core-ai-dev:vps-<sha>`). Run the compose file from that release directory:

    docker compose -p cst-dev-replay -f deploy/ai-workers/docker-compose.dev-bridge-fanout-replay.yml up -d

The code mounts read-only into an isolated worker using the application's existing
TypeScript dependencies. It does not rebuild, stop, or replace API/PROD containers.
It uses the existing dedicated DEV environment file, two ordinary DB connections
and one session LISTEN connection. The runtime rejects production mode, a disabled
flag, an unknown project reference, or a non-DEV database URL before DB access.
Health is private loopback port 18096. No host port or Docker socket is exposed.

To install the transactional queue before starting its consumer, use the same
compose service with `--install-only` as the script argument. This permits a
controlled callback-commit/consumer-offline recovery test. Stopping the replay
container leaves committed work durable. Restart resumes it; a source row and its
queue rows remain intact. Stopping this worker is not a substitute for testing DC
or ChatGPT timeout, and no such test is claimed here.

## Verification

`DEV Bridge Fanout Replay` runs a real PostgreSQL 16 fixture on loopback. The
fixture refuses any hostname other than loopback and any database name other than
`dev_bridge_replay_test`. It proves source/outbox rollback, concurrent exclusive
claims, actual child-process exits before/after destination commit, replay after
lease expiry, rejection of stale claims, and durable retention after exhausted
retries. Destination uniqueness is asserted, not inferred from a model reply.

Live DEV acceptance separately requires a correlated real source response,
pending rows while the consumer is stopped, two PROJECTED rows after restart,
exactly one Inbox row for the response, and observed OAuth read then ACK. These
facts cover this projection boundary, not FULL E2E across all continuity scenarios.
