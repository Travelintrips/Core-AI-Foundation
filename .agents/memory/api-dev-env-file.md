---
name: API development environment file
description: Development API startup must work with injected environment variables when the optional local env file is absent
---

The API development workflow must not depend exclusively on a tracked `.env.development` file. Re-imported or newly restored repls may provide the required values through Replit/GCP environment injection while the local file is absent.

**Why:** A missing optional env file previously stopped the API before it opened its port, leaving dependent admin actions unavailable even though the API build itself was healthy.

**How to apply:** Keep local env-file loading conditional in development; let injected environment variables remain the source of truth when the file is unavailable.