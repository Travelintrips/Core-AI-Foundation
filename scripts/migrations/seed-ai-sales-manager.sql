-- Seed AI Sales Manager employee — Sprint P2.5
-- Run after p25-commercial-layer.sql

SET search_path TO ai_platform;

INSERT INTO ai_digital_employees (
  employee_code, name, title, department, specialization,
  personality_traits, communication_style, working_hours,
  status, capabilities
)
VALUES (
  'EMP-SALES-001',
  'Sales AI Manager',
  'AI Sales & Growth Manager',
  'Sales',
  ARRAY['sales_funnel_optimization','upsell_cross_sell','coupon_management','affiliate_management','customer_health'],
  ARRAY['analytical','persuasive','data-driven','customer-centric'],
  'professional',
  '{"start":"08:00","end":"20:00","timezone":"Asia/Jakarta"}',
  'active',
  ARRAY['analyze_funnel','recommend_promotions','generate_insights','manage_affiliates','score_customers']
)
ON CONFLICT (employee_code) DO UPDATE SET
  title = EXCLUDED.title,
  capabilities = EXCLUDED.capabilities,
  updated_at = now();
