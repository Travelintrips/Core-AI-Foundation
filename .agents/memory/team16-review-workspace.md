---
name: Team 16 — Review Workspace
description: Universal design review and approval workspace built on top of existing creative_ai_client_reviews system.
---

# Team 16 — Review Workspace

## Architecture decisions

**No second token system or review DB.** Extends `creative_ai_client_reviews` + `creative_ai_client_comments`. One new table `ai_platform.ai_review_workspace_meta` (idempotent DDL in service init, not drizzle-kit push).

**Checklist**: Config-driven registry in `reviewWorkspaceService.ts` via `registerChecklistItems()` / `getChecklistDefs()`. Items stored as JSONB in `checklist_state` column. Core items are always included; domain-specific items filtered by `domain` field.

**Status mapping**: Canonical DB statuses unchanged. Workspace layer adds display aliases computed at read time: `not_shared/shared → pending`, `viewed → in_review`, `revoked+cancelReason → canceled`, `newer review exists → superseded`.

**Cancel = revoked**: Cancel decision maps to `status=revoked` + reason stored in `ai_review_workspace_meta.cancel_reason`. CAS-style update (only transitions non-terminal reviews).

**Token isolation**: `reviewTokenHash` and `reviewTokenPlain` are stripped in `serializeReview()` — never exposed via workspace routes.

**Admin auth**: All workspace routes are protected by `adminAuthWithExceptions` at the app level (no per-route middleware needed). Rate-limited by `clientReviewLimiter`.

## Key files

- `lib/db/src/schema/ai-review-workspace-meta.ts` — Drizzle schema
- `artifacts/api-server/src/services/reviewWorkspaceService.ts` — all business logic
- `artifacts/api-server/src/routes/review-workspace.ts` — 8 HTTP endpoints
- `artifacts/ai-platform/src/hooks/use-review-workspace.ts` — React Query hooks
- `artifacts/ai-platform/src/components/review-workspace/` — 8 components + index
- `artifacts/ai-platform/src/pages/review-workspace.tsx` — admin page at `/review-workspace/:reviewId`

## Test pattern

Uses `vi.hoisted()` for mock data fixtures referenced in `vi.mock()` factory. Mocks `reviewWorkspaceService.js` entirely (not `@workspace/db` directly).

## Permissions model

8 granular permissions: `can_approve`, `can_reject`, `can_request_revision`, `can_sign_off`, `can_remove_sign_off`, `can_cancel`, `can_set_due_date`, `can_manage_checklist`.

ACTIONABLE statuses for client-facing decisions: `shared`, `viewed` (not expired).
TERMINAL statuses (no workspace actions): `approved`, `rejected`, `revoked`.

**Why:** Terminal state guard prevents double-decision and sign-off leakage; permission set is computed live from DB status + meta, not cached.

## lib/db rebuild rule

After adding new schema files to `lib/db/src/schema/`, run `cd lib/db && npx tsc -b` before api-server typecheck — otherwise the new exports are not visible.
