---
name: react-icons v5 provider icons
description: Which react-icons/si exports exist for AI providers in v5.4.0
---

react-icons v5.4.0 does NOT export: SiOpenai, SiAnthropic, SiGoogle.

Available AI-related exports: SiReplicate, SiMistralai, SiOpenaigym (not SiOpenai).

**Why:** The package renamed or removed some icons between v4 and v5. Using wrong names causes a Vite runtime error: "does not provide an export named 'SiOpenai'".

**How to apply:** For OpenAI/Anthropic/Google/Gemini provider icons, use lucide-react `Cpu` with color variants (e.g. `text-green-400` for OpenAI). Only use react-icons/si for SiReplicate and SiMistralai.
