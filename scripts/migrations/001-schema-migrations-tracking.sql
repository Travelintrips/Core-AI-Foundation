-- Migration 001: Create schema_migrations tracking table
-- This table records which DDL migrations have been applied.
-- Safe to run multiple times (idempotent).

CREATE SCHEMA IF NOT EXISTS ai_platform;

CREATE TABLE IF NOT EXISTS ai_platform.schema_migrations (
  version    TEXT        NOT NULL PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  checksum   TEXT
);

COMMENT ON TABLE ai_platform.schema_migrations IS
  'Tracks applied DDL migration scripts. Managed by scripts/db-migrate.sh.';
