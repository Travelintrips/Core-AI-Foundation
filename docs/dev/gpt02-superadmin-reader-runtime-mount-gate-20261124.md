# GPT02 Owner ledger reader — DEV encrypted loading and mount integration

## Scope and current baseline

This continuation closes the missing loading and release callsite for GPT02-1782. It does not create an issuer, enroll a key, provision a database credential, or activate the Owner reader.

At the last verified baseline, [PR #1816](https://github.com/Travelintrips/Core-AI-Foundation/pull/1816) was deployed as `44426ba690c808ab77d3d59d32f9cb350fd5c2a5`. The reader feature was disabled, both V2 issuer public-key configurations and proof files were absent, and the dedicated Owner-reader sealed/runtime inputs were absent. That evidence is a baseline, not proof that this loading integration has been installed.

The earlier 24 November `PASSWORD NULL` snapshot is historical. Task190 now consumes the same PostgreSQL role, `gpt02_owner_ledger_reader_dev`, through a separately sealed credential and a different, bounded RPC contract. **Do not reset that role's password, copy Task190's sealed material, change its connection limit, or broaden its socket contract.** The legitimate custodian must reconcile the existing consumers before provisioning this separate read purpose.

## Implemented loading path

`gpt02-owner-ledger-credential-loader.service` is a static, dormant systemd unit: it has no installation target and is not enabled or started by installing its files.

| Boundary | Fixed input/output |
| --- | --- |
| Externally provisioned encrypted input | `/etc/credstore.encrypted/gpt02-owner-ledger-reader.json` |
| Authenticated encrypted credential name | `reader.json` |
| Private systemd input for the loader | `/run/credentials/gpt02-owner-ledger-credential-loader.service/reader.json` |
| Ephemeral root-only publication | `/run/credentials/gpt02-owner-ledger-reader/reader.json` |
| Loader executable | `/usr/local/libexec/cst-dev/gpt02_owner_reader_credential_loader.py` |
| Existing public CA | `/etc/gpt02-dev/supabase-root-ca-2021.crt` |

Systemd authenticates/decrypts the input through `LoadCredentialEncrypted`. The encrypted blob's embedded credential name must be `reader.json`; renaming a blob does not rebind its authenticated name. There is no plaintext persistent-disk fallback or in-chat provisioning procedure.

The loader runs as root with exact DEV environment, without network access. It opens trusted parent directories by descriptor, rejects symlinks/unsafe ownership, accepts only a single-link private regular source file, reads at most 4,097 bytes, and rejects source mutation. Strict UTF-8/JSON validation rejects duplicates and extra fields. The seven accepted fields must specify the existing fixed DEV project, host, port, database, TLS mode and reader role; the password is validated only in the loader process and is never printed.

Publication uses a private mode-0600 temporary file in the pinned root-only runtime directory, complete bounded writes, fsync and atomic replacement. Failures before replacement preserve the prior file and remove only the loader's own temporary file. A failure after atomic replacement can leave the complete new file; the release caller still aborts and must not infer success. CLI diagnostics contain fixed codes only.

## Actual release callsite

`scripts/vps/deploy_dev_release.py:start()` now calls the mount preparation path immediately before **both** canary and final container creation.

With `GPT02_OWNER_LEDGER_READER_ENABLED` absent or `false`, the optional path returns no mounts, inspects no credential/proof/CA paths, and starts no unit. Existing DEV deployment behavior is retained.

With an explicit `true` flag, the caller:

1. Requires exact development environment and DEV project, with no production-style Supabase configuration.
2. Checks both canonical Ed25519 public SPKI values, matching SHA-256 fingerprints and distinct issuer keys. This is configuration validation, not key enrollment or proof of issuer authority.
3. Inspects the two fixed protected public proof files and CA metadata before loading any sealed credential.
4. Starts only `gpt02-owner-ledger-credential-loader.service`, without enabling it at boot.
5. Requires the protected loaded reader file, then adds only readonly reader-file, CA-file and custody-directory mounts.
6. Aborts before Docker creation if any preparation step fails. The normal exact-SHA, CI, canary, rollback and PROD-preservation gates still apply.

The custody mount is the **directory** `/run/credentials/gpt02-reader-custody`, with root mode 0700, not two separate file mounts. This lets authorized removal or atomic replacement of a receipt inside that directory reach the verifier on its next request. Do not replace the directory inode itself while it is mounted. The verifier still checks real signatures, exact scope, expiry, current token generation and linkage on every authenticated request; the release metadata check does not replace it.

The credential and CA mounts intentionally hold file snapshots. Reloading or stopping the loader does not refresh or revoke a file already bound into a running container. An authorized refresh/revocation must recreate/stop the affected DEV containers through the reviewed release/rollback procedure. Systemd removes the host runtime directory on unit stop.

## Installation and rollback boundaries

The installed release executable `/usr/local/sbin/cst-vps-dev-release.py` includes runtime changes that are not identical to tracked source, including the existing `/run/gpt02-issuer-reader` mount, group 999, offline build handling, approval UI preservation and rollback retention. **Never overwrite it from tracked source.**

After exact candidate CI passes, installation must preserve a hash-identified backup and apply only the reviewed import, environment return, preparation function and `start()` callsite additions. Install the metadata helper next to that executable, the loader under `/usr/local/libexec/cst-dev`, and the static unit under `/etc/systemd/system`, with root ownership and no group/other write access. Reloading the unit definitions does not start the loader.

Verify the installed executable retains the historical issuer socket/group, build/provenance, rollback and PROD guards. With the feature disabled, verify that the unit stays inactive and no optional mounts appear during the ordinary DEV release. Rollback restores the exact prior executable/helper/unit installation and the previous verified DEV image/static snapshot; do not replace it with a differently customized tracked script.

## Remaining operational handoff

The existing Owner is the human decision maker. The worker-attestor and database-custodian identities are independent technical capabilities, not additional human reviewers.

There is still no operational GPT02-1782 V2 issuer in the inspected baseline. `/api/ai/agent-runtime/credentials` manages service tokens and does not issue custody attestations. Root shell access, a worker coordination appointment, or public-key presence must not be treated as issuer authority.

Before live activation, the authorized integration must establish issuer provenance, produce current V2 worker/DBA receipts, reconcile the shared-role consumer, and supply the independently scoped encrypted reader input. Do not create test keys, reset the shared role or replay Task190 approvals to satisfy those conditions. The [V2 signature contract](gpt02-reader-custody-runtime-adapter-20261124.md) and [Owner reader contract](gpt02-superadmin-owner-ledger-read-20261124.md) remain authoritative for their respective inputs.

Actual acceptance requires the authenticated worker custody check plus dedicated-role TLS/limited SELECT and the original challenge through a genuine signed Super Admin session. Loader PASS, source tests, and healthy deployment alone do not prove Owner-ledger E2E, signing, dispatch, relock or task execution. Keep the existing Nginx reader denial until its separately reviewed activation and E2E gates pass.
