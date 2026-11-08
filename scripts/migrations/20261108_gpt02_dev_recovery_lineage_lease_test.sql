\set ON_ERROR_STOP on
INSERT INTO ai_platform.ai_coding_bridge_commands(id) VALUES
 ('83db99f5-cbda-4e60-be71-3090fb411bbb'),
 ('41aa961d-ac1e-4e12-a2c8-28ed07ff97cc'),
 ('a1aa961d-ac1e-4e12-a2c8-28ed07ff97cc');
INSERT INTO ai_platform.ai_human_tasks(id) VALUES (6);
INSERT INTO ai_platform.gpt02_dev_recovery_reservations
 (parent_command_id,candidate_command_id,human_review_id,job_id,idempotency_key,artifact_sha256)
 VALUES ('83db99f5-cbda-4e60-be71-3090fb411bbb',
 '41aa961d-ac1e-4e12-a2c8-28ed07ff97cc',6,135,
 '2ba38abd-33bb-4459-9f3c-1fc280752a83',repeat('f',64));
DO $x$
DECLARE rid uuid;
BEGIN
 SELECT id INTO rid FROM ai_platform.gpt02_dev_recovery_reservations LIMIT 1;
 BEGIN
  INSERT INTO ai_platform.gpt02_dev_recovery_command_links(parent_command_id,child_command_id,reservation_id)
  VALUES ('83db99f5-cbda-4e60-be71-3090fb411bbb','a1aa961d-ac1e-4e12-a2c8-28ed07ff97cc',rid);
  RAISE EXCEPTION 'WRONG_CHILD_ACCEPTED';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='WRONG_CHILD_ACCEPTED' THEN RAISE; END IF;
  IF SQLERRM<>'GPT02_RECOVERY_LINK_IDENTITY_MISMATCH' THEN RAISE; END IF;
 END;
 INSERT INTO ai_platform.gpt02_dev_recovery_command_links(parent_command_id,child_command_id,reservation_id)
 VALUES ('83db99f5-cbda-4e60-be71-3090fb411bbb','41aa961d-ac1e-4e12-a2c8-28ed07ff97cc',rid);
 INSERT INTO ai_platform.gpt02_dev_recovery_leases(reservation_id) VALUES (rid);
 UPDATE ai_platform.gpt02_dev_recovery_leases
 SET fencing_token=fencing_token+1,lease_owner='worker-A',lease_expires_at=clock_timestamp()+interval '60s'
 WHERE reservation_id=rid AND (lease_owner IS NULL OR lease_expires_at<=clock_timestamp());
 IF (SELECT fencing_token FROM ai_platform.gpt02_dev_recovery_leases WHERE reservation_id=rid) <> 1 THEN
   RAISE EXCEPTION 'BAD_INITIAL_TOKEN';
 END IF;
 UPDATE ai_platform.gpt02_dev_recovery_leases SET lease_expires_at=clock_timestamp()-interval '1s' WHERE reservation_id=rid;
 UPDATE ai_platform.gpt02_dev_recovery_leases
 SET fencing_token=fencing_token+1,lease_owner='worker-B',lease_expires_at=clock_timestamp()+interval '60s'
 WHERE reservation_id=rid AND lease_expires_at<=clock_timestamp();
 IF (SELECT fencing_token FROM ai_platform.gpt02_dev_recovery_leases WHERE reservation_id=rid) <> 2 THEN RAISE EXCEPTION 'BAD_TAKEOVER'; END IF;
 UPDATE ai_platform.gpt02_dev_recovery_leases SET lease_owner=NULL,lease_expires_at=NULL WHERE reservation_id=rid AND fencing_token=1 AND lease_owner='worker-A';
 IF FOUND THEN RAISE EXCEPTION 'STALE_RELEASE_ACCEPTED'; END IF;
END $x$;
SELECT count(*) AS links_expected_1 FROM ai_platform.gpt02_dev_recovery_command_links;
SELECT fencing_token,lease_owner FROM ai_platform.gpt02_dev_recovery_leases;
