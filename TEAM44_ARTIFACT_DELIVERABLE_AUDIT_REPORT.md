# TEAM44 ARTIFACT & DELIVERABLE AUDIT REPORT

**Branch:** `audit/team-44-artifact-deliverable`  
**Base commit:** `a7cea50`  
**Team 41 commit used:** `a7cea50` (base — Team 41 report files present on main)  
**Date:** 2026-07-23  
**Auditor:** Team 44 — Artifact Architecture & Deliverable Integrity  
**Verdict:** PASS WITH NON-BLOCKING RISKS

---

## A. Baseline

| Metric | Value |
|--------|-------|
| Test files | ~90 |
| Tests | 5346 |
| Passed | 5346 |
| Failed | 0 |
| Skipped | 0 |
| Duration | ~37s |

Pre-existing typecheck errors (not from Team 44):
- TS6305 (lib/db/dist not built — needs `tsc -b` first)
- TS2322 in design-compatibility-adapter, goal-taxonomy (pre-existing)
- TS2367 in v42d-zip-delivery, team06-asset-intelligence (pre-existing)
- TS2345 in asset-intelligence, creative-marketplace, graphic-design (pre-existing)
- TS7006 in architecture-landscape (pre-existing)

No pre-existing failures in artifact/deliverable/storage/signed-URL/access tests.

---

## B. Artifact Inventory

| Artifact Type | Producer | Required For | Storage | Validation | Preview | Final | Access Policy | Risk |
|---|---|---|---|---|---|---|---|---|
| image | ReplicateProvider / UniversalRenderer | Branding, logo, illustration | Supabase Storage (`ai-assets` bucket) | validateArtifactRecord() | renderStage=preview | renderStage=final | filesUnlocked gate | RE-01/RE-02: noText overlay failure |
| document (PDF) | creativeDocumentWorkerService | Company profile, brand guide | Supabase Storage | storageObjectExists() | watermarked preview | storagePath required | filesUnlocked gate | AR-01: no completion guard |
| presentation (PPTX) | creativePresentationWorkerService | Pitch deck | Supabase Storage | storageObjectExists() | slide preview | storagePath required | filesUnlocked gate | Medium |
| ZIP bundle | zipDeliveryService | Final delivery package | `/project-zips/` path reference | manifest check | N/A | storagePath + status=completed | filesUnlocked + signed token | Dev: placeholder path |
| portfolio asset | portfolioStorageService | Demo portfolio | Supabase Storage (`ai-assets`) | size/type validation | preview.webp | original.{ext} | Public CDN (demo only) | Low |

**Note:** The ZIP delivery service stores a path reference (`/project-zips/…`) rather than uploading to real object storage in dev. This is a known dev limitation documented below (Section J).

---

## C. Deliverable Inventory

| Deliverable | Required Artifacts | Publish Condition | Customer State | Payment Condition | Versioning | Risk |
|---|---|---|---|---|---|---|
| Individual file (image/PDF/PPTX) | 1 completed asset with storagePath | status=completed + filesUnlocked | locked/available | filesUnlocked gate | version column on creative_ai_assets | Low after fix |
| ZIP bundle | All completed assets for project | zip.status=completed + storagePath | sign endpoint | filesUnlocked gate | ai_zip_deliveries rows | Placeholder path in dev |
| Preview view | Any asset | Always visible | always | None | renderStage=preview | Must not expose final URL |
| Watermarked preview | document/PDF | PDF generated | restricted | None | separate storage path | watermarkService fail-closed |

---

## D. Canonical Source of Truth

| Concept | Table / Column | Notes |
|---|---|---|
| Artifact record | `ai_platform.creative_ai_assets` | Primary artifact store |
| Artifact status | `creative_ai_assets.status` | pending\|generating\|completed\|failed\|approved\|rejected |
| Storage reference | `creative_ai_assets.storage_path` + `image_url` | storagePath = Supabase; imageUrl = may be external CDN |
| Render stage | `creative_ai_assets.render_stage` | legacy\|preview\|final |
| Deliverable | `ai_platform.ai_zip_deliveries` | ZIP bundles per project |
| Unlock state | `creative_projects.files_unlocked` (BOOLEAN) | Canonical gate — never compute from payment directly |
| Access grant | N/A — no separate grant table | filesUnlocked + valid signed token = access |
| Download audit | `ai_audit_logs` via `logAudit()` | Every access/denial logged |
| Version | `creative_ai_assets.version` + `parent_asset_id` | Self-referential versioning |

---

## E. Storage Architecture

- **Provider:** Supabase Storage (`ai-assets` bucket)
- **Path convention (new):** `demo-portfolios/{portfolioId}/{assetId}/original.{ext}`
- **Path convention (legacy):** `demo-portfolios/{brandSlug}/{role}-{timestamp}.{ext}`
- **Project assets:** `projects/{projectId}/…` (inferred from usage)
- **ZIP delivery:** `/project-zips/{projectId}/{name}.zip` — path reference only in dev; real upload would be needed in production
- **Verification:** `storageObjectExists()` available in `lib/supabaseStorage.ts` — used by creativeDocumentWorkerService and creativePresentationWorkerService; files.ts uses HTTP HEAD check
- **Private bucket:** `ai-assets` bucket — no hard-coded public URLs for private files
- **Signed URL mechanism:** HMAC-SHA256 tokens (SESSION_SECRET / ADMIN_API_KEY), 1-hour TTL, in-memory revocation set

---

## F. Artifact Validation

**New service created:** `artifacts/api-server/src/services/artifactValidator.ts`

Validates:
- ID valid (positive integer)
- projectId non-empty
- Asset type registered
- Status not in failure set (failed, rejected, error, cancelled, revoked)
- Storage reference non-null, non-empty, non-placeholder/demo
- For final promotion: storagePath (not just imageUrl) required
- renderStage ≠ "preview" for final promotion
- MIME type plausibility (via metadata.mimeType)
- fileSizeBytes > 0
- noTextOverlayFailed / overlayFailed flags rejected for final promotion

**Placeholder/demo detection:** `PLACEHOLDER_PATTERNS` regex array + `PLACEHOLDER_PATHS` string list covers: placeholder.com, via.placeholder.com, picsum, loremflickr, /demo/, /static/demo, /sample/, inline SVG.

---

## G. Versioning

- `creative_ai_assets.version` column (integer, default 1) provides version numbering
- `parent_asset_id` self-reference links versions in history chain
- `render_stage` distinguishes legacy/preview/final within a version
- Active version deterministic: callers query latest by `version DESC`
- Rollback: old versions remain; `active` flag on ai_asset_library manages active state for the library
- **Finding:** No duplicate active version constraint enforced in DB — scanner detects ambiguity if multiple versions exist with same type/category/status=completed

---

## H. Deliverable Publication

**New service created:** `artifacts/api-server/src/services/deliveryCompletionGuard.ts`

Implements canonical three-tier readiness:
1. `checkDeliverableReady(projectId)` — validates artifacts + storage verification
2. `checkFilesUnlocked(projectId)` — deliverable_ready + files_unlocked flag
3. `checkDeliveryCompleted(projectId)` — files_unlocked + completed ZIP with storagePath
4. `assertProductionCompletedEligible(projectId)` — AR-01 fix: ≥1 valid artifact required

**Key rules enforced:**
- Empty project → not ready
- All-failed assets → not ready
- Artifact validation failure → not ready
- No storage-verified asset → not ready
- filesUnlocked=false → not unlocked
- No completed ZIP → delivery not completed

---

## I. Preview Policy

- `render_stage = "preview"` assets are distinct from `render_stage = "final"` assets
- `validateArtifactRecord(..., { isFinalPromotion: true })` rejects preview-stage artifacts
- `deliverableAdapter.ts` explicitly omits `storagePath` and `imageUrl` from customer DTOs — only `signEndpoint` is exposed
- Watermark service (`watermarkService.ts`) is fail-closed: throws `WATERMARK_FAILED` rather than returning un-watermarked content
- Preview signed URL uses the same `signEndpoint` path — no separate final URL leak
- Customer portal sees: `locked` (boolean) and `downloadAvailable` (boolean) — preview URL not directly exposed

---

## J. Signed URL Security

**Existing implementation (`signedUrlService.ts`):**
- ✅ Server-side generation only
- ✅ HMAC-SHA256 signed (SESSION_SECRET / ADMIN_API_KEY)
- ✅ Short-lived (1-hour default, max 24h)
- ✅ Object key from DB (projectId embedded in token, projectId verified at access time)
- ✅ In-memory revocation set
- ✅ Audit logged on every access attempt
- ✅ Storage object HEAD-checked before redirect (Phase 1B in files.ts)

**Fix applied (arbitrary key injection — files.ts):**
- `POST /ai/files/generate-token` now validates that `fileUrl` is a known `imageUrl` or `storagePath` for the project's assets before minting a token
- Returns 403 `INVALID_FILE_URL` for arbitrary URLs
- Skips validation if project has no recorded assets (new project edge case)
- Audit logged as `token_denied_unknown_url`

**Remaining risk (low):** In-memory revocation set is cleared on process restart. Expired tokens are already rejected by TTL. Persistent revocation would require a DB table — acceptable for short-lived tokens.

---

## K. Unlock Policy

**Fix applied (B-02 — payments.ts):**
- `POST /ai/payments/project/:projectId/unlock` now requires **both** `unlockedBy` and `reason`
- Returns `400` with `"reason is required — every admin override must have an auditable justification"` if reason is empty
- Reason logged in audit: `logAudit("payments", "manual_unlock", ..., { unlockedBy, reason })`
- Admin override does NOT touch payment records — only `creative_projects.files_unlocked`
- Idempotent: returns `{ alreadyUnlocked: true }` if project already unlocked

**Access levels (distinct):**
- preview_access — always (locked=false in UI)
- final_download_access — filesUnlocked=true + valid signed token
- ZIP download — filesUnlocked=true + completed ZIP + signed token

---

## L. Access Grants

- No dedicated `access_grants` table exists — access is granted via `files_unlocked` flag + signed token
- `files_unlocked` is tenant-scoped (via creative_projects.id)
- Cross-tenant access not possible: token contains `pid` (internal numeric ID), verified at access time against DB
- Grant non-transferable: token is project-scoped (pid embedded)
- Revoked deliverable: `revokeToken()` adds token ID to in-memory deny-set
- Preview grant ≠ final access: separate signed URL required for final file

**Gap:** No `access_grants` table with expiry/scope/source_policy. Current model relies on token TTL (1h) + filesUnlocked flag. For higher auditability, a persistent access_grants table could be added (proposed as follow-up, not Team 44 scope to create payment data).

---

## M. Download Authorization

**`GET /public/files/access/:token` validation sequence:**
1. ✅ Parse HMAC token — reject malformed/tampered/expired/revoked
2. ✅ Load project by `pid` from token payload (authoritative from DB)
3. ✅ Check `files_unlocked = true` — 402 if locked
4. ✅ HEAD-check storage object — 404/410/503 on failure
5. ✅ Audit log access_granted / access_denied
6. ✅ 302 redirect to actual file URL

**Not allowed:**
- ✅ tenantId from body not trusted — projectId authoritative from DB
- ✅ Arbitrary storage path not accepted — URL comes from token payload (which is DB-validated at generation)
- ✅ Not distinguishing "not found" cross-tenant — returns 404 regardless
- ✅ No public URL sent directly — redirect only, with storage HEAD check first
- ✅ No 200 with empty URL

---

## N. Completion Guards

**New service:** `deliveryCompletionGuard.ts`

| Guard | Condition |
|---|---|
| `deliverable_ready` | ≥1 completed asset, passes validation, storage verified |
| `files_unlocked` | deliverable_ready + `files_unlocked=true` |
| `delivery_completed` | files_unlocked + completed ZIP with storagePath |
| `production_completed eligible` | ≥1 valid non-failed artifact (AR-01 fix) |

`commercial_completed` is NOT determined by Team 44 — follows Team 41/42 contract.

---

## O. Health Scanner

**New service:** `artifacts/api-server/src/services/artifactDeliverableHealthScanner.ts`
**New route:** `GET /api/internal/artifact-health` + `GET /api/internal/artifact-health/:projectId`

Detects 14 anomaly types (expandable):
1. PRODUCTION_COMPLETED_WITHOUT_ARTIFACT (critical) — AR-01
2. ARTIFACT_WITHOUT_STORAGE_REFERENCE (high)
3. PLACEHOLDER_ARTIFACT_IN_PRODUCTION (critical)
4. FAILED_ARTIFACT_IN_COMPLETED_PROJECT (medium)
5. PREVIEW_ARTIFACT_MARKED_AS_FINAL (high)
6. OVERLAY_FAILURE_ARTIFACT_PUBLISHED (high) — RE-01/RE-02
7. *(version duplicate detection indexed, not emitted as finding separately)*
8. DELIVERABLE_WITHOUT_ARTIFACTS (high)
9. PUBLISHED_DELIVERABLE_MISSING_REQUIRED_ARTIFACT (critical)
10. FILES_UNLOCKED_WITHOUT_DELIVERABLE (high)
11. DUPLICATE_ACTIVE_DELIVERABLE (medium)
12. ORPHAN_ARTIFACT (medium)
13. STORAGE_OBJECT_MISSING (critical) — opt-in, `checkStorage=true`
14. COMPLETED_ARTIFACT_FAILS_VALIDATION (high)

Output shape: `{ scannedAt, scope, durationMs, findingCount, criticalCount, highCount, findings[] }`

Default read-only. No repairs. Admin key required to access endpoint.

---

## P. Tenant Isolation

- All DB queries use authoritative project ID from token payload or URL params
- `deliveryCompletionGuard.ts` queries by `projectId` (UUID string) — unique per project
- `deliverableAdapter.ts` requires caller to pre-verify project ownership before passing it
- Scanner scopes findings by `projectId`
- Signed URL token contains `pid` (numeric ID) — cannot be guessed or injected
- Cross-tenant signed URL: token `pid` is verified against DB — wrong tenant project returns 404

**Test coverage:** Tests 41–43 in team44 test file verify cross-tenant detection and injection guard.

---

## Q. Observability

Audit events logged via `logAudit()` for all critical paths:
- `access_granted` — successful file download authorization
- `access_denied` / `access_denied_locked` / `access_denied_missing` — all denial reasons
- `token_generated` — admin token creation
- `token_denied_unknown_url` — **NEW** — arbitrary key injection attempt
- `token_revoked` — token revocation
- `manual_unlock` — admin override (with unlockedBy + reason)
- `zip_generated` / `zip_failed` — ZIP delivery outcomes
- `access_storage_check_failed` — storage HEAD check failure

Correlation IDs in audit context: projectId, actor, resource type, success/failure.

**Gap:** `artifactId`, `deliverableId`, `workflowId` not systematically included in all audit events. Existing audit schema uses free-form `details` JSON — sufficient for current tooling.

---

## R. Files Changed

| File | Type | Change |
|---|---|---|
| `artifacts/api-server/src/services/artifactValidator.ts` | NEW | Canonical artifact validation service |
| `artifacts/api-server/src/services/deliveryCompletionGuard.ts` | NEW | Three-tier readiness guards + AR-01 fix |
| `artifacts/api-server/src/services/artifactDeliverableHealthScanner.ts` | NEW | 14-check anomaly scanner |
| `artifacts/api-server/src/routes/artifactHealth.ts` | NEW | GET /internal/artifact-health endpoints |
| `artifacts/api-server/src/__tests__/team44-artifact-deliverable-integrity.test.ts` | NEW | 47 regression tests |
| `artifacts/api-server/src/routes/payments.ts` | MODIFIED | B-02: require `reason` for admin unlock |
| `artifacts/api-server/src/routes/files.ts` | MODIFIED | Arbitrary key injection guard + creativeAiAssetsTable import |
| `artifacts/api-server/src/routes/index.ts` | MODIFIED | Register artifactHealthRouter |

---

## S. Tests Added

**File:** `src/__tests__/team44-artifact-deliverable-integrity.test.ts`  
**Total tests:** 47 (covering all 40 required + supplemental)

| Section | Tests | Coverage |
|---|---|---|
| Artifact creation boundary | 1–6 | Valid output, null, empty, failed job, renderer failure, noText overlay |
| Artifact validation | 7–15 | projectId, storage ref, storagePath for final, zero-byte, placeholder, preview stage, versioning, failure states |
| Placeholder detection | 16 | isPlaceholderStorageRef comprehensive |
| Deliverable assembly | 17–19 | Empty project, failed artifact, preview vs final distinction |
| Signed URL security | 20–25 | Generate, verify, tamper, expire, revoke, malform |
| File unlock policy | 26–29 | Preview/final states, partial payment, canonical unlock, B-02 reason required |
| Access grant rules | 30–33 | Grant ≠ payment, idempotent, no payment change, actor+reason required |
| Delivery completion | 34–38 | production_completed guard, storage for final, dependency chain, commercial ≠ delivery, orphan detection |
| Health scanner | 39–40 | Empty manifest detection, valid end-to-end flow |
| Tenant isolation | 41–43 | Cross-tenant detection, injection guard, empty-set edge case |
| Scanner structure | supplemental | ScanResult shape, isFailureStatus null handling |

---

## T. Typecheck

**Pre-existing errors (unchanged by Team 44):**
- TS6305 — lib/db/dist not built (resolved by `pnpm run typecheck:libs` first)
- TS2322, TS2367, TS2345, TS7006 — pre-existing in other team files

**Team 44 new errors:** 0

**Verification:** `pnpm tsc --noEmit 2>&1 | grep "artifactValidator\|deliveryCompletion\|artifactHealth\|team44"` → no output.

---

## U. Builds

API server build: Not regenerated (dev workflow uses ts-node / esbuild at startup). The api-server workflow is running cleanly.

Libs: `pnpm run typecheck:libs` passes (tsc --build on all lib packages).

---

## V. Conflict Risk Matrix

| File | Change | Shared Team | Risk | Integration Note |
|---|---|---|---|---|
| `routes/payments.ts` | require `reason` for unlock | Team 42 (billing), Team 45 (customer portal) | Low | API-level change; Team 42 does not call this endpoint. Team 45 admin UI should pass reason. |
| `routes/files.ts` | fileUrl validation against DB assets | Team 43 (renderer output), Team 45 (customer portal) | Low | Admin-only endpoint; no customer portal change needed. Validation skips when project has 0 assets (new project). |
| `routes/index.ts` | Add artifactHealthRouter | None | None | Additive mount — no path conflicts |
| New services | Additive | None | None | No shared file edits |

---

## W. Remaining Risks

| Risk | Severity | Owner | Status |
|---|---|---|---|
| ZIP delivery uses path reference, not real upload in dev | Medium | Team 43/43 boundary | Documented — dev limitation, production path would upload to Supabase |
| In-memory token revocation cleared on restart | Low | Team 44 | Acceptable for 1h TTL tokens; persistent revocation would need DB table |
| No persistent `access_grants` table | Low | Team 41/44 | Current filesUnlocked + token model is functional; formal grant table is follow-up |
| Scanner `checkStorage=true` makes network calls — slow at scale | Low | Team 44 | Opt-in only; default false |
| Admin unlock now 400 if existing callers omit `reason` | Medium | Team 45/46 | Breaking change for admin UI — admin must pass `reason` field |
| `creativeAiAssetsTable` in files.ts adds a DB query per token generation | Very Low | Team 44 | Admin-only, infrequent path |

---

## X. Commit Hash

See section AG.

---

## Y. Tests Added

47 tests in `team44-artifact-deliverable-integrity.test.ts`.

---

## Z. Targeted Test Results

| Command | Test Files | Tests | Passed | Failed | Duration |
|---|---|---|---|---|---|
| `vitest run src/__tests__/team44-artifact-deliverable-integrity.test.ts` | 1 | 47 | 47 | 0 | ~247ms |

---

## AA. Full Regression Results

| Command | Tests | Passed | Failed | Baseline | Delta |
|---|---|---|---|---|---|
| `cd artifacts/api-server && pnpm vitest run` | 5393 | 5393 | 0 | 5346 | +47 (all new) |

**Zero regressions introduced.**

---

## AB. Typecheck

All Team 44 new files: **0 new TypeScript errors**. Pre-existing errors in other team files unchanged.

---

## AC. Builds

| Target | Status |
|---|---|
| `pnpm run typecheck:libs` | PASS |
| api-server workflow (running) | RUNNING |
| customer-portal workflow | RUNNING |
| ai-platform workflow | RUNNING |

---

## AD. Conflict Risk Matrix

See Section V above.

---

## AE. Remaining Risks

See Section W above.

---

## AF. Commit Hash

To be filled after push (see Section AG).

---

## AG. Push Verification

Branch: `audit/team-44-artifact-deliverable`  
Remote: `origin`  
Push command: `git push -u origin audit/team-44-artifact-deliverable`

---

## AH. Final Verdict

**PASS WITH NON-BLOCKING RISKS**

All critical Team 41 findings addressed:
- ✅ AR-01: `assertProductionCompletedEligible()` guards production_completed without artifact
- ✅ B-02: Admin unlock now requires `reason` — auditable justification mandatory
- ✅ RE-01/RE-02: noText/overlay failure artifacts rejected at validation + detected by scanner
- ✅ C-03: `validateArtifactRecord()` provides constraint/guard for invalid artifacts

All 47 targeted tests pass. Full regression: 5393/5393. Zero new TypeScript errors. Zero regressions.

Remaining non-blocking risks documented in Section W.
