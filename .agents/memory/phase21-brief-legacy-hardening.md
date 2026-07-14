---
name: Phase 2.1 brief legacy-compatibility hardening
description: Customer-portal brief form — legacy free-text parser rule, and a real "server brief never hydrates" bug found while verifying it.
---

## Legacy free-text parsers must never silently drop unmatched values
`parseChoices`/`parseColors` in `artifacts/customer-portal/src/lib/brief-utils.ts` split a stored
string on a separator and match each fragment to a known chip option. Any fragment that doesn't
match a known option must never be discarded — it must activate the "other" chip and be folded
into the `custom` text so it stays visible and editable. The old code silently dropped unmatched
legacy text (pre-chip free-text answers, or hand-edited data), which looked to the customer like
their real answer had vanished.

**How to apply:** when adding/auditing a chip-backed field that stores a plain string, always test
with (a) a pure legacy sentence with no separators, (b) a mix of matched + unmatched fragments,
and (c) a bare/malformed delimiter (semicolon with no space, newline instead of "; "). The splitter
should tolerate those delimiter variants without fragmenting a natural-language sentence that
merely contains commas/slashes/ampersands.

## The brief page never re-hydrated from the server-saved brief
`BriefPage` (`artifacts/customer-portal/src/pages/brief.tsx`) only ever populated its form state
from `EMPTY_BRIEF` or from a localStorage draft (`brief_draft_<requestId>`). There was no code path
that loaded `requestDetail.briefJson` (the brief already saved on the server) into the form. Any
customer returning without their original localStorage draft — new device, cleared storage, a
different browser — saw a blank form even though they'd already submitted answers. "Start over"
also reset to a fully empty brief instead of the last server-saved one.

**Why:** the draft-restore effect only checks localStorage; nobody added a parallel "hydrate from
server" effect. Easy to miss because a same-browser demo/dev session always has the localStorage
draft, masking the bug.

**How to apply:** any brief/onboarding form that autosaves to localStorage AND persists to a
backend must hydrate initial state from the backend value whenever there's no local draft to
restore (gate with a one-time ref so it never fights in-progress edits). Test with a fresh browser
profile or cleared localStorage against a request that already has saved data server-side.

## ADMIN_API_KEY exceptions list is narrower than the customer-facing route surface
`artifacts/api-server/src/middleware/adminAuth.ts`'s `PUBLIC_PATH_PREFIXES` only exempts `/public/*`
and `/ai/catalog/public`. But real, unauthenticated customer flows also call
`POST /ai/catalog/services/:id/request`, `POST /ai/catalog/services/:id/quote`, and
`GET /ai/catalog/services/:id` (service creation flow, service-detail page) — none of which are
under `/public`. Setting `ADMIN_API_KEY` (done during environment setup, previously fail-open with
no key in dev) silently breaks these customer flows with 401s. Not fixed as part of Phase 2.1 (out
of scope — forbidden to change API/auth in that pass); flagged to the user instead since a proper
fix needs care (that catalog router prefix mixes true admin CRUD endpoints with public read/action
endpoints, so a blanket prefix exception is unsafe).
