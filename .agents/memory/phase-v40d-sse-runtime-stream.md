---
name: phase-v40d-sse-runtime-stream
description: V4.0D SSE transport layer — shared poller, base64url cursor, connection limits, frontend hook
---

# V4.0D SSE Runtime Stream

## Key Files
- `artifacts/api-server/src/services/sseManager.ts` — shared poller registry, fan-out, limits, graceful shutdown
- `artifacts/api-server/src/routes/customer-workspace-sse.ts` — SSE endpoint
- `artifacts/customer-portal/src/hooks/use-runtime-event-stream.ts` — frontend SSE hook + mergeEvents helper
- `artifacts/customer-portal/src/components/sse-connection-indicator.tsx` — connection status badge
- `artifacts/customer-portal/vitest.config.ts` — added for frontend tests
- Tests: `artifacts/api-server/src/services/__tests__/sseManager.test.ts` (80 pass), `artifacts/customer-portal/src/hooks/__tests__/use-runtime-event-stream.test.ts` (10 pass)

## Cursor Design
- Cursor = base64url-encoded JSON `{ createdAt: string, eventId: string }`.
- SSE `id:` field carries the encoded cursor — NOT the raw canonical eventId.
- Canonical eventId stays inside the data payload only.
- Ordering: createdAt ASC → eventId lexicographic ASC (tiebreaker for same-timestamp events).
- Reconnect: browser sends Last-Event-ID header → server decodes cursor → sends only missed events.

## SSE Endpoint
- Route: GET /public/customer/workspace/:token/projects/:projectNumber/events/stream
- Security: token validated via resolveWorkspaceSession; project ownership via getProjectDetail (server-side only, no client-supplied internalProjectId).
- Headers: Content-Type: text/event-stream, Cache-Control: no-cache no-transform, X-Accel-Buffering: no, Connection: keep-alive.
- Terminal project: sends snapshot + stream.complete then closes (no reconnect loop).
- No runtime linkage (internalProjectId null): empty snapshot + heartbeat only.

## Shared Poller (sseManager.ts)
- One ProjectChannel per projectId UUID in module-level Map.
- Channel: pollTimer (setInterval), knownEventIds (bounded Set max 2000, trim to 1000), Set<Subscriber>.
- Poll interval: SSE_POLL_INTERVAL_MS env (default 3000ms, min 2000ms).
- Fan-out: all subscribers of a project in one poll → no N×DB queries.
- Channel removed when last subscriber disconnects.

## Connection Limits (all env-configurable)
- SSE_MAX_CONNS_PER_IP = 10, SSE_MAX_CONNS_PER_TOKEN = 5, SSE_MAX_SUBS_PER_PROJECT = 20
- SSE_IDLE_TIMEOUT_MS = 300000 — warns then closes. Heartbeat every 20s.

## Frontend Hook
- Fallback to REST polling after 5 failed SSE reconnects (FALLBACK_POLL_INTERVAL_MS = 12s).
- mergeEvents(existing, incoming): dedup by eventId, sort by createdAt+eventId ASC. Exported and tested.
- stream.complete: sets isCompletedRef=true — no reconnect loop for finished projects.
- Tab visibility + online/offline events trigger reconnect/fallback switching.
- Stale detection: 60s silence → isStale=true.

## Workspace Integration (project-detail.tsx)
- SSE events invalidate workspace-project-detail React Query (refreshes runtime snapshot).
- SSE canonical events → WorkspaceActivity format → merged with REST activity feed (dedup by resourceId).
- SseConnectionIndicator shown in AI Intelligence panel header + mobile toggle button.

## Graceful Shutdown
- sseManager.shutdown() called first in SIGTERM/SIGINT handlers in index.ts (before dispatcher/scheduler).

**Why:** shared poller must be a module-level singleton; route handlers just register/deregister. Cursor encodes both timestamp and eventId to handle same-timestamp events safely — comparing only timestamps loses events.
