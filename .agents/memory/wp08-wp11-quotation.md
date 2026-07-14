---
name: WP-08/09/10/11 Quotation domain
description: Implementation decisions for the quotation repository, soft-delete, cascading, restore, compatibility adapter, and legacy freeze.
---

# WP-08 – WP-11 Quotation Domain

## Decisions

### Soft-delete (WP-09)
- `deleted_at` / `deleted_by` added to all three quotation tables (ai_quotations, ai_quotation_items, creative_project_quotations).
- DDL: `artifacts/api-server/src/scripts/ddl-wp09-quotation-soft-delete.sql` — run once per env (additive, idempotent IF NOT EXISTS).
- `creative_project_quotations` is in the `public` schema (not `ai_platform`) — use unqualified table name in the DDL.
- ai_quotation_items schema file needed `timestamp` added to its drizzle-orm/pg-core import (it was missing before WP-09).

### Repository (WP-08)
- All write methods auto-emit audit via `void logAudit(...)` (fire-and-forget, TEAM A's existing hook, unchanged).
- Actor type `internal_user` does NOT exist in the `ACTOR_TYPES` union (requestContext.ts is frozen). The restore role guard uses `tenant_admin | platform_admin | system | worker | scheduler` instead.
- `RepositoryContext` must be imported from `types.js` in the adapter, NOT re-exported from `quotationRepository.ts` (it's not exported from there).

### Cascading soft-delete (WP-10)
- Order: items first, then parent (within same transaction) to match FK semantics.
- Items have no `updatedAt` column — do NOT include it in the `.set()` call.
- Restore does NOT auto-restore items (avoids surprising resurrection of business state).

### Legacy freeze (WP-11)
- PUT `/creative-ai/projects/:projectId/quotation` returns 410 Gone when no existing row.
- Pre-freeze draft rows can still be edited (updated), so existing projects aren't stranded.
- HTTP 410 (not 403) signals the creation path is permanently gone.

### aiQuotationService migration
- `createQuotation` routes through repo when `opts.tenantId` is present (uses `adaptLegacyTenantContext` to make a system RequestContext).
- No-tenantId path keeps direct insert for backward compatibility.
- No external API change (same function signature).

### Compatibility adapter
- `resolveQuotationForProject(ctx, { projectId, canonicalId? })` — primary resolver.
- Legacy status mapping: `sent→issued | approved→approved | rejected→rejected | expired→expired | draft→draft`.
- Items only available for canonical lineage; legacy items are JSONB on parent row.

### Tests (vitest)
- Use `vi.hoisted(() => ({ ... }))` for mock functions referenced inside `vi.mock()` factory closures — the factory is hoisted before variable assignments run.
- 18 new test cases, all passing without a real DB connection.
