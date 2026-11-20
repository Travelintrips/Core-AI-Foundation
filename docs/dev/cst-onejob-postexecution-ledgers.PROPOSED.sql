-- PROPOSAL ONLY: CST-DEV xssrfshdrtdfupgqwfdw. Not applied.
-- Requires approved independent subscriber/QA/final issuer custody,
-- private role grants, reviewed transaction boundaries, and a DEV change window.
-- No privileges or live credentials are provided by this SQL.
CREATE SCHEMA IF NOT EXISTS cst_onejob_private;
REVOKE ALL ON SCHEMA cst_onejob_private FROM PUBLIC;

CREATE TABLE cst_onejob_private.subscriber_delivery_receipts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  approval_id uuid NOT NULL UNIQUE
    REFERENCES ai_platform.cst_onejob_owner_approvals(id),
  job_id integer NOT NULL UNIQUE REFERENCES ai_platform.ai_jobs(id),
  event_id uuid NOT NULL UNIQUE,
  delivery_id uuid NOT NULL UNIQUE,
  subscriber_id text NOT NULL
    CHECK (subscriber_id ~ '^cst-onejob-subscriber-[a-z0-9_-]{4,64}$'),
  correlation_id uuid NOT NULL,
  delivery_digest text NOT NULL UNIQUE CHECK (delivery_digest ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status='ACKNOWLEDGED'),
  ack_nonce text NOT NULL UNIQUE CHECK (ack_nonce ~ '^[a-f0-9]{64}$'),
  ack_signature_base64 text NOT NULL
    CHECK (length(ack_signature_base64) BETWEEN 84 AND 92),
  ack_issuer_fingerprint text NOT NULL
    CHECK (ack_issuer_fingerprint ~ '^[a-f0-9]{64}$'),
  received_at timestamptz NOT NULL,
  ack_expires_at timestamptz NOT NULL,
  CONSTRAINT cst_onejob_signed_subscriber_ack_ttl CHECK (
    ack_expires_at > received_at AND
    ack_expires_at <= received_at + interval '5 minutes'
  ),
  UNIQUE(event_id,subscriber_id)
);
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.subscriber_delivery_receipts FROM PUBLIC;

CREATE TABLE cst_onejob_private.post_execution_qa_receipts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  approval_id uuid NOT NULL UNIQUE
    REFERENCES ai_platform.cst_onejob_owner_approvals(id),
  job_id integer NOT NULL UNIQUE REFERENCES ai_platform.ai_jobs(id),
  delivery_id uuid NOT NULL UNIQUE
    REFERENCES cst_onejob_private.subscriber_delivery_receipts(delivery_id),
  verifier_id text NOT NULL
    CHECK (verifier_id ~ '^cst-independent-qa-[a-z0-9_-]{8,80}$'),
  stage text NOT NULL CHECK (stage='POST_EXECUTION'),
  nonce text NOT NULL UNIQUE CHECK (nonce ~ '^[a-f0-9]{64}$'),
  proof_digest text NOT NULL UNIQUE CHECK (proof_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest text NOT NULL CHECK (evidence_digest ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT cst_onejob_post_receipt_ttl CHECK (
    expires_at>verified_at AND
    expires_at<=verified_at+interval '5 minutes'
  )
);
ALTER TABLE cst_onejob_private.post_execution_qa_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.post_execution_qa_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.post_execution_qa_receipts FROM PUBLIC;

CREATE TABLE cst_onejob_private.final_ack_reconciliations (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  approval_id uuid NOT NULL UNIQUE
    REFERENCES ai_platform.cst_onejob_owner_approvals(id),
  job_id integer NOT NULL UNIQUE REFERENCES ai_platform.ai_jobs(id),
  delivery_id uuid NOT NULL UNIQUE
    REFERENCES cst_onejob_private.subscriber_delivery_receipts(delivery_id),
  post_receipt_id uuid NOT NULL UNIQUE
    REFERENCES cst_onejob_private.post_execution_qa_receipts(id),
  final_ack_id uuid NOT NULL UNIQUE,
  independently_verified_by text NOT NULL,
  issued_at timestamptz NOT NULL,
  source_digest text NOT NULL CHECK (source_digest ~ '^[a-f0-9]{64}$'),
  ack_signature_base64 text NOT NULL
    CHECK (length(ack_signature_base64) BETWEEN 84 AND 92),
  issuer_public_fingerprint text NOT NULL
    CHECK (issuer_public_fingerprint ~ '^[a-f0-9]{64}$'),
  ack_claims_digest text NOT NULL UNIQUE CHECK (ack_claims_digest ~ '^[a-f0-9]{64}$')
);
ALTER TABLE cst_onejob_private.final_ack_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.final_ack_reconciliations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.final_ack_reconciliations FROM PUBLIC;

-- No writable policies and no role grants. The proposal is NOT operational.
-- A separately reviewed, dedicated independent subscriber/QA/Final ACK
-- service must cryptographically verify proofs before attempting any write.
