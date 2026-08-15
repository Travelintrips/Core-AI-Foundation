---
name: GCP Secret Manager bootstrap
description: Secret Manager bootstrap is read-capable but the current application secret payload is not canonical JSON
---

The canonical bootstrap is `GCP_SECRET_MANAGER_BOOTSTRAP_JSON`, targeting project `aicore-505614` and secret `aicore-app-secrets`. The bootstrap service account can authenticate and read `versions/latest`, but it cannot add a new secret version without additional IAM permission.

**Why:** The current latest payload is a text document containing a valid application-secrets JSON block surrounded by non-JSON text. A strict loader must reject the outer payload rather than silently interpreting an embedded block.

**How to apply:** Keep startup fail-closed until the secret is replaced with the pure JSON object. Do not print or copy secret values. Grant only the minimal secret-version-add permission if an automated repair is explicitly authorized; otherwise update the secret externally, then restart the API Server.