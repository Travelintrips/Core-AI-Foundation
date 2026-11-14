# GPT02 Issue159 — DELL Gateway encrypted backup + isolated restore operator runbook

**Scope: CST DEV only.** Prepared 14 Nov 2026 from read-only evidence for Draft PR #1754. **This is an operator plan, not authorization to run any mutating command or recover the live Gateway.** Nothing in this file authorizes PROD, signer, agent dispatch or a new gateway process.

## Owner update — prior Cloudflare R2 proposal withdrawn (15 November 2026)

The owner has explicitly requested **not to use Cloudflare** for DELL/OpenClaw backup. This **supersedes and cancels** the earlier Cloudflare R2 provider approval and its placeholder configuration from 14 November 2026. **Do not create or configure Cloudflare R2 buckets, API tokens, storage locations, or backup uploads for this work.**

**Current provider decision: NONE SELECTED.** The established goal remains an encrypted, independently recoverable backup for CST-DEV DELL, using existing supported capabilities and preserving already-PASS recovery gates. Any replacement must be explicitly selected and reviewed before configuration or writes. No new destination, encryption key, archive, or restore has been created under this change.

**Stage A remains NO-GO:** the real OpenClaw CLI previously reported zero configured storage locations. The actual independent destination, encryption and secret custody, access to protected config/data through authorized controls, retention, isolated restore, and host-runtime reconstruction must be evidenced before a real backup is attempted. Do not use source DELL C:/D: as an off-host destination or repurpose the active VPS OpenClaw instance.

## Owner choice — private GitHub encrypted backup (15 November 2026)

Owner now directs backup to **GitHub**, explicitly **not Cloudflare**. A dedicated **PRIVATE** GitHub repository has been created and independently checked as private. Nonsecret versioned recovery evidence is preserved there (runtime fingerprint inventory, gate code/tests, runbook). **Do not treat this as a full OpenClaw state backup.**

GitHub is **not a built-in OpenClaw storage-location provider** in the installed CLI. A future complete backup may use **client-side encrypted archive payloads uploaded as private GitHub Release assets**, not plaintext files in Git commits. Private repository visibility does not provide encryption. Never store credentials, auth profiles, plaintext databases, unencrypted archives, or the decryption key in repository history, releases, PR discussions, logs, or Actions artifacts. Key custody must be recoverable separately from the DELL machine and this GitHub account. GitHub Releases has per-asset size limits; package and verify accordingly. Do not use `backup create --output` as a plaintext fallback.

**Current evidence:** the initial nonsecret recovery source/metadata backup exists in the dedicated private repository. **Not yet proven:** encrypted native full-state archive, independent key custody, upload/download integrity of a private release asset, isolated restore and recoverable host-runtime components. Prior access-control denial for protected source files must not be circumvented through GitHub CLI or a different script.

**Decision: Stage A still NO-GO for live data backup/recovery.** Do not restart DELL Gateway, promote tasks, activate signer/dispatch, or modify PROD on the basis of GitHub repository creation.

## Current evidence and restrictions

- Gateway Scheduled Task `OpenClaw Gateway` is `Ready`, its original task exited nonzero; no listener on TCP 18789. A separate `AI Core DELL Wake Executor DEV` remains Running. Do not terminate all Node processes or run a second Gateway.
- The correct current host package is custom `staged-update-2026.10.7`, not a global npm OpenClaw install. Its `openclaw update --dry-run --json` refuses with `unmanaged-package-install`. The old `AI Core OpenClaw Repair DEV` Scheduled Task must **not** be used as a repair shortcut.
- Official `openclaw storage list --json` for the **actual Gateway state/config**: exit 0, **zero** configured storage locations.
- Correct shared-state `backup_runs` database table contains **zero** recorded runs; this proves only the local ledger has no entries, not that backups cannot exist elsewhere.
- Official `backup create --dry-run --json --no-include-workspace` detects config+state, five agent roots, zero skipped volatile files, but it is **not** a retained or verified full archive.
- Eight already-known local backup/recovery folders were searched by filename metadata, with no full archive-format candidate. An ACL-protected owner-local recovery directory contains two DPAPI `.sqlite.dpapi` snapshots and a manifest; only the two databases have prior in-memory verification. **DPAPI CurrentUser snapshots do not establish independent-machine restoration.**
- Two local fixed NTFS drives exist; encryption status could not be verified (BitLocker read-only status returned an error). Free internal disk space is **not** an approved backup security boundary. No removable/network-mounted logical drive appeared in the check.
- A previous attempt to capture protected config/credential material was blocked by an access-control gate. **Do not bypass this gate**, including through a different script, backup command, copied token, administrator escalation, or an alternate device. Future sensitive backup operations must have an independently authorized access path and a compliant, recoverable encryption mechanism.

## 21:30 WIB destination inventory — no approved off-host destination discovered

Additional metadata-only discovery on **14 Nov 2026**, without touching credentials, backing up files or starting a service:

- DELL has exactly two PowerShell filesystem drives, **C:** and **D:**, and `Get-SmbMapping` returned **0 SMB mappings**. Both mounted logical drives seen by Windows were fixed NTFS, not removable or network volumes. No native `restic`, `rclone`, `borg`, AWS, AzCopy or gcloud CLI was found on its PATH. Built-in Windows OneDrive updater and backup-named Scheduled Tasks exist, but their presence is **not** an approved, independent or credential-safe OpenClaw backup destination.
- DELL BitLocker status for C: and D: was **not readable** using the current limited access, so do not infer these local disks are encrypted. Do not elevate privileges or use this uncertainty to justify writing a plaintext backup archive.
- Read-only DEV VPS inspection found **no** pre-installed `restic`, `rclone`, `borg`, AWS, AzCopy, gcloud, S3cmd or duplicity CLI, and no NFS/CIFS/SSHFS/rclone/S3FS-style mount was observed. This is a bounded tool/mount inventory only, **not** a claim that the VPS lacks all other storage capabilities.
- A listener at VPS loopback port **127.0.0.1:18789** was mapped to a Docker proxy with container **`ai-core-workers-openclaw-1`**, image `ghcr.io/openclaw/openclaw:2026.9.8`, Docker health **healthy**. This is a **separate VPS instance** from the offline DELL Gateway, which has a custom pinned 2026.10.7 installation and zero listeners on port 18789. Do not switch GPT02 to the VPS instance, stop it, update its image, assume shared credentials or use its live container/volumes as an ad hoc backup store. Its data protection and owner boundaries have not been reviewed.
- Final DELL read-only service check at **21:32:56 WIB**: Scheduled Task `OpenClaw Gateway` **Ready**, port `18789` **0 listeners**, unrelated `AI Core DELL Wake Executor DEV` **Running**.
- The correct local OpenClaw CLI `storage list --json` still previously reported **0 configured destinations**. No off-host encrypted destination or independent decryption-key custody has been demonstrated.

**Decision after destination discovery: Stage A remains NO_GO.** Nothing in the observed environment is an already-approved backup location. This discovery does not authorize installing a new backup agent or mounting a VPS share; doing so requires its own review and operator approval.

### Provider-neutral storage possibilities (none selected)

1. **Separate protected object store:** operator chooses a designated encrypted bucket/prefix using a plugin/provider already supported by the *exact installed* OpenClaw version; provider compatibility, authorization, retention and recovery key custody must be verified independently. No object storage provider is approved by the owner at this stage; Cloudflare is specifically excluded.
2. **Separate protected filesystem storage:** operator mounts or provides an existing encrypted and recoverable removable/remote destination and registers it with built-in OpenClaw `filesystem` storage, with an approved `SecretRef` or other appropriately scoped secret injection. The destination must persist if DELL fails, and its key/marker must be recoverable on a *different* machine. The presently observed C:/D: drives do not satisfy independence by themselves.

For both choices, require explicit permission to access protected full-config/credential content, an approved destination identity and recoverable key before `storage init`, `storage test`, `backup create --to` or `backup restore` can be run. The previously denied protected-file copy must not be circumvented. **Do not choose or provision any provider or access protected credentials automatically.**

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

## Stage D2 — recover the host runtime separately from the data archive

**Read-only DELL inventory, 14 Nov 2026:** the official installed 2026.10.7 command `backup create --dry-run --json` (without excluding workspaces) reported **6 assets**: four workspaces, one active config and one state directory; it also reported five agent roots, 6 `covered` skips and 23 `regenerable` skips. It reported `dryRun=true` and `verified=false`, so no archive was written. None of the 6 asset source roots lies within the custom `staged-update-2026.10.7` package. Therefore this official archive plan does **not** establish recoverability of the OpenClaw installation itself.

Additional live host file metadata confirmed **each exists on source DELL but is outside the state directory**:

- Existing Task Scheduler executable `gateway.cmd`: file exists, size **890 bytes**, last modified **7 Nov 2026**; neither in state tree nor package tree. The Scheduled Task entry and launcher bindings need an independently reviewable reconstruction method; storing Task Scheduler metadata must not expose sensitive arguments or task identities.
- Pinned Windows Node executable **24.22.1** is outside the state tree. The exact binary/architecture/source/integrity must be supplied from an approved reproducible package or a controlled recovery point, not by assuming Node on PATH is equivalent.
- Custom installed OpenClaw **2026.10.7** package manifest exists outside state; the exact package owner, immutable artifact digest, dependency lock and safe replacement/restore method remain separately required. `openclaw update --dry-run` earlier returned `unmanaged-package-install`; a global npm reinstall or old `AI Core OpenClaw Repair DEV` task is not a replacement.
- The Gateway's **Codex 2026.10.7 plugin** is present *inside* Gateway state; the state asset may cover it, but the final archive inventory must still prove plugin files, native Codex package, any excluded/generated files, credentials and loader/binding metadata are recoverable.

**Operator G2-host acceptance, separate from data restoration:** demonstrate an isolated recovery host can reproduce verified bytes/versions of the approved host package and pinned Node, restore a sanitized launcher + Task Scheduler binding, keep a single owner/no-dispatch configuration, and inspect startup readiness without attaching live credentials. Never copy private config/credential content or launch any recovered Gateway from this task. The existing source DELL itself is not an independent recovery environment.

The pure [backup recovery evidence gate](../../scripts/dev/dev-gpt02-issue159-backup-recovery-gate.mjs) now requires explicit operator-reviewed `customHostPackageRecoveryVerified`, `pinnedNodeRecoveryVerified`, and `gatewayLauncherTaskRecoveryVerified` proof in addition to full encrypted archive, key custody and isolated restore. These are **evidence booleans, not secrets, executable operations or startup permission**. Even if every condition were true, `gatewayRestartAuthorized` remains `false`.

## Stage D3 — DELL OpenClaw/AI Core chain continuity (additional evidence only)

**Metadata-only follow-up, 14 Nov 2026:** A separate passive check on the source DELL found `node.vbs` (278 bytes), `dell-wake-event-listener.mjs` (7,301 bytes), the Gateway-pinned Node **24.22.1**, and the Wake Executor's separate portable Node **26.11.1**. The existing Gateway launcher's pinned Node must **not** be replaced with the Wake Executor Node. `OpenClaw Gateway` and `OpenClaw Node` were both Scheduled Task `Ready` with latest task result **1**; `AI Core DELL Wake Executor DEV` was `Running`; TCP 18789 showed **0 listeners**. These observations show source-host assets/status, not independent restore, healthy Gateway execution, or permission to change any task.

The original `evaluateBackupRecoveryGate` contract (Gateway data archive and host prerequisites) is **unchanged**. For the wider **DELL OpenClaw/AI Core chain**, the optional pure `evaluateDellOpenClawChainRecoveryGate` in the [same gate module](../../scripts/dev/dev-gpt02-issue159-backup-recovery-gate.mjs) requires all original backup evidence **plus** the following separately operator-reviewed proof from a fresh isolated recovery target:

1. `workspaceRecoveryVerified`: all workspaces required by the DELL chain independently recovered; including them in a dry-run is not evidence.
2. `openclawNodeLauncherRecoveryVerified` and `openclawNodeScheduledTaskRecoveryVerified`: the `node.vbs` artifact and `OpenClaw Node` task definition can be reconstructed safely, with exact intended version, action and ownership.
3. `wakeExecutorScriptRecoveryVerified`, `wakeExecutorDependencyClosureRecoveryVerified`, and `wakeExecutorNodeRecoveryVerified`: reproduce the exact Wake listener, its local runtime dependency closure (read-only source inventory shows `dell-wake-event-listener.mjs` imports `./dell-wake-executor-once.mjs`), and its separate portable Node runtime on a fresh isolated target. Presence of the listener alone is insufficient. Verify compatible dependency versions and integrity without reading protected credentials.
4. `wakeStagedOpenClawPackageRecoveryVerified`: the conditional Wake Executor runtime also references `openclaw-schema20-staging/node_modules/openclaw/openclaw.mjs`, whose source DELL package manifest reports **2026.11.1**. This is **distinct from Gateway 2026.10.7**. Independently restore and verify this second package and its dependency graph (or document a separately reviewed equivalent release contract), without substituting the Gateway package, invoking the code or using source DELL presence as recovery proof. Six already-pinned support-code files matched their pinned SHA-256 values on source DELL; that is source integrity only, not portable restore evidence. Do not read the existing protected environment or config files.
5. `wakeExecutorScheduledTaskRecoveryVerified` and `wakeExecutorScopedConfigRecoveryVerified`: the DEV-only Wake Executor task and its working directory, isolation, scoped runtime configuration and authorized credential *references* can be reconstructed without copying or displaying protected secrets. A user-bound DPAPI snapshot is not cross-host proof.
6. `crossTaskBindingsRecoveryVerified`: review all three task bindings together (Gateway, Node, Wake Executor), including intended startup triggers, principal/logon type, runtime paths, single-instance constraints and separation of authority. Recovered task definitions must be examined **disabled and offline**; this stage does not start a service.

A missing or non-boolean true field fails closed. The function reports `DELL_OPENCLAW_CHAIN_EVIDENCE_COMPLETE` only when every evidence field is true; this status is a **synthetic/evidence checklist**, not a guarantee that all Windows host components have been imaged or independently tested. It always returns `gatewayRestartAuthorized=false`, `openclawNodeRestartAuthorized=false`, `wakeExecutorRestartAuthorized=false`, `workerDispatchAuthorized=false`, and `productionModificationAuthorized=false`.

Never use the source DELL itself as an independent restore target. Never run the legacy repair task, restart the Gateway, promote a task, import unreviewed Scheduled Task XML, install a global runtime, read/copy protected credentials, or dispatch a worker as part of this check.

## Stage D4 — source runtime checksum inventory (nonsecret metadata only)

**Snapshot date:** 14 Nov 2026. Read-only DELL metadata and SHA-256 file hashes were collected without creating a backup or reading the contents of protected configuration, environment files, credentials, session data or private keys. This is a **source fingerprint list**, not a signed bill of materials, immutable upstream attestation, approved backup, or proof of independent recovery. A source checksum cannot by itself establish that the file is trustworthy. Do not use these hash values as an authorization for service start, credential transfer or dispatch.

| Asset identifier | Bytes observed on source DELL | SHA-256 (source file) |
| --- | ---: | --- |
| Gateway pinned Node 24.22.1 binary | 93915464 | `d702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5` |
| Gateway OpenClaw 2026.10.7 package manifest | 149337 | `362f8c0fda7b71a116e0ca2f812e896bfe9cfec41e64b6b66243f95703aaf7b8` |
| Gateway OpenClaw 2026.10.7 entrypoint | 24736 | `98caf565334400768d4a8ee54f7f9302c4b2c79881552c79785ed7d66da6a996` |
| Wake portable Node 26.11.1 binary | 105052136 | `a619e2e09eb0d50ef4c733d678b4d22689d2afef138cd67fd3fa107b535f8819` |
| Wake conditional OpenClaw staging 2026.11.1 package manifest | 152608 | `0bd1b84babac67876154f4072663d51c1f7fe6ffbc32c9c3bcd4555daab11d71` |
| Wake conditional OpenClaw staging 2026.11.1 entrypoint | 23906 | `469e60c9f60b615ff71c985a54238ee532a8f949866d76aebe7d6e4bc7219902` |
| Global Node binary referenced conditionally by Wake CDP path (observed Node 25.8.0) | 95392256 | `d0100ef59988cdfcb48a6876b36ea98b1ce006470de24e1e59ab7d5752750c21` |
| Gateway `gateway.cmd` launcher | 890 | `19c403af720537cd504158c7d893e554552378dbc265e72675de1f3e94eed118` |
| OpenClaw Node `node.vbs` launcher | 278 | `8a672a1267e63f4eaed8df864691e6ed467ed550f95188f040292dd70fbf8ec0` |
| Wake `dell-wake-event-listener.mjs` | 7301 | `1e4050711926c3c87af2fcfcedf03ef8b5da8f7d0cdac88e712b9853b476c950` |
| Wake `dell-wake-executor-once.mjs` | 56110 | `6f3bc3a6b6f1d814d08602df0fffc3f8a8f5ca47f9a73275f6d2b757b6da8eb1` |
| Wake `dev-chatgpt-wake-once.py` | 33676 | `379c413269f98308919cddeec8355cb159ccd3646a2c787671dc8c3736bb6c03` |

For the **six support code files already pinned in the local Wake Executor implementation**, the source DELL read-only SHA-256 check reported **six matches out of six**. That check does not cover the entire package tree, downstream Python dependencies, native Codex components, browser/CDP binaries, or private environment/configuration. The existing local script `dell-wake-executor-once.mjs` also references `dev_chatgpt_native_transport.py`, passive capture helpers and an existing GPT02 local cache readback adapter; their full portable dependency closure still requires independent verification.

**Independent recovery acceptance procedure (offline, disabled and isolated):** obtain the original/versioned release artifacts from authorized owners; verify package provenance/immutable release records and complete dependency closure; compare the recovered file bytes and hashes against approved references *as one evidence layer*; reconstruct the three Scheduled Tasks with verified identities and paths while keeping them disabled; then independently inspect the restored state and secrets by an authorized custodian without copying protected material into CI, logs, GitHub or chat. Source DELL file presence, hash equality alone, a dry-run, or synthetic CI must **never** switch any recovery evidence field to `true`.

A separate protected encrypted off-host backup destination and independent key custody remain unresolved; therefore **Stage A is still NO_GO**. Do not convert this inventory into an archive, copy it into a live service directory, or execute launcher/task artifacts as part of this audit.

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
