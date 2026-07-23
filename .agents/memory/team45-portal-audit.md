---
name: team45-portal-audit
description: Team 45 customer portal consistency audit — bugs found and fixed, test locations
---

## Bugs Fixed in Customer Portal (2026-07-23)

**Why:** status-badge/stageColor/dashboard had critical field-name and status-mapping bugs causing blank/incorrect UI.

### 1. `status-badge.tsx` — Only 5 project statuses handled
Before: only `pending/running/generating_document/generating_presentation/completed/failed`.
After: 35+ canonical stages mapped. Key additions: `workflow_completed→"Preparing Files"`, `deliverable_ready→"Files Ready"`, `files_unlocked→"Files Unlocked"`, `order_completed→"Completed"`, all commercial gate stages.

### 2. `workspace-format.ts` — stageColor/stageLabel gaps
Both functions now cover the full canonical lifecycle. Color tiers: emerald=complete, violet=preparing, amber=action-needed, blue=payment-verification, orange=production, sky=pre-production.

### 3. `dashboard.tsx` — Wrong field names (CRITICAL)
`WorkspaceProject` recent-projects map used `p.id/title/status/stage/progress` — none exist.
Fixed: `p.projectNumber/brandName/currentStageLabel/currentStage/progressPercent`.

### 4. `project-detail.tsx` — getInsight showed "Project Complete" when files locked
Added `filesUnlocked` guard: completed+locked→warning banner, completed+unlocked→success banner.
New insight states for `files_unlocked`, `deliverable_ready`, `commercial_completed`, `workflow_completed`.

### 5. `downloads.tsx` — null-check `d.category.toUpperCase()` → `(d.category ?? "").toUpperCase()`

### 6. `workspace-layout.tsx` — invalid `t()` second arg (string instead of vars object)

### 7. `i18n.tsx` — `enLocale as unknown as Translations` to fix literal-type mismatch

### 8. `locales/id.ts` + `locales/en.ts` — added `brandIntelligence` nav key

## Tests
`artifacts/customer-portal/src/__tests__/team45-regression.test.ts` — 43 tests, all passing.
430 total tests in customer-portal all pass.

## Branch
`team-45/customer-portal-consistency` — committed locally, push requires GitHub token.

**How to apply:** Run `git push origin team-45/customer-portal-consistency` after setting up GitHub token via git-remote skill.
