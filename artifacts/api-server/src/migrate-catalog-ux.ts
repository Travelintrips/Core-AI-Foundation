/**
 * Additive catalog UX migration.
 *
 * Safe to run repeatedly. Existing service IDs, codes, packages, requests,
 * projects, quotations, payments, workflows, and reports are untouched.
 */
import { pool } from "@workspace/db";

const DDL = `
SET search_path TO ai_platform, public;

ALTER TABLE ai_service_categories
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_service_categories
  ADD COLUMN IF NOT EXISTS starting_price_override NUMERIC(12,2);

ALTER TABLE ai_services
  ADD COLUMN IF NOT EXISTS aliases JSONB;
ALTER TABLE ai_services
  ADD COLUMN IF NOT EXISTS parent_category_id INTEGER REFERENCES ai_service_categories(id) ON DELETE SET NULL;
ALTER TABLE ai_services
  ADD COLUMN IF NOT EXISTS display_as_primary BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE ai_services
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_services
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;

-- Exactly six categories are public discovery categories. Legacy categories
-- remain available to internal workflows and historical reporting.
UPDATE ai_service_categories
SET visibility = CASE WHEN code IN (
  'brand-identity', 'content-marketing', 'ai-visual-design',
  'presentation-documents', 'product-commercial', 'specialized-design'
) THEN 'public' ELSE 'internal' END,
    commercial_status = CASE WHEN code IN (
  'brand-identity', 'content-marketing', 'ai-visual-design',
  'presentation-documents', 'product-commercial', 'specialized-design'
) THEN 'commercial_ready' ELSE 'internal_only' END,
    is_featured = CASE WHEN code IN (
  'brand-identity', 'content-marketing', 'ai-visual-design',
  'presentation-documents', 'product-commercial', 'specialized-design'
  ) THEN TRUE ELSE FALSE END;

CREATE INDEX IF NOT EXISTS idx_ai_service_categories_public_order
  ON ai_service_categories(visibility, status, commercial_status, display_order);
CREATE INDEX IF NOT EXISTS idx_ai_services_public_parent_order
  ON ai_services(category_id, status, display_as_primary, display_order);
CREATE INDEX IF NOT EXISTS idx_ai_services_canonical_parent_order
  ON ai_services(parent_category_id, status, display_as_primary, display_order);

-- Backfill the canonical discovery parent by stable service code. This does
-- not alter category_id, which remains the historical/reporting category.
UPDATE ai_services s
SET parent_category_id = c.id
FROM ai_service_categories c
WHERE c.code = CASE s.service_code
  WHEN 'logo-design' THEN 'brand-identity'
  WHEN 'GD-LOGO' THEN 'brand-identity'
  WHEN 'brand-identity' THEN 'brand-identity'
  WHEN 'company-profile' THEN 'presentation-documents'
  WHEN 'brand-strategy' THEN 'brand-identity'
  WHEN 'copywriting' THEN 'content-marketing'
  WHEN 'social-media-design' THEN 'content-marketing'
  WHEN 'ebook' THEN 'content-marketing'
  WHEN 'image-generation' THEN 'ai-visual-design'
  WHEN 'poster-banner' THEN 'ai-visual-design'
  WHEN 'GD-FLYER' THEN 'ai-visual-design'
  WHEN 'GD-POSTER' THEN 'ai-visual-design'
  WHEN 'GD-BANNER' THEN 'ai-visual-design'
  WHEN 'GD-BROCHURE' THEN 'ai-visual-design'
  WHEN 'GD-SOCIAL' THEN 'ai-visual-design'
  WHEN 'GD-CERT' THEN 'ai-visual-design'
  WHEN 'GD-BCARD' THEN 'ai-visual-design'
  WHEN 'GD-LTRHEAD' THEN 'ai-visual-design'
  WHEN 'GD-STATIONERY' THEN 'ai-visual-design'
  WHEN 'pitch-deck' THEN 'presentation-documents'
  WHEN 'pd-pitch-deck' THEN 'presentation-documents'
  WHEN 'company-profile' THEN 'presentation-documents'
  WHEN 'pd-company-profile-doc' THEN 'presentation-documents'
  WHEN 'proposal' THEN 'presentation-documents'
  WHEN 'pd-business-proposal' THEN 'presentation-documents'
  WHEN 'whitepaper' THEN 'presentation-documents'
  WHEN 'pd-annual-report' THEN 'presentation-documents'
  WHEN 'pd-executive-summary' THEN 'presentation-documents'
  WHEN 'pd-meeting-deck' THEN 'presentation-documents'
  WHEN 'pd-training-material' THEN 'presentation-documents'
  WHEN 'annual-report' THEN 'presentation-documents'
  WHEN 'case-study' THEN 'presentation-documents'
  WHEN 'product-catalog' THEN 'product-commercial'
  WHEN 'pd-product-catalog' THEN 'product-commercial'
  WHEN 'packaging-design' THEN 'product-commercial'
  WHEN 'fashion-brand-brief' THEN 'specialized-design'
  WHEN 'interior-concept-design' THEN 'specialized-design'
  WHEN 'creative-consultation' THEN 'brand-identity'
  ELSE NULL
END
AND s.service_code IN (
  'logo-design','GD-LOGO','brand-identity','company-profile','brand-strategy','copywriting',
  'social-media-design','ebook','image-generation','poster-banner',
  'GD-FLYER','GD-POSTER','GD-BANNER','GD-BROCHURE','GD-SOCIAL','GD-CERT',
  'GD-BCARD','GD-LTRHEAD','GD-STATIONERY','pitch-deck','pd-pitch-deck',
  'company-profile','pd-company-profile-doc','proposal','pd-business-proposal',
  'whitepaper','pd-annual-report','pd-executive-summary','pd-meeting-deck',
  'pd-training-material','annual-report','case-study','product-catalog',
  'pd-product-catalog','packaging-design','fashion-brand-brief',
  'interior-concept-design','creative-consultation'
);
`;

async function run() {
  const client = await pool.connect();
  try {
    await client.query(DDL);
    console.log("Catalog UX additive migration complete");
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Catalog UX migration failed:", err);
  process.exit(1);
});