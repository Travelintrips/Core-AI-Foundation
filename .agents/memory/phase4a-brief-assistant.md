---
name: Phase 4A Brief Assistant
description: Rule-based guided brief assistant feature structure, key invariants, and wiring pattern
---

## Feature location
`artifacts/customer-portal/src/features/brief-assistant/`

## File structure
- `types.ts` — all domain types (modes, stages, question types, draft change, state, actions)
- `constants.ts` — FIELD_META, SERVICE_QUESTION_ORDER, CONDITIONALLY_VISIBLE, REVIEW_FIELDS
- `question-planner.ts` — `planBriefQuestions()`, `getNextBriefQuestion()`, `isFieldFilled()`
- `answer-mapper.ts` — `previewAssistantAnswer()`, `applyAssistantDraftChange()`
- `conversation-reducer.ts` — pure reducer, 12 actions
- `conversation-storage.ts` — sessionStorage with key `creative-brief-assistant:{requestId}`
- `assistant-session.ts` — `useAssistantSession()` hook
- `index.ts` — public barrel

## Components
`BriefAssistantLauncher` — FAB at `fixed bottom-[5.5rem] right-4 z-40` (above sticky footer)
`BriefAssistantPanel` — right drawer `fixed inset-y-0 right-0 w-[440px]` + mobile full-screen
Plus: AssistantHeader, AssistantMessage, AssistantQuestion, AssistantQuickReplies,
      AssistantTextInput, AssistantChangePreview, AssistantReview, AssistantCompletionSummary

## Key invariants
1. `onBriefChange` is called ONLY in `applyAnswer()` — no other path mutates the brief
2. `pendingChange` is NEVER auto-applied; always requires explicit Terapkan click
3. `RESTORE` action always clears `pendingChange` (spec §17)
4. No network calls anywhere in the assistant feature
5. All chip fields use existing `parseChoices`/`serializeChoices`/`parseColors`/`serializeColors` parsers
6. Selection limits: STYLE_MAX=3, COLOR_MAX=3, AUDIENCE_MAX=4 from `apply-adapter.ts`

## Wiring in brief.tsx
```tsx
// New state
const serviceType = useMemo(() => detectServiceType(...), [...]);
const [assistantOpen, setAssistantOpen] = useState(false);

// In JSX, before closing </Layout>:
<BriefAssistantLauncher onOpen={() => setAssistantOpen(true)} />
<AnimatePresence>
  {assistantOpen && <BriefAssistantPanel ... onBriefChange={(newBrief) => setBrief(newBrief)} />}
</AnimatePresence>
```

## BriefRecommendationPanel props
`serviceName` (not `serviceType`), `onApply` (not `onBriefChange`) — see BriefRecommendationPanel.tsx

## Tests
39 planner tests, 13 mapper tests, 11 reducer tests — all in `features/brief-assistant/*.test.ts`
Run with: `pnpm --filter @workspace/customer-portal exec vitest run`

**Why:** Zero AI calls, zero new endpoints — pure rule-based, respects existing autosave flow.
