# CST-DEV VPS — one-shot official signed-release batch importer

**Purpose:** Complete the missing installation bridge *only after* a separate, authorized CST Security/Operations custodian returns a **cryptographically signed** single-job change record. Do not generate a private Operations key here, reuse the 8 operator/signer keys, or fill public roots with fake placeholders.

Script: `deploy/cst-onejob-vps/install_approved_release_batch.py`. Two explicit modes:

- `--read-only` performs source and public-manifest hash checks, ensures all 8 signer units are inactive, and reports pending/missing independent approval; does not decrypt keys, create roles, install files, or start a service.
- `--install-after-signed-approval` accepts only the fixed root-owned `/etc/cst-onejob-dev/inbox/signed-release-batch.json` and the independently pinned root-owned Ed25519 Operations public root `/etc/cst-onejob-dev/operator-trust/release-public.pem`. **These files are absent now.** Installation is impossible without authentic signatures. No CLI-selected trust path or submitted secret.

An externally approved batch must contain `payload` with exact keys `schema,project,companyId,changeId,jobId,approvalId,sourceSha,workerName,manifestSha256,issuedAt,expiresAt,permits` plus `signatureBase64`, whose signature is over
`b"CST_DEV_ONEJOB_VPS_APPROVED_BATCH_V1\n" + json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()`.
The `permits` mapping contains exactly 8 `{claims,signatureBase64}` records each signed over the canonical `CST_DEV_ONEJOB_VPS_ONE_SIGNATURE_PERMIT_V1\n` domain and the fixed ordered claims used by the already-installed VPS signer. All must bind one new job ID (greater than 482), one Owner approval ID, one Company-1 source SHA/worker, correct Linux OS UIDs, eight public Ed25519 fingerprints, unique nonces, SHA-256 payload digests and a time window of at most 5 minutes. The reviewer must also accept the **single-host shared root risk**. A valid batch is **NOT** proof the Owner actually approved the job: the separate authenticated database readback is mandatory before any service is enabled or job queued.

Once the independent root and batch are present and pass verification, the installer writes only `approved-public/<role>.json` and `authorized-releases/<role>.json` with root-owned public pins and signed permits. It does not issue a signature, reveal a private key, enable/start service, grant database access, create an Owner approval, or claim Hub Final ACK. Missing signatures, root, manifest SHA, mismatched UID/role/source, expired permit, replayed nonce, or any signer's live state yields DENIED/NO_GO.

Operational E2E remains NO-GO until independent real signed authorization, Owner action and live DB readback, reviewed non-bypassable broker contract, staged service activation, subscriber ACK, four genuine agent attestations, reviewer Final ACK and relock. No KMS, no DELL signer, no PROD changes.

## Pinned installed-runtime caveat

The review importer's `SOURCE_SHA` pin is the **currently installed** dormant signer source hash `cb24077b4ae31c1de24f365046a274d74e7249a3b05ab46dcb2d5880cef31702`, rather than an assumption that all newer PR commits have been deployed. The signer source in commit `d4effeeea37b1a78743099476588bb352f8d98e7` includes an additional nonce-directory durability improvement but was not part of the original VPS installation readback. Before operational signing, reconcile the installed signer source and immutable approved release hash under one reviewed exact-source change. Do not silently remove the source pin to obtain readiness.
