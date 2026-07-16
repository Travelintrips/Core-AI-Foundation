-- Auto-generated migration: dev → prod (additive only)
-- Generated: 2026-07-15T08:25:34.262Z
-- Missing tables: 87

SET search_path TO ai_platform, public;

-- table: activity
CREATE TABLE IF NOT EXISTS ai_platform.activity (
  id SERIAL NOT NULL PRIMARY KEY,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  entity_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: ai_ab_tests
CREATE TABLE IF NOT EXISTS ai_platform.ai_ab_tests (
  id SERIAL NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  test_type TEXT NOT NULL,
  status TEXT DEFAULT 'active'::text NOT NULL,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  winner_variant_id INTEGER,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_ab_tests_test_type_check CHECK ((test_type = ANY (ARRAY['package'::text, 'promotion'::text, 'cta'::text]))),
  CONSTRAINT ai_ab_tests_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'completed'::text])))
);

-- table: ai_ab_variants
CREATE TABLE IF NOT EXISTS ai_platform.ai_ab_variants (
  id SERIAL NOT NULL PRIMARY KEY,
  test_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  label TEXT,
  impressions INTEGER DEFAULT 0 NOT NULL,
  clicks INTEGER DEFAULT 0 NOT NULL,
  checkouts INTEGER DEFAULT 0 NOT NULL,
  conversions INTEGER DEFAULT 0 NOT NULL,
  revenue INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: ai_affiliate_clicks
CREATE TABLE IF NOT EXISTS ai_platform.ai_affiliate_clicks (
  id SERIAL NOT NULL PRIMARY KEY,
  affiliate_id INTEGER NOT NULL,
  visitor_id TEXT,
  session_id TEXT,
  landing_page TEXT,
  device TEXT,
  country TEXT,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: ai_affiliate_conversions
CREATE TABLE IF NOT EXISTS ai_platform.ai_affiliate_conversions (
  id SERIAL NOT NULL PRIMARY KEY,
  affiliate_id INTEGER NOT NULL,
  click_id INTEGER,
  service_request_id INTEGER,
  order_amount INTEGER NOT NULL,
  commission_amount INTEGER NOT NULL,
  status TEXT DEFAULT 'pending'::text NOT NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_affiliate_conversions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text])))
);

-- table: ai_affiliates
CREATE TABLE IF NOT EXISTS ai_platform.ai_affiliates (
  id SERIAL NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  affiliate_code TEXT NOT NULL,
  commission_rate INTEGER DEFAULT 10 NOT NULL,
  status TEXT DEFAULT 'active'::text NOT NULL,
  total_clicks INTEGER DEFAULT 0 NOT NULL,
  total_conversions INTEGER DEFAULT 0 NOT NULL,
  total_revenue INTEGER DEFAULT 0 NOT NULL,
  total_commission INTEGER DEFAULT 0 NOT NULL,
  pending_commission INTEGER DEFAULT 0 NOT NULL,
  paid_commission INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_affiliates_affiliate_code_key UNIQUE (affiliate_code),
  CONSTRAINT ai_affiliates_email_key UNIQUE (email),
  CONSTRAINT ai_affiliates_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'pending'::text])))
);

-- table: ai_asset_intelligence
CREATE TABLE IF NOT EXISTS ai_platform.ai_asset_intelligence (
  id SERIAL NOT NULL PRIMARY KEY,
  asset_id INTEGER NOT NULL,
  asset_source TEXT NOT NULL,
  client_id TEXT NOT NULL,
  detected_subjects JSONB,
  auto_tags JSONB,
  auto_category TEXT,
  search_keywords JSONB,
  suggested_usage JSONB,
  color_palette JSONB,
  dominant_colors JSONB,
  perceptual_hash TEXT,
  is_duplicate BOOLEAN DEFAULT false NOT NULL,
  duplicate_of_id INTEGER,
  version_type TEXT,
  version_chain_id INTEGER,
  quality_score INTEGER,
  resolution_info JSONB,
  has_transparency BOOLEAN,
  analysis_failed BOOLEAN DEFAULT false NOT NULL,
  failure_reason TEXT,
  confidence_score NUMERIC(4,3),
  metadata JSONB,
  analyzed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: ai_asset_library
CREATE TABLE IF NOT EXISTS ai_platform.ai_asset_library (
  id SERIAL NOT NULL PRIMARY KEY,
  email_hash TEXT NOT NULL,
  project_id TEXT,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT,
  preview_url TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT,
  checksum TEXT,
  version INTEGER DEFAULT 1 NOT NULL,
  parent_asset_id INTEGER,
  active BOOLEAN DEFAULT true NOT NULL,
  archived BOOLEAN DEFAULT false NOT NULL,
  favorited BOOLEAN DEFAULT false NOT NULL,
  uploaded_by TEXT,
  source_asset_id INTEGER,
  tags JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: ai_automation_executions
CREATE TABLE IF NOT EXISTS ai_platform.ai_automation_executions (
  id SERIAL NOT NULL PRIMARY KEY,
  rule_id INTEGER NOT NULL,
  trigger_event_id TEXT,
  trigger_event_type TEXT,
  customer_profile_id INTEGER,
  status TEXT DEFAULT 'success'::text NOT NULL,
  result_json JSONB,
  executed_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: ai_automation_rules
CREATE TABLE IF NOT EXISTS ai_platform.ai_automation_rules (
  id SERIAL NOT NULL PRIMARY KEY,
  rule_code TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  description TEXT,
  trigger_event TEXT NOT NULL,
  conditions_json JSONB DEFAULT '{}'::jsonb NOT NULL,
  action_type TEXT NOT NULL,
  action_config_json JSONB,
  priority INTEGER DEFAULT 50 NOT NULL,
  is_enabled BOOLEAN DEFAULT true NOT NULL,
  execution_count INTEGER DEFAULT 0 NOT NULL,
  last_executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_automation_rules_rule_code_key UNIQUE (rule_code)
);

-- table: ai_brand_dna
CREATE TABLE IF NOT EXISTS ai_platform.ai_brand_dna (
  id SERIAL NOT NULL PRIMARY KEY,
  client_id TEXT NOT NULL,
  brand_personality JSONB,
  brand_voice TEXT,
  writing_style TEXT,
  photography_style TEXT,
  illustration_style TEXT,
  icon_style TEXT,
  layout_style TEXT,
  visual_density TEXT,
  spacing_style TEXT,
  detected_colors JSONB,
  color_psychology JSONB,
  detected_typography JSONB,
  target_audience JSONB,
  industry TEXT,
  risk_profile TEXT,
  completeness_score INTEGER,
  consistency_score INTEGER,
  confidence_score NUMERIC(4,3),
  data_sources_summary JSONB,
  analysis_version TEXT DEFAULT 'v1'::text NOT NULL,
  metadata JSONB,
  analyzed_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_brand_dna_client_id_key UNIQUE (client_id)
);

-- table: ai_brand_kit_assets
CREATE TABLE IF NOT EXISTS ai_platform.ai_brand_kit_assets (
  id SERIAL NOT NULL PRIMARY KEY,
  project_id TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  slot TEXT NOT NULL,
  file_name TEXT,
  storage_path TEXT,
  preview_url TEXT,
  mime_type TEXT,
  file_size_bytes BIGINT,
  checksum TEXT,
  value TEXT,
  value_json JSONB,
  version INTEGER DEFAULT 1 NOT NULL,
  parent_asset_id INTEGER,
  active BOOLEAN DEFAULT true NOT NULL,
  archived BOOLEAN DEFAULT false NOT NULL,
  uploaded_by TEXT,
  tags JSONB,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: ai_commercial_gates
CREATE TABLE IF NOT EXISTS ai_platform.ai_commercial_gates (
  id SERIAL NOT NULL PRIMARY KEY,
  tenant_id TEXT,
  service_request_id INTEGER,
  quotation_id INTEGER,
  gate_type TEXT DEFAULT 'admin_approval'::text NOT NULL,
  status TEXT DEFAULT 'pending'::text NOT NULL,
  required_amount NUMERIC(14,2),
  verified_amount NUMERIC(14,2),
  reference_number TEXT,
  verified_by TEXT,
  verified_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  service_quotation_id INTEGER
);

-- table: ai_coupon_usages
CREATE TABLE IF NOT EXISTS ai_platform.ai_coupon_usages (
  id SERIAL NOT NULL PRIMARY KEY,
  coupon_id INTEGER NOT NULL,
  customer_profile_id INTEGER,
  service_request_id INTEGER,
  discount_amount INTEGER NOT NULL,
  used_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: ai_coupons
CREATE TABLE IF NOT EXISTS ai_platform.ai_coupons (
  id SERIAL NOT NULL PRIMARY KEY,
  code TEXT NOT NULL,
  type TEXT NOT NULL,
  value INTEGER NOT NULL,
  minimum_order INTEGER,
  maximum_discount INTEGER,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  usage_limit INTEGER,
  usage_per_customer INTEGER DEFAULT 1 NOT NULL,
  usage_count INTEGER DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'active'::text NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_coupons_code_key UNIQUE (code),
  CONSTRAINT ai_coupons_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'expired'::text]))),
  CONSTRAINT ai_coupons_type_check CHECK ((type = ANY (ARRAY['percentage'::text, 'fixed'::text])))
);

-- table: ai_customer_health_scores
CREATE TABLE IF NOT EXISTS ai_platform.ai_customer_health_scores (
  id SERIAL NOT NULL PRIMARY KEY,
  customer_profile_id INTEGER NOT NULL,
  payment_score INTEGER DEFAULT 0 NOT NULL,
  activity_score INTEGER DEFAULT 0 NOT NULL,
  repeat_order_score INTEGER DEFAULT 0 NOT NULL,
  review_score INTEGER DEFAULT 0 NOT NULL,
  response_time_score INTEGER DEFAULT 0 NOT NULL,
  overall_score INTEGER DEFAULT 0 NOT NULL,
  health_status TEXT DEFAULT 'potential'::text NOT NULL,
  last_calculated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_customer_health_scores_customer_profile_id_key UNIQUE (customer_profile_id),
  CONSTRAINT ai_customer_health_scores_health_status_check CHECK ((health_status = ANY (ARRAY['healthy'::text, 'potential'::text, 'at_risk'::text, 'lost'::text])))
);

-- table: ai_customer_segments
CREATE TABLE IF NOT EXISTS ai_platform.ai_customer_segments (
  id SERIAL NOT NULL PRIMARY KEY,
  customer_profile_id INTEGER NOT NULL,
  segment TEXT DEFAULT 'new'::text NOT NULL,
  previous_segment TEXT,
  segment_score INTEGER DEFAULT 0 NOT NULL,
  segment_reason TEXT,
  metadata_json JSONB,
  calculated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_customer_segments_customer_profile_id_key UNIQUE (customer_profile_id)
);

-- table: ai_invoices
CREATE TABLE IF NOT EXISTS ai_platform.ai_invoices (
  id SERIAL NOT NULL PRIMARY KEY,
  invoice_number TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  payment_schedule_id INTEGER,
  invoice_type TEXT DEFAULT 'final'::text NOT NULL,
  amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  currency TEXT DEFAULT 'IDR'::text NOT NULL,
  status TEXT DEFAULT 'issued'::text NOT NULL,
  line_items_json JSONB,
  issued_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_invoices_invoice_number_key UNIQUE (invoice_number)
);

-- table: ai_live_previews
CREATE TABLE IF NOT EXISTS ai_platform.ai_live_previews (
  id SERIAL NOT NULL PRIMARY KEY,
  session_id TEXT NOT NULL,
  service_id INTEGER NOT NULL,
  company_name TEXT NOT NULL,
  industry TEXT NOT NULL,
  style TEXT NOT NULL,
  primary_color TEXT,
  secondary_color TEXT,
  short_description TEXT,
  reference_image_url TEXT,
  concept_a JSONB,
  concept_b JSONB,
  selected_concept TEXT,
  status TEXT DEFAULT 'generating'::text NOT NULL,
  error_message TEXT,
  service_request_id INTEGER,
  watermarked BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: ai_payment_schedule
CREATE TABLE IF NOT EXISTS ai_platform.ai_payment_schedule (
  id SERIAL NOT NULL PRIMARY KEY,
  project_id INTEGER NOT NULL,
  payment_type TEXT DEFAULT 'full_payment'::text NOT NULL,
  percentage INTEGER,
  amount NUMERIC(14,2) DEFAULT 0 NOT NULL,
  currency TEXT DEFAULT 'IDR'::text NOT NULL,
  due_date TIMESTAMPTZ,
  status TEXT DEFAULT 'pending'::text NOT NULL,
  reference TEXT,
  verified_by TEXT,
  paid_at TIMESTAMPTZ,
  notes TEXT,
  display_order INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  proof_image_url TEXT
);

-- table: ai_pipeline_stages
CREATE TABLE IF NOT EXISTS ai_platform.ai_pipeline_stages (
  id SERIAL NOT NULL PRIMARY KEY,
  run_id INTEGER NOT NULL,
  stage_name TEXT NOT NULL,
  stage_order INTEGER NOT NULL,
  status TEXT DEFAULT 'pending'::text NOT NULL,
  input JSONB,
  output JSONB,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  latency_ms INTEGER,
  retry_count INTEGER DEFAULT 0 NOT NULL,
  error_message TEXT,
  agent_slug TEXT,
  model TEXT,
  provider TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: ai_portfolio_assets
CREATE TABLE IF NOT EXISTS ai_platform.ai_portfolio_assets (
  id SERIAL NOT NULL PRIMARY KEY,
  portfolio_id INTEGER NOT NULL,
  creative_asset_id INTEGER,
  asset_type TEXT NOT NULL,
  asset_role TEXT NOT NULL,
  title TEXT,
  alt_text TEXT,
  file_name TEXT,
  thumbnail_url TEXT,
  preview_url TEXT,
  storage_path TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  display_order INTEGER DEFAULT 0 NOT NULL,
  downloadable BOOLEAN DEFAULT false NOT NULL,
  watermark_required BOOLEAN DEFAULT false NOT NULL,
  metadata_json JSONB,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  status TEXT DEFAULT 'generated'::text NOT NULL,
  source_url TEXT,
  archive_status TEXT DEFAULT 'pending'::text NOT NULL,
  archive_started_at TIMESTAMPTZ,
  archive_completed_at TIMESTAMPTZ,
  archive_attempts INTEGER DEFAULT 0 NOT NULL,
  archive_error TEXT,
  storage_provider TEXT,
  storage_bucket TEXT,
  thumbnail_status TEXT DEFAULT 'pending'::text NOT NULL,
  optimization_status TEXT DEFAULT 'pending'::text NOT NULL
);

-- table: ai_portfolio_favorites
CREATE TABLE IF NOT EXISTS ai_platform.ai_portfolio_favorites (
  id SERIAL NOT NULL PRIMARY KEY,
  client_id TEXT NOT NULL,
  portfolio_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_portfolio_favorites_client_id_portfolio_id_key UNIQUE (client_id, portfolio_id)
);

-- table: ai_portfolio_generation_batches
CREATE TABLE IF NOT EXISTS ai_platform.ai_portfolio_generation_batches (
  id SERIAL NOT NULL PRIMARY KEY,
  batch_code TEXT NOT NULL,
  service_id INTEGER,
  industry TEXT NOT NULL,
  style TEXT NOT NULL,
  package_level TEXT DEFAULT 'standard'::text NOT NULL,
  requested_count INTEGER DEFAULT 3 NOT NULL,
  generated_count INTEGER DEFAULT 0 NOT NULL,
  approved_count INTEGER DEFAULT 0 NOT NULL,
  rejected_count INTEGER DEFAULT 0 NOT NULL,
  failed_count INTEGER DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'draft'::text NOT NULL,
  max_cost NUMERIC(10,2),
  actual_cost NUMERIC(10,2) DEFAULT 0 NOT NULL,
  auto_publish BOOLEAN DEFAULT false NOT NULL,
  qc_threshold INTEGER DEFAULT 70 NOT NULL,
  created_by TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_portfolio_generation_batches_batch_code_key UNIQUE (batch_code)
);

-- table: ai_portfolio_permissions
CREATE TABLE IF NOT EXISTS ai_platform.ai_portfolio_permissions (
  id SERIAL NOT NULL PRIMARY KEY,
  project_id INTEGER NOT NULL,
  customer_id INTEGER,
  permission_status TEXT DEFAULT 'not_requested'::text NOT NULL,
  requested_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  scope_json JSONB,
  approved_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: ai_production_pipelines
CREATE TABLE IF NOT EXISTS ai_platform.ai_production_pipelines (
  id SERIAL NOT NULL PRIMARY KEY,
  run_id TEXT NOT NULL,
  project_id INTEGER NOT NULL,
  status TEXT DEFAULT 'pending'::text NOT NULL,
  current_stage TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0 NOT NULL,
  execution_summary JSONB,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_production_pipelines_run_id_key UNIQUE (run_id)
);

-- table: ai_promotions
CREATE TABLE IF NOT EXISTS ai_platform.ai_promotions (
  id SERIAL NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  discount_type TEXT NOT NULL,
  discount_value INTEGER,
  benefit_label TEXT,
  service_id INTEGER,
  package_id INTEGER,
  industry TEXT,
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  usage_limit INTEGER,
  usage_count INTEGER DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'active'::text NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_promotions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'expired'::text]))),
  CONSTRAINT ai_promotions_discount_type_check CHECK ((discount_type = ANY (ARRAY['percentage'::text, 'fixed'::text, 'free_revision'::text, 'free_source_file'::text, 'free_consultation'::text, 'bundle'::text])))
);

-- table: ai_quotation_items
CREATE TABLE IF NOT EXISTS ai_platform.ai_quotation_items (
  id SERIAL NOT NULL PRIMARY KEY,
  quotation_id INTEGER NOT NULL,
  item_type TEXT DEFAULT 'service'::text NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER DEFAULT 1 NOT NULL,
  unit_price INTEGER DEFAULT 0 NOT NULL,
  amount INTEGER DEFAULT 0 NOT NULL,
  metadata_json JSONB,
  display_order INTEGER DEFAULT 0 NOT NULL
);

-- table: ai_quotations
CREATE TABLE IF NOT EXISTS ai_platform.ai_quotations (
  id SERIAL NOT NULL PRIMARY KEY,
  tenant_id TEXT,
  quotation_code TEXT NOT NULL,
  service_request_id INTEGER,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  currency TEXT DEFAULT 'IDR'::text NOT NULL,
  subtotal INTEGER DEFAULT 0 NOT NULL,
  discount INTEGER DEFAULT 0 NOT NULL,
  tax INTEGER DEFAULT 0 NOT NULL,
  total INTEGER DEFAULT 0 NOT NULL,
  pricing_snapshot_json JSONB,
  scope_snapshot_json JSONB,
  terms_snapshot_json JSONB,
  valid_until TIMESTAMPTZ,
  status TEXT DEFAULT 'draft'::text NOT NULL,
  review_token_hash TEXT,
  review_token_expires_at TIMESTAMPTZ,
  issued_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,
  revision_requested_at TIMESTAMPTZ,
  revision_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_quotations_quotation_code_key UNIQUE (quotation_code),
  CONSTRAINT ai_quotations_quotation_code_unique UNIQUE (quotation_code),
  CONSTRAINT ai_quotations_review_token_hash_key UNIQUE (review_token_hash),
  CONSTRAINT ai_quotations_review_token_hash_unique UNIQUE (review_token_hash)
);

-- table: ai_referrals
CREATE TABLE IF NOT EXISTS ai_platform.ai_referrals (
  id SERIAL NOT NULL PRIMARY KEY,
  referrer_profile_id INTEGER NOT NULL,
  referee_profile_id INTEGER,
  referral_code TEXT NOT NULL,
  referral_link TEXT,
  status TEXT DEFAULT 'pending'::text NOT NULL,
  reward_type TEXT,
  reward_amount INTEGER,
  reward_status TEXT DEFAULT 'pending'::text,
  converted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_referrals_referral_code_key UNIQUE (referral_code),
  CONSTRAINT ai_referrals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'converted'::text, 'rewarded'::text]))),
  CONSTRAINT ai_referrals_reward_status_check CHECK ((reward_status = ANY (ARRAY['pending'::text, 'paid'::text]))),
  CONSTRAINT ai_referrals_reward_type_check CHECK ((reward_type = ANY (ARRAY['cash'::text, 'discount'::text, 'credit'::text])))
);

-- table: ai_service_categories
CREATE TABLE IF NOT EXISTS ai_platform.ai_service_categories (
  id SERIAL NOT NULL PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  display_order INTEGER DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'active'::text NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  tenant_id TEXT,
  visibility TEXT DEFAULT 'internal'::text NOT NULL,
  commercial_status TEXT DEFAULT 'internal_only'::text NOT NULL,
  CONSTRAINT ai_service_categories_code_unique UNIQUE (code),
  CONSTRAINT chk_ai_service_categories_commercial_status CHECK ((commercial_status = ANY (ARRAY['commercial_ready'::text, 'internal_only'::text, 'beta'::text, 'disabled'::text]))),
  CONSTRAINT chk_ai_service_categories_visibility CHECK ((visibility = ANY (ARRAY['public'::text, 'internal'::text, 'disabled'::text])))
);

-- table: ai_service_faqs
CREATE TABLE IF NOT EXISTS ai_platform.ai_service_faqs (
  id SERIAL NOT NULL PRIMARY KEY,
  service_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  display_order INTEGER DEFAULT 0 NOT NULL,
  status TEXT DEFAULT 'published'::text NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: ai_service_packages
CREATE TABLE IF NOT EXISTS ai_platform.ai_service_packages (
  id SERIAL NOT NULL PRIMARY KEY,
  service_id INTEGER NOT NULL,
  package_name TEXT NOT NULL,
  package_type TEXT DEFAULT 'standard'::text NOT NULL,
  monthly_price NUMERIC(14,2),
  yearly_price NUMERIC(14,2),
  one_time_price NUMERIC(14,2),
  features_json JSONB,
  limits_json JSONB,
  sla_json JSONB,
  status TEXT DEFAULT 'active'::text NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  package_level TEXT DEFAULT 'starter'::text NOT NULL,
  setup_fee NUMERIC(14,2),
  included_revisions INTEGER,
  deliverables_json JSONB,
  display_order INTEGER DEFAULT 0 NOT NULL,
  payment_policy TEXT DEFAULT 'full_payment'::text NOT NULL,
  deposit_percentage INTEGER DEFAULT 50 NOT NULL
);

-- table: ai_service_portfolios
CREATE TABLE IF NOT EXISTS ai_platform.ai_service_portfolios (
  id SERIAL NOT NULL PRIMARY KEY,
  tenant_id TEXT,
  service_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  industry TEXT NOT NULL,
  style TEXT NOT NULL,
  color_tags JSONB,
  business_size TEXT DEFAULT 'sme'::text,
  package_label TEXT,
  description TEXT,
  cover_image TEXT,
  gallery_json JSONB,
  before_image TEXT,
  after_image TEXT,
  deliverables_json JSONB,
  tools_used_json JSONB,
  workflow_json JSONB,
  delivery_time TEXT,
  rating NUMERIC(3,2),
  views INTEGER DEFAULT 0 NOT NULL,
  completed_projects INTEGER DEFAULT 0 NOT NULL,
  featured BOOLEAN DEFAULT false NOT NULL,
  status TEXT DEFAULT 'published'::text NOT NULL,
  display_order INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  portfolio_code TEXT,
  slug TEXT,
  short_description TEXT,
  business_type TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  package_level TEXT,
  delivery_days INTEGER,
  total_reviews INTEGER DEFAULT 0 NOT NULL,
  total_clicks INTEGER DEFAULT 0 NOT NULL,
  total_checkouts INTEGER DEFAULT 0 NOT NULL,
  publish_status TEXT DEFAULT 'published'::text NOT NULL,
  metadata_json JSONB,
  is_demo BOOLEAN DEFAULT false NOT NULL,
  trademark_risk TEXT DEFAULT 'low'::text NOT NULL,
  qc_score NUMERIC(5,2),
  source_project_id INTEGER,
  generation_status TEXT DEFAULT 'metadata_only'::text NOT NULL,
  cover_asset_id INTEGER
);

-- table: ai_service_price_rules
CREATE TABLE IF NOT EXISTS ai_platform.ai_service_price_rules (
  id SERIAL NOT NULL PRIMARY KEY,
  tenant_id TEXT,
  service_id INTEGER,
  rule_code TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  condition_type TEXT NOT NULL,
  condition_json JSONB,
  adjustment_type TEXT NOT NULL,
  adjustment_value NUMERIC(14,4) NOT NULL,
  minimum_charge NUMERIC(14,2),
  maximum_charge NUMERIC(14,2),
  priority INTEGER DEFAULT 0 NOT NULL,
  active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_service_price_rules_rule_code_unique UNIQUE (rule_code)
);

-- table: ai_service_requests
CREATE TABLE IF NOT EXISTS ai_platform.ai_service_requests (
  id SERIAL NOT NULL PRIMARY KEY,
  request_id TEXT NOT NULL,
  service_id INTEGER NOT NULL,
  package_id INTEGER,
  pricing_model_selected TEXT DEFAULT 'one_time'::text NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  company_name TEXT,
  notes TEXT,
  status TEXT DEFAULT 'draft'::text NOT NULL,
  created_project_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  tenant_id TEXT,
  customer_phone TEXT,
  brief_json JSONB,
  quantity INTEGER DEFAULT 1 NOT NULL,
  rush_speed TEXT,
  human_review_requested BOOLEAN DEFAULT false NOT NULL,
  extra_revisions INTEGER DEFAULT 0 NOT NULL,
  bilingual BOOLEAN DEFAULT false NOT NULL,
  editable_source_file BOOLEAN DEFAULT false NOT NULL,
  extended_usage_rights BOOLEAN DEFAULT false NOT NULL,
  currency TEXT DEFAULT 'IDR'::text NOT NULL,
  subtotal NUMERIC(14,2) DEFAULT '0'::numeric NOT NULL,
  rush_fee NUMERIC(14,2) DEFAULT '0'::numeric NOT NULL,
  revision_fee NUMERIC(14,2) DEFAULT '0'::numeric NOT NULL,
  human_review_fee NUMERIC(14,2) DEFAULT '0'::numeric NOT NULL,
  additional_service_fee NUMERIC(14,2) DEFAULT '0'::numeric NOT NULL,
  discount NUMERIC(14,2) DEFAULT '0'::numeric NOT NULL,
  tax NUMERIC(14,2) DEFAULT '0'::numeric NOT NULL,
  total NUMERIC(14,2) DEFAULT '0'::numeric NOT NULL,
  pricing_snapshot_json JSONB,
  estimated_ai_cost NUMERIC(14,2),
  actual_ai_cost NUMERIC(14,2),
  human_labor_estimate NUMERIC(14,2),
  gross_margin NUMERIC(14,2),
  gross_margin_percent NUMERIC(6,2),
  margin_approval_required BOOLEAN DEFAULT false NOT NULL,
  margin_approved_by TEXT,
  margin_approved_at TIMESTAMPTZ,
  completion_notes TEXT,
  completion_links JSONB,
  brief_guard_override_reason TEXT,
  brief_guard_override_by TEXT,
  brief_guard_override_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  CONSTRAINT ai_service_requests_request_id_unique UNIQUE (request_id)
);

-- table: ai_services
CREATE TABLE IF NOT EXISTS ai_platform.ai_services (
  id SERIAL NOT NULL PRIMARY KEY,
  category_id INTEGER NOT NULL,
  service_code TEXT NOT NULL,
  service_name TEXT NOT NULL,
  short_description TEXT,
  full_description TEXT,
  service_type TEXT DEFAULT 'project'::text NOT NULL,
  pricing_model TEXT DEFAULT 'one_time'::text NOT NULL,
  starting_price NUMERIC(12,2),
  currency TEXT DEFAULT 'USD'::text NOT NULL,
  estimated_delivery TEXT,
  human_review BOOLEAN DEFAULT false NOT NULL,
  ai_only BOOLEAN DEFAULT true NOT NULL,
  subscription_supported BOOLEAN DEFAULT false NOT NULL,
  enterprise_supported BOOLEAN DEFAULT false NOT NULL,
  department TEXT,
  workflow_summary TEXT,
  ai_employees_involved JSONB,
  deliverables JSONB,
  revision_policy TEXT,
  status TEXT DEFAULT 'active'::text NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  tenant_id TEXT,
  service_flow TEXT DEFAULT 'custom_project'::text NOT NULL,
  CONSTRAINT ai_services_service_code_unique UNIQUE (service_code)
);

-- table: ai_tasks
CREATE TABLE IF NOT EXISTS ai_platform.ai_tasks (
  id SERIAL NOT NULL PRIMARY KEY,
  company_id TEXT DEFAULT 'default'::text NOT NULL,
  task_number TEXT,
  source TEXT DEFAULT 'manual'::text NOT NULL,
  customer_id INTEGER,
  customer_name TEXT,
  customer_phone TEXT,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  division TEXT,
  priority TEXT DEFAULT 'medium'::text NOT NULL,
  status TEXT DEFAULT 'new_inquiry'::text NOT NULL,
  assigned_to TEXT,
  assigned_to_id INTEGER,
  assigned_role TEXT,
  assigned_division TEXT,
  assigned_vendor TEXT,
  driver_name TEXT,
  driver_phone TEXT,
  plate_number TEXT,
  quotation_amount TEXT,
  quotation_notes TEXT,
  due_date TIMESTAMPTZ,
  sla_hours INTEGER,
  overdue_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  sla_status TEXT DEFAULT 'on_track'::text NOT NULL,
  last_customer_reply_at TIMESTAMPTZ,
  follow_up_count INTEGER DEFAULT 0 NOT NULL,
  ai_summary TEXT,
  ai_intent TEXT,
  missing_data TEXT,
  required_action TEXT,
  admin_notes TEXT,
  ai_confidence_score TEXT,
  customer_sentiment TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: ai_template_analytics
CREATE TABLE IF NOT EXISTS ai_platform.ai_template_analytics (
  id SERIAL NOT NULL PRIMARY KEY,
  template_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  client_id TEXT,
  session_id TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: ai_template_brand_mappings
CREATE TABLE IF NOT EXISTS ai_platform.ai_template_brand_mappings (
  id SERIAL NOT NULL PRIMARY KEY,
  template_id INTEGER NOT NULL,
  brand_attribute TEXT NOT NULL,
  attribute_value TEXT NOT NULL,
  weight NUMERIC(4,3) DEFAULT 1.000 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_template_brand_mappings_template_attr_value UNIQUE (template_id, brand_attribute, attribute_value)
);

-- table: ai_template_industry_mappings
CREATE TABLE IF NOT EXISTS ai_platform.ai_template_industry_mappings (
  id SERIAL NOT NULL PRIMARY KEY,
  template_id INTEGER NOT NULL,
  industry TEXT NOT NULL,
  weight NUMERIC(4,3) DEFAULT 1.000 NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_template_industry_mappings_template_industry UNIQUE (template_id, industry)
);

-- table: ai_template_layouts
CREATE TABLE IF NOT EXISTS ai_platform.ai_template_layouts (
  id SERIAL NOT NULL PRIMARY KEY,
  layout_key TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  structure_json JSONB DEFAULT '{}'::jsonb NOT NULL,
  min_slots INTEGER DEFAULT 1 NOT NULL,
  max_slots INTEGER,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  layout_type TEXT NOT NULL,
  CONSTRAINT ai_template_layouts_layout_key_key UNIQUE (layout_key)
);

-- table: ai_template_package_mappings
CREATE TABLE IF NOT EXISTS ai_platform.ai_template_package_mappings (
  id SERIAL NOT NULL PRIMARY KEY,
  template_id INTEGER NOT NULL,
  service_code TEXT NOT NULL,
  weight NUMERIC(4,3) DEFAULT 1.000 NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_template_package_mappings_template_service UNIQUE (template_id, service_code)
);

-- table: ai_template_registry
CREATE TABLE IF NOT EXISTS ai_platform.ai_template_registry (
  id SERIAL NOT NULL PRIMARY KEY,
  template_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  status TEXT DEFAULT 'draft'::text NOT NULL,
  current_version_id INTEGER,
  thumbnail_url TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_template_registry_template_key_key UNIQUE (template_key)
);

-- table: ai_template_themes
CREATE TABLE IF NOT EXISTS ai_platform.ai_template_themes (
  id SERIAL NOT NULL PRIMARY KEY,
  theme_key TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT,
  tokens_json JSONB DEFAULT '{}'::jsonb NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_template_themes_theme_key_key UNIQUE (theme_key)
);

-- table: ai_template_versions
CREATE TABLE IF NOT EXISTS ai_platform.ai_template_versions (
  id SERIAL NOT NULL PRIMARY KEY,
  template_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL,
  status TEXT DEFAULT 'draft'::text NOT NULL,
  theme_id INTEGER,
  layout_id INTEGER,
  layout_spec_json JSONB DEFAULT '{}'::jsonb NOT NULL,
  theme_overrides_json JSONB DEFAULT '{}'::jsonb NOT NULL,
  changelog TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  published_at TIMESTAMPTZ,
  CONSTRAINT ai_template_versions_template_version UNIQUE (template_id, version_number)
);

-- table: ai_templates
CREATE TABLE IF NOT EXISTS ai_platform.ai_templates (
  id SERIAL NOT NULL PRIMARY KEY,
  template_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  style TEXT NOT NULL,
  industry TEXT,
  color_theme JSONB,
  typography JSONB,
  layout TEXT,
  supported_packages JSONB,
  brand_dna_tags JSONB,
  preview_images JSONB,
  pdf_preview_url TEXT,
  ppt_preview_url TEXT,
  cover_image TEXT,
  editable BOOLEAN DEFAULT true NOT NULL,
  is_premium BOOLEAN DEFAULT false NOT NULL,
  version TEXT DEFAULT '1.0'::text NOT NULL,
  status TEXT DEFAULT 'published'::text NOT NULL,
  featured BOOLEAN DEFAULT false NOT NULL,
  sort_order INTEGER DEFAULT 0 NOT NULL,
  price_points JSONB,
  views INTEGER DEFAULT 0 NOT NULL,
  selections INTEGER DEFAULT 0 NOT NULL,
  previews_generated INTEGER DEFAULT 0 NOT NULL,
  conversions INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT ai_templates_template_code_key UNIQUE (template_code)
);

-- table: ai_zip_deliveries
CREATE TABLE IF NOT EXISTS ai_platform.ai_zip_deliveries (
  id SERIAL NOT NULL PRIMARY KEY,
  project_id TEXT NOT NULL,
  job_id INTEGER,
  status TEXT DEFAULT 'queued'::text NOT NULL,
  storage_path TEXT,
  download_url TEXT,
  file_size_bytes BIGINT,
  checksum TEXT,
  manifest_json JSONB,
  error_message TEXT,
  retry_count INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: cp_document_versions
CREATE TABLE IF NOT EXISTS ai_platform.cp_document_versions (
  id SERIAL NOT NULL PRIMARY KEY,
  project_id TEXT NOT NULL,
  review_id INTEGER,
  asset_id INTEGER,
  version INTEGER DEFAULT 1 NOT NULL,
  version_label TEXT,
  reason TEXT,
  revision_notes TEXT,
  sections_json JSONB,
  qc_score INTEGER,
  qc_passed BOOLEAN,
  qc_dimensions_json JSONB,
  approved BOOLEAN DEFAULT false NOT NULL,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  sent_for_review_at TIMESTAMPTZ,
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: cp_page_comments
CREATE TABLE IF NOT EXISTS ai_platform.cp_page_comments (
  id SERIAL NOT NULL PRIMARY KEY,
  review_id INTEGER NOT NULL,
  project_id TEXT NOT NULL,
  document_version_id INTEGER,
  parent_comment_id INTEGER,
  page_number INTEGER,
  position_x REAL,
  position_y REAL,
  section_id TEXT,
  comment TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_type TEXT DEFAULT 'client'::text NOT NULL,
  priority TEXT DEFAULT 'normal'::text NOT NULL,
  status TEXT DEFAULT 'open'::text NOT NULL,
  resolved_by TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: creative_project_quotations
CREATE TABLE IF NOT EXISTS ai_platform.creative_project_quotations (
  id SERIAL NOT NULL PRIMARY KEY,
  project_id TEXT NOT NULL,
  currency TEXT DEFAULT 'IDR'::text NOT NULL,
  line_items JSONB NOT NULL,
  discount INTEGER DEFAULT 0 NOT NULL,
  tax_percent INTEGER DEFAULT 0 NOT NULL,
  subtotal INTEGER DEFAULT 0 NOT NULL,
  tax_amount INTEGER DEFAULT 0 NOT NULL,
  total INTEGER DEFAULT 0 NOT NULL,
  notes TEXT,
  valid_until TIMESTAMPTZ,
  status TEXT DEFAULT 'draft'::text NOT NULL,
  sent_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  response_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT creative_project_quotations_project_id_key UNIQUE (project_id)
);

-- table: customer_contexts
CREATE TABLE IF NOT EXISTS ai_platform.customer_contexts (
  id SERIAL NOT NULL PRIMARY KEY,
  company_id TEXT DEFAULT 'default'::text NOT NULL,
  phone TEXT NOT NULL,
  name TEXT,
  company_name TEXT,
  frequent_service TEXT,
  special_notes TEXT,
  previous_intents TEXT,
  total_tasks INTEGER DEFAULT 0 NOT NULL,
  last_active_task_id INTEGER,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: customer_notification_reads
CREATE TABLE IF NOT EXISTS ai_platform.customer_notification_reads (
  id SERIAL NOT NULL PRIMARY KEY,
  email_hash TEXT NOT NULL,
  notification_key TEXT NOT NULL,
  read_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT customer_notification_reads_email_key_uq UNIQUE (email_hash, notification_key)
);

-- table: customer_profiles
CREATE TABLE IF NOT EXISTS ai_platform.customer_profiles (
  id SERIAL NOT NULL PRIMARY KEY,
  email_hash TEXT NOT NULL,
  client_email TEXT NOT NULL,
  company_name TEXT,
  address TEXT,
  pic_name TEXT,
  pic_phone TEXT,
  billing_email TEXT,
  tax_id TEXT,
  payment_method_notes TEXT,
  brand_preferences JSONB,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT customer_profiles_email_hash_key UNIQUE (email_hash)
);

-- table: customer_support_tickets
CREATE TABLE IF NOT EXISTS ai_platform.customer_support_tickets (
  id SERIAL NOT NULL PRIMARY KEY,
  email_hash TEXT NOT NULL,
  client_email TEXT NOT NULL,
  client_name TEXT NOT NULL,
  project_id TEXT,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  category TEXT DEFAULT 'general'::text NOT NULL,
  status TEXT DEFAULT 'open'::text NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: data_template_fields
CREATE TABLE IF NOT EXISTS ai_platform.data_template_fields (
  id SERIAL NOT NULL PRIMARY KEY,
  template_id INTEGER NOT NULL,
  field_name TEXT NOT NULL,
  field_label TEXT NOT NULL,
  field_type TEXT DEFAULT 'text'::text NOT NULL,
  is_required BOOLEAN DEFAULT true NOT NULL,
  sort_order INTEGER DEFAULT 0 NOT NULL,
  help_text TEXT,
  placeholder TEXT,
  options JSONB,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: dispatcher_logs
CREATE TABLE IF NOT EXISTS ai_platform.dispatcher_logs (
  id SERIAL NOT NULL PRIMARY KEY,
  company_id TEXT DEFAULT 'default'::text NOT NULL,
  task_id INTEGER NOT NULL,
  task_number TEXT,
  task_title TEXT,
  task_category TEXT,
  task_priority TEXT,
  task_sla_status TEXT,
  suggested_member_id INTEGER,
  suggested_member_name TEXT,
  suggested_member_role TEXT,
  suggested_member_division TEXT,
  assigned_member_name TEXT,
  was_overridden BOOLEAN DEFAULT false,
  override_reason TEXT,
  total_score REAL,
  workload_score REAL,
  skill_score REAL,
  urgency_score REAL,
  availability_score REAL,
  explanation TEXT,
  all_candidates_json TEXT,
  dispatched_by TEXT,
  dispatched_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: document_audits
CREATE TABLE IF NOT EXISTS ai_platform.document_audits (
  id SERIAL NOT NULL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  audit_status TEXT DEFAULT 'pending'::text NOT NULL,
  complete_fields TEXT[] DEFAULT '{}'::text[] NOT NULL,
  missing_fields TEXT[] DEFAULT '{}'::text[] NOT NULL,
  mismatch_fields TEXT[] DEFAULT '{}'::text[] NOT NULL,
  unclear_fields TEXT[] DEFAULT '{}'::text[] NOT NULL,
  recommendation TEXT,
  next_action TEXT,
  audit_detail JSONB,
  cross_doc_detail JSONB,
  cross_doc_warnings TEXT[] DEFAULT '{}'::text[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: document_template_fields
CREATE TABLE IF NOT EXISTS ai_platform.document_template_fields (
  id SERIAL NOT NULL PRIMARY KEY,
  template_id INTEGER NOT NULL,
  document_name TEXT NOT NULL,
  document_type TEXT,
  is_required BOOLEAN DEFAULT true NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: document_templates
CREATE TABLE IF NOT EXISTS ai_platform.document_templates (
  id SERIAL NOT NULL PRIMARY KEY,
  company_id TEXT DEFAULT 'default'::text NOT NULL,
  name TEXT NOT NULL,
  intent_code TEXT,
  category TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: documents
CREATE TABLE IF NOT EXISTS ai_platform.documents (
  id SERIAL NOT NULL PRIMARY KEY,
  filename TEXT NOT NULL,
  file_url TEXT,
  storage_path TEXT,
  mime_type TEXT,
  file_size INTEGER,
  status TEXT DEFAULT 'pending'::text NOT NULL,
  audit_summary TEXT,
  audit_issues TEXT[] DEFAULT '{}'::text[] NOT NULL,
  audit_score INTEGER,
  task_id INTEGER,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: driver_documents
CREATE TABLE IF NOT EXISTS ai_platform.driver_documents (
  id SERIAL NOT NULL PRIMARY KEY,
  driver_id INTEGER NOT NULL,
  document_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT,
  object_path TEXT,
  is_current BOOLEAN DEFAULT true NOT NULL,
  is_verified BOOLEAN DEFAULT false NOT NULL,
  verification_notes TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

-- table: driver_portal_tokens
CREATE TABLE IF NOT EXISTS ai_platform.driver_portal_tokens (
  id SERIAL NOT NULL PRIMARY KEY,
  token TEXT NOT NULL,
  driver_id INTEGER,
  phone TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  is_revoked BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT driver_portal_tokens_token_key UNIQUE (token)
);

-- table: executive_briefing_logs
CREATE TABLE IF NOT EXISTS ai_platform.executive_briefing_logs (
  id SERIAL NOT NULL PRIMARY KEY,
  company_id TEXT DEFAULT 'default'::text NOT NULL,
  recipient_phone TEXT NOT NULL,
  recipient_role TEXT,
  status TEXT DEFAULT 'pending'::text NOT NULL,
  message_preview TEXT,
  sent_at TIMESTAMPTZ,
  error_message TEXT,
  delivery_provider TEXT DEFAULT 'fonnte'::text NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: fleet_driver_performance
CREATE TABLE IF NOT EXISTS ai_platform.fleet_driver_performance (
  id SERIAL NOT NULL PRIMARY KEY,
  driver_id INTEGER NOT NULL,
  company_id TEXT DEFAULT 'default'::text NOT NULL,
  period_month TEXT NOT NULL,
  period_start DATE,
  period_end DATE,
  total_trips INTEGER DEFAULT 0 NOT NULL,
  total_distance_km NUMERIC(10,2) DEFAULT 0 NOT NULL,
  avg_fuel_efficiency NUMERIC(6,2),
  incidents_count INTEGER DEFAULT 0 NOT NULL,
  on_time_deliveries INTEGER DEFAULT 0 NOT NULL,
  overall_score NUMERIC(5,2),
  safety_score NUMERIC(5,2),
  punctuality_score NUMERIC(5,2),
  fuel_score NUMERIC(5,2),
  utilization_score NUMERIC(5,2),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: follow_up_logs
CREATE TABLE IF NOT EXISTS ai_platform.follow_up_logs (
  id SERIAL NOT NULL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  company_id TEXT DEFAULT 'default'::text NOT NULL,
  customer_phone TEXT,
  customer_name TEXT,
  follow_up_number INTEGER DEFAULT 1 NOT NULL,
  message TEXT NOT NULL,
  channel TEXT DEFAULT 'whatsapp'::text NOT NULL,
  is_success BOOLEAN DEFAULT false NOT NULL,
  error_message TEXT,
  sent_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: internal_users
CREATE TABLE IF NOT EXISTS ai_platform.internal_users (
  id SERIAL NOT NULL PRIMARY KEY,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'internal_staff'::text NOT NULL,
  account_type TEXT DEFAULT 'internal'::text NOT NULL,
  status TEXT DEFAULT 'active'::text NOT NULL,
  must_change_password BOOLEAN DEFAULT true NOT NULL,
  password_changed_at TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT uq_internal_users_email UNIQUE (email),
  CONSTRAINT chk_internal_users_role CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'internal_staff'::text]))),
  CONSTRAINT chk_internal_users_account_type CHECK ((account_type = 'internal'::text)),
  CONSTRAINT chk_internal_users_status CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text])))
);

-- table: marketplace_assets
CREATE TABLE IF NOT EXISTS ai_platform.marketplace_assets (
  id SERIAL NOT NULL PRIMARY KEY,
  asset_code TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  tags JSONB DEFAULT '[]'::jsonb NOT NULL,
  creator_id INTEGER,
  price_type TEXT DEFAULT 'free'::text NOT NULL,
  price_amount NUMERIC(12,2) DEFAULT 0 NOT NULL,
  currency TEXT DEFAULT 'IDR'::text NOT NULL,
  file_url TEXT,
  preview_urls JSONB DEFAULT '[]'::jsonb NOT NULL,
  thumbnail_url TEXT,
  file_size_bytes BIGINT,
  file_format TEXT,
  license TEXT DEFAULT 'standard'::text NOT NULL,
  is_featured BOOLEAN DEFAULT false NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  downloads_count INTEGER DEFAULT 0 NOT NULL,
  views_count INTEGER DEFAULT 0 NOT NULL,
  favorites_count INTEGER DEFAULT 0 NOT NULL,
  avg_rating NUMERIC(3,2) DEFAULT 0 NOT NULL,
  ratings_count INTEGER DEFAULT 0 NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT marketplace_assets_asset_code_key UNIQUE (asset_code)
);

-- table: marketplace_creators
CREATE TABLE IF NOT EXISTS ai_platform.marketplace_creators (
  id SERIAL NOT NULL PRIMARY KEY,
  creator_code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  bio TEXT,
  avatar_url TEXT,
  website_url TEXT,
  email TEXT,
  is_verified BOOLEAN DEFAULT false NOT NULL,
  is_active BOOLEAN DEFAULT true NOT NULL,
  total_assets INTEGER DEFAULT 0 NOT NULL,
  total_downloads INTEGER DEFAULT 0 NOT NULL,
  avg_rating NUMERIC(3,2) DEFAULT 0 NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT marketplace_creators_creator_code_key UNIQUE (creator_code)
);

-- table: marketplace_downloads
CREATE TABLE IF NOT EXISTS ai_platform.marketplace_downloads (
  id SERIAL NOT NULL PRIMARY KEY,
  customer_email TEXT,
  item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  ip_address TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: marketplace_favorites
CREATE TABLE IF NOT EXISTS ai_platform.marketplace_favorites (
  id SERIAL NOT NULL PRIMARY KEY,
  customer_email TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT marketplace_favorites_customer_email_item_type_item_id_key UNIQUE (customer_email, item_type, item_id)
);

-- table: marketplace_ratings
CREATE TABLE IF NOT EXISTS ai_platform.marketplace_ratings (
  id SERIAL NOT NULL PRIMARY KEY,
  customer_email TEXT NOT NULL,
  item_type TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  rating INTEGER NOT NULL,
  review TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT marketplace_ratings_customer_email_item_type_item_id_key UNIQUE (customer_email, item_type, item_id),
  CONSTRAINT marketplace_ratings_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);

-- table: notification_receivers
CREATE TABLE IF NOT EXISTS ai_platform.notification_receivers (
  id SERIAL NOT NULL PRIMARY KEY,
  company_id TEXT DEFAULT 'default'::text NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: operational_checklists
CREATE TABLE IF NOT EXISTS ai_platform.operational_checklists (
  id SERIAL NOT NULL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  task_type TEXT DEFAULT 'ai_task'::text NOT NULL,
  company_id TEXT DEFAULT 'default'::text NOT NULL,
  item_name TEXT NOT NULL,
  is_done BOOLEAN DEFAULT false NOT NULL,
  done_at TIMESTAMPTZ,
  done_by TEXT,
  notes TEXT,
  sort_order INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: portfolio_reviews
CREATE TABLE IF NOT EXISTS ai_platform.portfolio_reviews (
  id SERIAL NOT NULL PRIMARY KEY,
  service_id INTEGER NOT NULL,
  portfolio_id INTEGER,
  rating INTEGER NOT NULL,
  review TEXT NOT NULL,
  company TEXT NOT NULL,
  industry TEXT,
  client_name TEXT,
  featured BOOLEAN DEFAULT false NOT NULL,
  status TEXT DEFAULT 'published'::text NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  verified BOOLEAN DEFAULT false NOT NULL
);

-- table: public_tokens
CREATE TABLE IF NOT EXISTS ai_platform.public_tokens (
  id SERIAL NOT NULL PRIMARY KEY,
  token TEXT NOT NULL,
  task_id INTEGER NOT NULL,
  token_type TEXT NOT NULL,
  created_by TEXT,
  expires_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  is_revoked BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  CONSTRAINT public_tokens_token_key UNIQUE (token)
);

-- table: sales_funnel_events
CREATE TABLE IF NOT EXISTS ai_platform.sales_funnel_events (
  id SERIAL NOT NULL PRIMARY KEY,
  visitor_id TEXT,
  customer_id INTEGER,
  session_id TEXT,
  event_type TEXT NOT NULL,
  service_id INTEGER,
  portfolio_id INTEGER,
  project_id TEXT,
  package_id INTEGER,
  campaign_id TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  device TEXT,
  country TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: shipment_events
CREATE TABLE IF NOT EXISTS ai_platform.shipment_events (
  id SERIAL NOT NULL PRIMARY KEY,
  tracking_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  event_time TIMESTAMPTZ NOT NULL,
  event_code TEXT,
  event_description TEXT NOT NULL,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: shipment_trackings
CREATE TABLE IF NOT EXISTS ai_platform.shipment_trackings (
  id SERIAL NOT NULL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  company_id TEXT DEFAULT 'default'::text NOT NULL,
  tracking_type TEXT DEFAULT 'container'::text NOT NULL,
  tracking_number TEXT,
  carrier_name TEXT,
  vessel_name TEXT,
  voyage_number TEXT,
  port_of_loading TEXT,
  port_of_discharge TEXT,
  etd TIMESTAMPTZ,
  eta TIMESTAMPTZ,
  atd TIMESTAMPTZ,
  ata TIMESTAMPTZ,
  current_status TEXT,
  current_location TEXT,
  last_updated_at TIMESTAMPTZ,
  raw_data TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: sport_center_bookings
CREATE TABLE IF NOT EXISTS ai_platform.sport_center_bookings (
  id SERIAL NOT NULL PRIMARY KEY,
  company_id TEXT DEFAULT 'default'::text NOT NULL,
  ai_task_id INTEGER,
  intake_session_id INTEGER,
  field_type TEXT DEFAULT 'Umum'::text NOT NULL,
  booking_date DATE NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  duration_hours NUMERIC(4,2),
  booker_name TEXT,
  phone TEXT,
  status TEXT DEFAULT 'pending'::text NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: task_assignments
CREATE TABLE IF NOT EXISTS ai_platform.task_assignments (
  id SERIAL NOT NULL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  assigned_to TEXT,
  assigned_role TEXT,
  assigned_division TEXT,
  assigned_vendor TEXT,
  assigned_by TEXT,
  status TEXT DEFAULT 'active'::text NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: task_attachments
CREATE TABLE IF NOT EXISTS ai_platform.task_attachments (
  id SERIAL NOT NULL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT,
  object_path TEXT,
  mime_type TEXT,
  file_size INTEGER,
  file_type TEXT,
  document_type TEXT,
  ocr_status TEXT DEFAULT 'pending'::text,
  extracted_text TEXT,
  extracted_fields JSONB,
  uploaded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: task_comments
CREATE TABLE IF NOT EXISTS ai_platform.task_comments (
  id SERIAL NOT NULL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  sender_type TEXT DEFAULT 'agent'::text NOT NULL,
  sender_name TEXT,
  comment TEXT NOT NULL,
  attachment_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: task_timeline
CREATE TABLE IF NOT EXISTS ai_platform.task_timeline (
  id SERIAL NOT NULL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  actor TEXT,
  actor_type TEXT DEFAULT 'system'::text NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: tasks
CREATE TABLE IF NOT EXISTS ai_platform.tasks (
  id SERIAL NOT NULL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending'::text NOT NULL,
  priority TEXT DEFAULT 'medium'::text NOT NULL,
  assignee_id INTEGER,
  assigned_role TEXT,
  assigned_division TEXT,
  assigned_vendor TEXT,
  customer_name TEXT,
  source_message_id INTEGER,
  due_date TEXT,
  tags TEXT[] DEFAULT '{}'::text[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: team_members
CREATE TABLE IF NOT EXISTS ai_platform.team_members (
  id SERIAL NOT NULL PRIMARY KEY,
  company_id TEXT DEFAULT 'default'::text NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  division TEXT,
  is_vendor TEXT DEFAULT 'false'::text,
  is_active BOOLEAN DEFAULT true NOT NULL,
  phone TEXT,
  email TEXT,
  avatar_url TEXT,
  skills TEXT,
  max_active_tasks INTEGER,
  current_task_count INTEGER DEFAULT 0 NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- table: whatsapp_notifications
CREATE TABLE IF NOT EXISTS ai_platform.whatsapp_notifications (
  id SERIAL NOT NULL PRIMARY KEY,
  task_id INTEGER,
  company_id TEXT DEFAULT 'default'::text NOT NULL,
  recipient_phone TEXT NOT NULL,
  recipient_type TEXT DEFAULT 'customer'::text NOT NULL,
  template_name TEXT,
  message_text TEXT NOT NULL,
  status TEXT DEFAULT 'pending'::text NOT NULL,
  external_message_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
