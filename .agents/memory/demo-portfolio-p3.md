---
name: Demo Portfolio Sprint P3
description: Publication guard, asset_purpose separation, audit/repair endpoints — Sprint P3 rules and invariants
---

## Two-Policy Asset Separation

- `live_preview` — temp, 1-hour expiry, watermarked, base64 only, NEVER stored in Supabase
- `demo_portfolio` — permanent, stored in Supabase Object Storage, public CDN, gallery-ready
- `asset_purpose` column: text, default `'demo_portfolio'`, no DB enum constraint
- `expires_at` column: only set for `live_preview` assets, null for demo_portfolio

## Storage Path Pattern (Sprint P3)

New: `demo-portfolios/{portfolioId}/{assetId}/original.webp` + `preview.webp` + `thumb.webp`
Legacy: `demo-portfolios/{brandSlug}/{role}/{timestamp}.webp` (kept for in-flight jobs)
All three storage functions accept optional `portfolioId`/`assetId` params; fall back to legacy.

## Publication Guard (`checkPublicationGuard`)

Hard thresholds enforced by ALL paths to `publish_status = 'published'`:
- QC score ≥ 80 (`PUBLICATION_MIN_QC`)
- trademark_risk = 'low'
- cover_image: not null, not a replicate.delivery URL
- asset count ≥ 6 (`PUBLICATION_MIN_ASSETS`)
- all assets in terminal states (archived/optimized/archive_failed)
- zero assets still serving replicate.delivery URLs

**Why:** Per spec the batch `qcThreshold` only governs auto-publish routing during generation. The hard 80 floor applies regardless for all manual approvals.

## New DB Columns (DDL in `ddl-portfolio-p3.sql` — must run manually)

`ai_portfolio_assets`:
  - `asset_purpose` TEXT NOT NULL DEFAULT 'demo_portfolio'
  - `expires_at` TIMESTAMPTZ

`ai_service_portfolios`:
  - `generation_status` TEXT NOT NULL DEFAULT 'metadata_only'
  - `cover_asset_id` INTEGER (FK to ai_portfolio_assets.id)

Also creates view `v_broken_published_portfolios`.

## generation_status values

metadata_only → generating → generated → archiving → archived → optimizing → qc_review → ready_to_publish → published
Error states: archive_failed | incomplete | needs_repair

## New API Endpoints

- `POST /ai/portfolio/batch/estimate` — heuristic cost/storage estimate (no generation)
- `GET /ai/portfolio/audit` — scan published portfolios failing the guard
- `POST /ai/portfolio/audit/mark-needs-repair` — bulk mark broken as needs_repair (removes from public)
- `POST /ai/portfolio/portfolios/:id/repair` — reset + regenerate single portfolio
- `POST /ai/portfolio/repair-all` — requires `{confirm:true}`, max 20 portfolios, fire-and-forget
- PATCH `/ai/portfolio/portfolios/:id/publish-status` — now also accepts `needs_repair`; runs guard when setting `published`

## Public API Guard (`portfolio-public.ts`)

Conditions added to all public queries:
- `cover_image IS NOT NULL`
- `cover_image NOT LIKE '%replicate.delivery%'`
- `(NOT is_demo OR (qc_score::numeric >= 80 AND trademark_risk = 'low'))`

Real client portfolios (is_demo=false) skip the QC/trademark checks.

## Auto-publish Guard (`maybeFinalizePortfolioPublish`)

Added: cover must be non-null AND not a replicate.delivery URL before auto-publishing.
Sets `generation_status` = 'published' | 'archived' | 'incomplete' after all assets terminal.

## Admin UI (portfolio-admin.tsx)

New tab "Audit & Repair" (AlertTriangle icon) with AuditTab component.
STATUS_COLORS added: needs_repair, metadata_only, qc_review, ready_to_publish, incomplete, pending_archive.
CreateBatchPanel: CostEstimateRow component calls `/ai/portfolio/batch/estimate`.
PortfolioDetailDrawer: "Repair Missing Assets" button shown when publishStatus=needs_repair or trademarkRisk=high/medium.
