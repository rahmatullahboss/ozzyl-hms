# Design: Payroll Page — Frontend Completion + Net Override Audit

**Date:** 2026-06-12
**Scope:** Single page, multi-tab; small backend addition for net-override persistence.

---

## 1. Context

The HR/Payroll module has a complete backend (`src/routes/tenant/hr/payroll.ts`, 585 lines) and DB schema (`hr_salary_heads`, `hr_staff_salary_structure`, `hr_payroll_runs`, `hr_payslips`, `hr_overtime_log`) but the frontend is fragmented:

- `web/src/pages/PayrollGeneration.tsx` (525 lines) covers only the **Overview** workflow (generate / review / lock / approve). Net-override is local state, lost on reload.
- Salary heads CRUD + salary structure view (read-only) + runs history + lock/approve buttons are **buried in `HRDashboard.tsx`'s `PayrollTab` component** (~250 lines) — wrong place, duplicates the same APIs the page above uses.
- The `/api/hr/payroll/overtime-integrate` endpoint is unwired from the UI.
- The `/api/hr/payroll/structure` POST is unwired (the UI can view a structure but cannot save one).
- Payslip print uses `window.print()` which prints the whole page, not a per-staff letterhead view; the `bank_account` column from `/runs/:id` is never displayed.

This spec consolidates everything into a single payroll page with 4 URL-driven tabs, deletes the duplicate `PayrollTab` from `HRDashboard.tsx`, and adds a small backend PATCH endpoint + audit table to make net overrides durable.

---

## 2. Goals

1. **One place to manage payroll.** A single `/hr/payroll-generation` page with 4 tabs covers heads, structure, generation, and run history.
2. **Deep-linkable tabs.** `?tab=heads` / `?tab=structure` / `?tab=runs` work from Command Palette and HR overview card.
3. **No regression of existing workflows.** The Overview tab keeps generate / review / lock / approve / CSV export.
4. **Durable net overrides.** A new `payroll_payslip_adjustments` table + `PATCH /api/hr/payroll/payslips/:id` persist per-payslip net changes with audit (user, old, new, reason, timestamp). Only allowed in `draft` state.
5. **Overtime is one click.** A single button on the draft run view loops the existing per-staff `overtime-integrate` endpoint for all payslips in the run, with partial-success reporting.
6. **Per-staff payslip print.** A hidden iframe mounted via portal renders a clean letterhead view (uses `bank_account` from the `/runs/:id` response).
7. **Remove duplicate UI.** Delete `PayrollTab` from `HRDashboard.tsx`; add a small "Payroll" overview card linking to the page.

---

## 3. Non-Goals

- No new role-based permissions (existing `hr:read` is the gate; `hospital_admin` / `director` / `md` are the natural owners).
- No bulk-delete of runs.
- No payslip regeneration for a locked/approved run (matches backend behavior; user must manually create a new month).
- No email/WhatsApp delivery of payslips (out of scope — payroll module stays operational, not communication).
- No undo of approval (locked-on/approved-on are immutable; financial record).
- No tax calculation engine (the `is_taxable` flag is metadata only — actual tax math stays manual via deduction heads).

---

## 4. Architecture

```
PayrollGeneration  (default ?tab=overview)
  │
  ├─ <TabBar tabs={[overview, heads, structure, runs]} />    URL via useSearchParams
  │
  ├─ <OverviewTab />         generate / review / lock / approve / overtime / print
  │    └─ <PayslipPrintFrame />   hidden iframe; renders on print()
  │
  ├─ <SalaryHeadsTab />      CRUD modal over /api/hr/payroll/salary-heads
  │
  ├─ <SalaryStructureTab />  staff picker + line-item editor → POST /structure
  │
  └─ <RunsHistoryTab />      table of all runs + drawer with per-run payslips
```

**File layout:**

```
web/src/pages/PayrollGeneration.tsx               (page shell, URL state, <TabBar/>)
web/src/pages/payroll/OverviewTab.tsx             (lifted from current PayrollGeneration)
web/src/pages/payroll/SalaryHeadsTab.tsx
web/src/pages/payroll/SalaryStructureTab.tsx
web/src/pages/payroll/RunsHistoryTab.tsx
web/src/pages/payroll/PayslipPrintFrame.tsx
```

Splitting tabs into separate files under `web/src/pages/payroll/` keeps the main page small and lets each tab grow independently (each tab will end up 200–400 lines).

---

## 5. Data Flow

### 5.1 Overview tab

| Step | Action | API |
|------|--------|-----|
| 1 | List recent runs | `GET /api/hr/payroll/runs?limit=50` |
| 2 | Filter to selected month (or activeRunId) | local |
| 3 | Load payslips for the run | `GET /api/hr/payroll/runs/:id` |
| 4 | Load monthly attendance summary | `GET /api/hr/attendance/summary?month=YYYY-MM` |
| 5 | Build `ReviewRow[]` from payslips + attendance + persisted adjustments | local |
| 6 | Generate | `POST /api/hr/payroll/runs` body `{ runMonth }` |
| 7 | Lock | `POST /api/hr/payroll/runs/:id/lock` |
| 8 | Approve | `POST /api/hr/payroll/runs/:id/approve` |
| 9 | Edit net (draft only) | `PATCH /api/hr/payroll/payslips/:id` body `{ netPay, reason }` |
| 10 | Run overtime (draft only) | loop `POST /api/hr/payroll/overtime-integrate` per payslip |
| 11 | Print payslip | mount `<PayslipPrintFrame runId staffId />`, `frame.contentWindow.print()` |

### 5.2 Salary Heads tab

| Step | API |
|------|-----|
| List | `GET /api/hr/payroll/salary-heads` |
| Create | `POST /api/hr/payroll/salary-heads` body `{ headName, headType, isTaxable }` |
| Update | `PUT /api/hr/payroll/salary-heads/:id` body partial |
| Deactivate (soft) | `DELETE /api/hr/payroll/salary-heads/:id` (backend sets `is_active=0`) |

### 5.3 Salary Structure tab

| Step | API |
|------|-----|
| List active staff | `GET /api/staff` filtered `status='active'` |
| Load structure for staff | `GET /api/hr/payroll/structure/:staffId` |
| Save (replaces) | `POST /api/hr/payroll/structure` body `{ staffId, items: [{ salaryHeadId, amount, calculationType }] }` |

### 5.4 Runs History tab

| Step | API |
|------|-----|
| List all runs | `GET /api/hr/payroll/runs?page=1&limit=100` |
| Single run with payslips | `GET /api/hr/payroll/runs/:id` (already returns joined `bank_account` + `position`) |
| Re-open drawer | local state |

---

## 6. New Backend Surface

### 6.1 Migration `0348_payroll_payslip_adjustments.sql`

```sql
CREATE TABLE IF NOT EXISTS payroll_payslip_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id INTEGER NOT NULL,
    payslip_id INTEGER NOT NULL,
    payroll_run_id INTEGER NOT NULL,
    staff_id INTEGER NOT NULL,
    old_net_pay REAL NOT NULL,
    new_net_pay REAL NOT NULL,
    reason TEXT NOT NULL,
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (payslip_id) REFERENCES hr_payslips(id) ON DELETE CASCADE,
    FOREIGN KEY (payroll_run_id) REFERENCES hr_payroll_runs(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ppa_payslip ON payroll_payslip_adjustments(payslip_id);
CREATE INDEX IF NOT EXISTS idx_ppa_run ON payroll_payslip_adjustments(payroll_run_id, tenant_id);
```

### 6.2 Schema: `src/schemas/hr.ts` addition

```ts
export const patchPayslipSchema = z.object({
  netPay: z.number().min(0),
  reason: z.string().min(3).max(500),
});
```

### 6.3 Route: `src/routes/tenant/hr/payroll.ts` addition

```ts
payrollRoutes.patch('/payslips/:id', zValidator('json', patchPayslipSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const payslipId = Number(c.req.param('id'));
  const { netPay, reason } = c.req.valid('json');

  const row = await c.env.DB.prepare(`
    SELECT ps.id, ps.staff_id, ps.payroll_run_id, ps.net_pay as old_net, pr.status as run_status
    FROM hr_payslips ps
    JOIN hr_payroll_runs pr ON ps.payroll_run_id = pr.id
    WHERE ps.id = ? AND ps.tenant_id = ?
  `).bind(payslipId, tenantId).first<{ id: number; staff_id: number; payroll_run_id: number; old_net: number; run_status: string }>();

  if (!row) throw new HTTPException(404, { message: 'Payslip not found' });
  if (row.run_status !== 'draft') {
    throw new HTTPException(409, { message: `Cannot edit payslip in ${row.run_status} run. Re-generate the month to adjust.` });
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE hr_payslips
      SET net_pay = ?, total_deduction = total_earning - ?
      WHERE id = ? AND tenant_id = ?
    `).bind(netPay, netPay, payslipId, tenantId),
    c.env.DB.prepare(`
      INSERT INTO payroll_payslip_adjustments
        (tenant_id, payslip_id, payroll_run_id, staff_id, old_net_pay, new_net_pay, reason, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(tenantId, payslipId, row.payroll_run_id, row.staff_id, row.old_net, netPay, reason, userId),
    // Recompute run totals
    c.env.DB.prepare(`
      UPDATE hr_payroll_runs
      SET total_net = (SELECT COALESCE(SUM(net_pay), 0) FROM hr_payslips WHERE payroll_run_id = ? AND tenant_id = ?),
          total_deductions = (SELECT COALESCE(SUM(total_deduction), 0) FROM hr_payslips WHERE payroll_run_id = ? AND tenant_id = ?)
      WHERE id = ? AND tenant_id = ?
    `).bind(row.payroll_run_id, tenantId, row.payroll_run_id, tenantId, row.payroll_run_id, tenantId),
  ]);

  return c.json({ message: 'Net pay updated', oldNet: row.old_net, newNet: netPay });
});
```

### 6.4 No new query keys required for the small list (server returns the persisted value next fetch)

But add for invalidation symmetry:

```ts
// web/src/lib/queryKeys.ts
payslipAdjustments: (runId: number) => ['hr', 'payroll', 'adjustments', runId] as const,
```

---

## 7. Error Handling

| Source | Handling |
|--------|----------|
| Backend 4xx (e.g. `409` "Cannot edit payslip in locked run") | `useApiMutation` `onError` → `toast.error(err.message)` |
| Backend 5xx | Same path, generic message |
| Idempotent run create (returns 200 with existing run) | Detect `data.message` contains "already exists" → don't re-toast; just refresh `runs` query |
| Fiscal period closed on approve | `409` with `assertAccountingPeriodOpen` message → show "Period closed for YYYY-MM; cannot approve" |
| Overtime loop partial failure | Catch per-staff; collect successes/failures; final toast `"OT integrated for X/Y staff (Z failed)"` |
| Print iframe load failure | Fallback: log error, do not block workflow |
| Network offline | `useApiMutation` already queues mutations when `offline: true` is passed; the Overview mutations are NOT offline-queued (payroll is a connected-only operation); show offline toast if `!navigator.onLine` |

---

## 8. Testing

### 8.1 Backend (new file)

`test/payroll-payslip-adjustments.test.ts`:

| Test | Setup | Assert |
|------|-------|--------|
| PATCH in draft | Insert draft run + payslip | 200; `hr_payslips.net_pay` updated; `payroll_payslip_adjustments` row inserted; run totals recomputed |
| PATCH in locked | Lock the run | 409; message contains "locked" |
| PATCH in approved | Approve the run | 409; message contains "approved" |
| PATCH other tenant | Use a different `tenantId` | 404 |
| PATCH reason too short | `reason: 'x'` | 400 (Zod) |
| PATCH negative net | `netPay: -1` | 400 (Zod min(0)) |

### 8.2 Frontend (new file)

`web/src/pages/PayrollGeneration.test.tsx`:

| Test | Assert |
|------|--------|
| Renders TabBar with 4 tabs | All 4 tab labels visible |
| Default tab is Overview | `?tab=` absent → Overview content rendered |
| Tab URL roundtrip | Click "Salary Heads" → URL has `?tab=heads`; navigate to `?tab=structure` → Structure content rendered |
| Overview empty state | No run for month → `<EmptyState />` visible |
| Overview generate button | Click → calls `POST /runs`; mock returns 201 → toast + invalidation |
| Structure tab staff picker | Loads `/api/staff`; selecting a staff fires `/api/hr/payroll/structure/:id` |
| Runs tab | Loads `/api/hr/payroll/runs?page=1&limit=100`; row click opens drawer |
| HRDashboard.test.ts update | `function PayrollTab` is gone; `'payroll'` is in the overview quick-link list |

### 8.3 Existing test

`web/src/pages/HRDashboard.test.ts`:

- `expect(source).not.toMatch(/function\s+PayrollTab\b/)` — already a similar test for LeaveTab. Add a parallel for PayrollTab.

---

## 9. File Changes Summary

| File | Change |
|------|--------|
| `migrations/0348_payroll_payslip_adjustments.sql` | **NEW** — audit table |
| `src/schemas/hr.ts` | Add `patchPayslipSchema` |
| `src/routes/tenant/hr/payroll.ts` | Add `PATCH /payslips/:id` handler |
| `test/payroll-payslip-adjustments.test.ts` | **NEW** — backend test |
| `web/src/pages/PayrollGeneration.tsx` | Rewrite as page shell with `<TabBar />` and 4 children |
| `web/src/pages/payroll/OverviewTab.tsx` | **NEW** — current grid logic |
| `web/src/pages/payroll/SalaryHeadsTab.tsx` | **NEW** — heads CRUD |
| `web/src/pages/payroll/SalaryStructureTab.tsx` | **NEW** — staff picker + line editor + save |
| `web/src/pages/payroll/RunsHistoryTab.tsx` | **NEW** — runs table + payslip drawer |
| `web/src/pages/payroll/PayslipPrintFrame.tsx` | **NEW** — hidden iframe letterhead view |
| `web/src/pages/PayrollGeneration.test.tsx` | **NEW** — page + tab tests |
| `web/src/pages/HRDashboard.tsx` | Delete `PayrollTab` (~250 lines); add `PayrollQuickLink` card on Overview |
| `web/src/pages/HRDashboard.test.ts` | Add assertion: `function PayrollTab` is gone |
| `web/src/lib/queryKeys.ts` | Add `payslipAdjustments(runId)` |
| `web/public/locales/en/hr.json` | Add: `tabs.{overview,heads,structure,runs}`, `overtime.*`, `adjustments.*`, `print.*`, `structure.*` strings |
| `web/public/locales/bn/hr.json` | Bengali translations for the same keys |
| `web/src/components/dashboard/adminSidebarConfig.tsx` | No change (sidebar entry already at `hr/payroll-generation` path) |
| `web/src/components/dashboard/Sidebar.tsx` | No change (md/hr/payroll-generation already there) |
| `web/src/components/dashboard/CommandPalette.tsx` | No change |

---

## 10. Open Questions

None — answered during brainstorming (single-page multi-tab, printable iframe, PATCH endpoint + audit table, single OT button + client loop, 4 tabs, remove PayrollTab from HRDashboard).
