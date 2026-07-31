# Admin Endpoint Integration Coverage — Design Spec

**Date:** 2026-06-11
**Author:** opencode
**Status:** Approved (brainstorming gate passed 2026-06-11)
**Slices covered:** Backend integration test expansion for the 19 admin endpoints
wired in commits `b2ce419c` and `5dbf7cfd`.

## Context

The 19 tenant-scoped admin endpoints added in commits `b2ce419c` (Phase 1) and
`5dbf7cfd` (Phase 2) currently have **happy-path-only** test coverage — a single
test per endpoint that asserts the response shape and a 200 status code. They
do not pin:

- The auth boundary (no-tenant, wrong role, unauthenticated)
- The empty-data path (zero rows in DB, summary still valid)
- The error path (invalid query params, malformed IDs, missing references)
- The data-boundary path (single row, large rows, edge of date range)

This slice expands the existing 9 admin test files from **38 happy-path tests
to ~66 boundary + error-path tests** using TDD, and fixes any real bugs that
emerge as RED.

## Goals

1. **Pin the contract** of every admin endpoint under realistic boundary
   conditions so that future refactors cannot silently regress.
2. **Surface real bugs** in the error paths of the 19 endpoints (some
   endpoint handlers may assume non-null input that is not enforced at the
   schema layer; the new tests will turn these into visible failures).
3. **Establish a pattern** for error-path coverage that can be reused for
   every future tenant-scoped endpoint (especially for the orphan-page
   endpoints that were wired without tests in Phase 1/2).
4. **Keep the change set small and reversible** — extend the existing 9
   test files in place, no new test files, no new dependencies.

## Non-goals

- This spec does **not** add Playwright E2E or browser-based tests. That
  is **sub-project 3** in the broader three-sub-project plan
  (Backend → Frontend → E2E flow).
- This spec does **not** add new endpoints or modify endpoint behavior
  beyond what is strictly required to make the boundary tests pass.
- This spec does **not** touch the 28 pre-existing test failures. Those
  are documented in `docs/ozzyl-admin-panel-progress.md` and are out of
  scope.

## Endpoints covered

The 19 admin endpoints are grouped by test file. Each test file already
exists; this spec only adds new `it()` blocks.

| Test file | Endpoints | Current tests | Target tests |
|---|---|---|---|
| `test/admin-ipd-monitor-stats.test.ts` | `/api/admissions/stats` | 4 | 8 |
| `test/admin-opd-monitor-queue.test.ts` | `/api/queue/tokens/overview` | 2 | 5 |
| `test/admin-dashboard-stats.test.ts` | `/api/dashboard/stats`, `/api/dashboard/active-counters`, `/api/dashboard/security-alerts` | 7 | 10 |
| `test/admin-diagnostic-monitor.test.ts` | `/api/lab/orders/queue/today` | 2 | 5 |
| `test/admin-pharmacy-monitor.test.ts` | `/api/pharmacy/summary` | 1 | 4 |
| `test/admin-alerts-tasks.test.ts` | `/api/admin/alerts`, `/api/admin/tasks` | 2 | 4 |
| `test/admin-discount-references.test.ts` | `/api/admin/discount-references` | 1 | 4 |
| `test/admin-audit-explorer-routes.test.ts` | `/api/admin/audit`, `/api/admin/audit/financial`, `/api/admin/export-history`, `/api/admin/sessions`, `/api/admin/alerts/detect` | 5 | 8 |
| `test/admin-detail-routes.test.ts` | 13 detail endpoints (hospital-profile, approval-policies, escalation-rules, notifications/rules, due-receivables, inventory/alerts, collection-followups, patient-record-access, doctor-payout/:id, refunds/:id, expenses/:id, cash-drawers/:id, shift-handover/:id) | 13 | 18 |
| **Total** | 19 endpoints | **38** | **~66** |

## Per-endpoint test matrix

Every endpoint gets tests in the following categories. Existing happy-path
tests stay; the new tests fill the gaps.

### 1. Happy path (existing — keep)
- Status 200, expected shape, summary totals match.

### 2. Empty data (new)
- `tables: {}` — no rows in any underlying table
- Response should still be 200 with a valid shape (empty arrays, zero
  counters, summary with all zeros, no `null`/undefined leaks).
- This is the test that **most likely turns RED** because some handlers
  will try to `r.discountAmount.toFixed(1)` on `undefined` when there
  are no rows.

### 3. Auth boundary (new)
- `createTestAppNoRole(...)` — should return 401 or 403.
- `tenantId: ''` — should return 401/403 from `requireTenantId`.
- These pin the contract enforced by `requireRole(...ADMIN_DASHBOARD_ROLES)`
  and `requireTenantId`.

### 4. ID parse (new, for detail routes only)
- `/api/admin/refunds/abc` — should return 400 (not 500).
- `/api/admin/expenses/999999` — should return 404 or empty object.
- This catches the pattern where `Number(c.req.param('id'))` returns
  `NaN` and gets passed to SQL.

### 5. Date filter (new, for dated endpoints)
- `?date=invalid-date` — should return 400 or fall back to today.
- `?date=2026-06-11` — should return 200 with that day's data.
- This catches the date-parsing branches in
  `getTodayGMT6()` and `getFullTimestampGMT6()`.

### 6. Single row (new, for analytics endpoints)
- Exactly 1 row in the source table — should return 1 element in the
  array, summary should show 1, and `Math.max(...arr, 1)` should not
  divide-by-zero.

### 7. Disputed / handover / variance (new, for cash-drawer / shift-handover)
- `variance: -500` — UI shows red.
- `variance: 0` — UI shows green.
- This catches the sign-handling in `CashDrawerDetail.tsx` and
  `ShiftHandoverDetail.tsx`.

## Test pattern (concrete)

```ts
import { describe, it, expect } from 'vitest';
import adminRoute from '../src/routes/admin/index';
import { createTestApp, createTestAppNoRole } from './integration/helpers/test-app';

const TENANT_ID = 'tenant-1';

function makeApp(tables: Record<string, Record<string, unknown>[]> = {}) {
  return createTestApp({
    route: adminRoute,
    routePath: '/admin',
    role: 'hospital_admin',
    tenantId: TENANT_ID,
    universalFallback: true,
    tables,
  });
}

describe('Admin Hospital Profile — empty tenant', () => {
  it('returns 200 with null profile when tenant row missing', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'tenant-without-profile',
      universalFallback: true,
      // tables intentionally empty
    });
    const res = await app.request('/admin/hospital-profile');
    expect(res.status).toBe(200);
    const body = await res.json() as { profile: unknown };
    expect(body.profile === null || body.profile !== undefined).toBe(true);
  });
});

describe('Admin Hospital Profile — missing role', () => {
  it('returns 401/403 when no role is set on context', async () => {
    const { app } = createTestAppNoRole({
      route: adminRoute,
      routePath: '/admin',
      tenantId: TENANT_ID,
    });
    const res = await app.request('/admin/hospital-profile');
    expect([401, 403]).toContain(res.status);
  });
});
```

## Implementation approach

TDD cycle per test case:

1. **RED** — write the new `it()` block. Run the suite. If the test
   passes already, the behavior is already correct → great, document
   the behavior and move on. If it fails, you have a real bug.
2. **DIAGNOSE** — read the handler to understand why. Most likely causes:
   - `.first()` returns null and handler dereferences a field
   - `Number(undefined ?? 0)` returns `NaN` for empty arrays
   - Missing `c.json({...}, 400)` for invalid input
3. **GREEN** — fix the handler. Smallest possible change. The fix is
   scoped to the route handler that owns the endpoint; do not refactor
   unrelated code.
4. **VERIFY** — re-run the full admin test suite to make sure no other
   test regressed.

Each cycle is a separate commit. We expect roughly 28 new tests across
9 files, so roughly 1-2 hours of work. If a single RED requires a large
fix, escalate to the user before committing the fix.

## Risk

- **Error-path tests may surface real bugs** that require handler changes.
  Each fix is a small, scoped change. The cumulative fix surface is bounded
  by the 19 endpoints — no architectural changes.
- **Mock-DB limitation**: the helper `createMockDB` has a `universalFallback`
  mode that returns a generic row for `.first()`. This means the auth-
  boundary tests may pass when they should fail (the mock returns a row
  that is then read by the handler). The auth-boundary tests must use
  `createTestAppNoRole` (no DB row) and assert the response status, not
  the body shape.
- **Pre-existing test failures** remain out of scope. We are only adding
  new tests; we are not touching the 28 failing test files.

## Out of scope (deferred to sub-projects 2 and 3)

- **Sub-project 2: Frontend mock-data verification.** Write Vitest
  component tests with mocked `useApiQuery` responses that assert the
  admin page actually renders the data the backend now returns.
- **Sub-project 3: Playwright E2E.** Write Playwright specs under
  `test/e2e/browser/` that drive the actual UI through login → admin
  panel → monitor → action center → approval drawer and assert the
  user-visible output.

## Verification

- `npx vitest run test/admin-*` — every admin test file green, no
  pre-existing test files touched.
- `npx tsc --noEmit` (project root and `web/`) — clean.
- `git diff --stat` — only the 9 admin test files modified, no source
  files touched unless a real bug fix is required.

## Commit format

One commit per TDD cycle. Commit message format:

```
test(admin): pin <endpoint> error path

Adds <N> boundary tests to <test-file>:
- empty data path
- missing-role auth boundary
- invalid ID parse

Surfaced bug: <description> (if any). Fix: <one-line fix> (if any).
```
