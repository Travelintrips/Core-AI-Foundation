# CST-DEV Hostinger VPS one-job signer custody — one-batch migration (DEV only)

The Owner chose VPS `srv1792369` instead of Windows DELL code signing / DPAPI or Google KMS. **Do not activate the Windows DELL signer or Google KMS.** Reuse existing Linux systemd encrypted credentials and the already-PASS one-shot QA/subscriber/Core adapters; the existing GPT02 signer **keys must not be reused**.

## Actually staged on VPS (21 November 2026)

Eight *new*, distinct Ed25519 private keys were generated **in memory** and immediately encrypted via `systemd-creds encrypt --with-key=host --name=private-key.pkcs8`, one encrypted blob per role under `/etc/credstore.encrypted/cst-onejob-<role>-private-key.pkcs8` (root `0600`). Public SPKI SHA-256 fingerprints and PEMs are in the **unapproved** root-owned `/etc/cst-onejob-dev/staged-public/manifest.json`. Round-trip decryption/fingerprint verification: **8/8 PASS**. Eight separate non-login Unix signer identities `cst1j-sig-*` are password locked. User DELL accounts, old GPT02 keys, Core AI container and PROD were not modified.

**Security limitation**: the systemd host credential secret is root-only but on **unencrypted VPS media** (confirmed by systemd). VPS root can decrypt all eight credentials. Distinct Unix identities offer process isolation, **not independent hardware/administrator custody**. The Custody/Operations reviewer must explicitly accept that DEV trust model, and plan host-key/profile backup, intrusion detection and revocation. Do not present 8 fingerprints on one VPS as 8 independent physical custodians.

## VPS native signer implementation

- `deploy/cst-onejob-vps/cst_onejob_vps_signer.py` is an Ed25519 AF_UNIX socket signer with exact 4-byte length framing / 64-byte signature response, matching existing one-shot subscriber and issuer adapters.
- Uses `SO_PEERCRED` to require an exact, distinct non-root operator identity; the signer identity is a different Unix UID. Strict hardcoded paths/role purpose, bounded 64–8192 byte request, project `xssrfshdrtdfupgqwfdw`, Company-1, job ID greater than 482, exact canonical source SHA/worker/approval/payload SHA-256, and five-minute expiry.
- For **every** signature it requires a separate, cryptographically verified Ed25519 release permit from a separately authorized Operations root at `/etc/cst-onejob-dev/operator-trust/release-public.pem`, plus a reviewed public signer root at `/etc/cst-onejob-dev/approved-public/<role>.json`. Both are **intentionally absent** during staging. No caller-selected trust root or signer key allowed. Durable signer-owned one-use nonce journal rejects replay.
- Service template installer generates eight static `cst-onejob-signer-<role>.service` unit files with systemd `LoadCredentialEncrypted`, `NoNewPrivileges`, `PrivateNetwork`, `ProtectSystem=strict` and no `[Install]` section. Units are **not started or enabled**. Default environment is `CST_ONEJOB_LINUX_SIGNING_ENABLED=false`; missing signed permits and approved roots fail closed even if started manually.
- This does not create the permit-signing private key, approve releases, enable DB logins, grant broker UPDATE, call the Owner, enqueue a job, start a worker or issue Final ACK. All operator credentials, independent oversight and E2E gates remain separate.

**NO-GO for operational E2E** until an authorized independent permit issuer and public root are installed, actual signer services/consumer identities are verified, broker anti-bypass and DB roles are appropriately scoped, and a new, single Owner-approved CST-DEV job finishes with genuine Hub 4+1 signed Final ACK. No PROD changes.
