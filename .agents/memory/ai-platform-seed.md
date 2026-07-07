---
name: AI Platform seed script
description: How to run and extend the seed script for providers/models/agents
---

## Location
`artifacts/api-server/src/seed.ts` — runs via `pnpm --filter @workspace/api-server run seed`

## What it seeds (idempotent — skips existing records)
- **4 Providers:** openai, anthropic, google, replicate
- **9 Models:** gpt-4o, gpt-4o-mini, o4-mini, claude-3-5-sonnet, claude-3-haiku, gemini-1.5-pro, gemini-1.5-flash, flux-schnell, flux-dev
- **1 Agent:** AI Brand Strategist (slug: brand-strategist, 7 capabilities)
- **1 Prompt:** Brand Strategist System Prompt (category: system)

## Provider → env var mapping (in aiSecretService.ts)
- openai → OPENAI_API_KEY
- anthropic → ANTHROPIC_API_KEY  
- google → GEMINI_API_KEY
- replicate → REPLICATE_API_TOKEN

## Adding a new provider
1. Add to PROVIDER_ENV_VARS in aiSecretService.ts
2. Add a case in aiExecutionService.ts executeAI() dispatcher
3. Run seed script or insert via Registry UI
