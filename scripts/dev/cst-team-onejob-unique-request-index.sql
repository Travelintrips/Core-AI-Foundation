-- CST-DEV ONLY: additive, narrow uniqueness guard for Company-1 pilot request IDs.
-- Do not apply to PROD. Run only after catalog/read-only duplicate check and
-- isolated PostgreSQL test. Do not wrap CONCURRENTLY inside a transaction.
-- The index also covers other job types using the same pilot requestId to
-- prevent a hidden non-model row from bypassing exact-one-job admission.
-- Preflight must fail closed until this index is valid.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ai_jobs_company1_pilot_request_unique
  ON ai_platform.ai_jobs ((payload_json ->> 'requestId'))
  WHERE (payload_json ->> 'requestId') LIKE 'cst-ai-team-company1-dev:pilot-%';

-- Readback (select only):
-- SELECT i.indisunique, i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid)
-- FROM pg_index i JOIN pg_class x ON x.oid=i.indexrelid
-- WHERE x.relname='ai_jobs_company1_pilot_request_unique';
--
-- Rollback, only with explicit authorization:
-- DROP INDEX CONCURRENTLY IF EXISTS ai_platform.ai_jobs_company1_pilot_request_unique;
