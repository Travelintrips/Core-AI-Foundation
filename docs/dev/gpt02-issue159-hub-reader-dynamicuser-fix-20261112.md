# GPT02 Issue #159 — Hub/Core reader socket: explicit DynamicUser bind mount

Date: 2026-11-12. Scope: DEV-only signer custody and read-only readiness.

## Verified cause
The Hub/Core reader is active and returns HTTP 200 with two independent
restricted TLS-backed database sessions, but systemd exposes its
RuntimeDirectory through a root-owned symlink:

    /run/gpt02-reader -> /run/private/gpt02-reader

The private parent /run/private has mode 0700 and is not traversable
by the signer DynamicUser. Inside the real signer mount namespace,
os.lstat('/run/gpt02-reader/reader.sock') failed with Errno 13
Permission denied under the exact signer UID/GID (supplementary
gpt02-issue159-signers group). Merely allowing the trusted symlink in
Python is not sufficient and must not be used as an authorization bypass.

The previously running four signer custody snapshots reported
hubCoreReaderOperational=false; Issuer Reader was accessible because its
bind was a direct group-traversable directory.

## Minimal corrective architecture
The signer systemd unit now mounts the root-private reader directory
READ-ONLY into the signer mount namespace using the exact systemd bind:

    BindReadOnlyPaths=/run/private/gpt02-reader:/run/gpt02-hub-reader-bound

The signer runtime can connect only to:

    /run/gpt02-hub-reader-bound/reader.sock
    /run/gpt02-issuer-reader/reader.sock

No other filesystem paths are allowed. The Hub reader path must be a
real 0750 directory with non-root owner and the signer group, not
an alias back into /run/private; the socket remains non-root, mode 0660
and owned by the signer group. The only accepted root-owned symlink is
the exact, separately reviewed Issuer reader canonical alias.

The aggregate readiness checker, which runs outside the signer sandbox,
continues to verify the canonical Hub reader symlink itself, demanding
root:root alias ownership, exact /run/private/gpt02-reader target,
non-root group-private directory/socket and live health response.

## Evidence before release
- Running Hub reader: HTTP 200, twoSessionsVerified=true.
- Running Issuer reader: HTTP 200, TLS verified, readOnly=true.
- Test without any signer credentials: ephemeral systemd DynamicUser
  with Group/SupplementaryGroups=gpt02-issue159-signers,
  PrivateNetwork=yes, RestrictAddressFamilies=AF_UNIX,
  NoNewPrivileges=yes, ProtectSystem=strict, and the same
  BindReadOnlyPaths mapping successfully resolved the bound directory,
  validated owner/group/modes and got HTTP 400 UNTRUSTED_TASK_IDENTITY
  from POST /trusted-facts with empty JSON; no evidence was created.
- The same identity and namespace without the bind could not lstat the
  original canonical socket (PermissionError 13), which confirms
  the fix addresses a real mount/permission failure.
- Focused unit tests validate both allowed socket paths, wrong owner,
  unknown alias rejection, preserved private key custody and NO_GO
  flags. Full Issue159 regression and GitHub CI remain release gates.

## Safeguards
No chmod/ACL change to /run/private or read-only reader databases.
No private key copying or signer API is introduced.
No signed approval, nonce, fence, lease, dispatch or DELL worker action.
All four signers must remain GPT02_ISSUE159_SIGNING_ENABLED=false.

Only after CI PASS on the updated commit may the DEV service unit and
the two small runtime scripts be atomically synchronized with backups.
Restart signers serially, canary first; require real persisted
readiness.json showing hubCoreReaderOperational=true,
issuerReaderOperational=true and trustedReaderConnectivityVerified=true.
If a canary fails, roll back source and unit, and keep signing locked.

PROD untouched. Existing Task #147/148 evidence expired. Native lifecycle
E2E still NO-GO until a fresh genuine Super Admin approval, four
cryptographic signatures, nonce/lease consumption and final ACK proof.
