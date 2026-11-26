# Issue238 — candidate main integration only, NOT runtime deploy authorization

The QA source branch has a stand-alone read-only endpoint. This proposal ports
only the endpoint, its negative tests and a two-line router import/mount to the
older `main` branch. It deliberately does not carry over newer agent-runtime
routes or a deleted QA contract document from the source-only branch.

**Hold deployment:** the actual running DEV image is tagged
`core-ai-dev:vps-82c0bba41632`, while the checked-out main source is from a
different revision. The live VPS checkout has uncommitted modifications.
Do not use this branch to overwrite the active image or assume the old main
routing contains all previously passing features. Reconcile against a clean
copy of the exact active image's source first.

The endpoint remains SELECT-only and requires an exact authenticated worker
token, command ID, claim-token equality, QA marker and unexpired DB lease. It
cannot create work or prove that the QA marker itself was authorized. It cannot
issue Owner signatures, permits or execute PostgreSQL.
