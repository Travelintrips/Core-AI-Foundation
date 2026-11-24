# CST-DEV one-job — DELL-only Windows IPC host boundary

**Scope:** DEV project `xssrfshdrtdfupgqwfdw`; source candidate only, **not operational approval**. Owner selected **DELL as the only additional PC**. Existing Linux VPS remains the shared Core AI host and optional broker infrastructure; no ALMANO QA/signing deployment.

## Verified on authorized DELL (20 November 2026)

- Windows 11 Pro build 26200, x64, Node.js 24 and local Ollama available. WSL **not installed** and Docker CLI absent. The first observed free RAM was approximately 2.3 GiB; memory varies, so it is not a multi-agent capacity guarantee.
- Real Windows kernel pipe handshake with an explicit ACL for the current logon SID: **PASS**. The server calls `NamedPipeServerStream.RunAsClient` and checks the actual Windows access-token SID, not a value provided by the client.
- Real negative test: a separate ephemeral named pipe allowing **only LocalSystem** refused the ordinary DELL client: **PASS**. Both pipes were closed, and no extra account or service was installed.
- An idempotent, fail-closed transport probe is provided in `scripts/dev/cst-onejob-dell-native-ipc-preflight.ps1`. It emits only nonsecret booleans, `releaseDecision:NO_GO`, and `changes:NONE`. Execute manually from a PowerShell session on DELL if needed:
  `& .\scripts\dev\cst-onejob-dell-native-ipc-preflight.ps1`

## Required architecture, **not yet implemented**

1. Keep the already-PASS Linux PostgreSQL broker and `SO_PEERCRED` design scoped to the **existing VPS**, not Windows. Do **not** weaken Linux UID/GID checks, create new VPS sidecar daemons, or restart shared Core AI just to accommodate DELL.
2. Windows DELL is the model host and potential local QA/signing process host. A future Windows-specific, default-deny signer adapter must use **named-pipe ACLs and actual Windows client token SID**; Node's bare named-pipe path is **not a verified caller identity**. Pin expected non-administrative service identities from independently reviewed local configuration. Refuse Everyone/anonymous access, wrong SID, replay, unexpected request formats, wrong project, and a missing release.
3. Keep the subscriber, QA, four Hub agents (`coding`, `infrastructure`, `security`, `qa`), and reviewer behind distinct identities and signing-key custody. **One PC plus five different process names or software keys alone does not prove independent custodian control.** The worker and inspected Core must not read signers' private keys. Host/admin compromise remains a shared failure domain; security must explicitly accept or mitigate it.
4. Do **not** assume that native Windows CNG/TPM can hold nonexportable **Ed25519** keys: the standard Microsoft CNG KSP documentation enumerates RSA/ECDSA and does not establish this property. The existing GCP Secret Manager is not itself an Ed25519 signer. Do not enable a new Cloud KMS API, create keys, or store unencrypted signer material as a shortcut.
5. At release, the separately authorized provisioning/custody process must supply dedicated DEV-only service identities and public trust roots, one signed Owner-authorized job, independent QA, real subscriber receipt, four actual agent attestations, Hub reviewer Final ACK, and rollback/relock evidence. No fake Final ACK or reuse of historical job #482.

## Preflight limitations

The included self-check proves **only Windows IPC/ACL availability** by testing the current user's SID and a LocalSystem-only denial. It does **not** prove cross-service SID separation, hardened private-key custody, system service identity, production-grade key protection, signer independence, role/grant/provisioning authorization, operational readiness, or Hub Final ACK. No secret, key, password, database connection, Windows account, service, or container is created. **Always NO_GO** until independently verified live prerequisites exist.

Sources: [Windows Named Pipe Security](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights); [ImpersonateNamedPipeClient](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-impersonatenamedpipeclient); [Node IPC on Windows](https://nodejs.org/docs/latest-v24.x/api/net.html); [Microsoft CNG key storage providers](https://learn.microsoft.com/en-us/windows/win32/seccertenroll/cng-key-storage-providers).
