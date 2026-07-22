-- Seed AI Sales Manager employee — Sprint P2.5
-- Run after p25-commercial-layer.sql
--
-- Canonical table: ai_employees (NOT the stale ai_digital_employees reference)
-- Columns that have no direct mapping (specialization, personality_traits,
-- communication_style, working_hours, capabilities) are stored in metadata JSONB.
--
-- Idempotent: ON CONFLICT DO NOTHING preserves any existing employee record.

SET search_path TO ai_platform;

INSERT INTO ai_employees (
  employee_code,
  employee_name,
  position,
  role,
  level,
  status,
  metadata
)
VALUES (
  'EMP-SALES-001',
  'Sales AI Manager',
  'AI Sales & Growth Manager',
  'manager',
  'senior',
  'active',
  jsonb_build_object(
    'department',          'Sales',
    'specialization',      ARRAY['sales_funnel_optimization','upsell_cross_sell','coupon_management','affiliate_management','customer_health'],
    'personality_traits',  ARRAY['analytical','persuasive','data-driven','customer-centric'],
    'communication_style', 'professional',
    'working_hours',       '{"start":"08:00","end":"20:00","timezone":"Asia/Jakarta"}',
    'capabilities',        ARRAY['analyze_funnel','recommend_promotions','generate_insights','manage_affiliates','score_customers']
  )
)
ON CONFLICT (employee_code) DO NOTHING;
