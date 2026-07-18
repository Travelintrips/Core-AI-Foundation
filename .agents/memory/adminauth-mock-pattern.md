---
name: adminauth-mock-pattern
description: Correct vi.mock pattern for adminAuth middleware when the router uses adminAuthWithExceptions
---

## Rule
Any test file that mocks `../../(or ../../../)middleware/adminAuth.js` MUST also export `adminAuthWithExceptions` from the mock factory.

**Why:** Multiple routers (design-blueprints, design-components, creative-commercial) apply `router.use(adminAuthWithExceptions)` at router level. Vitest throws "No adminAuthWithExceptions export is defined on the mock" if it is missing, causing the entire test file to fail (0 tests run).

## Correct Pattern A — when using `vi.hoisted` mocks object

```ts
vi.mock("../../../middleware/adminAuth.js", () => ({
  adminAuth: mocks.adminAuth,
  // Must also export adminAuthWithExceptions; delegate to adminAuth so
  // per-test mockImplementation changes propagate automatically.
  adminAuthWithExceptions: vi.fn((req: unknown, res: unknown, next: () => void) =>
    mocks.adminAuth(req, res, next)),
}));
```

## Correct Pattern B — when not using hoisted mocks

```ts
vi.mock("../../middleware/adminAuth.js", () => {
  const adminAuth = vi.fn((_req: any, _res: any, next: any) => next());
  return {
    adminAuth,
    adminAuthWithExceptions: vi.fn((req: any, res: any, next: any) => adminAuth(req, res, next)),
  };
});
```

## Auth behavior for GET route tests
The `adminAuthWithExceptions` mock must NOT be a blanket pass-through (always calling next()). If the router applies it at router level (router.use), GET routes will return 200 instead of 401 in "unauthenticated" test cases. Mirror the auth check of `adminAuth` in the mock.

## Files fixed
- `src/routes/__tests__/design-blueprints.test.ts` — adminAuthWithExceptions was pass-through
- `src/services/design-components/__tests__/designComponentSecurity.test.ts` — missing export
- `src/routes/creative-commercial/__tests__/security.test.ts` — missing export
- `src/routes/creative-commercial/__tests__/routes.test.ts` — missing export

**How to apply:** Before writing any new test file that mocks adminAuth, check if the router under test uses `adminAuthWithExceptions` (grep: `router.use(adminAuthWithExceptions)`). If yes, use Pattern A or B above.
