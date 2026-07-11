-- ============================================================
-- P1.1 Customer Workspace Migration
-- Sprint: API Standardization, Invoice PDF, Security Audit
-- Target schema: ai_platform
-- ============================================================
-- ADDITIVE ONLY. No DROP, no TRUNCATE, no data overwrite.
-- Run preflight.sql first. Then apply this file.
-- ============================================================

SET search_path TO ai_platform, public;

-- ── 1. ai_customer_documents ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.ai_customer_documents (
    id                  SERIAL PRIMARY KEY,
    customer_id         TEXT    NOT NULL,          -- email_hash of the customer
    client_email        TEXT    NOT NULL,
    project_id          TEXT,                      -- creative_projects.project_id (nullable)
    service_request_id  TEXT,                      -- ai_service_requests.request_id (nullable)
    quotation_id        INTEGER,                   -- ai_quotations.id (nullable)
    payment_schedule_id INTEGER,                   -- ai_payment_schedule.id (nullable)
    document_type       TEXT    NOT NULL,          -- deposit_invoice|remaining_invoice|final_invoice|payment_receipt|quotation|delivery_package
    document_number     TEXT    NOT NULL,          -- human-readable e.g. INV-202607-0001
    file_name           TEXT    NOT NULL,
    storage_path        TEXT    NOT NULL,          -- internal — NEVER expose to client
    mime_type           TEXT    NOT NULL DEFAULT 'application/pdf',
    file_size           BIGINT,
    status              TEXT    NOT NULL DEFAULT 'draft', -- draft|generating|issued|voided
    snapshot_json       JSONB,                     -- frozen invoice data at generation time
    generated_at        TIMESTAMPTZ,
    voided_at           TIMESTAMPTZ,
    metadata_json       JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_customer_doc_number UNIQUE (customer_id, document_number)
);

COMMENT ON TABLE ai_platform.ai_customer_documents IS 'Server-generated PDF documents (invoices, receipts) for customers. storage_path is internal — never returned to client.';
COMMENT ON COLUMN ai_platform.ai_customer_documents.storage_path IS 'Internal file path. Never expose to client. Use signed access tokens.';
COMMENT ON COLUMN ai_platform.ai_customer_documents.snapshot_json IS 'Frozen snapshot of invoice data at generation time. Never re-reads live data.';

-- ── 2. ai_customer_impersonation_tokens ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_platform.ai_customer_impersonation_tokens (
    id          SERIAL PRIMARY KEY,
    email_hash  TEXT        NOT NULL,   -- target customer
    client_email TEXT       NOT NULL,
    token_hash  TEXT        NOT NULL UNIQUE, -- SHA-256 of plaintext impersonation token
    issued_by   TEXT        NOT NULL DEFAULT 'admin',
    reason      TEXT        NOT NULL,   -- mandatory for audit
    readonly    BOOLEAN     NOT NULL DEFAULT TRUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    ended_at    TIMESTAMPTZ,            -- set when admin explicitly ends session
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE ai_platform.ai_customer_impersonation_tokens IS 'Short-lived admin impersonation tokens. Separate from customer_dashboard_tokens so real customer token is never overwritten.';
COMMENT ON COLUMN ai_platform.ai_customer_impersonation_tokens.reason IS 'Mandatory reason for audit trail.';

-- ── 3. Indexes ────────────────────────────────────────────────────────────────

-- customer_dashboard_tokens
CREATE INDEX IF NOT EXISTS idx_cdt_email_hash ON ai_platform.customer_dashboard_tokens (email_hash);
CREATE INDEX IF NOT EXISTS idx_cdt_expires_at ON ai_platform.customer_dashboard_tokens (expires_at);

-- ai_customer_documents
CREATE INDEX IF NOT EXISTS idx_acd_customer_id ON ai_platform.ai_customer_documents (customer_id);
CREATE INDEX IF NOT EXISTS idx_acd_project_id  ON ai_platform.ai_customer_documents (project_id);
CREATE INDEX IF NOT EXISTS idx_acd_doc_type    ON ai_platform.ai_customer_documents (document_type);
CREATE INDEX IF NOT EXISTS idx_acd_created_at  ON ai_platform.ai_customer_documents (created_at DESC);

-- ai_customer_impersonation_tokens
CREATE INDEX IF NOT EXISTS idx_acit_email_hash ON ai_platform.ai_customer_impersonation_tokens (email_hash);
CREATE INDEX IF NOT EXISTS idx_acit_expires_at ON ai_platform.ai_customer_impersonation_tokens (expires_at);

-- customer_notification_reads
CREATE INDEX IF NOT EXISTS idx_cnr_email_hash ON ai_platform.customer_notification_reads (email_hash);

-- customer_support_tickets
CREATE INDEX IF NOT EXISTS idx_cst_email_hash ON ai_platform.customer_support_tickets (email_hash);
CREATE INDEX IF NOT EXISTS idx_cst_status      ON ai_platform.customer_support_tickets (status);
CREATE INDEX IF NOT EXISTS idx_cst_created_at  ON ai_platform.customer_support_tickets (created_at DESC);

-- creative_projects — customer isolation queries
CREATE INDEX IF NOT EXISTS idx_cp_status       ON ai_platform.creative_projects (status);
CREATE INDEX IF NOT EXISTS idx_cp_payment_status ON ai_platform.creative_projects (payment_status);
CREATE INDEX IF NOT EXISTS idx_cp_created_at   ON ai_platform.creative_projects (created_at DESC);

-- ai_service_requests — customer email lookup
CREATE INDEX IF NOT EXISTS idx_asr_customer_email ON ai_platform.ai_service_requests (customer_email);
CREATE INDEX IF NOT EXISTS idx_asr_status          ON ai_platform.ai_service_requests (status);

-- ai_invoices — project lookup
CREATE INDEX IF NOT EXISTS idx_ai_project_id   ON ai_platform.ai_invoices (project_id);
CREATE INDEX IF NOT EXISTS idx_ai_status        ON ai_platform.ai_invoices (status);

-- ai_payment_schedule
CREATE INDEX IF NOT EXISTS idx_aps_project_id  ON ai_platform.ai_payment_schedule (project_id);
CREATE INDEX IF NOT EXISTS idx_aps_status       ON ai_platform.ai_payment_schedule (status);

-- customer_profiles
CREATE INDEX IF NOT EXISTS idx_cp_profile_email_hash ON ai_platform.customer_profiles (email_hash);

-- ai_audit_logs — resource lookup (used by activity feed)
CREATE INDEX IF NOT EXISTS idx_aal_resource_id  ON ai_platform.ai_audit_logs (resource_id);
CREATE INDEX IF NOT EXISTS idx_aal_created_at   ON ai_platform.ai_audit_logs (created_at DESC);

-- creative_ai_client_reviews — client email lookup
CREATE INDEX IF NOT EXISTS idx_cacr_client_email ON ai_platform.creative_ai_client_reviews (client_email);

