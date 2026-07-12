---
name: Text overlay for diffusion-model brand text
description: Why and how AI-image pipelines needing legible brand text/menus use a programmatic SVG overlay instead of trusting the diffusion model, plus the QC-prompt and provider-timeout traps this created.
---

**Rule:** Diffusion models (FLUX Schnell/Dev, and likely most others) cannot reliably
spell brand names, taglines, or menu copy — negative prompts reduce but never
eliminate gibberish lettering. Any image role that needs legible text should
generate a text-free background (hardened "noText" prompt/negative-prompt) and have
the real text composited on top afterward with SVG + sharp (plate + text, sized to
the actual image dimensions from `sharp().metadata()`).

**Why:** Spent several iterations trying to prompt-engineer clean text out of FLUX
Schnell; it never got there. Switching to programmatic overlay took scores on
overlay-covered roles from consistently garbled (garbled brand name in ~most images)
to consistently 85-90 once two knock-on bugs (below) were fixed. Non-overlay roles
(background only, e.g. color_palette, packaging photography) still occasionally leak
model-hallucinated gibberish elsewhere in frame despite hardened negative prompts —
this is residual stochastic risk, not something prompt wording fixes further.

**How to apply:**
1. Vision-based QC must judge the *final composited* image (as a base64 data URI or
   the persisted URL), never the pre-overlay draft or a prompt-only judgment —
   otherwise QC is scoring something the user will never see.
2. When you tell the diffusion model "no text/no lettering" for a role, and then add
   an overlay anyway, you MUST build a *separate* prompt string to show QC — one that
   (a) strips the "no lettering/icon only" phrasing from the original promptHint, and
   (b) explicitly says the visible text was added programmatically afterward and
   should be judged only on legibility/spelling/integration, not flagged as violating
   the generation brief. Otherwise vision QC penalizes your own successful overlay for
   "contradicting the prompt" even when the baked-in text is perfectly spelled.
3. Add a quality-retry loop (distinct from provider-error retries): if QC score is
   below a threshold (e.g. 65) after a clean generation, spend one more cheap
   generation (~$0.003/image on FLUX Schnell) and keep whichever attempt scored
   higher. This meaningfully absorbs FLUX's per-draw stochastic gibberish without
   loosening the QC bar.
4. If a role type keeps hitting the provider timeout across multiple unrelated runs,
   check the actual configured `providerTimeoutMs` guardrail default before assuming
   it's a fluke — a too-tight timeout (e.g. 30s default) silently converts otherwise-
   fine generations into $0 "failed" assets, which drags the whole portfolio's average
   QC score down for reasons unrelated to image quality.
