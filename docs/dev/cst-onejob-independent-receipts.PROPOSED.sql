-- PROPOSED ONLY: CST-DEV independent admission readiness receipt ledger.
-- No deployment/migration. No issuance, key material, signer use, or authority
-- implied by inserting a row. A cryptographic verification and independent
-- issuer trust boundary must be implemented separately before admission.
--
-- There is intentionally NO GRANT or policy. FORCE RLS prevents untrusted
-- workers and generic runtime access, including after future table grants.
CREATE TABLE cst_onejob_private.verified_admission_receipts (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  approval_id uuid NOT NULL UNIQUE
    REFERENCES ai_platform.cst_onejob_owner_approvals(id),
  job_id integer NOT NULL UNIQUE REFERENCES ai_platform.ai_jobs(id),
  company_id text NOT NULL CHECK (company_id='1'),
  request_id text NOT NULL UNIQUE
    CHECK (request_id ~ '^cst-ai-team-company1-dev:pilot-[a-f0-9]{20}$'),
  worker_name text NOT NULL
    CHECK (worker_name ~ '^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$'),
  image_source_sha text NOT NULL CHECK (image_source_sha ~ '^[a-f0-9]{40}$'),
  image_id text NOT NULL CHECK (image_id ~ '^sha256:[a-f0-9]{64}$'),
  isolated_network_verified boolean NOT NULL CHECK (isolated_network_verified IS TRUE),
  scoped_dev_role_verified boolean NOT NULL CHECK (scoped_dev_role_verified IS TRUE),
  event_audit_path_verified boolean NOT NULL CHECK (event_audit_path_verified IS TRUE),
  subscriber_path_verified boolean NOT NULL CHECK (subscriber_path_verified IS TRUE),
  independent_qa_available boolean NOT NULL CHECK (independent_qa_available IS TRUE),
  proof_digest text NOT NULL UNIQUE CHECK (proof_digest ~ '^[a-f0-9]{64}$'),
  verifier_id text NOT NULL CHECK (verifier_id ~ '^cst-independent-qa-[a-z0-9_-]{8,80}$'),
  verified_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT onejob_receipt_short_ttl CHECK (
    expires_at > verified_at
    AND expires_at <= verified_at + interval '5 minutes'
  ),
  CONSTRAINT onejob_receipt_consumption_order CHECK (
    consumed_at IS NULL OR (
      consumed_at >= verified_at AND consumed_at <= expires_at
    )
  )
);
CREATE UNIQUE INDEX cst_onejob_receipt_one_active_per_company
  ON cst_onejob_private.verified_admission_receipts(company_id)
  WHERE consumed_at IS NULL;
ALTER TABLE cst_onejob_private.verified_admission_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE cst_onejob_private.verified_admission_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE cst_onejob_private.verified_admission_receipts FROM PUBLIC;
-- Critical: these boolean columns are only bounded data, NOT proof of
-- authenticated origin. This proposed table does not attest signatures.
-- The currently proposed admit_waiting_job() intentionally raises
-- ONEJOB_ATOMIC_ADMISSION_NOT_YET_AUTHORIZED even if this table exists.
-- No generic role must be granted INSERT/UPDATE or verified issuer status.
