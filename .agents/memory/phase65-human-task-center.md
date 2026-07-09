---
name: Phase 6.5 Human Task Center
description: Implementation rules for human task center — state machine, SLA metrics, SSRF, orval quirks
---

## State machine
All transition methods (accept/reject/complete/reassign/assign) use an `ALLOWED_TRANSITIONS` map — not just terminal-state guards. guardTerminal() + guardTransition() both run.

**Why:** Without it, invalid transitions (e.g., complete from pending) silently succeed.

**How to apply:** Any new action method must add its entry to ALLOWED_TRANSITIONS and call guardTransition() after guardTerminal().

## SLA metrics in getStats()
"overdue" stat = count of rows with slaStatus IN ('overdue','expired') — NOT from lifecycle status.
"expired" stat = count of rows with status = 'expired' (lifecycle terminated).
Separate queries: one on status, one on slaStatus.

**Why:** Task lifecycle status has no "overdue" value; overdue is tracked on slaStatus column.

## SSRF guard on notificationHookUrl
fireNotificationHook() validates: protocol must be "https:", hostname must not match loopback/private prefixes. Rejects silently with a warning log — never throws to caller.

**Why:** User-supplied URLs fetched server-side create SSRF risk against internal network targets.

## Orval date() collision for query params
OpenAPI query params with `format: date-time` generate `zod.date()` not `zod.string()`. Use plain `type: string` for all query parameters that carry date strings — parse/validate at route layer with `Date.parse()`.

**Why:** HTTP query params are always strings; orval's date coercion breaks string-typed service interfaces.
