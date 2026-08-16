---
name: GCP provider secret precedence
description: How provider credentials are loaded at API startup and why a local override may not affect runtime
---

The API's startup loader replaces `process.env` provider values with the matching keys from the latest GCP Secret Manager JSON payload. A provider can therefore start successfully while still failing authentication if the GCP payload contains an expired or invalid key.

**Why:** Creative image generation reached Replicate but received HTTP 401 even though startup reported a successful secret load; the loaded payload, not a separately configured local value, was authoritative at runtime.

**How to apply:** When a provider reports authentication failure, inspect or update the GCP Secret Manager payload and restart the API workflow before changing pipeline code. Never log the credential while diagnosing it.