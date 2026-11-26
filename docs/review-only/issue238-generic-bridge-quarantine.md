# Issue238 QA reserved-origin safety gate — source only

The general coding bridge is NOT a QA issuance system. A caller-provided
`issue238QaPurpose` value is never sufficient authorization. This patch
rejects this reserved marker at generic submission before any DB read/write,
even if the key contains null/false/empty, and skips it in generic claims,
including targeted and expired claims. Existing ordinary work is unchanged.

A separate scoped, authenticated and Owner-authorized job-origin issuer is
still required before any real QA work can be submitted or claimed. The
current trusted read-only `/dev/issue238/claim-readiness/:commandId`
endpoint remains a verifier rather than a command factory. Do not equate this
quarantine with proof of Owner consent, immutable QA image provenance, PG17
E2E, or readiness to issue Invoice #108.

No new SQL migrations, roles, credentials, runner, QA job, or PROD changes.
