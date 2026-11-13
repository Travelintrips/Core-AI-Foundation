# GPT02 Issue159 — DEV verifier source alignment (13 Nov 2026)

This change **preserves**, but does not rebuild, the DEV-only verifier already
running on the authorized VPS. The five Python modules and the two systemd
units are byte-identical to the tested live files. Only their already-existing
focused regression tests and a new CI workflow accompany them.

## Purpose

Keep four-signature verification, persisted Super Admin approval readback,
immutable task/command/attempt binding, and independent lineage checks in
the tracked `develop` source. These were previously only available inside
the broad, unmerged PR #1723 and on the live DEV VPS.

## Safety and release boundaries

- **Read-only verifier**: no database writer credentials, no private signer
  keys, no nonce or lease mutation, no command creation, no worker dispatch.
- Verifier responds with `signingPermitted=false`,
  `authorizationGranted=false`, `dispatchPermitted=false`, and
  `releaseDecision=NO_GO` even when cryptographic proof verifies.
- Service is restricted to private Unix sockets with `PrivateNetwork=yes`,
  `RestrictAddressFamilies=AF_UNIX`, and restricted filesystem access.
- It does not authorize Job #135 recovery, nor reuse Jobs #136 or #151–156.
  That requires an independent, task-bound operator approval, a complete
  historic-attempt exclusion proof and a dedicated, legitimate issuer write.
- No Supabase migration, role change, signing flag, new task or PROD change.

## Evidence

Live SHA-256 equivalence was checked for the five modules and both units.
Focused suites: 13 broker contract, 23 staged admission, 21 lineage
readback, 8 approval reader, 20 broker runtime, 3 verifier service and
3 approval reader service tests: **91/91 PASS** locally.

This is source retention only. Before any operational issuer activation,
require an independent, explicit release review of the full issuer/writer,
nonce/lease fence and DELL signed Final ACK chain.
