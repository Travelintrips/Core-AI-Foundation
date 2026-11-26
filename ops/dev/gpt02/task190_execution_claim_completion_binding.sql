-- CST-DEV only. Make an execution completion impossible unless an exact
-- irrevocable claim exists for the same Owner, task, attempt, challenge and
-- independently asserted issuer-proof digest. No roles/grants/dispatch.
BEGIN;
ALTER TABLE gpt02_task190_execution_custody.claims
  ADD CONSTRAINT task190_claim_exact_execution_binding
  UNIQUE (company_id, task_id, execution_id, attempt_id, owner_subject,
          challenge_id, authority_ref, issuer_proof_sha256);
ALTER TABLE gpt02_task190_execution_custody.consumptions
  ADD CONSTRAINT task190_consumption_requires_exact_claim
  FOREIGN KEY (company_id, task_id, execution_id, attempt_id, owner_subject,
               challenge_id, authority_ref, issuer_proof_sha256)
  REFERENCES gpt02_task190_execution_custody.claims
     (company_id, task_id, execution_id, attempt_id, owner_subject,
      challenge_id, authority_ref, issuer_proof_sha256)
  ON UPDATE RESTRICT ON DELETE RESTRICT NOT DEFERRABLE;
COMMIT;
