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


## Reusable eight-signer public-only gate (21 November 2026)

The new `deploy/cst-onejob-vps/cst_onejob_vps_readonly_gate.py` replaces
repeated manual signer inventory with one **read-only** check. On authorized VPS
`srv1792369`, run:

```bash
python3 -B deploy/cst-onejob-vps/cst_onejob_vps_readonly_gate.py --host-readonly
```

The tool pins the existing VPS source SHA, checks all eight Linux unit/UID/group
and Unix-socket bindings, systemd hardening, **root:0600 encrypted credential
file metadata only** (never their bytes), validates each Ed25519 **public**
fingerprint, and independently counts release conditions. It has no signing,
release, provisioning, decrypt or service-start mode. It **always** reports
`releaseDecision=NO_GO`; source and metadata PASS cannot grant live job
admission. No Google KMS, no DELL code-signing requirement.

Direct result on 21 Nov 2026: 8/8 signer foundations PASS; 8 distinct public
pins; 24 unmet unit conditions representing 17 distinct missing authorization
files (one operator trust root, 8 approved public role records, 8 per-job release
records). `signaturesIssued=0`, private credential content unread,
`FOUNDATION_PASS_RELEASE_PENDING`. The eight dormant services remain OFF.
Negative source regression tests cover forged public pin, wrong OS identity,
group and socket, duplicate switches, unencrypted credential directives,
unsafe symlinks, unexpected release paths, activation without authorization
and attempts to run an unsupported activation command.

The deployed current source and encrypted credentials are preserved. The
public root paths must **not** be populated from fake placeholders; this audit
cannot issue trusted release approval or replace the real Owner session.
Full operational E2E still requires approved independent trust, a new
Company-1 job, verified service identities and signed Hub 4+1 Final ACK.


## Durable anti-replay journal fix (source-only candidate, 21 Nov 2026)

The original signer journal used atomic `O_EXCL` creation and `fsync` on
the nonce file, but did **not** synchronize the containing directory. An
unexpected VPS power loss can lose the new directory entry even after the
file contents were synchronized, creating a replay window after restart.

The candidate signer source now validates the nonce against exactly 64
lowercase hexadecimal characters, rejects short journal writes, synchronizes
**both the file and the containing directory**, and retains fail-closed
behavior if either synchronization raises an exception. It never deletes a
failed nonce record to retry. Invalid nonce paths, symlinks and world-writable
ledger directories are rejected.

Disposable VPS regression tests use only temporary journal paths and no
operational signer key: successful private `0600` ledger creation, replay
denial, file+directory fsync order, simulated failures of each fsync, short
write, invalid/traversal nonce, symlink directory and unsafe permissions.

**Source-versus-installed-code distinction:** the live dormant VPS
`/opt/cst-onejob-dev/bin/cst_onejob_vps_signer.py` is NOT changed by this
source-only PR patch. The signed, independently authorized source release
must explicitly pin and validate the new candidate SHA before any possible
operational service start. The existing encrypted credentials are preserved.
No service activation, public approval-root promotion, Owner approval, job
dispatch, PROD write or real Final ACK is authorized by these tests.
