-- Team 04: creative-portfolio-v2
-- Migration draft — NOT run yet. Additive indexes only.
-- All columns already exist in ai_service_portfolios.

-- Performance index for enhanced gallery sort by rating
CREATE INDEX IF NOT EXISTS idx_portfolio_v2_rating
  ON ai_platform.ai_service_portfolios (
    status,
    (rating::numeric) DESC NULLS LAST
  )
  WHERE status = 'published' AND cover_image IS NOT NULL;

-- Performance index for fastest-delivery sort
CREATE INDEX IF NOT EXISTS idx_portfolio_v2_delivery_days
  ON ai_platform.ai_service_portfolios (
    status,
    delivery_days ASC NULLS LAST
  )
  WHERE status = 'published' AND cover_image IS NOT NULL;

-- Performance index for before/after feed
CREATE INDEX IF NOT EXISTS idx_portfolio_v2_before_after
  ON ai_platform.ai_service_portfolios (
    status,
    featured DESC,
    views DESC
  )
  WHERE status = 'published'
    AND cover_image IS NOT NULL
    AND before_image IS NOT NULL
    AND after_image IS NOT NULL;

-- Performance index for color_tags JSONB containment queries
CREATE INDEX IF NOT EXISTS idx_portfolio_v2_color_tags_gin
  ON ai_platform.ai_service_portfolios
  USING GIN (color_tags jsonb_path_ops)
  WHERE status = 'published';

-- Performance index for style lookup (inspiration feed)
CREATE INDEX IF NOT EXISTS idx_portfolio_v2_style_lower
  ON ai_platform.ai_service_portfolios (
    status,
    LOWER(style)
  )
  WHERE status = 'published' AND cover_image IS NOT NULL;
