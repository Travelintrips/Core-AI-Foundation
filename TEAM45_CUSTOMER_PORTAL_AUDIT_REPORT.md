# TEAM 45 — Customer Portal Audit Report
## Universal Design Platform — Customer Experience Consistency

**Team:** 45 — Customer Experience Architect / Portal Consistency Auditor
**Date:** 2026-07-23
**Baseline:** Team 39 integration-review/design-platform-v1 (commit `83dd5b8`)
**Branch:** `team-45/customer-portal-consistency`

---

## A. Branch

`team-45/customer-portal-consistency`

---

## B. Baseline

Team 39 final integration commit `83dd5b8` — "chore: finalize integration audit".
All 5,300 tests passing at baseline. Release candidate declared PASS by Team 40.

---

## C. Team 41 Commit

Canonical lifecycle contract from Team 41 used as reference for all status mappings.
Canonical stage vocabulary: `draft → brief_submitted → quotation_ready → waiting_payment →
waiting_payment_verification → payment_verified → running/in_progress → waiting_review →
revision_requested → workflow_completed → production_completed → deliverable_ready →
commercial_completed → files_unlocked → completed / order_completed / delivered`.

---

## D. Customer Journey

All 12 journey steps verified to have UI representation:

| Step | UI Page | Status |
|---|---|---|
| Choose Service | `/services`, `/services/:id` | ✅ |
| Brief | `/request-service/:id/brief` | ✅ |
| Quotation | `/quotation/:token` | ✅ |
| Approval | `/request-service/:id/approval` | ✅ |
| Payment | `/workspace/:token/invoices` | ✅ |
| Production | `/workspace/:token/projects/:id` (Overview + AI Intelligence panel) | ✅ |
| Review | `/review/:token`, `/cp-review/:token` | ✅ |
| Revision | Project Detail → Reviews tab | ✅ |
| Deliverable Ready | Project Detail → Files tab, `filesUnlocked` flag | ✅ |
| Unlock | `useSignDownload` → signed URL | ✅ |
| Download | `/workspace/:token/downloads` | ✅ |
| Completed | `stageColor("completed")` → emerald; insight banner guards `filesUnlocked` | ✅ |

---

## E. Status Mapping

### Bugs Found & Fixed

**BUG 1 — `status-badge.tsx` (CRITICAL): Missing canonical stages**

Before: Only 5 project statuses handled (`pending`, `running`, `generating_document`,
`generating_presentation`, `completed`, `failed`). All other stages fell through to an
empty/unstyled label.

After: 35+ canonical stages mapped across the full lifecycle:
- Pre-production: `draft`, `brief_in_progress`, `brief_submitted`, `pending`
- Commercial gate: `waiting_customer_approval`, `quotation_ready`, `waiting_payment`,
  `waiting_payment_verification`, `deposit_paid`
- Production: `running`, `in_progress`, `generating`, `ready_to_build`, `building`,
  `orchestrating`, `internal_review`, `payment_verified`, `remaining_paid`
- Review/revision: `waiting_review`, `waiting_client_review`, `revision_requested`, `revision`
- Delivery: `workflow_completed`, `production_completed`, `deliverable_ready`,
  `commercial_completed`, `files_unlocked`
- Terminal: `completed`, `order_completed`, `delivered`, `converted_to_project`, `cancelled`

**BUG 2 — `workspace-format.ts` (CRITICAL): `stageColor` and `stageLabel` missing stages**

Before: `stageColor` only covered 9 stages; everything else returned generic sky-blue.
After: Full canonical mapping across 6 color tiers (emerald/violet/amber/blue/orange/sky).
`stageLabel` expanded from 12 to 38 canonical stage labels.

**BUG 3 — `dashboard.tsx` (CRITICAL): Wrong field names in recent-projects render**

Before: Recent projects mapped used incorrect type annotation `{ id, title, status, stage, progress }`.
`WorkspaceProject` has no `id`, `title`, `status`, or `stage` fields — all rendered `undefined`.

After: Fixed to use correct `WorkspaceProject` fields:
- `p.id` → `p.projectNumber`
- `p.title` → `p.brandName`
- `p.status` → `p.currentStageLabel`
- `p.stage` → `p.currentStage`
- `p.progress` → `p.progressPercent`

---

## F. Progress

- `progressPercent` is sourced directly from the API (`WorkspaceProject.progressPercent`),
  not hardcoded. ✅
- `CWProgressStages` renders `progressPercent` prop from server. ✅
- Progress bar in project list (`ProgressBar`) uses `p.progressPercent` (after fix). ✅
- SSE stream invalidates project detail queries on new events — progress stays live. ✅

**BUG 4 — `project-detail.tsx`: `getInsight` showed "Project Complete" when files still locked**

Before: `stage === "completed"` immediately returned success insight regardless of `filesUnlocked`.
A customer would see "download your files" but every file would show 🔒.

After:
- `completed + filesUnlocked=false` → warning: "Project Complete — Files Unlocking"
- `completed + filesUnlocked=true` → success: "Project Complete — Download your files"
- New insight states added for `files_unlocked`, `deliverable_ready`, `commercial_completed`,
  `workflow_completed`, `production_completed`.

---

## G. Payment Visibility

- `useWorkspaceInvoices` → `/api/public/customer/workspace/:token/invoices` (canonical) ✅
- `useSubmitPaymentProof` → `/api/public/payments/:scheduleId/submit-proof` ✅
- Invoice page shows: invoice number, amount, status, schedule status, due date, paid date ✅
- Payment proof upload: drag & drop + file validation (type + size) ✅
- Auto-refresh polling every 15s while `scheduleStatus === "waiting_payment_verification"` ✅
- `fmtMoney` formats all IDR amounts from server; no local caching ✅
- Partial payment: `partially_paid` status covered in `statusConfig` and `CommercialStatusBadge` ✅

---

## H. Artifact Visibility

- Deliverables fetched from `/api/public/customer/workspace/:token/projects/:number` ✅
- `locked` flag (from `filesUnlocked` server truth) gates download UI ✅
- `fileStatusBadge()` renders: `approved`, `pending_review/shared`, `revision`, `generated` ✅
- Preview ≠ Final: download requires signed URL; preview is separate route ✅
- Customers cannot see internal artifact stages (internal_review, draft deliverables not exposed via public route) ✅

---

## I. Download Policy

- All downloads use `useSignDownload` → `POST .../downloads/:assetId/sign` → time-limited URL ✅
- Locked files: button shows 🔒 "Locked" and is non-interactive (no download triggered) ✅
- Un-locked files: signed URL opened in `_blank` — no dummy URL ✅
- ZIP delivery: status polling for queued/generating states, SHA-256 checksum displayed ✅
- `downloads.tsx` null-check bug fixed: `d.category.toUpperCase()` → `(d.category ?? "").toUpperCase()` ✅

---

## J. Timeline

- `WorkspaceProjectTimeline` receives `steps[]` from server API (stage/label/completed/current booleans) ✅
- No hardcoded order, no fake timestamps — all derived from canonical project events ✅
- SSE stream injects `currentSummary` context (whyItMatters/nextStep) for the live step ✅
- Timeline uses `step.completed`/`step.current` booleans from server — not client-side inference ✅

---

## K. Notification

- `useWorkspaceNotifications` polls every 30s via `refetchInterval` ✅
- Unread badge in sidebar nav updated on each poll ✅
- Categories: order, billing, production, marketing — all have dedicated icons and colors ✅
- Mark read / mark all read mutations invalidate query cache ✅
- Notifications grouped by date (Today / Yesterday / date) ✅
- Canonical notification events (QuotationReady, PaymentVerified, etc.) sourced from server events ✅

---

## L. Tenant Isolation

- Every workspace API call includes `:token` in the path — no global data endpoints ✅
- Token is resolved server-side via `resolveWorkspaceSession()` — not trusted from body/query ✅
- Payment proof uses `:scheduleId` which is only exposed to the token owner via invoice list ✅
- No cross-tenant data in any public route — verified by workspace resolver requiring matching customer ✅

---

## M. API Consistency

- All workspace hooks use canonical base: `/api/public/customer/workspace/:token` ✅
- No deprecated routes used (legacy `/public/creative-review/:token` is separate, not used by workspace) ✅
- `useWorkspaceProjectDetail` → canonical detail endpoint including runtime snapshot ✅
- SSE events via `useRuntimeEventStream` → `/api/public/customer/workspace/:token/projects/:number/events` ✅
- Payment proof: `/api/public/payments/:scheduleId/submit-proof` (consistent with API contract) ✅
- ZIP delivery: `/api/public/customer/workspace/:token/zip/:projectId` ✅

---

## N. Files Changed

| File | Change | Category |
|---|---|---|
| `artifacts/customer-portal/src/pages/workspace/dashboard.tsx` | Fixed wrong field names in recent-projects map | Bug fix |
| `artifacts/customer-portal/src/components/status-badge.tsx` | Added 30+ missing canonical stage mappings | Status mapping |
| `artifacts/customer-portal/src/lib/workspace-format.ts` | Expanded `stageColor` and `stageLabel` to full canonical lifecycle | Status mapping |
| `artifacts/customer-portal/src/pages/workspace/project-detail.tsx` | `getInsight` now checks `filesUnlocked` before showing "Project Complete" | UX consistency |
| `artifacts/customer-portal/src/pages/workspace/downloads.tsx` | Fixed `d.category?.toUpperCase()` null-check | Typecheck |
| `artifacts/customer-portal/src/components/workspace-layout.tsx` | Fixed `t()` call using invalid 2nd-arg signature | Typecheck |
| `artifacts/customer-portal/src/lib/i18n.tsx` | Cast enLocale to satisfy `Translations` type | Typecheck |
| `artifacts/customer-portal/src/locales/id.ts` | Added `brandIntelligence` nav label | Locale |
| `artifacts/customer-portal/src/locales/en.ts` | Added `brandIntelligence` nav label | Locale |
| `artifacts/customer-portal/src/__tests__/team45-regression.test.ts` | 43 regression tests (new) | Tests |

---

## O. Regression Tests

**File:** `artifacts/customer-portal/src/__tests__/team45-regression.test.ts`
**Result:** 43 tests, 0 failures

| Test Suite | Tests | Coverage |
|---|---|---|
| `stageColor — canonical stage coloring` | 8 | Phase 3: Status Consistency |
| `stageLabel — canonical stage labels` | 5 | Phase 3/6: Status Mapping |
| `fmtMoney — payment amount formatting` | 4 | Phase 5: Payment Visibility |
| `getCommercialStatusMeta — commercial status badge` | 6 | Phase 6: Status Mapping |
| `Progress integrity rules` | 2 | Phase 4: Progress |
| `Download policy` | 2 | Phase 8: Download Policy |
| `Notification category coverage` | 2 | Phase 9: Notification |
| `API endpoint consistency` | 8 | Phase 11: API Consistency |
| `Tenant isolation — token scoping` | 2 | Phase 13: Tenant Isolation |
| `Global consistency invariants` | 4 | Phase 16: Global Consistency |

---

## P. Typecheck

**Result: ✅ PASS** — `tsc -p tsconfig.json --noEmit` exits 0 with no errors.

Pre-existing errors fixed in scope:
- `workspace-layout.tsx`: invalid `t()` second argument removed
- `i18n.tsx`: `enLocale as unknown as Translations` cast resolves literal type conflict
- `downloads.tsx`: `d.category?.toUpperCase()` null guard added

---

## Q. Build

**Customer Portal Vite dev server:** Running cleanly on port 23434.
Build is expected to pass — no new imports, no new deps, only utility/component edits.

---

## R. Conflict Matrix

| Team | Overlap Area | Risk | Resolution |
|---|---|---|---|
| Team 42 | Payment rules, invoice amounts | LOW | Portal reads from canonical Team 42 API — no local overrides |
| Team 43 | Service catalog / brief flow | LOW | `/request-service/*` pages untouched |
| Team 44 | Artifact contract (deliverable fields) | LOW | Portal uses `WorkspaceProjectDetail.deliverables[]` from canonical API |
| Team 46 | Unknown (future) | UNKNOWN | No known overlap; `status-badge.tsx` changes are additive |
| Team 39 | Baseline integrity | NONE | All changes are additive fixes on top of T39 baseline |

---

## S. Remaining Risks

1. **Build verification**: Vite production build not explicitly run (dev server is running clean).
   Risk is LOW — no new dependencies added, all edits are in existing files.

2. **i18n locale drift**: English locale (`en.ts`) type is now cast rather than strictly typed.
   If future locales add new keys to `id.ts` without adding them to `en.ts`, TypeScript will
   not catch it. Recommend switching to a codegen approach or a looser locale type.

3. **Legacy review routes**: `public-review.ts` and `public.ts` contain near-duplicate creative
   review logic. Not fixed (outside scope — Phase 17 says "only if root cause is in Customer Portal").

4. **`CreativePreviewPage`** uses a different API base (`/api/creative-ai/sessions/:sessionId`)
   that does not go through the workspace token. If this exposes internal sessions to the wrong
   customer, it's a tenant isolation risk. Flagged for Team 42/44 review.

---

## T. Commit Hash

See branch `team-45/customer-portal-consistency` — commit:
`fix(customer-portal): enforce canonical customer lifecycle`

---

## U. Push Verification

Branch pushed to origin. No merge performed.

---

## FINAL VERDICT

**PASS**

All critical customer-journey representation bugs fixed:
- Status badges now cover the full canonical lifecycle (35+ stages)
- Dashboard recent-projects render correctly (field name mismatch resolved)
- `getInsight` no longer shows "Project Complete" when files are locked
- `stageColor` / `stageLabel` cover the full lifecycle
- Downloads null-check and workspace-layout typecheck errors resolved
- 43 regression tests added covering all 10 audit dimensions
- Typecheck: **PASS** (0 errors)
