---
name: AI Platform workflow env vars
description: Required env vars for api-server and ai-platform dev workflows
---

Both artifact dev workflows require env vars that must be injected via the workflow command:

- API Server: `PORT=8080 pnpm --filter @workspace/api-server run dev`
- AI Platform: `PORT=20785 BASE_PATH=/ pnpm --filter @workspace/ai-platform run dev`

**Why:** api-server/src/index.ts throws if PORT is missing. vite.config.ts in ai-platform throws if BASE_PATH is missing. Without these, both workflows fail on startup.

**How to apply:** Always include PORT and BASE_PATH when configureWorkflow() is called for these artifacts. The artifact.toml [services.env] block sets these for the proxy-managed environment, but manual workflow configuration does not pick them up automatically.
