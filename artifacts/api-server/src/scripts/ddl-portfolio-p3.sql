-- DDL: Demo Portfolio Sample Pipeline Hardening (Sprint P3)
-- Additive only. Run once against the Supabase dev/prod database.
-- All tables live in the ai_platform schema.

SET search_path TO ai_platform, public;

-- ── asset_purpose: classifies asset lifecycle and storage policy ─────────────
--
-- live_preview    : temporary, expires 1 h, watermarked, low-res, auto cleanup
-- demo_portfolio  : permanent, stored in Object Storage, public optimised preview
-- customer_preview: private, watermarked, signed access, not final
-- customer_final  : private permanent, signed download, payment-gated

ALTER TABLE ai_platform.ai_portfolio_assets
  ADD COLUMN IF NOT EXISTS asset_purpose TEXT NOT NULL DEFAULT 'demo_portfolio',
  ADD COLUMN IF NOT EXISTS expires_at    TIMESTAMPTZ;

-- ── generation_status: tracks the full pipeline stage for UI display ─────────
-- metadata_only | generating | generated | archiving | archived |
-- optimizing | qc_review | ready_to_publish | published |
-- archive_failed | incomplete | needs_repair

ALTER TABLE ai_platform.ai_service_portfolios
  ADD COLUMN IF NOT EXISTS generation_status TEXT NOT NULL DEFAULT 'metadata_only',
  ADD COLUMN IF NOT EXISTS cover_asset_id   INTEGER;

-- Indexes
CREATE INDEX IF NOT EXISTS ai_portfolio_assets_purpose_idx
  ON ai_platform.ai_portfolio_assets(asset_purpose);

CREATE INDEX IF NOT EXISTS ai_portfolio_assets_expires_at_idx
  ON ai_platform.ai_portfolio_assets(expires_at)
  WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS ai_service_portfolios_pub_status_idx
  ON ai_platform.ai_service_portfolios(publish_status);

CREATE INDEX IF NOT EXISTS ai_service_portfolios_gen_status_idx
  ON ai_platform.ai_service_portfolios(generation_status);

-- Backfill generation_status from existing status/publish_status
UPDATE ai_platform.ai_service_portfolios
SET generation_status = CASE
  WHEN publish_status = 'published'       THEN 'published'
  WHEN publish_status = 'pending_archive' THEN 'archiving'
  WHEN publish_status = 'review'          THEN 'qc_review'
  WHEN status = 'draft'                   THEN 'generated'
  ELSE 'metadata_only'
END
WHERE generation_status = 'metadata_only';

-- Mark existing demo assets with correct asset_purpose
UPDATE ai_platform.ai_portfolio_assets
SET asset_purpose = 'demo_portfolio'
WHERE asset_purpose = 'demo_portfolio'; -- no-op, just ensures constraint path works

-- Audit helper view (re-creatable) ────────────────────────────────────────────
CREATE OR REPLACE VIEW ai_platform.v_broken_published_portfolios AS
SELECT
  p.id,
  p.title,
  p.publish_status,
  p.qc_score,
  p.trademark_risk,
  p.cover_image,
  p.is_demo,
  COUNT(a.id)                                                                 AS asset_count,
  COUNT(CASE WHEN a.status = 'archive_failed'                      THEN 1 END) AS failed_asset_count,
  COUNT(CASE WHEN a.preview_url LIKE '%replicate.delivery%'        THEN 1 END) AS replicate_url_count
FROM ai_platform.ai_service_portfolios p
LEFT JOIN ai_platform.ai_portfolio_assets a ON a.portfolio_id = p.id
WHERE p.publish_status = 'published'
GROUP BY p.id, p.title, p.publish_status, p.qc_score, p.trademark_risk, p.cover_image, p.is_demo
HAVING (
  p.cover_image IS NULL
  OR p.cover_image LIKE '%replicate.delivery%'
  OR p.qc_score IS NULL
  OR p.qc_score::numeric < 80
  OR p.trademark_risk != 'low'
  OR COUNT(a.id) < 6
  OR COUNT(CASE WHEN a.preview_url LIKE '%replicate.delivery%' THEN 1 END) > 0
);
