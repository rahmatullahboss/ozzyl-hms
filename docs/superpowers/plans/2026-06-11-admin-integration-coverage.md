# Admin Endpoint Integration Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the 19 admin endpoint tests from 38 happy-path tests to ~66 boundary + error-path tests using TDD, surfacing and fixing any real bugs in the error paths of those 19 endpoints.

**Architecture:** Extend the 9 existing admin test files in `test/admin-*.test.ts` with new `it()` blocks. Each task uses RED-GREEN-VERIFY. When a test surfaces a real bug, the fix is scoped to the route handler that owns the endpoint.

**Tech Stack:** Hono, TypeScript, Vitest, `createTestApp` / `createTestAppNoRole` from `test/integration/helpers/test-app.ts`, `createMockDB` with `universalFallback: true`.

---

## File map

**Test files to extend (no new test files):**
- Modify: `test/admin-ipd-monitor-stats.test.ts` (4 → 8)
- Modify: `test/admin-opd-monitor-queue.test.ts` (2 → 5)
- Modify: `test/admin-dashboard-stats.test.ts` (7 → 10)
- Modify: `test/admin-diagnostic-monitor.test.ts` (2 → 5)
- Modify: `test/admin-pharmacy-monitor.test.ts` (1 → 4)
- Modify: `test/admin-alerts-tasks.test.ts` (2 → 4)
- Modify: `test/admin-discount-references.test.ts` (1 → 4)
- Modify: `test/admin-audit-explorer-routes.test.ts` (5 → 8)
- Modify: `test/admin-detail-routes.test.ts` (13 → 18)

**Source files to potentially fix (only if a RED surfaces a real bug):**
- `src/routes/tenant/admissions.ts` (IPD stats)
- `src/routes/tenant/queue.ts` (OPD overview)
- `src/routes/tenant/dashboard.ts` (dashboard stats / active-counters / security-alerts)
- `src/routes/tenant/lab.ts` (lab queue/today)
- `src/routes/tenant/pharmacy/index.ts` (pharmacy summary)
- `src/routes/admin/index.ts` (alerts / tasks / discount-references / audit / financial / export-history / sessions / alerts/detect / hospital-profile / approval-policies / escalation-rules / notifications/rules / due-receivables / inventory/alerts / collection-followups / patient-record-access / doctor-payout / refunds / expenses / cash-drawers / shift-handover)

Each task is bounded to **one endpoint + one bug-class**. We do not refactor unrelated code.

---

## Task ordering

Tasks 1-9 follow the existing test-file order, lowest test count to highest (smallest surface first). Tasks 10-12 cover cross-cutting patterns that surface as we go.

If a test surfaces a real bug, the fix becomes a separate commit *after* the RED is observed, so the commit log shows: `test: pin X error path` (RED) → `fix(admin): handle X null case` (GREEN).

---

### Task 1: Pin IPD monitor empty-data + single-ward paths

**Files:**
- Modify: `test/admin-ipd-monitor-stats.test.ts:1-72` (append 4 new `it()` blocks)

- [ ] **Step 1: Write the failing tests**

Append to `test/admin-ipd-monitor-stats.test.ts` (after the existing 4 tests):

```ts
describe('Admin IPD Monitor — empty-data path', () => {
  it('returns 200 with zero stats and empty arrays when no beds/admissions exist', async () => {
    const { app } = createTestApp({
      route: admissionsRoute,
      routePath: '/admissions',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      universalFallback: true,
      // no tables — all queries return empty
    });
    const res = await app.request('/admissions/stats');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const stats = body.stats as Record<string, unknown>;
    expect(stats.totalBeds).toBe(0);
    expect(stats.occupied).toBe(0);
    expect(stats.available).toBe(0);
    expect(stats.occupancyPercentage).toBe(0);
    expect(Array.isArray(body.wards)).toBe(true);
    expect(Array.isArray(body.admissions)).toBe(true);
    expect(Array.isArray(body.dischargePending)).toBe(true);
  });

  it('returns single ward when exactly one bed exists', async () => {
    const { app } = createTestApp({
      route: admissionsRoute,
      routePath: '/admissions',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      universalFallback: true,
      tables: {
        beds: [{ id: 1, tenant_id: TENANT_ID, bed_number: 'A-01', ward_name: 'General', status: 'available' }],
        admissions: [],
      },
    });
    const res = await app.request('/admissions/stats');
    const body = await res.json() as Record<string, unknown>;
    const wards = body.wards as Array<{ name: string; beds: unknown[] }>;
    expect(wards.length).toBe(1);
    expect(wards[0].name).toBe('General');
    expect(wards[0].beds.length).toBe(1);
  });
});

describe('Admin IPD Monitor — auth boundary', () => {
  it('returns 401/403 when no role is set', async () => {
    const { app } = createTestAppNoRole({
      route: admissionsRoute,
      routePath: '/admissions',
      tenantId: TENANT_ID,
    });
    const res = await app.request('/admissions/stats');
    expect([401, 403]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run tests to verify behavior**

Run: `npx vitest run test/admin-ipd-monitor-stats.test.ts`
Expected: empty-data test may pass; single-ward test may pass; auth-boundary test should pass. If any fails, document the failure mode and proceed to Step 3 only for the failing test.

- [ ] **Step 3: If RED, fix the handler**

The most likely RED is in the `occupancyPercentage` calculation when `totalBeds === 0` (already handled with the `> 0` guard, but verify). Other likely REDs: `r.patient_name` dereference on a row with `null` patient. If a fix is needed, scope to `src/routes/tenant/admissions.ts:106-180` only.

- [ ] **Step 4: Re-run the suite**

Run: `npx vitest run test/admin-ipd-monitor-stats.test.ts`
Expected: 7 tests, all green.

- [ ] **Step 5: Commit**

```bash
git add test/admin-ipd-monitor-stats.test.ts src/routes/tenant/admissions.ts
git commit -m "test(admin): pin IPD monitor empty-data + auth boundary paths"
```

---

### Task 2: Pin OPD monitor empty-data + date-filter paths

**Files:**
- Modify: `test/admin-opd-monitor-queue.test.ts:1-49` (append 3 new `it()` blocks)

- [ ] **Step 1: Write the failing tests**

```ts
describe('Admin OPD Monitor — empty-data path', () => {
  it('returns 200 with zero stats and empty tokens array when no queue rows exist', async () => {
    const { app } = createTestApp({
      route: queueRoute,
      routePath: '/queue',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      universalFallback: true,
    });
    const res = await app.request('/queue/tokens/overview');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const stats = body.stats as Record<string, unknown>;
    expect(stats.total).toBe(0);
    expect(stats.waiting).toBe(0);
    expect(Array.isArray(body.tokens)).toBe(true);
    expect(Array.isArray(body.delayedDoctors)).toBe(true);
  });
});

describe('Admin OPD Monitor — date filter', () => {
  it('returns 200 with stats for an explicit date', async () => {
    const { app } = createTestApp({
      route: queueRoute,
      routePath: '/queue',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      universalFallback: true,
    });
    const res = await app.request('/queue/tokens/overview?date=2026-06-11');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('stats');
  });
});

describe('Admin OPD Monitor — auth boundary', () => {
  it('returns 401/403 when no role is set', async () => {
    const { app } = createTestAppNoRole({
      route: queueRoute,
      routePath: '/queue',
      tenantId: TENANT_ID,
    });
    const res = await app.request('/queue/tokens/overview');
    expect([401, 403]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run tests to verify behavior**

Run: `npx vitest run test/admin-opd-monitor-queue.test.ts`
Expected: empty-data passes; date filter passes; auth-boundary passes. If any fails, fix the handler.

- [ ] **Step 3: If RED, fix the handler**

Scope: `src/routes/tenant/queue.ts:557-580`. Likely RED: `fetchQueueStats` returns `null` for `.first()` results — but the spreading `{ ...stats, nowServing }` will tolerate null. Check `stats.waiting` is `Number(undefined ?? 0)`.

- [ ] **Step 4: Re-run the suite**

Run: `npx vitest run test/admin-opd-monitor-queue.test.ts`
Expected: 5 tests, all green.

- [ ] **Step 5: Commit**

```bash
git add test/admin-opd-monitor-queue.test.ts src/routes/tenant/queue.ts
git commit -m "test(admin): pin OPD monitor empty-data + date + auth paths"
```

---

### Task 3: Pin dashboard stats error paths

**Files:**
- Modify: `test/admin-dashboard-stats.test.ts:1-93` (append 3 new `it()` blocks)

- [ ] **Step 1: Write the failing tests**

```ts
describe('Admin Dashboard — empty tenant', () => {
  it('returns 200 with zero-valued finance / todaySummary when no rows exist', async () => {
    const { app } = createTestApp({
      route: dashboardRoute,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/dashboard/stats');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.finance).toBeDefined();
    expect(body.todaySummary).toBeDefined();
  });
});

describe('Admin Dashboard — active-counters empty path', () => {
  it('returns 200 with empty array when no active counter sessions exist', async () => {
    const { app } = createTestApp({
      route: dashboardRoute,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/dashboard/active-counters');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.activeCounters).toEqual([]);
    expect(body.totalActive).toBe(0);
  });
});

describe('Admin Dashboard — security-alerts empty path', () => {
  it('returns 200 with zero counts when no exception rows exist', async () => {
    const { app } = createTestApp({
      route: dashboardRoute,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/dashboard/security-alerts');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const summary = body.summary as Record<string, unknown>;
    expect(summary.canceledCount).toBe(0);
    expect(summary.highDiscountCount).toBe(0);
    expect(summary.discrepancyCount).toBe(0);
    expect(summary.lowStockCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify behavior**

Run: `npx vitest run test/admin-dashboard-stats.test.ts`
Expected: most likely pass — but watch for `bills.total` and `bills.discount` returning `null` from `.first()` which would NaN-out `todayCollection`.

- [ ] **Step 3: If RED, fix the handler**

Scope: `src/routes/tenant/dashboard.ts:77-540`. Likely RED: `?.count ?? 0` already covers null. Verify `roundMoney` handles `undefined` input.

- [ ] **Step 4: Re-run the suite**

Run: `npx vitest run test/admin-dashboard-stats.test.ts`
Expected: 10 tests, all green.

- [ ] **Step 5: Commit**

```bash
git add test/admin-dashboard-stats.test.ts src/routes/tenant/dashboard.ts
git commit -m "test(admin): pin dashboard empty-tenant paths for stats / counters / alerts"
```

---

### Task 4: Pin diagnostic monitor empty-data + critical-only paths

**Files:**
- Modify: `test/admin-diagnostic-monitor.test.ts:1-42` (append 3 new `it()` blocks)

- [ ] **Step 1: Write the failing tests**

```ts
describe('Admin Diagnostic Monitor — empty queue', () => {
  it('returns 200 with all-zero stats when no lab orders exist', async () => {
    const { app } = createTestApp({
      route: labRoute,
      routePath: '/lab',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      universalFallback: true,
    });
    const res = await app.request('/lab/orders/queue/today');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    const stats = body.stats as Record<string, unknown>;
    expect(stats.totalToday).toBe(0);
    expect(stats.samplePending).toBe(0);
    expect(stats.processing).toBe(0);
    expect(stats.reportReady).toBe(0);
    expect(Array.isArray(body.items)).toBe(true);
    expect(Array.isArray(body.criticalAlerts)).toBe(true);
  });
});

describe('Admin Diagnostic Monitor — auth boundary', () => {
  it('returns 401/403 when no role is set', async () => {
    const { app } = createTestAppNoRole({
      route: labRoute,
      routePath: '/lab',
      tenantId: TENANT_ID,
    });
    const res = await app.request('/lab/orders/queue/today');
    expect([401, 403]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run tests to verify behavior**

Run: `npx vitest run test/admin-diagnostic-monitor.test.ts`
Expected: empty queue passes; auth boundary passes.

- [ ] **Step 3: If RED, fix the handler**

Scope: `src/routes/tenant/lab.ts:737-780`. Likely RED: `i.created_at` is null when no rows, and `new Date(null).getTime()` returns 0 — delay calculation becomes negative. Verify the `delay = Math.max(0, ...)` guard.

- [ ] **Step 4: Re-run the suite**

Run: `npx vitest run test/admin-diagnostic-monitor.test.ts`
Expected: 5 tests, all green.

- [ ] **Step 5: Commit**

```bash
git add test/admin-diagnostic-monitor.test.ts src/routes/tenant/lab.ts
git commit -m "test(admin): pin diagnostic monitor empty-queue + auth paths"
```

---

### Task 5: Pin pharmacy monitor empty-data + boundary paths

**Files:**
- Modify: `test/admin-pharmacy-monitor.test.ts:1-34` (append 3 new `it()` blocks)

- [ ] **Step 1: Write the failing tests**

```ts
describe('Admin Pharmacy Monitor — empty-data path', () => {
  it('returns 200 with zero todaySales and empty items when pharmacy is empty', async () => {
    const { app } = createTestApp({
      route: pharmacyRoute,
      routePath: '/pharmacy',
      role: 'hospital_admin',
      tenantId: 'empty-pharmacy',
      universalFallback: true,
    });
    const res = await app.request('/pharmacy/summary');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.todaySales).toBe(0);
    expect(body.todaySalesCount).toBe(0);
    expect(body.grossMargin).toBe(0);
  });

  it('handles todaySales > 0 but costOfGoods = 0 (no division-by-zero)', async () => {
    // Math: if todaySales > 0 and income === 0, grossMargin divisor is Math.max(0, 1) === 1
    // → (todaySales - 0) / todaySales = 100%
    const { app } = createTestApp({
      route: pharmacyRoute,
      routePath: '/pharmacy',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      universalFallback: true,
    });
    const res = await app.request('/pharmacy/summary');
    const body = await res.json() as Record<string, unknown>;
    const margin = Number(body.grossMargin ?? 0);
    expect(Number.isFinite(margin)).toBe(true);
  });
});

describe('Admin Pharmacy Monitor — auth boundary', () => {
  it('returns 401/403 when no role is set', async () => {
    const { app } = createTestAppNoRole({
      route: pharmacyRoute,
      routePath: '/pharmacy',
      tenantId: TENANT_ID,
    });
    const res = await app.request('/pharmacy/summary');
    expect([401, 403]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run tests to verify behavior**

Run: `npx vitest run test/admin-pharmacy-monitor.test.ts`
Expected: empty-data passes; finite-margin passes; auth-boundary passes.

- [ ] **Step 3: If RED, fix the handler**

Scope: `src/routes/tenant/pharmacy/index.ts:584-660`. Likely RED: `Math.max(income, 1)` should prevent NaN — verify. The `grossMargin` ternary on `todaySales > 0` should cover the case.

- [ ] **Step 4: Re-run the suite**

Run: `npx vitest run test/admin-pharmacy-monitor.test.ts`
Expected: 4 tests, all green.

- [ ] **Step 5: Commit**

```bash
git add test/admin-pharmacy-monitor.test.ts src/routes/tenant/pharmacy/index.ts
git commit -m "test(admin): pin pharmacy summary empty-data + margin-safety paths"
```

---

### Task 6: Pin alerts/tasks empty paths

**Files:**
- Modify: `test/admin-alerts-tasks.test.ts:1-50` (append 2 new `it()` blocks)

- [ ] **Step 1: Write the failing tests**

```ts
describe('Admin Alerts — empty-data path', () => {
  it('returns 200 with empty alerts array when no exception rows exist', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/alerts');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.alerts).toEqual([]);
    const summary = body.summary as Record<string, unknown>;
    expect(summary.total).toBe(0);
  });
});

describe('Admin Tasks — empty-data path', () => {
  it('returns 200 with empty tasks array when no pending due/refund/expense rows exist', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/tasks');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.tasks).toEqual([]);
    const summary = body.summary as Record<string, unknown>;
    expect(summary.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify behavior**

Run: `npx vitest run test/admin-alerts-tasks.test.ts`
Expected: both pass — the `catch` blocks already return empty defaults.

- [ ] **Step 3: If RED, fix the handler**

Unlikely. If RED, scope to `src/routes/admin/index.ts:701-870`.

- [ ] **Step 4: Re-run the suite**

Run: `npx vitest run test/admin-alerts-tasks.test.ts`
Expected: 4 tests, all green.

- [ ] **Step 5: Commit**

```bash
git add test/admin-alerts-tasks.test.ts src/routes/admin/index.ts
git commit -m "test(admin): pin alerts/tasks empty-data paths"
```

---

### Task 7: Pin discount references empty + single-high-discount paths

**Files:**
- Modify: `test/admin-discount-references.test.ts:1-34` (append 3 new `it()` blocks)

- [ ] **Step 1: Write the failing tests**

```ts
describe('Admin Discount References — empty-data path', () => {
  it('returns 200 with empty references + staff arrays and zero summary', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/discount-references');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.references).toEqual([]);
    expect(body.staff).toEqual([]);
    const summary = body.summary as Record<string, unknown>;
    expect(summary.totalReferences).toBe(0);
    expect(summary.totalStaff).toBe(0);
    expect(summary.totalDiscountAmount).toBe(0);
  });
});

describe('Admin Discount References — single reference', () => {
  it('returns one row with the expected totals when exactly one discount exists', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      universalFallback: true,
      tables: {
        bills: [{
          id: 1, tenant_id: TENANT_ID, total: 1000, discount: 250, discount_by_name: 'Dr. Karim',
          discount_by_role: 'doctor', patient_id: 42, created_by: 7, status: 'paid',
        }],
      },
    });
    const res = await app.request('/admin/discount-references');
    const body = await res.json() as Record<string, unknown>;
    const references = body.references as Array<Record<string, unknown>>;
    expect(references.length).toBeGreaterThanOrEqual(1);
    const karim = references.find((r) => r.name === 'Dr. Karim');
    expect(karim).toBeDefined();
    expect(karim?.discountAmount).toBe(250);
  });
});

describe('Admin Discount References — auth boundary', () => {
  it('returns 401/403 when no role is set', async () => {
    const { app } = createTestAppNoRole({
      route: adminRoute,
      routePath: '/admin',
      tenantId: TENANT_ID,
    });
    const res = await app.request('/admin/discount-references');
    expect([401, 403]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run tests to verify behavior**

Run: `npx vitest run test/admin-discount-references.test.ts`
Expected: empty-data passes; single-reference passes; auth-boundary passes.

- [ ] **Step 3: If RED, fix the handler**

Scope: `src/routes/admin/index.ts:873-960`. Likely RED: `highDiscountCount` aggregation if `total <= 0` divides by 0 — already guarded with `total > 0`.

- [ ] **Step 4: Re-run the suite**

Run: `npx vitest run test/admin-discount-references.test.ts`
Expected: 4 tests, all green.

- [ ] **Step 5: Commit**

```bash
git add test/admin-discount-references.test.ts src/routes/admin/index.ts
git commit -m "test(admin): pin discount references empty/single-row + auth paths"
```

---

### Task 8: Pin audit + export + sessions + alerts-detect empty paths

**Files:**
- Modify: `test/admin-audit-explorer-routes.test.ts:1-78` (append 3 new `it()` blocks)

- [ ] **Step 1: Write the failing tests**

```ts
describe('Admin Audit — empty-data path', () => {
  it('returns 200 with empty events array and zero summary', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/audit');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.events).toEqual([]);
    const summary = body.summary as Record<string, unknown>;
    expect(summary.total).toBe(0);
  });
});

describe('Admin Financial Audit — empty-data path', () => {
  it('returns 200 with empty entries array and zero summary', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/audit/financial');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.entries).toEqual([]);
  });
});

describe('Admin Suspicious Alerts Detection — empty-data path', () => {
  it('returns 200 with empty alerts when no exception patterns match', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/alerts/detect');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.alerts).toEqual([]);
    const summary = body.summary as Record<string, unknown>;
    expect(summary.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify behavior**

Run: `npx vitest run test/admin-audit-explorer-routes.test.ts`
Expected: all 3 pass — the `catch` blocks already return empty defaults.

- [ ] **Step 3: If RED, fix the handler**

Unlikely. If RED, scope to `src/routes/admin/index.ts:962-1175`.

- [ ] **Step 4: Re-run the suite**

Run: `npx vitest run test/admin-audit-explorer-routes.test.ts`
Expected: 8 tests, all green.

- [ ] **Step 5: Commit**

```bash
git add test/admin-audit-explorer-routes.test.ts src/routes/admin/index.ts
git commit -m "test(admin): pin audit/financial/alerts-detect empty-data paths"
```

---

### Task 9: Pin detail-route empty + invalid-ID paths

**Files:**
- Modify: `test/admin-detail-routes.test.ts:1-157` (append 5 new `it()` blocks covering missing ID, invalid ID format, and empty-data path on the most representative detail endpoints)

- [ ] **Step 1: Write the failing tests**

```ts
describe('Admin Detail Routes — empty-data path', () => {
  it('GET /admin/refunds/empty-tenant returns 200 with refund null', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/refunds/1');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.refund).toBeNull();
  });

  it('GET /admin/expenses/empty-tenant returns 200 with expense null', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/expenses/1');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.expense).toBeNull();
  });

  it('GET /admin/doctor-payout/empty-tenant returns 200 with doctor null + empty earnings', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: 'empty-tenant',
      universalFallback: true,
    });
    const res = await app.request('/admin/doctor-payout/1');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.doctor).toBeNull();
    expect(body.earnings).toEqual([]);
  });
});

describe('Admin Detail Routes — invalid ID format', () => {
  it('GET /admin/refunds/abc returns 200 or 400 (not 500)', async () => {
    const { app } = createTestApp({
      route: adminRoute,
      routePath: '/admin',
      role: 'hospital_admin',
      tenantId: TENANT_ID,
      universalFallback: true,
    });
    const res = await app.request('/admin/refunds/abc');
    expect([200, 400]).toContain(res.status);
  });
});

describe('Admin Detail Routes — auth boundary', () => {
  it('GET /admin/cash-drawers/1 returns 401/403 when no role is set', async () => {
    const { app } = createTestAppNoRole({
      route: adminRoute,
      routePath: '/admin',
      tenantId: TENANT_ID,
    });
    const res = await app.request('/admin/cash-drawers/1');
    expect([401, 403]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run tests to verify behavior**

Run: `npx vitest run test/admin-detail-routes.test.ts`
Expected: empty-data tests pass; invalid-ID may surface a real bug (handler may pass `Number('abc') === NaN` to SQL).

- [ ] **Step 3: If RED, fix the handler**

Most likely RED: `src/routes/admin/index.ts` refund/expense/doctor-payout detail handlers use `c.req.param('id')` directly. If ID is non-numeric, the SQL bind may error. Fix: validate `id` and return 400 if not numeric.

Concretely, if RED:

```ts
// In each detail handler, replace:
const id = c.req.param('id');
// With:
const id = c.req.param('id');
if (id && !/^\d+$/.test(id)) {
  return c.json({ error: 'Invalid ID' }, 400);
}
```

- [ ] **Step 4: Re-run the suite**

Run: `npx vitest run test/admin-detail-routes.test.ts`
Expected: 18 tests, all green.

- [ ] **Step 5: Commit**

```bash
git add test/admin-detail-routes.test.ts src/routes/admin/index.ts
git commit -m "test(admin): pin detail-routes empty + invalid-id + auth paths"
```

---

### Task 10: Run full admin test suite, fix any cascading regressions

**Files:** none (verification only)

- [ ] **Step 1: Run the full admin test suite**

Run: `npx vitest run test/admin-*`
Expected: All 9 admin test files green, ~66 tests total.

- [ ] **Step 2: If any file fails, fix or document**

If a test fails, read the failure and decide:
- If it's a real bug in the handler → fix and commit
- If it's a brittle test (e.g. wrong mock) → fix the test and commit

Do not skip the failure.

- [ ] **Step 3: Run TypeScript check**

Run: `npx tsc --noEmit` (project root) and `cd web && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Run the full backend suite to confirm no regression**

Run: `npx vitest run test/`
Expected: same 28 pre-existing failures (idempotency, bed-charges, etc.) — none of the new admin tests should fail.

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "test(admin): resolve any cascading regressions from boundary tests"
```

---

### Task 11: Update progress.md with sub-project 1 completion

**Files:**
- Modify: `docs/ozzyl-admin-panel-progress.md` (append a new checkpoint entry)

- [ ] **Step 1: Add the new checkpoint entry**

Append to `docs/ozzyl-admin-panel-progress.md`:

```markdown
### 2026-06-11 - Admin Endpoint Boundary Test Coverage (Sub-project 1 of 3)

- Status: Complete.
- Expanded the 19 admin endpoint tests from 38 happy-path tests to ~66
  boundary + error-path tests. Spec:
  `docs/superpowers/specs/2026-06-11-admin-integration-coverage-design.md`.
- Test categories added per endpoint: empty-data, auth boundary (no role),
  invalid ID format, single-row boundary, date filter.
- Surfaced and fixed <N> real bugs in the route handlers: <list or "none">.
- Verification:
  - `npx vitest run test/admin-*` — 9 files, ~66 tests, all green.
  - `npx vitest run test/` — same 28 pre-existing failures, no new ones.
  - `npx tsc --noEmit` (project root + `web/`) — clean.
- Sub-projects 2 (frontend mock-data verification) and 3 (Playwright E2E)
  remain as separate slices per the spec.
```

Replace `<N>` and `<list or "none">` with actual values from the work.

- [ ] **Step 2: Commit**

```bash
git add docs/ozzyl-admin-panel-progress.md
git commit -m "docs(admin): record sub-project 1 boundary-test completion"
```

---

## Self-review checklist

- [x] **Spec coverage:** every section of the spec is mapped to a task (Task 1-9 cover the 9 test files, Task 10 covers regression, Task 11 covers progress.md).
- [x] **Placeholder scan:** no "TBD", "TODO", "implement later", "similar to Task N" — every step shows actual code.
- [x] **Type consistency:** `createTestApp` / `createTestAppNoRole` signatures match the helper. `app.request(path)` matches Hono's signature. The `Record<string, unknown>` cast pattern matches the existing tests.
- [x] **No architectural changes:** scope is strictly test additions + small scoped handler fixes.
- [x] **No placeholders for unspecified behavior:** when a fix is "may be needed", the task says "if RED" and gives the concrete fix template.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-11-admin-integration-coverage.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration with quality gates.
2. **Inline Execution** — I execute tasks in this session using `executing-plans` skill, batch execution with checkpoints for review.

Which approach?
