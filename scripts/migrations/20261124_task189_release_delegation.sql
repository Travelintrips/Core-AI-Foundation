-- Reviewed DEV migration only. Run as the protected migration owner.
BEGIN;
DO $$ BEGIN
  IF current_setting('ai_core.dev_migration_authorized',true) IS DISTINCT FROM 'true'
    OR current_setting('ai_core.dev_project_ref',true) IS DISTINCT FROM 'xssrfshdrtdfupgqwfdw' THEN
    RAISE EXCEPTION 'Explicit CST-DEV migration context required';
  END IF;
END $$;
CREATE SCHEMA task189_release;
REVOKE ALL ON SCHEMA task189_release FROM PUBLIC;
CREATE TABLE task189_release.grants (
  grant_id uuid PRIMARY KEY,
  mandate jsonb NOT NULL,
  signature text NOT NULL,
  registered_by integer NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_by integer,
  revoked_at timestamptz,
  CHECK ((revoked_by IS NULL) = (revoked_at IS NULL))
);
-- Exactly one issuance across all grants, restarts, retries and key rotations.
CREATE TABLE task189_release.permit (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  grant_id uuid NOT NULL REFERENCES task189_release.grants(grant_id),
  permit_id uuid UNIQUE NOT NULL,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by integer,
  CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '3 minutes'),
  CHECK ((consumed_at IS NULL) = (consumed_by IS NULL)),
  CHECK (consumed_at IS NULL OR (consumed_at >= issued_at AND consumed_at < expires_at))
);
REVOKE ALL ON ALL TABLES IN SCHEMA task189_release FROM PUBLIC;
-- Historical mandates and issuance must survive retries, expiry and revocation.
CREATE FUNCTION task189_release.protect_history() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP='UPDATE' THEN
    IF TG_TABLE_NAME='grants' THEN
      IF (to_jsonb(NEW) - ARRAY['revoked_at','revoked_by']) =
         (to_jsonb(OLD) - ARRAY['revoked_at','revoked_by']) AND NEW.revoked_at IS NOT NULL
         AND (OLD.revoked_at IS NULL OR NEW IS NOT DISTINCT FROM OLD) THEN RETURN NEW; END IF;
    ELSIF (to_jsonb(NEW) - ARRAY['consumed_at','consumed_by']) =
          (to_jsonb(OLD) - ARRAY['consumed_at','consumed_by']) AND OLD.consumed_at IS NULL
          AND NEW.consumed_at IS NOT NULL THEN RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'Release history is immutable';
END $$;
CREATE TRIGGER protect_grants BEFORE UPDATE OR DELETE ON task189_release.grants
  FOR EACH ROW EXECUTE FUNCTION task189_release.protect_history();
CREATE TRIGGER protect_permit BEFORE UPDATE OR DELETE ON task189_release.permit
  FOR EACH ROW EXECUTE FUNCTION task189_release.protect_history();
CREATE TRIGGER keep_grants BEFORE TRUNCATE ON task189_release.grants
  FOR EACH STATEMENT EXECUTE FUNCTION task189_release.protect_history();
CREATE TRIGGER keep_permit BEFORE TRUNCATE ON task189_release.permit
  FOR EACH STATEMENT EXECUTE FUNCTION task189_release.protect_history();
DO $$ DECLARE api_role text; BEGIN
  FOR api_role IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA task189_release FROM %I', api_role);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA task189_release FROM %I', api_role);
  END LOOP;
END $$;
-- No grants to workers, browser roles or the public API. The release operator
-- provisions only the Core service's required column privileges at activation.
COMMIT;
