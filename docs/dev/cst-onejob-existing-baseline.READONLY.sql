-- VERIFIED AGAINST REAL CST-DEV CATALOG, 2026-11-20.
-- Read-only; explicit Supabase project xssrfshdrtdfupgqwfdw ONLY.
-- Do not infer project identity from current_database()='postgres'.
-- Do not recreate already-PASS stage writer, login, Owner ledger, RLS or indexes.
-- No DDL, role/credential activation, migration, dispatch or Final ACK.
-- ONE-SHOT PULL subscriber needs a supervised consumer, NOT an active
-- event-bus 'job.completed' subscription; absence of one is not its blocker.
WITH baseline AS (
  SELECT
    to_regclass('ai_platform.cst_onejob_owner_approvals') IS NOT NULL AS owner_table,
    COALESCE((SELECT c.relrowsecurity AND c.relforcerowsecurity
      FROM pg_catalog.pg_class c
      WHERE c.oid=to_regclass('ai_platform.cst_onejob_owner_approvals')),false) AS owner_force_rls,
    (SELECT count(DISTINCT p.policyname)=6
      FROM pg_catalog.pg_policies p
      WHERE p.schemaname='ai_platform'
      AND p.policyname IN (
        'cst_onejob_stage_owner_select','cst_onejob_stage_insert',
        'cst_onejob_stage_select','cst_onejob_stage_approval_insert',
        'cst_onejob_stage_approval_select','cst_onejob_stage_audit_insert')
      AND p.roles @> ARRAY['cst_team_model_pilot_writer']::name[]) AS policies_six,
    (SELECT count(*)=2 AND bool_and(NOT rolcanlogin AND NOT rolbypassrls)
      FROM pg_catalog.pg_roles
      WHERE rolname IN ('cst_team_model_pilot_writer',
                         'cst_team_model_pilot_stage_login')) AS old_roles_locked,
    (SELECT count(DISTINCT ix.relname)=2
      FROM pg_catalog.pg_index idx
      JOIN pg_catalog.pg_class ix ON ix.oid=idx.indexrelid
      JOIN pg_catalog.pg_class tbl ON tbl.oid=idx.indrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid=tbl.relnamespace
      WHERE ns.nspname='ai_platform'
        AND ((tbl.relname='ai_jobs' AND ix.relname='ai_jobs_company1_pilot_request_unique')
          OR (tbl.relname='cst_onejob_owner_approvals' AND ix.relname='cst_onejob_one_active_approval'))
        AND idx.indisunique AND idx.indisvalid AND idx.indisready) AS indexes_two
), delta AS (
 SELECT
  (SELECT count(*) FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='cst_onejob_private' AND c.relkind='r') AS private_tables,
  (SELECT count(*) FROM pg_catalog.pg_roles
    WHERE rolname IN ('cst_onejob_broker_login','cst_onejob_admission_broker',
      'cst_onejob_qa_receipt_login','cst_onejob_qa_receipt_writer',
      'cst_onejob_subscriber_login','cst_onejob_subscriber_writer',
      'cst_onejob_finalack_login','cst_onejob_finalack_writer')) AS extra_roles,
  (SELECT count(*) FROM ai_platform.cst_onejob_owner_approvals) AS approvals,
  (SELECT count(*) FROM ai_platform.ai_jobs j
    WHERE j.status IN ('waiting','queued')
      AND j.payload_json->>'requestId' LIKE 'cst-ai-team-company1-dev:pilot-%') AS pending,
  (SELECT count(*) FROM ai_platform.ai_workers w
    WHERE w.worker_name ~ '^cst-dev-dell-onejob-[0-9]{8}-[a-f0-9]{8}$'
      AND w.provider_slug='ollama' AND w.model_id='qwen2.5:3b') AS pilot_workers
)
SELECT jsonb_build_object(
 'scope','CST_DEV_ONEJOB_READ_ONLY_CATALOG',
 'projectClaimNotDatabaseAttestation','xssrfshdrtdfupgqwfdw',
 'existingBaselineReusable',
   b.owner_table AND b.owner_force_rls AND b.policies_six
   AND b.old_roles_locked AND b.indexes_two,
 'ownerLedgerPresent',b.owner_table,
 'ownerLedgerForceRls',b.owner_force_rls,
 'sixStagePoliciesPresent',b.policies_six,
 'twoExistingRolesNoLoginNoBypassRls',b.old_roles_locked,
 'twoUniqueIndexesValid',b.indexes_two,
 'uninstalledPrivateTables',d.private_tables,
 'newOneJobServiceRolesPresent',d.extra_roles,
 'ownerApprovalCount',d.approvals,
 'pendingPilotJobCount',d.pending,
 'exactPilotWorkerCount',d.pilot_workers,
 'subscriberMode','ONE_SHOT_PULL_NO_EVENT_SUBSCRIPTION_REQUIRED',
 'nextMigration','REUSE_EXISTING_PASS_AND_APPLY_ONLY_REVIEWED_MISSING_DELTA',
 'releaseDecision','NO_GO',
 'credentialProvisioningAuthorized',false,
 'dispatchPermitted',false,'finalAckIssued',false
) AS catalog_report
FROM baseline b CROSS JOIN delta d;
