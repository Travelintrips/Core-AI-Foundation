---
name: WP-03 Canonical Audit Log
description: Design decisions behind ai_audit_logs' tenant/actor columns, the logAudit backward-compat overload, and repository-driven auto-emission
---

- `ai_audit_logs` gained nullable `tenant_id`/`actor_type` columns rather than a new table; the separate Canonical Runtime Event Model (v4.0C) stays the eventual consolidation target (blueprint Phase 3), not done yet. Check `docs/blueprints/p0-audit-log-blueprint.md` before extending this further.
- Audit's actor-type vocabulary (`internal_user | customer | public_token | system | worker`) is deliberately coarser than and *different from* `RequestContext.ActorType` (9 values). Always map through `deriveAuditContext`/`toAuditActorType` in `services/audit/auditTypes.ts` — never store the raw RequestContext actorType in an audit row.
- `computeAuditDiff` (in `services/audit/auditRedaction.ts`) diffs raw before/after values FIRST, then redacts the changed keys — redacting before diffing would make two different secret values look identical (no detected change) and silently hide that a change happened at all.
- `logAudit` supports two calling conventions on purpose: the original positional signature (do not break — ~40 call sites) plus an object-style overload. The object overload's existence is what fixed 3 pre-existing type errors elsewhere that already called it as an object; extending a shared service to fix downstream call-site bugs (without touching those files) is an established, disclosed pattern here — see also `admin-auth-canonical-pattern.md`.
- Audit-log immutability is enforced by never having an update/delete code path, plus explicit `updateAuditLog()`/`deleteAuditLog()` exports that always throw — so a future dev reaching for "edit an audit row" hits a documented refusal instead of a missing symbol or a silently-added mutation.
- Repository-driven auto-audit lives in a new standalone `repositories/auditHook.ts`, never inside `repositories/types.ts`/`tenantScope.ts` — keeps foundation files owned by their original work package untouched while still giving every migrated domain repo one-line audit wiring per write method.
