-- Migration: Fashion Design Revision Flow (Team 18)
-- Adds human-touch revision workflow tables and columns
-- Safe to run multiple times (uses IF NOT EXISTS / IF NOT EXISTS guards)

-- 1. Add designer assignment columns to fashion_design_orders
ALTER TABLE ai_platform.fashion_design_orders
  ADD COLUMN IF NOT EXISTS designer_name TEXT,
  ADD COLUMN IF NOT EXISTS designer_email TEXT;

-- 2. Add new revision statuses to the status column (text column, no enum constraint)
-- No migration needed — status is a plain TEXT column

-- 3. Create the fashion_design_revisions table
CREATE TABLE IF NOT EXISTS ai_platform.fashion_design_revisions (
  id               SERIAL PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES ai_platform.fashion_design_orders(id) ON DELETE CASCADE,
  type             TEXT    NOT NULL, -- customer_request | designer_assignment | designer_upload
  status           TEXT    NOT NULL DEFAULT 'pending', -- pending | in_progress | completed
  feedback         TEXT,            -- customer revision feedback text
  reference_urls   JSONB   NOT NULL DEFAULT '[]',      -- customer reference image URLs
  designer_name    TEXT,            -- assigned designer name
  designer_email   TEXT,            -- assigned designer email
  revised_file_urls JSONB  NOT NULL DEFAULT '[]',      -- designer uploaded file URLs
  notes            TEXT,            -- admin/designer notes
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Index for efficient per-order lookups
CREATE INDEX IF NOT EXISTS idx_fashion_revisions_order_id
  ON ai_platform.fashion_design_revisions(order_id);
