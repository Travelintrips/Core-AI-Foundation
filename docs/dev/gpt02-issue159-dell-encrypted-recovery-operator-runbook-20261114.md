# GPT02 Issue159 — DELL Gateway encrypted backup + isolated restore operator runbook

**Scope: CST DEV only.** Prepared 14 Nov 2026 from read-only evidence for Draft PR #1754. **This is an operator plan, not authorization to run any mutating command or recover the live Gateway.** Nothing in this file authorizes PROD, signer, agent dispatch or a new gateway process.

## Current evidence and restrictions

- Gateway Scheduled Task `OpenClaw Gateway` is `Ready`, its original task exited nonzero; no listener on TCP 18789. A separate `AI Core DELL Wake Executor DEV` remains Running. Do not terminate all Node processes or run a second Gateway.
- The correct current host package is custom `staged-update-2026.10.7`, not a global npm OpenClaw install. Its `openclaw update --dry-run --json` refuses with `unmanaged-package-install`. The old `AI Core OpenClaw Repair DEV` Scheduled Task must **not** be used as a repair shortcut.
- Official `openclaw storage list --json` for the **actual Gateway state/config**: exit 0, **zero** configured storage locations.
- Correct shared-state `backup_runs` database table contains **zero** recorded runs; this proves only the local ledger has no entries, not that backups cannot exist elsewhere.
- Official `backup create --dry-run --json --no-include-workspace` detects config+state, five agent roots, zero skipped volatile files, but it is **not** a retained or verified full archive.
- Eight already-known local backup/recovery folders were searched by filename metadata, with no full archive-format candidate. An ACL-protected owner-local recovery directory contains two DPAPI `.sqlite.dpapi` snapshots and a manifest; only the two databases have prior in-memory verification. **DPAPI CurrentUser snapshots do not establish independent-machine restoration.**
- Two local fixed NTFS drives exist; encryption status could not be verified (BitLocker read-only status returned an error). Free internal disk space is **not** an approved backup security boundary. No removable/network-mounted logical drive appeared in the check.
- A previous attempt to capture protected config/credential material was blocked by an access-control gate. **Do not bypass this gate**, including through a different script, backup command, copied token, administrator escalation, or an alternate device. Future sensitive backup operations must have an independently authorized access path and a compliant, recoverable encryption mechanism.

## Stage A — operator provisions protected location, before any archive is created

1. Operator designates a **separate durable destination**: encrypted object store or existing mounted/secured storage. It must have explicit ownership, access control, sufficient capacity, recovery from loss of the DELL machine, and a documented backup retention policy. Neither C: nor D: is assumed secure or independent.
2. Operator provisions an **independently recoverable encryption passphrase** through an approved secret manager, using a valid OpenClaw `SecretRef` or a narrowly scoped process environment injection. Never include the value in this PR, CI, stdout/stderr, command-line args, PowerShell history, screenshots, incident logs or chat. Never use `encryption: "none"` simply to unblock recovery.
3. The storage root must already exist and point to the intended disk/mount/bucket. Create or verify the destination outside this session under operator authority. Do **not** let an empty local mountpoint masquerade as a recovered external destination.
4. Operator reviews the required `storage.locations.<name>` configuration and its secret reference. Official reference: [OpenClaw storage locations at v2026.10.7](https://github.com/openclaw/openclaw/blob/v2026.10.7/docs/concepts/storage-locations.md). Any config edit is a separate authorized change with rollback; this runbook does not apply it.
5. Before any live Gateway restart, re-check that the intended archive destination is **not** under live Gateway state, agent directories, workspaces, plugin roots or the existing local DPAPI directory.

**Stage-A acceptance:** `openclaw storage list --json` reports the chosen location with correct provider, existing root, initialized marker and encryption/key check. Do not accept a mere root-path string as evidence that the destination is available or encrypted.

## Stage B — permitted read-only inspections

Use the **existing pinned Node and OpenClaw 2026.10.7 entrypoint** of the DELL Gateway; do not substitute PATH-based `openclaw` or another staged/global runtime. Set environment paths for the correct active state/config without printing secret values:

```powershell
$env:OPENCLAW_STATE_DIR = "<EXISTING_DELL_GATEWAY_STATE_DIR>"
$env:OPENCLAW_CONFIG_PATH = "<EXISTING_DELL_GATEWAY_CONFIG_PATH>"
$node = "<EXISTING_PINNED_NODE_24.22.1_EXE>"
$cli = "<EXISTING_OPENCLAW_2026.10.7_ENTRYPOINT>"
& $node $cli storage list --json
& $node $cli backup create --dry-run --json
```

The `backup create --dry-run` must include all needed agent/config/plugin/credential sources. **Do not add `--no-include-workspace` by default** if complete recovery also requires workspace content. If ordinary workspaces are deliberately excluded, document the separate workspace recovery proof and the resulting coverage boundary. A plan containing skipped `covered` assets is not by itself evidence of missing data, but every skipped or regenerable item must be classified and independently reviewed.

Never paste raw `storage list`, manifests, full config, storage location identity, agent paths or credentials into PR comments. Record only safe booleans/counts and redacted error codes.

## Stage C — mutation only after separate explicit maintenance + credential custody authorization

**Commands below are *not executed* by this runbook.** The operator alone chooses the location name, verifies secret custody, reviews service/lock quiescence, and explicitly authorizes these steps. The existing Gateway must remain single-instance; do not launch another Gateway to produce a backup.

```powershell
# EXAMPLES ONLY — NOT APPROVED FOR EXECUTION IN CURRENT STATE
& $node $cli storage init <APPROVED_LOCATION_NAME>
& $node $cli storage test <APPROVED_LOCATION_NAME>
& $node $cli backup create --to <APPROVED_LOCATION_NAME> --json
```

`storage init` writes the location identity/encryption marker. `storage test` writes/reads/deletes a temporary encrypted probe. `backup create --to` opens the configured location, creates an archive in managed scratch, verifies and uploads it; offsite verification is built in. **Do not add `--output`**: per OpenClaw v2026.10.7 documentation it retains an **ordinary plaintext** local tarball even if the offsite destination uses encryption.

A full archive may hold provider/auth tokens, private config, session and plugin state. Access to these files was previously blocked: do not invoke this stage until the authorization explicitly covers that path and data class.

## Stage D — independent verify and restore to a fresh target

**After an authorized protected archive exists**, use its exact returned archive key and matching namespace, not an unchecked `latest` pointer, for independent verification. The restore target must be a private newly created or empty location outside the live Gateway and agent trees.

```powershell
# EXAMPLES ONLY — require separately approved protected archive + restore target
& $node $cli backup list --from <APPROVED_LOCATION_NAME> --json
& $node $cli backup verify --from <APPROVED_LOCATION_NAME> <EXACT_ARCHIVE_KEY> --json
& $node $cli backup restore --from <APPROVED_LOCATION_NAME> <EXACT_ARCHIVE_KEY> --target <FRESH_PRIVATE_RESTORE_DIRECTORY> --json
```

Acceptance must include:
- Correct storage marker, authenticated encryption, and operator-held recoverable key; encrypted bytes can be read from the independent recovery environment.
- Native archive `verify` PASS; complete durable root/config include graph, plugin data, all configured/registered/discovered agent SQLite snapshots and the required credential inventory. No unexplained omissions or unsafe links.
- Isolated target restore PASS; SQLite integrity and native inventory roles/identities PASS. Confirm that staged files are readable and have constrained ACLs **without disclosing contents**. Target must not be a live state path or mounted live plugin directory.
- Restore is not fully atomic across every live config/database source. Reconcile the backup capture instant and any subsequent writes before declaring it a valid recovery point.
- Once tested, retain proof of archive key, namespace, version, checksum/inventory verification, storage retention and restore timing in a **nonsecret audit receipt**. Do not publish the archive or credentials.

Source reference: [OpenClaw backup CLI at v2026.10.7](https://github.com/openclaw/openclaw/blob/v2026.10.7/docs/cli/backup.md).

## Stage E — service operation remains independently gated

Passing all Stage A–D conditions is **necessary, not sufficient**, to turn on the DELL Gateway. Required separately:
- G0: prove no active Gateway, unexpected state owner, outstanding work or unsafe concurrent direct CLI; preserve other Node/AI Core processes and historic lock evidence.
- G2R: choose a release with verified Windows live-owner lock, plugin retirement and hard-exit watchdog semantics; qualify the *matched OpenClaw + Codex plugin + native Codex* release cohort. A pre-release passing disposable CI is not a live deployment authorization.
- G3: separate, auditable DEV-only maintenance approval for the existing Scheduled Task and a versioned rollback with exact executable/launcher bindings; no old repair task, blind global npm install or second Gateway.
- G4: fresh, post-start owned single listener and clean health; no opportunistic service loops.
- G5: separately verify the genuine `gpt02-dev` OpenAI auth principal, required model route and Gateway binding before any positive permit. Saved auth profile metadata is not proof of usable access.
- Issue159 business task dispatch, signing/attestation and Final ACK remain **NO_GO** until independently proved.

The pure [Issue159 backup evidence gate](../../scripts/dev/dev-gpt02-issue159-backup-recovery-gate.mjs) returns `NO_GO` for the currently observed zero-location, DPAPI-only state, and deliberately **never** sets `gatewayRestartAuthorized=true`. CI source/fixture PASS must never override real operator custody or maintenance authorization.

**Current decision (14 Nov 2026): Stage A NO_GO.** No approved encrypted remote location or portable recovery key is evidenced; no real full archive, config/credential capture or isolated full restore was conducted.
