-- PROPOSED ONLY — NOT APPLIED to CST-DEV or PROD.
-- Requires separately approved independent QA and subscriber secret/key custody,
-- scoped invoker RLS/grants and privileged live migration review.
-- Independent proof provenance is validated OUTSIDE PostgreSQL.
-- Inserting a row is NEVER authorization to dispatch or issue Final ACK.
CREATE SCHEMA IF NOT EXISTS cst_onejob_private;
REVOKE ALL ON SCHEMA cst_onejob_private FROM PUBLIC;

-- Explicit subscriber delivery receipt, NOT inferred from ai_events.processed.
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
  status text NOT NULL CHECK(status='ACKNOWLEDGED'),
  ack_nonce text NOT NULL UNIQUE CHECK (ack_nonce ~ '^[a-f0-9]{64} timestamptz NOT NULL,
  UNIQUE(event_id,subscriber_id)
);
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.subscriber_delivery_receipts FROM PUBLIC;

-- POST_EXECUTION is cryptographically different from PRE_ADMISSION.
-- Proof digest is bound to independently observed response/event/subscriber.
CREATE TABLE cst_onejob_private.post_execution_qa_receipts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  approval_id uuid NOT NULL UNIQUE
    REFERENCES ai_platform.cst_onejob_owner_approvals(id),
  job_id integer NOT NULL UNIQUE REFERENCES ai_platform.ai_jobs(id),
  delivery_id uuid NOT NULL UNIQUE
    REFERENCES cst_onejob_private.subscriber_delivery_receipts(delivery_id),
  verifier_id text NOT NULL
    CHECK (verifier_id ~ '^cst-independent-qa-[a-z0-9_-]{8,80}$'),
  stage text NOT NULL CHECK(stage='POST_EXECUTION'),
  nonce text NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{64}$'),
  proof_digest text NOT NULL UNIQUE CHECK(proof_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT post_execution_receipt_ttl CHECK(
    expires_at > verified_at AND
    expires_at <= verified_at + interval '5 minutes')
);
ALTER TABLE cst_onejob_private.post_execution_qa_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.post_execution_qa_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.post_execution_qa_receipts FROM PUBLIC;

-- Separate one-time immutable reconciliation record. Merely inserting row
-- does not issue a Final ACK: authorized independent service must verify
-- actual delivery and signed post-execution proof before writing this record.
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
  source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64});
ALTER TABLE cst_onejob_private.final_ack_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.final_ack_reconciliations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.final_ack_reconciliations FROM PUBLIC;

-- Deliberate no RLS policies or grants. A future reviewed DEV migration must
-- install exact non-public writer roles, and a trusted independent Final ACK
-- issuer; this file alone is always non-operational.
),
  ack_signature_base64 text NOT NULL CHECK (length(ack_signature_base64) BETWEEN 84 AND 92),
  ack_issuer_fingerprint text NOT NULL CHECK (ack_issuer_fingerprint ~ '^[a-f0-9]{64} timestamptz NOT NULL,
  UNIQUE(event_id,subscriber_id)
);
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.subscriber_delivery_receipts FROM PUBLIC;

-- POST_EXECUTION is cryptographically different from PRE_ADMISSION.
-- Proof digest is bound to independently observed response/event/subscriber.
CREATE TABLE cst_onejob_private.post_execution_qa_receipts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  approval_id uuid NOT NULL UNIQUE
    REFERENCES ai_platform.cst_onejob_owner_approvals(id),
  job_id integer NOT NULL UNIQUE REFERENCES ai_platform.ai_jobs(id),
  delivery_id uuid NOT NULL UNIQUE
    REFERENCES cst_onejob_private.subscriber_delivery_receipts(delivery_id),
  verifier_id text NOT NULL
    CHECK (verifier_id ~ '^cst-independent-qa-[a-z0-9_-]{8,80}$'),
  stage text NOT NULL CHECK(stage='POST_EXECUTION'),
  nonce text NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{64}$'),
  proof_digest text NOT NULL UNIQUE CHECK(proof_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT post_execution_receipt_ttl CHECK(
    expires_at > verified_at AND
    expires_at <= verified_at + interval '5 minutes')
);
ALTER TABLE cst_onejob_private.post_execution_qa_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.post_execution_qa_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.post_execution_qa_receipts FROM PUBLIC;

-- Separate one-time immutable reconciliation record. Merely inserting row
-- does not issue a Final ACK: authorized independent service must verify
-- actual delivery and signed post-execution proof before writing this record.
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
  source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$')
);
ALTER TABLE cst_onejob_private.final_ack_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.final_ack_reconciliations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.final_ack_reconciliations FROM PUBLIC;

-- Deliberate no RLS policies or grants. A future reviewed DEV migration must
-- install exact non-public writer roles, and a trusted independent Final ACK
-- issuer; this file alone is always non-operational.
),
  received_at timestamptz NOT NULL,
  UNIQUE(event_id,subscriber_id)
);
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.subscriber_delivery_receipts FROM PUBLIC;

-- POST_EXECUTION is cryptographically different from PRE_ADMISSION.
-- Proof digest is bound to independently observed response/event/subscriber.
CREATE TABLE cst_onejob_private.post_execution_qa_receipts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  approval_id uuid NOT NULL UNIQUE
    REFERENCES ai_platform.cst_onejob_owner_approvals(id),
  job_id integer NOT NULL UNIQUE REFERENCES ai_platform.ai_jobs(id),
  delivery_id uuid NOT NULL UNIQUE
    REFERENCES cst_onejob_private.subscriber_delivery_receipts(delivery_id),
  verifier_id text NOT NULL
    CHECK (verifier_id ~ '^cst-independent-qa-[a-z0-9_-]{8,80}$'),
  stage text NOT NULL CHECK(stage='POST_EXECUTION'),
  nonce text NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{64}$'),
  proof_digest text NOT NULL UNIQUE CHECK(proof_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT post_execution_receipt_ttl CHECK(
    expires_at > verified_at AND
    expires_at <= verified_at + interval '5 minutes')
);
ALTER TABLE cst_onejob_private.post_execution_qa_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.post_execution_qa_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.post_execution_qa_receipts FROM PUBLIC;

-- Separate one-time immutable reconciliation record. Merely inserting row
-- does not issue a Final ACK: authorized independent service must verify
-- actual delivery and signed post-execution proof before writing this record.
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
  source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$')
);
ALTER TABLE cst_onejob_private.final_ack_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.final_ack_reconciliations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.final_ack_reconciliations FROM PUBLIC;

-- Deliberate no RLS policies or grants. A future reviewed DEV migration must
-- install exact non-public writer roles, and a trusted independent Final ACK
-- issuer; this file alone is always non-operational.
),
  ack_signature_base64 text NOT NULL CHECK (length(ack_signature_base64) BETWEEN 84 AND 92),
  issuer_public_fingerprint text NOT NULL CHECK (issuer_public_fingerprint ~ '^[a-f0-9]{64});
ALTER TABLE cst_onejob_private.final_ack_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.final_ack_reconciliations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.final_ack_reconciliations FROM PUBLIC;

-- Deliberate no RLS policies or grants. A future reviewed DEV migration must
-- install exact non-public writer roles, and a trusted independent Final ACK
-- issuer; this file alone is always non-operational.
),
  ack_signature_base64 text NOT NULL CHECK (length(ack_signature_base64) BETWEEN 84 AND 92),
  ack_issuer_fingerprint text NOT NULL CHECK (ack_issuer_fingerprint ~ '^[a-f0-9]{64} timestamptz NOT NULL,
  UNIQUE(event_id,subscriber_id)
);
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.subscriber_delivery_receipts FROM PUBLIC;

-- POST_EXECUTION is cryptographically different from PRE_ADMISSION.
-- Proof digest is bound to independently observed response/event/subscriber.
CREATE TABLE cst_onejob_private.post_execution_qa_receipts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  approval_id uuid NOT NULL UNIQUE
    REFERENCES ai_platform.cst_onejob_owner_approvals(id),
  job_id integer NOT NULL UNIQUE REFERENCES ai_platform.ai_jobs(id),
  delivery_id uuid NOT NULL UNIQUE
    REFERENCES cst_onejob_private.subscriber_delivery_receipts(delivery_id),
  verifier_id text NOT NULL
    CHECK (verifier_id ~ '^cst-independent-qa-[a-z0-9_-]{8,80}$'),
  stage text NOT NULL CHECK(stage='POST_EXECUTION'),
  nonce text NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{64}$'),
  proof_digest text NOT NULL UNIQUE CHECK(proof_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT post_execution_receipt_ttl CHECK(
    expires_at > verified_at AND
    expires_at <= verified_at + interval '5 minutes')
);
ALTER TABLE cst_onejob_private.post_execution_qa_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.post_execution_qa_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.post_execution_qa_receipts FROM PUBLIC;

-- Separate one-time immutable reconciliation record. Merely inserting row
-- does not issue a Final ACK: authorized independent service must verify
-- actual delivery and signed post-execution proof before writing this record.
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
  source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$')
);
ALTER TABLE cst_onejob_private.final_ack_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.final_ack_reconciliations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.final_ack_reconciliations FROM PUBLIC;

-- Deliberate no RLS policies or grants. A future reviewed DEV migration must
-- install exact non-public writer roles, and a trusted independent Final ACK
-- issuer; this file alone is always non-operational.
),
  received_at timestamptz NOT NULL,
  UNIQUE(event_id,subscriber_id)
);
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.subscriber_delivery_receipts FROM PUBLIC;

-- POST_EXECUTION is cryptographically different from PRE_ADMISSION.
-- Proof digest is bound to independently observed response/event/subscriber.
CREATE TABLE cst_onejob_private.post_execution_qa_receipts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  approval_id uuid NOT NULL UNIQUE
    REFERENCES ai_platform.cst_onejob_owner_approvals(id),
  job_id integer NOT NULL UNIQUE REFERENCES ai_platform.ai_jobs(id),
  delivery_id uuid NOT NULL UNIQUE
    REFERENCES cst_onejob_private.subscriber_delivery_receipts(delivery_id),
  verifier_id text NOT NULL
    CHECK (verifier_id ~ '^cst-independent-qa-[a-z0-9_-]{8,80}$'),
  stage text NOT NULL CHECK(stage='POST_EXECUTION'),
  nonce text NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{64}$'),
  proof_digest text NOT NULL UNIQUE CHECK(proof_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT post_execution_receipt_ttl CHECK(
    expires_at > verified_at AND
    expires_at <= verified_at + interval '5 minutes')
);
ALTER TABLE cst_onejob_private.post_execution_qa_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.post_execution_qa_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.post_execution_qa_receipts FROM PUBLIC;

-- Separate one-time immutable reconciliation record. Merely inserting row
-- does not issue a Final ACK: authorized independent service must verify
-- actual delivery and signed post-execution proof before writing this record.
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
  source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$')
);
ALTER TABLE cst_onejob_private.final_ack_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.final_ack_reconciliations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.final_ack_reconciliations FROM PUBLIC;

-- Deliberate no RLS policies or grants. A future reviewed DEV migration must
-- install exact non-public writer roles, and a trusted independent Final ACK
-- issuer; this file alone is always non-operational.
),
  ack_claims_digest text NOT NULL UNIQUE CHECK (ack_claims_digest ~ '^[a-f0-9]{64});
ALTER TABLE cst_onejob_private.final_ack_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.final_ack_reconciliations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.final_ack_reconciliations FROM PUBLIC;

-- Deliberate no RLS policies or grants. A future reviewed DEV migration must
-- install exact non-public writer roles, and a trusted independent Final ACK
-- issuer; this file alone is always non-operational.
),
  ack_signature_base64 text NOT NULL CHECK (length(ack_signature_base64) BETWEEN 84 AND 92),
  ack_issuer_fingerprint text NOT NULL CHECK (ack_issuer_fingerprint ~ '^[a-f0-9]{64} timestamptz NOT NULL,
  UNIQUE(event_id,subscriber_id)
);
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.subscriber_delivery_receipts FROM PUBLIC;

-- POST_EXECUTION is cryptographically different from PRE_ADMISSION.
-- Proof digest is bound to independently observed response/event/subscriber.
CREATE TABLE cst_onejob_private.post_execution_qa_receipts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  approval_id uuid NOT NULL UNIQUE
    REFERENCES ai_platform.cst_onejob_owner_approvals(id),
  job_id integer NOT NULL UNIQUE REFERENCES ai_platform.ai_jobs(id),
  delivery_id uuid NOT NULL UNIQUE
    REFERENCES cst_onejob_private.subscriber_delivery_receipts(delivery_id),
  verifier_id text NOT NULL
    CHECK (verifier_id ~ '^cst-independent-qa-[a-z0-9_-]{8,80}$'),
  stage text NOT NULL CHECK(stage='POST_EXECUTION'),
  nonce text NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{64}$'),
  proof_digest text NOT NULL UNIQUE CHECK(proof_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT post_execution_receipt_ttl CHECK(
    expires_at > verified_at AND
    expires_at <= verified_at + interval '5 minutes')
);
ALTER TABLE cst_onejob_private.post_execution_qa_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.post_execution_qa_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.post_execution_qa_receipts FROM PUBLIC;

-- Separate one-time immutable reconciliation record. Merely inserting row
-- does not issue a Final ACK: authorized independent service must verify
-- actual delivery and signed post-execution proof before writing this record.
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
  source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$')
);
ALTER TABLE cst_onejob_private.final_ack_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.final_ack_reconciliations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.final_ack_reconciliations FROM PUBLIC;

-- Deliberate no RLS policies or grants. A future reviewed DEV migration must
-- install exact non-public writer roles, and a trusted independent Final ACK
-- issuer; this file alone is always non-operational.
),
  received_at timestamptz NOT NULL,
  UNIQUE(event_id,subscriber_id)
);
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.subscriber_delivery_receipts FROM PUBLIC;

-- POST_EXECUTION is cryptographically different from PRE_ADMISSION.
-- Proof digest is bound to independently observed response/event/subscriber.
CREATE TABLE cst_onejob_private.post_execution_qa_receipts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  approval_id uuid NOT NULL UNIQUE
    REFERENCES ai_platform.cst_onejob_owner_approvals(id),
  job_id integer NOT NULL UNIQUE REFERENCES ai_platform.ai_jobs(id),
  delivery_id uuid NOT NULL UNIQUE
    REFERENCES cst_onejob_private.subscriber_delivery_receipts(delivery_id),
  verifier_id text NOT NULL
    CHECK (verifier_id ~ '^cst-independent-qa-[a-z0-9_-]{8,80}$'),
  stage text NOT NULL CHECK(stage='POST_EXECUTION'),
  nonce text NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{64}$'),
  proof_digest text NOT NULL UNIQUE CHECK(proof_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT post_execution_receipt_ttl CHECK(
    expires_at > verified_at AND
    expires_at <= verified_at + interval '5 minutes')
);
ALTER TABLE cst_onejob_private.post_execution_qa_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.post_execution_qa_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.post_execution_qa_receipts FROM PUBLIC;

-- Separate one-time immutable reconciliation record. Merely inserting row
-- does not issue a Final ACK: authorized independent service must verify
-- actual delivery and signed post-execution proof before writing this record.
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
  source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$')
);
ALTER TABLE cst_onejob_private.final_ack_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.final_ack_reconciliations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.final_ack_reconciliations FROM PUBLIC;

-- Deliberate no RLS policies or grants. A future reviewed DEV migration must
-- install exact non-public writer roles, and a trusted independent Final ACK
-- issuer; this file alone is always non-operational.
)
);
ALTER TABLE cst_onejob_private.final_ack_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.final_ack_reconciliations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.final_ack_reconciliations FROM PUBLIC;

-- Deliberate no RLS policies or grants. A future reviewed DEV migration must
-- install exact non-public writer roles, and a trusted independent Final ACK
-- issuer; this file alone is always non-operational.
),
  ack_signature_base64 text NOT NULL CHECK (length(ack_signature_base64) BETWEEN 84 AND 92),
  ack_issuer_fingerprint text NOT NULL CHECK (ack_issuer_fingerprint ~ '^[a-f0-9]{64} timestamptz NOT NULL,
  UNIQUE(event_id,subscriber_id)
);
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.subscriber_delivery_receipts FROM PUBLIC;

-- POST_EXECUTION is cryptographically different from PRE_ADMISSION.
-- Proof digest is bound to independently observed response/event/subscriber.
CREATE TABLE cst_onejob_private.post_execution_qa_receipts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  approval_id uuid NOT NULL UNIQUE
    REFERENCES ai_platform.cst_onejob_owner_approvals(id),
  job_id integer NOT NULL UNIQUE REFERENCES ai_platform.ai_jobs(id),
  delivery_id uuid NOT NULL UNIQUE
    REFERENCES cst_onejob_private.subscriber_delivery_receipts(delivery_id),
  verifier_id text NOT NULL
    CHECK (verifier_id ~ '^cst-independent-qa-[a-z0-9_-]{8,80}$'),
  stage text NOT NULL CHECK(stage='POST_EXECUTION'),
  nonce text NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{64}$'),
  proof_digest text NOT NULL UNIQUE CHECK(proof_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT post_execution_receipt_ttl CHECK(
    expires_at > verified_at AND
    expires_at <= verified_at + interval '5 minutes')
);
ALTER TABLE cst_onejob_private.post_execution_qa_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.post_execution_qa_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.post_execution_qa_receipts FROM PUBLIC;

-- Separate one-time immutable reconciliation record. Merely inserting row
-- does not issue a Final ACK: authorized independent service must verify
-- actual delivery and signed post-execution proof before writing this record.
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
  source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$')
);
ALTER TABLE cst_onejob_private.final_ack_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.final_ack_reconciliations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.final_ack_reconciliations FROM PUBLIC;

-- Deliberate no RLS policies or grants. A future reviewed DEV migration must
-- install exact non-public writer roles, and a trusted independent Final ACK
-- issuer; this file alone is always non-operational.
),
  received_at timestamptz NOT NULL,
  UNIQUE(event_id,subscriber_id)
);
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.subscriber_delivery_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.subscriber_delivery_receipts FROM PUBLIC;

-- POST_EXECUTION is cryptographically different from PRE_ADMISSION.
-- Proof digest is bound to independently observed response/event/subscriber.
CREATE TABLE cst_onejob_private.post_execution_qa_receipts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  approval_id uuid NOT NULL UNIQUE
    REFERENCES ai_platform.cst_onejob_owner_approvals(id),
  job_id integer NOT NULL UNIQUE REFERENCES ai_platform.ai_jobs(id),
  delivery_id uuid NOT NULL UNIQUE
    REFERENCES cst_onejob_private.subscriber_delivery_receipts(delivery_id),
  verifier_id text NOT NULL
    CHECK (verifier_id ~ '^cst-independent-qa-[a-z0-9_-]{8,80}$'),
  stage text NOT NULL CHECK(stage='POST_EXECUTION'),
  nonce text NOT NULL UNIQUE CHECK(nonce ~ '^[a-f0-9]{64}$'),
  proof_digest text NOT NULL UNIQUE CHECK(proof_digest ~ '^[a-f0-9]{64}$'),
  evidence_digest text NOT NULL CHECK(evidence_digest ~ '^[a-f0-9]{64}$'),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT post_execution_receipt_ttl CHECK(
    expires_at > verified_at AND
    expires_at <= verified_at + interval '5 minutes')
);
ALTER TABLE cst_onejob_private.post_execution_qa_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.post_execution_qa_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.post_execution_qa_receipts FROM PUBLIC;

-- Separate one-time immutable reconciliation record. Merely inserting row
-- does not issue a Final ACK: authorized independent service must verify
-- actual delivery and signed post-execution proof before writing this record.
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
  source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$')
);
ALTER TABLE cst_onejob_private.final_ack_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.final_ack_reconciliations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON cst_onejob_private.final_ack_reconciliations FROM PUBLIC;

-- Deliberate no RLS policies or grants. A future reviewed DEV migration must
-- install exact non-public writer roles, and a trusted independent Final ACK
-- issuer; this file alone is always non-operational.
