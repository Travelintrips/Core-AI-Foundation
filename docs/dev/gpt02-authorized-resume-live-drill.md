# GPT02 DEV — authorized resume live drill (NOT RUN)

## Verified prerequisite
CI #4237 passed at commit `ea9a3f3`. CST-DEV currently contains no RECEIVED/PROCESSING bridge command. Existing terminal commands are immutable test evidence, NOT candidates for resumption. The signed review-intent audit table has 0 real rows. Production is excluded.

## Use the existing, authenticated AI Core Chat lane
Only a human who is already logged in to the correct **DEV / internal-only** AI Core Chat instance should submit the following **once**, using the existing UI. The message syntax is parsed by `parseInternalDevJob` and routes through `queueDevBrowserWake` with the verified GPT02/DELL browser binding. The parser requires `AI_CORE_DEV_EXECUTION_MODE=internal-only` and NODE_ENV not production. Do not substitute a direct SQL INSERT, unauthenticated HTTP call, synthetic ACK, or manual command-status update.

```text
/job
Environment: DEV
Target: GPT02
Mode: TEST_ONLY

UJI LIFECYCLE GPT02 DEV SAJA. Dilarang mengubah repository, database, sistem produksi, serta mengirim notifikasi eksternal. Gunakan handshake resmi dan laporkan checkpoint melalui mekanisme native worker yang sudah tersedia. Sebelum melakukan aksi pemulihan apa pun, minta persetujuan manusia lewat jalur resmi. Jika tindakan memang terhenti menunggu persetujuan, laporkan BLOCKER dengan alasan nyata dan bukti asli sesuai protokol. Jangan mengarang BLOCKER, ACK, tanda tangan, status sukses, atau bukti lain. Apabila mekanisme native ACK/BLOCKER tidak tersedia, laporkan kekurangannya dengan jelas dan berhenti; jangan lakukan resume otomatis.
```

## Required evidence before any signer activation
1. Capture the newly returned `commandId`, correlation ID, assigned worker and operator-authenticated session (do not store cookies or private keys in logs).
2. Read back the command from `ai_platform.ai_coding_bridge_commands`; require metadata `devOnly=true`, `capability=chatgpt:wake`, `assignedClientId=openclaw-dell-chatgpt-wake-dev` and a nonterminal state.
3. Read all ordered `ai_platform.ai_coding_bridge_responses`: verify native checkpoint issuer receipt and ACK through the backend verifier; verify the latest BLOCKER is genuine, refers to the same command, and follows checkpoint.
4. Require full response history (not a bounded/truncated 101+ result), healthy worker, and current policy/429/retry review. Note worker-presence lease is NOT an exclusive command lease.
5. Only then, from a real Internal Portal admin/owner session, test gated review-only signing with an independently configured DEV key and origin **after security approval and deployment**. Verify durable signed review audit and exactly-once nonce. An audit intent still must never authorize grant or worker dispatch.
6. If no genuine BLOCKER occurs or any proof is missing: record NO-GO and terminate the drill without fabricated evidence or worker resume.

## Zero-write queries for verification
```sql
SELECT c.id,c.status,c.metadata_json->>'assignedClientId' AS assigned_worker,
       c.metadata_json->>'devOnly' AS dev_only,
       c.metadata_json->>'capability' AS capability
FROM ai_platform.ai_coding_bridge_commands c
WHERE c.id = :new_command_id::uuid;
SELECT r.id,r.kind,r.created_at,r.acknowledged_at,
       (r.metadata_json ? 'checkpointReceipt') AS has_checkpoint_receipt
FROM ai_platform.ai_coding_bridge_responses r
WHERE r.command_id = :new_command_id::uuid ORDER BY r.created_at,r.id;
SELECT COUNT(*) FROM ai_platform.dev_gpt02_operator_review_intents
WHERE command_id = :new_command_id::uuid;
```
Replace `:new_command_id` with the exact returned UUID using a bound parameter. Never paste an unknown identifier into concatenated SQL. These queries only inventory evidence; the signature/ACK verification MUST happen through its trusted backend verifier, not by presence of JSON keys.

## Stop conditions
Any terminal command, invalid native signature or ACK, missing/latest-blocker mismatch, HTTP 429 without expired Retry-After, stale worker, insufficient authenticated authority or competing command lease => STOP/NO-GO. This drill is not authorization to deploy PR #1660, provision a private signing key, or activate `dev_gpt02_claim_resume`.
