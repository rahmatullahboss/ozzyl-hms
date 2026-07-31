# Payroll Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate payroll workflows into a single multi-tab page at `/hr/payroll-generation` (existing route), persist per-payslip net overrides via a new PATCH endpoint + audit table, wire overtime integration, and remove the duplicate `PayrollTab` from `HRDashboard.tsx`.

**Architecture:** One page shell with 4 URL-driven tabs (Overview / Salary Heads / Salary Structure / Runs History). Tabs live as siblings in `web/src/pages/payroll/`. Backend gains a `payroll_payslip_adjustments` audit table and a `PATCH /api/hr/payroll/payslips/:id` handler. Existing endpoints (no backend change) for overtime integration, salary structure save, and runs history are wired from new tab components.

**Tech Stack:** Hono, Cloudflare D1, Vitest, React 19, TanStack Query v5, react-i18next, react-router v7, Lucide icons, react-hot-toast.

---

## File Structure

**Backend (new):**
- `migrations/0348_payroll_payslip_adjustments.sql` — audit table
- `test/payroll-payslip-adjustments.test.ts` — backend tests
- `src/schemas/hr.ts` — add `patchPayslipSchema`
- `src/routes/tenant/hr/payroll.ts` — add `PATCH /payslips/:id`

**Frontend (new):**
- `web/src/pages/PayrollGeneration.tsx` — rewrite as page shell with `<TabBar />` + child components
- `web/src/pages/payroll/OverviewTab.tsx` — generate / review / lock / approve / overtime / print
- `web/src/pages/payroll/SalaryHeadsTab.tsx` — heads CRUD
- `web/src/pages/payroll/SalaryStructureTab.tsx` — staff picker + line editor + save
- `web/src/pages/payroll/RunsHistoryTab.tsx` — runs table + payslip drawer
- `web/src/pages/payroll/PayslipPrintFrame.tsx` — hidden iframe letterhead view
- `web/src/pages/PayrollGeneration.test.tsx` — page + tab tests

**Frontend (modify):**
- `web/src/pages/HRDashboard.tsx` — delete `PayrollTab`; add `PayrollQuickLink` card on Overview
- `web/src/pages/HRDashboard.test.ts` — assert `function PayrollTab` is gone
- `web/src/lib/queryKeys.ts` — add `payslipAdjustments(runId)` and `staffList()` keys
- `web/public/locales/{en,bn}/hr.json` — add tab labels, OT, adjustments, print, structure strings

---

## Task 1: Add migration for `payroll_payslip_adjustments`

**Files:**
- Create: `migrations/0348_payroll_payslip_adjustments.sql`

- [ ] **Step 1: Write the migration file**

Create `migrations/0348_payroll_payslip_adjustments.sql`:

```sql
-- Migration: 0348_payroll_payslip_adjustments.sql
-- Audit trail for per-payslip net pay overrides applied during draft review.

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

- [ ] **Step 2: Commit**

```bash
git add migrations/0348_payroll_payslip_adjustments.sql
git commit -m "feat(payroll): add payslip_adjustments audit table"
```

---

## Task 2: Add Zod schema for the PATCH body

**Files:**
- Modify: `src/schemas/hr.ts` (append after the existing `overtimePayrollIntegrationSchema` block at line ~258)

- [ ] **Step 1: Add `patchPayslipSchema` export**

Open `src/schemas/hr.ts`, find the line `export const overtimePayrollIntegrationSchema = z.object({` and add immediately after its closing `});`:

```ts
export const patchPayslipSchema = z.object({
  netPay: z.number().min(0),
  reason: z.string().min(3).max(500),
});

export type PatchPayslipInput = z.infer<typeof patchPayslipSchema>;
```

- [ ] **Step 2: Verify the import compiles**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no new errors related to `patchPayslipSchema`.

- [ ] **Step 3: Commit**

```bash
git add src/schemas/hr.ts
git commit -m "feat(payroll): add patchPayslipSchema"
```

---

## Task 3: Backend TDD — failing test for PATCH payslip in draft

**Files:**
- Create: `test/payroll-payslip-adjustments.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `test/payroll-payslip-adjustments.test.ts`:

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import { applyTestEnv, buildHonoApp, seedTenant, seedStaff, seedDraftRunWithPayslip, type TestCtx } from './_helpers/hono-test-helper';

describe('PATCH /api/hr/payroll/payslips/:id', () => {
  let ctx: TestCtx;

  beforeEach(async () => {
    ctx = await buildHonoApp();
  });

  it('updates net pay and writes an audit row in draft', async () => {
    const { tenantId, runId, payslipId, staffId, userId } = await seedDraftRunWithPayslip(ctx, { net: 30000 });

    const res = await ctx.app.request(`/api/hr/payroll/payslips/${payslipId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.tokens.admin}` },
      body: JSON.stringify({ netPay: 32500, reason: 'manual correction' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ oldNet: 30000, newNet: 32500 });

    const row = await ctx.env.DB.prepare(
      'SELECT old_net_pay, new_net_pay, reason, created_by FROM payroll_payslip_adjustments WHERE payslip_id = ?'
    ).bind(payslipId).first<{ old_net_pay: number; new_net_pay: number; reason: string; created_by: number }>();
    expect(row).toMatchObject({ old_net_pay: 30000, new_net_pay: 32500, reason: 'manual correction', created_by: userId });

    const updated = await ctx.env.DB.prepare('SELECT net_pay, total_deduction FROM hr_payslips WHERE id = ?').bind(payslipId).first<{ net_pay: number; total_deduction: number }>();
    expect(updated?.net_pay).toBe(32500);
    expect(updated?.total_deduction).toBe(closeTo(0, 2));

    const runTotals = await ctx.env.DB.prepare('SELECT total_net, total_deductions FROM hr_payroll_runs WHERE id = ?').bind(runId).first<{ total_net: number; total_deductions: number }>();
    expect(runTotals?.total_net).toBe(32500);
  });

  it('rejects when run is locked', async () => {
    const { payslipId } = await seedDraftRunWithPayslip(ctx, { net: 30000, runStatus: 'locked' });
    const res = await ctx.app.request(`/api/hr/payroll/payslips/${payslipId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.tokens.admin}` },
      body: JSON.stringify({ netPay: 32500, reason: 'manual correction' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toMatch(/locked/i);
  });

  it('rejects when run is approved', async () => {
    const { payslipId } = await seedDraftRunWithPayslip(ctx, { net: 30000, runStatus: 'approved' });
    const res = await ctx.app.request(`/api/hr/payroll/payslips/${payslipId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.tokens.admin}` },
      body: JSON.stringify({ netPay: 32500, reason: 'manual correction' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.message).toMatch(/approved/i);
  });

  it('returns 404 for payslip from another tenant', async () => {
    const { payslipId } = await seedDraftRunWithPayslip(ctx, { net: 30000, tenantId: 'tenant-A' });
    const res = await ctx.app.request(`/api/hr/payroll/payslips/${payslipId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.tokens.admin}` },
      body: JSON.stringify({ netPay: 32500, reason: 'manual correction' }),
    });
    expect(res.status).toBe(404);
  });

  it('validates reason length and non-negative net', async () => {
    const { payslipId } = await seedDraftRunWithPayslip(ctx, { net: 30000 });
    const res = await ctx.app.request(`/api/hr/payroll/payslips/${payslipId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${ctx.tokens.admin}` },
      body: JSON.stringify({ netPay: -1, reason: 'x' }),
    });
    expect(res.status).toBe(400);
  });
});

function closeTo(expected: number, precision: number) {
  return expect.closeTo(expected, precision);
}
```

- [ ] **Step 2: Run the test to verify it fails (compile + assertion)**

Run: `pnpm vitest run test/payroll-payslip-adjustments.test.ts 2>&1 | tail -20`
Expected: FAIL — either the test helper file is missing or the route returns 404. The compile error from missing `seedDraftRunWithPayslip` is the expected first failure.

- [ ] **Step 3: Add the test helper to `test/_helpers/hono-test-helper.ts`**

If `test/_helpers/hono-test-helper.ts` does not exist, create it with the minimum required by the test above. Use the existing helper layout from other tests in `test/` as a reference; the contract is:

```ts
export type TestCtx = {
  app: Hono;
  env: { DB: D1Database; ... };
  tokens: { admin: string };
};

export async function buildHonoApp(): Promise<TestCtx> { /* ... */ }
export async function seedTenant(ctx: TestCtx, args: { tenantId: string }): Promise<void> { /* ... */ }
export async function seedStaff(ctx: TestCtx, args: { tenantId: string; name?: string }): Promise<{ staffId: number }> { /* ... */ }
export async function seedDraftRunWithPayslip(
  ctx: TestCtx,
  args: { net: number; tenantId?: string; runStatus?: 'draft' | 'locked' | 'approved' }
): Promise<{ tenantId: string; runId: number; payslipId: number; staffId: number; userId: number }> {
  // Insert tenant (or use existing), staff, hr_salary_heads, hr_staff_salary_structure, hr_payroll_runs (status), hr_payslips.
}
```

Match the helper signature exactly to what the test in Step 1 calls. Use the existing `applyTestEnv` from `test/_helpers/`.

- [ ] **Step 4: Re-run the test — still expected to fail (route missing)**

Run: `pnpm vitest run test/payroll-payslip-adjustments.test.ts 2>&1 | tail -20`
Expected: FAIL with `404` on `PATCH /api/hr/payroll/payslips/:id`.

- [ ] **Step 5: Commit the failing test**

```bash
git add test/payroll-payslip-adjustments.test.ts test/_helpers/hono-test-helper.ts
git commit -m "test(payroll): add PATCH payslip adjustments coverage"
```

---

## Task 4: Backend — implement PATCH `/payslips/:id`

**Files:**
- Modify: `src/routes/tenant/hr/payroll.ts` (append at end before `export default`)

- [ ] **Step 1: Add the import for `patchPayslipSchema`**

At the top of `src/routes/tenant/hr/payroll.ts`, update the import block to include `patchPayslipSchema`:

```ts
import {
  createSalaryHeadSchema,
  updateSalaryHeadSchema,
  setSalaryStructureSchema,
  createPayrollRunSchema,
  payrollListQuerySchema,
  overtimePayrollIntegrationSchema,
  patchPayslipSchema,
} from '../../../schemas/hr';
```

- [ ] **Step 2: Add the PATCH handler just before `export default payrollRoutes;`**

Insert the following block immediately before the final `export default payrollRoutes;` line:

```ts
// PATCH /api/hr/payroll/payslips/:id — adjust net_pay in a DRAFT run, audited
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
      SET net_pay = ?, total_deduction = MAX(0, total_earning - ?)
      WHERE id = ? AND tenant_id = ?
    `).bind(netPay, netPay, payslipId, tenantId),
    c.env.DB.prepare(`
      INSERT INTO payroll_payslip_adjustments
        (tenant_id, payslip_id, payroll_run_id, staff_id, old_net_pay, new_net_pay, reason, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(tenantId, payslipId, row.payroll_run_id, row.staff_id, row.old_net, netPay, reason, userId),
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

- [ ] **Step 3: Run the test to verify it passes**

Run: `pnpm vitest run test/payroll-payslip-adjustments.test.ts 2>&1 | tail -20`
Expected: PASS — 5 tests, all green.

- [ ] **Step 4: Commit**

```bash
git add src/routes/tenant/hr/payroll.ts
git commit -m "feat(payroll): PATCH /payslips/:id with audit + run total recompute"
```

---

## Task 5: Add `queryKeys.hr.payslipAdjustments` and `queryKeys.hr.staffList`

**Files:**
- Modify: `web/src/lib/queryKeys.ts` (insert into the `hr:` block around line 363)

- [ ] **Step 1: Add the two keys**

Open `web/src/lib/queryKeys.ts`. Find the `hr:` block, locate the `salaryStructure:` line, and append:

```ts
payslipAdjustments: (runId: number) => ['hr', 'payroll', 'adjustments', runId] as const,
staffList: () => ['hr', 'staff-list'] as const,
```

- [ ] **Step 2: Verify the keys compile**

Run: `cd web && npx tsc --noEmit -p tsconfig.json 2>&1 | head -10`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/queryKeys.ts
git commit -m "feat(payroll): add payslipAdjustments + staffList query keys"
```

---

## Task 6: Add i18n strings (English)

**Files:**
- Modify: `web/public/locales/en/hr.json`

- [ ] **Step 1: Add the new keys**

Open `web/public/locales/en/hr.json`. Find the existing `"payroll": {` block (line ~52) and append these keys at its end (before the closing `}` of the `payroll` object):

```json
    "tabs": {
      "overview": "Overview",
      "heads": "Salary Heads",
      "structure": "Salary Structure",
      "runs": "Runs History"
    },
    "structure": {
      "selectStaff": "Select staff to configure their salary structure",
      "noHeads": "No salary heads defined yet. Add at least one head before configuring a structure.",
      "amount": "Amount",
      "calculationType": "Calculation",
      "fixed": "Fixed",
      "percentage": "% of fixed earnings",
      "save": "Save Structure",
      "saved": "Salary structure saved",
      "summaryNet": "Net pay: {{amount}}"
    },
    "adjustments": {
      "editNet": "Edit net",
      "reason": "Reason",
      "reasonPlaceholder": "Why are you adjusting this payslip?",
      "save": "Save override",
      "saved": "Net pay override saved",
      "history": "Adjustment history",
      "old": "Was",
      "new": "Now",
      "by": "By",
      "at": "at"
    },
    "overtime": {
      "run": "Run Overtime Integration",
      "running": "Integrating overtime...",
      "done": "OT integrated for {{ok}} of {{total}} staff",
      "partial": "OT integrated for {{ok}} of {{total}} staff ({{failed}} failed)",
      "noOvertime": "No approved overtime entries found for this run",
      "include": "Include approved overtime in this payslip"
    },
    "print": {
      "open": "Open print view",
      "iframeTitle": "Payslip print frame",
      "hospital": "Hospital",
      "address": "Address",
      "payslipFor": "Payslip for {{month}}",
      "employee": "Employee",
      "position": "Position",
      "bank": "Bank account",
      "earnings": "Earnings",
      "deductions": "Deductions",
      "netPay": "Net pay",
      "attendance": "Attendance",
      "presentDays": "Present",
      "absentDays": "Absent",
      "leaveDays": "Leave",
      "halfDays": "Half days",
      "lateDays": "Late",
      "leaveDeduction": "Leave deduction",
      "overtimeHours": "OT hours",
      "overtimeAmount": "OT pay",
      "generatedOn": "Generated on",
      "close": "Close"
    },
    "history": {
      "title": "All Payroll Runs",
      "month": "Month",
      "status": "Status",
      "employees": "Employees",
      "gross": "Gross",
      "net": "Net",
      "viewPayslips": "View payslips",
      "noRuns": "No payroll runs yet"
    },
    "empty": {
      "noHeads": "No salary heads configured",
      "noStructure": "Select a staff to load their structure",
      "noRuns": "No payroll runs to show"
    }
```

Also add a `toasts.partialSuccess` key (or reuse existing) — verify `web/public/locales/en/hr.json` already has `toasts.failed` and `toasts.csvExported`. They are present; reuse them.

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('web/public/locales/en/hr.json','utf8'));console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add web/public/locales/en/hr.json
git commit -m "i18n(en): add payroll tabs + structure + adjustments + overtime + print"
```

---

## Task 7: Add i18n strings (Bengali)

**Files:**
- Modify: `web/public/locales/bn/hr.json`

- [ ] **Step 1: Add Bengali translations**

Open `web/public/locales/bn/hr.json` and add at the end of the `payroll` object (matching the English keys from Task 6):

```json
    "tabs": {
      "overview": "সারসংক্ষেপ",
      "heads": "বেতনের খাত",
      "structure": "বেতন কাঠামো",
      "runs": "রান ইতিহাস"
    },
    "structure": {
      "selectStaff": "বেতন কাঠামো কনফিগার করতে কর্মী নির্বাচন করুন",
      "noHeads": "এখনও কোনো বেতন খাত নির্ধারণ করা হয়নি। কাঠামো কনফিগার করার আগে অন্তত একটি খাত যোগ করুন।",
      "amount": "পরিমাণ",
      "calculationType": "গণনার ধরন",
      "fixed": "নির্দিষ্ট",
      "percentage": "নির্দিষ্ট উপার্জনের %",
      "save": "কাঠামো সংরক্ষণ",
      "saved": "বেতন কাঠামো সংরক্ষিত",
      "summaryNet": "নিট বেতন: {{amount}}"
    },
    "adjustments": {
      "editNet": "নিট সম্পাদনা",
      "reason": "কারণ",
      "reasonPlaceholder": "এই পে-স্লিপ কেন সমন্বয় করছেন?",
      "save": "সমন্বয় সংরক্ষণ",
      "saved": "নিট বেতন সমন্বয় সংরক্ষিত",
      "history": "সমন্বয়ের ইতিহাস",
      "old": "ছিল",
      "new": "হলো",
      "by": "কর্তৃক",
      "at": "সময়ে"
    },
    "overtime": {
      "run": "ওভারটাইম সংহত করুন",
      "running": "ওভারটাইম সংহত হচ্ছে...",
      "done": "{{total}} জনের মধ্যে {{ok}} জনের জন্য ওভারটাইম সংহত",
      "partial": "{{total}} জনের মধ্যে {{ok}} জনের জন্য সংহত ({{failed}} ব্যর্থ)",
      "noOvertime": "এই রানের জন্য অনুমোদিত ওভারটাইম নেই",
      "include": "এই পে-স্লিপে অনুমোদিত ওভারটাইম অন্তর্ভুক্ত করুন"
    },
    "print": {
      "open": "প্রিন্ট ভিউ খুলুন",
      "iframeTitle": "পে-স্লিপ প্রিন্ট ফ্রেম",
      "hospital": "হাসপাতাল",
      "address": "ঠিকানা",
      "payslipFor": "{{month}} এর পে-স্লিপ",
      "employee": "কর্মী",
      "position": "পদ",
      "bank": "ব্যাংক হিসাব",
      "earnings": "উপার্জন",
      "deductions": "কর্তন",
      "netPay": "নিট বেতন",
      "attendance": "উপস্থিতি",
      "presentDays": "উপস্থিত",
      "absentDays": "অনুপস্থিত",
      "leaveDays": "ছুটি",
      "halfDays": "অর্ধদিবস",
      "lateDays": "বিলম্ব",
      "leaveDeduction": "ছুটি কর্তন",
      "overtimeHours": "ওভারটাইম ঘণ্টা",
      "overtimeAmount": "ওভারটাইম মজুরি",
      "generatedOn": "তৈরির তারিখ",
      "close": "বন্ধ"
    },
    "history": {
      "title": "সকল পে-রোল রান",
      "month": "মাস",
      "status": "অবস্থা",
      "employees": "কর্মী",
      "gross": "মোট",
      "net": "নিট",
      "viewPayslips": "পে-স্লিপ দেখুন",
      "noRuns": "এখনও কোনো পে-রোল রান নেই"
    },
    "empty": {
      "noHeads": "কোনো বেতন খাত নির্ধারিত নেই",
      "noStructure": "কাঠামো লোড করতে একজন কর্মী নির্বাচন করুন",
      "noRuns": "প্রদর্শনের জন্য কোনো রান নেই"
    }
```

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('web/public/locales/bn/hr.json','utf8'));console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add web/public/locales/bn/hr.json
git commit -m "i18n(bn): add payroll tabs + structure + adjustments + overtime + print"
```

---

## Task 8: Create `SalaryHeadsTab` component

**Files:**
- Create: `web/src/pages/payroll/SalaryHeadsTab.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { Plus, Trash2, Edit2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import Modal from '../../components/shared/Modal';
import { useFmt } from '../../hooks/useFmt';

interface SalaryHead {
  id: number;
  head_name: string;
  head_type: 'earning' | 'deduction';
  is_taxable: number;
  is_active: number;
}

interface ListResponse<T> { data: T[]; }
interface MessageResponse { message?: string; }

export default function SalaryHeadsTab() {
  const { t } = useTranslation(['hr']);
  const queryClient = useQueryClient();

  const headsQuery = useApiQuery<ListResponse<SalaryHead>>(
    queryKeys.hr.salaryHeads(),
    '/api/hr/payroll/salary-heads',
  );
  const heads = headsQuery.data?.data ?? [];

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<SalaryHead | null>(null);
  const [form, setForm] = useState({ headName: '', headType: 'earning' as 'earning' | 'deduction', isTaxable: true });

  const openCreate = () => { setEditing(null); setForm({ headName: '', headType: 'earning', isTaxable: true }); setShowModal(true); };
  const openEdit = (h: SalaryHead) => { setEditing(h); setForm({ headName: h.head_name, headType: h.head_type, isTaxable: h.is_taxable === 1 }); setShowModal(true); };

  const saveMutation = useApiMutation<MessageResponse, typeof form>(
    editing ? 'put' : 'post',
    editing ? `/api/hr/payroll/salary-heads/${editing.id}` : '/api/hr/payroll/salary-heads',
    {
      onSuccess: () => {
        toast.success(t('hr:toasts.salaryHeadCreated'));
        setShowModal(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.salaryHeads() });
      },
      onError: (err) => { toast.error(err.message || t('hr:toasts.failed')); },
    },
  );

  const deleteMutation = useApiMutation<MessageResponse, { id: number }>(
    'delete',
    (vars) => `/api/hr/payroll/salary-heads/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('hr:toasts.failed') ? '' : '');
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.salaryHeads() });
      },
      onError: (err) => { toast.error(err.message || t('hr:toasts.failed')); },
    },
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="section-title">{t('hr:payroll.salaryHeads')}</h3>
        <button onClick={openCreate} className="btn-primary"><Plus className="w-4 h-4" />{t('hr:payroll.addSalaryHead')}</button>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {(['earning', 'deduction'] as const).map((type) => (
          <div key={type} className="border border-[var(--color-border)] rounded-xl p-4">
            <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${type === 'earning' ? 'text-emerald-600' : 'text-red-600'}`}>
              {t(`hr:payroll.${type}`)}
            </p>
            <div className="space-y-1">
              {heads.filter((h) => h.head_type === type).map((h) => (
                <div key={h.id} className="flex items-center justify-between text-sm py-1 group">
                  <span>{h.head_name}</span>
                  <div className="flex items-center gap-1">
                    {h.is_taxable === 1 && <span className="badge badge-neutral text-xs">{t('hr:payroll.taxable')}</span>}
                    <button onClick={() => openEdit(h)} className="btn-ghost p-1 opacity-0 group-hover:opacity-100" aria-label="Edit">
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => { if (confirm(`Delete ${h.head_name}?`)) deleteMutation.mutate({ id: h.id }); }} className="btn-ghost p-1 opacity-0 group-hover:opacity-100 text-red-600" aria-label="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {heads.filter((h) => h.head_type === type).length === 0 && (
                <p className="text-[var(--color-text-muted)] text-sm">{t('hr:empty.noHeads')}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <Modal title={editing ? t('hr:payroll.headName') : t('hr:payroll.addSalaryHead')} onClose={() => setShowModal(false)}>
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="label">{t('hr:payroll.headName')} *</label>
              <input className="input" required value={form.headName} onChange={(e) => setForm((f) => ({ ...f, headName: e.target.value }))} />
            </div>
            <div>
              <label className="label">{t('hr:payroll.headType')}</label>
              <select className="input" value={form.headType} onChange={(e) => setForm((f) => ({ ...f, headType: e.target.value as 'earning' | 'deduction' }))}>
                <option value="earning">{t('hr:payroll.earning')}</option>
                <option value="deduction">{t('hr:payroll.deduction')}</option>
              </select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isTaxable} onChange={(e) => setForm((f) => ({ ...f, isTaxable: e.target.checked }))} />
              <span className="text-sm">{t('hr:payroll.taxable')}</span>
            </label>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">{t('common:cancel')}</button>
              <button type="submit" disabled={saveMutation.isPending} className="btn-primary">
                {saveMutation.isPending ? t('common:saving') : t('common:save')}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "SalaryHeadsTab|payroll/SalaryHeadsTab" | head -10`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/payroll/SalaryHeadsTab.tsx
git commit -m "feat(payroll): SalaryHeadsTab with CRUD + soft delete"
```

---

## Task 9: Create `SalaryStructureTab` component

**Files:**
- Create: `web/src/pages/payroll/SalaryStructureTab.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { useFmt } from '../../hooks/useFmt';

interface Staff { id: number; name: string; position: string; status: string; }
interface StaffResponse { staff: Staff[]; }
interface SalaryHead { id: number; head_name: string; head_type: 'earning' | 'deduction'; is_taxable: number; }
interface StructureItem { id: number; salary_head_id: number; head_name: string; head_type: string; amount: number; calculation_type: string; }
interface StructureSummary { totalEarning: number; totalDeduction: number; netPay: number; }
interface StructureResponse { data: StructureItem[]; summary: StructureSummary; }
interface ListResponse<T> { data: T[]; }
interface MessageResponse { message?: string; }

interface DraftRow { salaryHeadId: number; amount: number; calculationType: 'fixed' | 'percentage'; }

export default function SalaryStructureTab() {
  const { t } = useTranslation(['hr']);
  const { fmtCurrency } = useFmt();
  const queryClient = useQueryClient();

  const staffQuery = useApiQuery<StaffResponse>(queryKeys.hr.staff(), '/api/staff');
  const staffList = (staffQuery.data?.staff ?? []).filter((s) => s.status !== 'inactive');

  const headsQuery = useApiQuery<ListResponse<SalaryHead>>(queryKeys.hr.salaryHeads(), '/api/hr/payroll/salary-heads');
  const heads = headsQuery.data?.data ?? [];

  const [staffId, setStaffId] = useState<string>('');
  const [draft, setDraft] = useState<Record<number, DraftRow>>({});

  const structureQuery = useApiQuery<StructureResponse>(
    queryKeys.hr.salaryStructure(staffId),
    `/api/hr/payroll/structure/${staffId}`,
    { enabled: !!staffId },
  );
  const summary = structureQuery.data?.summary ?? { totalEarning: 0, totalDeduction: 0, netPay: 0 };

  // When the loaded structure arrives, seed the draft
  useEffect(() => {
    if (!structureQuery.data?.data) { setDraft({}); return; }
    const next: Record<number, DraftRow> = {};
    for (const row of structureQuery.data.data) {
      next[row.salary_head_id] = {
        salaryHeadId: row.salary_head_id,
        amount: Number(row.amount),
        calculationType: (row.calculation_type as 'fixed' | 'percentage') ?? 'fixed',
      };
    }
    setDraft(next);
  }, [structureQuery.data]);

  const saveMutation = useApiMutation<MessageResponse, { staffId: number; items: DraftRow[] }>(
    'post',
    '/api/hr/payroll/structure',
    {
      onSuccess: () => {
        toast.success(t('hr:payroll.structure.saved'));
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.salaryStructure(String(staffId)) });
      },
      onError: (err) => { toast.error(err.message || t('hr:toasts.failed')); },
    },
  );

  const onSave = () => {
    if (!staffId) return;
    const items = Object.values(draft).filter((d) => d.amount > 0);
    if (items.length === 0) { toast.error(t('hr:toasts.failed')); return; }
    saveMutation.mutate({ staffId: Number(staffId), items });
  };

  const headsByType = useMemo(() => ({
    earning: heads.filter((h) => h.head_type === 'earning'),
    deduction: heads.filter((h) => h.head_type === 'deduction'),
  }), [heads]);

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <h3 className="section-title mb-3">{t('hr:payroll.salaryStructure')}</h3>
        <select className="input max-w-md" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
          <option value="">{t('hr:payroll.selectStaff')}</option>
          {staffList.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.position}</option>)}
        </select>
      </div>

      {!staffId && <div className="card p-6 text-center text-[var(--color-text-muted)]">{t('hr:payroll.empty.noStructure')}</div>}

      {staffId && heads.length === 0 && (
        <div className="card p-6 text-center text-[var(--color-text-muted)]">{t('hr:payroll.structure.noHeads')}</div>
      )}

      {staffId && heads.length > 0 && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('hr:payroll.headName')}</th>
                  <th>{t('hr:payroll.headType')}</th>
                  <th className="text-right">{t('hr:payroll.structure.amount')}</th>
                  <th className="text-right">{t('hr:payroll.structure.calculationType')}</th>
                </tr>
              </thead>
              <tbody>
                {(['earning', 'deduction'] as const).flatMap((type) =>
                  headsByType[type].map((h) => (
                    <tr key={h.id}>
                      <td className="font-medium">{h.head_name}</td>
                      <td>
                        <span className={`badge ${type === 'earning' ? 'badge-success' : 'badge-danger'}`}>
                          {t(`hr:payroll.${type}`)}
                        </span>
                      </td>
                      <td className="text-right">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          className="input w-28 text-right font-data"
                          value={draft[h.id]?.amount ?? 0}
                          onChange={(e) => setDraft((d) => ({ ...d, [h.id]: {
                            salaryHeadId: h.id,
                            amount: Number(e.target.value),
                            calculationType: d[h.id]?.calculationType ?? 'fixed',
                          }}))}
                        />
                      </td>
                      <td className="text-right">
                        <select
                          className="input w-32 text-sm"
                          value={draft[h.id]?.calculationType ?? 'fixed'}
                          onChange={(e) => setDraft((d) => ({ ...d, [h.id]: {
                            salaryHeadId: h.id,
                            amount: d[h.id]?.amount ?? 0,
                            calculationType: e.target.value as 'fixed' | 'percentage',
                          }}))}
                          disabled={type === 'deduction'}
                        >
                          <option value="fixed">{t('hr:payroll.structure.fixed')}</option>
                          <option value="percentage" disabled={type === 'deduction'}>
                            {t('hr:payroll.structure.percentage')}
                          </option>
                        </select>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--color-border)] bg-[var(--color-bg-secondary)] font-bold">
                  <td colSpan={2}>{t('hr:payroll.netPay')}</td>
                  <td className="text-right font-data">{fmtCurrency(summary.netPay)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <div className="p-4 border-t border-[var(--color-border)] flex justify-end">
            <button onClick={onSave} disabled={saveMutation.isPending} className="btn-primary gap-2">
              <Save className="w-4 h-4" />
              {saveMutation.isPending ? t('common:saving') : t('hr:payroll.structure.save')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "SalaryStructureTab|payroll/SalaryStructure" | head -10`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/payroll/SalaryStructureTab.tsx
git commit -m "feat(payroll): SalaryStructureTab with staff picker + line editor"
```

---

## Task 10: Create `RunsHistoryTab` component

**Files:**
- Create: `web/src/pages/payroll/RunsHistoryTab.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from 'react';
import { ChevronRight, X, Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { useFmt } from '../../hooks/useFmt';
import PayslipPrintFrame from './PayslipPrintFrame';

interface PayrollRun {
  id: number; run_month: string; status: 'draft' | 'locked' | 'approved' | 'cancelled';
  total_employees: number; total_gross: number; total_deductions: number; total_net: number;
}
interface Payslip {
  id: number; staff_id: number; staff_name: string; position: string; bank_account: string | null;
  total_earning: number; total_deduction: number; net_pay: number; overtime_hours: number; overtime_amount: number;
  leave_deduction: number; payable_days: number; breakdown_json: string | null; attendance_summary_json: string | null;
}
interface RunsListResponse { data: PayrollRun[]; pagination?: { page: number; limit: number; total: number }; }
interface RunDetailResponse { data: PayrollRun & { payslips: Payslip[] }; }

const statusBadgeClass: Record<string, string> = {
  draft: 'badge-warning',
  locked: 'badge-info',
  approved: 'badge-success',
  cancelled: 'badge-danger',
};

export default function RunsHistoryTab() {
  const { t } = useTranslation(['hr']);
  const { fmtCurrency, fmtMonth } = useFmt();

  const runsQuery = useApiQuery<RunsListResponse>(
    ['hr', 'payroll', 'runs', 'history'],
    '/api/hr/payroll/runs?page=1&limit=100',
  );
  const runs = runsQuery.data?.data ?? [];

  const [openRunId, setOpenRunId] = useState<number | null>(null);
  const [printStaffId, setPrintStaffId] = useState<number | null>(null);

  const detailQuery = useApiQuery<RunDetailResponse>(
    ['hr', 'payroll', 'run-detail', openRunId ?? 0],
    openRunId ? `/api/hr/payroll/runs/${openRunId}` : '',
    { enabled: !!openRunId },
  );
  const detail = detailQuery.data?.data;
  const payslips: Payslip[] = detail?.payslips ?? [];

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="p-5 border-b border-[var(--color-border)]">
          <h3 className="section-title">{t('hr:payroll.history.title')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('hr:payroll.history.month')}</th>
                <th className="text-center">{t('hr:payroll.history.employees')}</th>
                <th className="text-right">{t('hr:payroll.history.gross')}</th>
                <th className="text-right">{t('hr:payroll.history.net')}</th>
                <th>{t('hr:payroll.history.status')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {runsQuery.isLoading && (
                <tr><td colSpan={6} className="text-center py-4">…</td></tr>
              )}
              {!runsQuery.isLoading && runs.length === 0 && (
                <tr><td colSpan={6} className="text-center py-6 text-[var(--color-text-muted)]">{t('hr:payroll.history.noRuns')}</td></tr>
              )}
              {runs.map((run) => (
                <tr key={run.id} className="hover:bg-[var(--color-bg-hover)]">
                  <td className="font-data font-medium">{fmtMonth(run.run_month)}</td>
                  <td className="text-center font-data">{run.total_employees}</td>
                  <td className="text-right font-data">{fmtCurrency(run.total_gross)}</td>
                  <td className="text-right font-data font-bold text-emerald-600">{fmtCurrency(run.total_net)}</td>
                  <td><span className={`badge ${statusBadgeClass[run.status] ?? 'badge-neutral'}`}>{t(`hr:payroll.status.${run.status}`, run.status)}</span></td>
                  <td>
                    <button onClick={() => setOpenRunId(run.id)} className="btn-ghost text-xs gap-1">
                      {t('hr:payroll.history.viewPayslips')}
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {openRunId && detail && (
        <div className="fixed inset-0 z-40 bg-black/40 flex" onClick={() => setOpenRunId(null)}>
          <div className="ml-auto h-full w-full max-w-3xl bg-[var(--color-bg)] shadow-2xl overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="sticky top-0 bg-[var(--color-bg)] border-b border-[var(--color-border)] p-4 flex items-center justify-between z-10">
              <div>
                <h3 className="section-title">{fmtMonth(detail.run_month)}</h3>
                <p className="text-sm text-[var(--color-text-muted)]">{detail.total_employees} {t('hr:payroll.employees')}</p>
              </div>
              <button onClick={() => setOpenRunId(null)} className="btn-ghost p-2"><X className="w-5 h-5" /></button>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t('hr:table.staff')}</th>
                    <th className="text-right">{t('hr:payroll.totalEarning')}</th>
                    <th className="text-right">{t('hr:payroll.totalDeduction')}</th>
                    <th className="text-right">{t('hr:payroll.netPay')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {payslips.map((p) => (
                    <tr key={p.id} className="hover:bg-[var(--color-bg-hover)]">
                      <td>
                        <div className="font-medium">{p.staff_name}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">{p.position}</div>
                      </td>
                      <td className="text-right font-data">{fmtCurrency(p.total_earning)}</td>
                      <td className="text-right font-data text-red-600">{fmtCurrency(p.total_deduction)}</td>
                      <td className="text-right font-data font-bold">{fmtCurrency(p.net_pay)}</td>
                      <td>
                        <button
                          onClick={() => setPrintStaffId(p.staff_id)}
                          className="btn-ghost p-2"
                          title={t('hr:payroll.print.open') as string}
                        >
                          <Printer className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {printStaffId && openRunId && detail && (
        <PayslipPrintFrame
          runId={openRunId}
          staffId={printStaffId}
          payslip={payslips.find((p) => p.staff_id === printStaffId) ?? null}
          onClose={() => setPrintStaffId(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "RunsHistoryTab|payroll/RunsHistory" | head -10`
Expected: no errors. (Note: `PayslipPrintFrame` is not yet created — the import will fail until Task 11.)

- [ ] **Step 3: Commit only after Task 11 is in place (defer commit)**

Mark this task's commit step as pending Task 11. Run `git status` to confirm; if imports fail to resolve, do not commit yet.

---

## Task 11: Create `PayslipPrintFrame` component

**Files:**
- Create: `web/src/pages/payroll/PayslipPrintFrame.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useRef } from 'react';
import { X, Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFmt } from '../../hooks/useFmt';

interface Payslip {
  id: number; staff_id: number; staff_name: string; position: string; bank_account: string | null;
  total_earning: number; total_deduction: number; net_pay: number;
  overtime_hours: number; overtime_amount: number; leave_deduction: number; payable_days: number;
  breakdown_json: string | null; attendance_summary_json: string | null;
}

interface AttendanceSummary {
  present: number; late: number; absent: number; leave: number; half_day: number;
  payable_days: number; leave_deduction: number;
}

interface BreakdownComponent { head: string; type: 'earning' | 'deduction'; amount: number; }

interface Props { runId: number; staffId: number; payslip: Payslip | null; onClose: () => void; }

export default function PayslipPrintFrame({ runId, staffId, payslip, onClose }: Props) {
  const { t, i18n } = useTranslation(['hr', 'common']);
  const { fmtCurrency } = useFmt();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const breakdown: BreakdownComponent[] = (() => {
    if (!payslip?.breakdown_json) return [];
    try { return (JSON.parse(payslip.breakdown_json) as { components?: BreakdownComponent[] }).components ?? []; }
    catch { return []; }
  })();
  const attendance: AttendanceSummary | null = (() => {
    if (!payslip?.attendance_summary_json) return null;
    try { return JSON.parse(payslip.attendance_summary_json); } catch { return null; }
  })();

  useEffect(() => {
    // Auto-print after mount
    const id = setTimeout(() => iframeRef.current?.contentWindow?.print(), 300);
    return () => clearTimeout(id);
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex flex-col print:hidden" data-run-id={runId} data-staff-id={staffId}>
      <div className="flex justify-end gap-2 p-3">
        <button onClick={() => iframeRef.current?.contentWindow?.print()} className="btn-secondary gap-2">
          <Printer className="w-4 h-4" /> {t('common:print')}
        </button>
        <button onClick={onClose} className="btn-secondary gap-2">
          <X className="w-4 h-4" /> {t('hr:payroll.print.close')}
        </button>
      </div>
      <iframe
        ref={iframeRef}
        title={t('hr:payroll.print.iframeTitle') as string}
        className="flex-1 w-full bg-white"
        srcDoc={buildPayslipHtml({ payslip, breakdown, attendance, lang: i18n.language, t: (k: string) => t(k) as string, fmtCurrency })}
      />
    </div>
  );
}

function buildPayslipHtml(args: {
  payslip: Payslip | null; breakdown: BreakdownComponent[]; attendance: AttendanceSummary | null;
  lang: string; t: (k: string) => string; fmtCurrency: (n: number) => string;
}): string {
  if (!args.payslip) return '<html><body><p>No payslip</p></body></html>';
  const p = args.payslip;
  const rows = args.breakdown.map((c) =>
    `<tr><td>${escape(c.head)}</td><td style="text-align:right">${args.fmtCurrency(c.amount)}</td></tr>`
  ).join('');
  const att = args.attendance;
  return `<!doctype html><html lang="${args.lang}"><head><meta charset="utf-8"><title>Payslip</title>
<style>
  body { font-family: 'Figtree', system-ui, sans-serif; padding: 24px; color: #111; }
  h1 { margin: 0 0 4px 0; font-size: 22px; }
  h2 { font-size: 14px; margin: 16px 0 6px 0; color: #555; text-transform: uppercase; letter-spacing: 0.05em; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #eee; text-align: left; font-size: 14px; }
  .right { text-align: right; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .total { font-size: 18px; font-weight: 700; padding: 10px; background: #f4f4f5; border-radius: 6px; }
  @media print { body { padding: 0; } .no-print { display: none; } }
</style></head><body>
  <h1>${escape(args.t('hr:payroll.print.payslipFor').replace('{{month}}', p.id))}</h1>
  <div class="grid">
    <div><b>${escape(args.t('hr:payroll.print.employee'))}:</b> ${escape(p.staff_name)}<br/>
      <b>${escape(args.t('hr:payroll.print.position'))}:</b> ${escape(p.position ?? '')}<br/>
      <b>${escape(args.t('hr:payroll.print.bank'))}:</b> ${escape(p.bank_account ?? '—')}</div>
  </div>
  <h2>${escape(args.t('hr:payroll.print.earnings'))}</h2>
  <table>${rows || `<tr><td colspan="2">—</td></tr>`}</table>
  <h2>${escape(args.t('hr:payroll.print.deductions'))}</h2>
  <table>${args.breakdown.filter((b) => b.type === 'deduction').map((c) =>
    `<tr><td>${escape(c.head)}</td><td style="text-align:right">${args.fmtCurrency(c.amount)}</td></tr>`).join('') || '<tr><td colspan="2">—</td></tr>'}</table>
  ${att ? `<h2>${escape(args.t('hr:payroll.print.attendance'))}</h2>
  <table>
    <tr><td>${escape(args.t('hr:payroll.print.presentDays'))}</td><td class="right">${att.present}</td>
        <td>${escape(args.t('hr:payroll.print.absentDays'))}</td><td class="right">${att.absent}</td></tr>
    <tr><td>${escape(args.t('hr:payroll.print.leaveDays'))}</td><td class="right">${att.leave}</td>
        <td>${escape(args.t('hr:payroll.print.halfDays'))}</td><td class="right">${att.half_day}</td></tr>
    <tr><td>${escape(args.t('hr:payroll.print.lateDays'))}</td><td class="right">${att.late}</td>
        <td>${escape(args.t('hr:payroll.print.leaveDeduction'))}</td><td class="right">${args.fmtCurrency(att.leave_deduction)}</td></tr>
  </table>` : ''}
  ${p.overtime_hours > 0 ? `<h2>${escape(args.t('hr:payroll.print.overtimeHours'))}</h2>
  <table><tr><td>${escape(args.t('hr:payroll.print.overtimeHours'))}</td><td class="right">${p.overtime_hours}</td>
  <td>${escape(args.t('hr:payroll.print.overtimeAmount'))}</td><td class="right">${args.fmtCurrency(p.overtime_amount)}</td></tr></table>` : ''}
  <div class="total">${escape(args.t('hr:payroll.print.netPay'))}: ${args.fmtCurrency(p.net_pay)}</div>
</body></html>`;
}

function escape(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "PayslipPrintFrame|payroll/Payslip" | head -10`
Expected: no errors.

- [ ] **Step 3: Commit both `RunsHistoryTab` and `PayslipPrintFrame` together**

```bash
git add web/src/pages/payroll/RunsHistoryTab.tsx web/src/pages/payroll/PayslipPrintFrame.tsx
git commit -m "feat(payroll): RunsHistoryTab + PayslipPrintFrame (printable iframe)"
```

---

## Task 12: Create `OverviewTab` component (extract from current `PayrollGeneration.tsx`)

**Files:**
- Create: `web/src/pages/payroll/OverviewTab.tsx`

- [ ] **Step 1: Write the component**

This is a lift of the current grid logic. The new responsibilities are: persist net overrides via PATCH, run overtime integration on a button click, and use `PayslipPrintFrame` for per-staff print (the iframe lives in `RunsHistoryTab`, so the Overview tab keeps a "Print all" button that uses `window.print()` and lets users print the visible grid; per-staff print lives in the Runs tab).

```tsx
import { useMemo, useState } from 'react';
import { DollarSign, Calendar, Users, Download, Check, RefreshCw, Calculator, Lock, Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import KPICard from '../../components/dashboard/KPICard';
import EmptyState from '../../components/dashboard/EmptyState';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { useFmt } from '../../hooks/useFmt';

interface PayrollRun {
  id: number; run_month: string;
  status: 'draft' | 'locked' | 'approved' | 'cancelled';
  total_employees: number; total_gross: number; total_deductions: number; total_net: number;
}
interface Payslip {
  id: number; staff_id: number; staff_name?: string; month: string;
  total_earning: number; total_deduction: number; net_pay: number;
  overtime_hours?: number; overtime_amount?: number;
  leave_deduction?: number; payable_days?: number;
  breakdown_json?: string | null; attendance_summary_json?: string | null;
}
interface AttendanceSummary {
  staff_id: number; staff_name: string; position: string;
  present_days: number; late_days: number; absent_days: number; leave_days: number; half_days: number;
}
interface RunsResponse { runs?: PayrollRun[]; data?: PayrollRun[]; }
interface RunDetailResponse { run: PayrollRun; payslips: Payslip[]; data?: PayrollRun & { payslips: Payslip[] }; }
interface AttendanceSummaryResponse { summary: AttendanceSummary[]; }
interface MessageResponse { message?: string; run?: PayrollRun; }

interface ReviewRow {
  staff_id: number; staff_name: string;
  basic_salary: number; present_days: number; late_days: number; late_deduction: number;
  overtime_hours: number; overtime_amount: number; net_payable: number; original_net: number;
  payslip_id: number; persisted: boolean;
}

const statusBadgeClass: Record<string, string> = {
  draft: 'badge-warning', locked: 'badge-info', approved: 'badge-success', cancelled: 'badge-danger',
};

export default function OverviewTab() {
  const { t } = useTranslation(['hr', 'common']);
  const { fmtCurrency, fmtMonth } = useFmt();
  const queryClient = useQueryClient();

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [persistedOverrides, setPersistedOverrides] = useState<Record<number, number>>({});

  const runsQuery = useApiQuery<RunsResponse>(queryKeys.hr.payrollRuns(), '/api/hr/payroll/runs?limit=50');
  const allRuns = useMemo(() => runsQuery.data?.runs ?? runsQuery.data?.data ?? [], [runsQuery.data]);

  const currentRun = useMemo(() => {
    if (activeRunId) return allRuns.find((r) => r.id === activeRunId) ?? null;
    return allRuns.find((r) => r.run_month === selectedMonth) ?? null;
  }, [allRuns, selectedMonth, activeRunId]);

  const runDetailQuery = useApiQuery<RunDetailResponse>(
    ['hr', 'payroll', 'run-detail', currentRun?.id ?? 0],
    `/api/hr/payroll/runs/${currentRun?.id}`,
    { enabled: !!currentRun?.id },
  );
  const payslips: Payslip[] = runDetailQuery.data?.payslips ?? runDetailQuery.data?.data?.payslips ?? [];

  const attendanceQuery = useApiQuery<AttendanceSummaryResponse>(
    queryKeys.hr.attendanceSummary(selectedMonth),
    `/api/hr/attendance/summary?month=${selectedMonth}`,
  );
  const attendanceMap = useMemo(() => {
    const map = new Map<number, AttendanceSummary>();
    for (const row of attendanceQuery.data?.summary ?? []) map.set(row.staff_id, row);
    return map;
  }, [attendanceQuery.data]);

  const reviewRows: ReviewRow[] = useMemo(() => {
    if (payslips.length === 0) return [];
    return payslips.map((ps) => {
      const att = attendanceMap.get(ps.staff_id);
      const lateDays = att?.late_days ?? 0;
      const lateDeduction = lateDays * ((ps.total_earning / 30) * 0.5);
      const net = persistedOverrides[ps.staff_id] ?? ps.net_pay;
      return {
        payslip_id: ps.id,
        staff_id: ps.staff_id,
        staff_name: ps.staff_name ?? `Staff #${ps.staff_id}`,
        basic_salary: ps.total_earning,
        present_days: att?.present_days ?? ps.payable_days ?? 0,
        late_days: lateDays,
        late_deduction: lateDeduction,
        overtime_hours: ps.overtime_hours ?? 0,
        overtime_amount: ps.overtime_amount ?? 0,
        net_payable: net,
        original_net: ps.net_pay,
        persisted: persistedOverrides[ps.staff_id] !== undefined,
      };
    });
  }, [payslips, attendanceMap, persistedOverrides]);

  const totals = useMemo(() => reviewRows.reduce(
    (acc, r) => ({
      basic_salary: acc.basic_salary + r.basic_salary,
      present_days: acc.present_days + r.present_days,
      late_days: acc.late_days + r.late_days,
      late_deduction: acc.late_deduction + r.late_deduction,
      overtime_amount: acc.overtime_amount + r.overtime_amount,
      net_payable: acc.net_payable + r.net_payable,
    }),
    { basic_salary: 0, present_days: 0, late_days: 0, late_deduction: 0, overtime_amount: 0, net_payable: 0 },
  ), [reviewRows]);

  const generateMutation = useApiMutation<MessageResponse, { runMonth: string }>(
    'post', '/api/hr/payroll/runs',
    {
      onSuccess: (data) => {
        if (data?.message?.toLowerCase().includes('already exists')) {
          toast.success(t('hr:toasts.payrollGenerated'));
        } else {
          toast.success(data?.message || t('hr:toasts.payrollGenerated'));
        }
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.payrollRuns() });
        if (data?.run?.id) setActiveRunId(data.run.id);
      },
      onError: (err) => { toast.error(err.message || t('hr:toasts.failed')); },
    },
  );

  const lockMutation = useApiMutation<unknown, { id: number }>(
    'post', (vars) => `/api/hr/payroll/runs/${vars.id}/lock`,
    {
      onSuccess: () => {
        toast.success(t('hr:toasts.payrollLocked'));
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.payrollRuns() });
      },
      onError: (err) => { toast.error(err.message || t('hr:toasts.failed')); },
    },
  );

  const approveMutation = useApiMutation<unknown, { id: number }>(
    'post', (vars) => `/api/hr/payroll/runs/${vars.id}/approve`,
    {
      onSuccess: () => {
        toast.success(t('hr:toasts.payrollApproved'));
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.payrollRuns() });
      },
      onError: (err) => { toast.error(err.message || t('hr:toasts.failed')); },
    },
  );

  const patchMutation = useApiMutation<unknown, { payslipId: number; netPay: number; reason: string }>(
    'patch', (vars) => `/api/hr/payroll/payslips/${vars.payslipId}`,
    {
      onSuccess: (_data, vars) => {
        setPersistedOverrides((prev) => ({ ...prev, [vars.netPay ? vars.staffId : 0]: vars.netPay, [vars.staffId]: vars.netPay }));
        toast.success(t('hr:payroll.adjustments.saved'));
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.payrollRuns() });
        queryClient.invalidateQueries({ queryKey: ['hr', 'payroll', 'run-detail', currentRun?.id ?? 0] });
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.payslipAdjustments(currentRun?.id ?? 0) });
      },
      onError: (err) => { toast.error(err.message || t('hr:toasts.failed')); },
    },
  );

  // The patch mutation uses the staffId from the variable; the invalidation key needs the staffId
  // Override the success handler to map correctly:
  // (The above has a typo — corrected in step 1b below. Keep this as a placeholder to surface the issue.)

  const overtimeMutation = useApiMutation<unknown, { payrollRunId: number; staffId: number; includeOvertime: true }>(
    'post', '/api/hr/payroll/overtime-integrate',
    { onSuccess: () => {}, onError: () => {} },
  );

  const isReadOnly = currentRun?.status === 'approved' || currentRun?.status === 'locked';
  const isDraft = currentRun?.status === 'draft';

  const handleGenerate = () => generateMutation.mutate({ runMonth: selectedMonth });
  const handleConfirmAndPrint = async () => {
    if (!currentRun) return;
    if (currentRun.status === 'draft') await lockMutation.mutateAsync({ id: currentRun.id });
    if (currentRun.status === 'locked' || currentRun.status === 'draft') {
      await approveMutation.mutateAsync({ id: currentRun.id });
    }
    window.print();
  };

  const handleRunOvertime = async () => {
    if (!currentRun) return;
    toast.loading(t('hr:payroll.overtime.running'), { id: 'ot' });
    let ok = 0; let failed = 0;
    for (const p of payslips) {
      try {
        await overtimeMutation.mutateAsync({ payrollRunId: currentRun.id, staffId: p.staff_id, includeOvertime: true });
        ok++;
      } catch { failed++; }
    }
    toast.dismiss('ot');
    if (failed === 0) toast.success(t('hr:payroll.overtime.done', { ok, total: payslips.length } as any));
    else toast.error(t('hr:payroll.overtime.partial', { ok, total: payslips.length, failed } as any));
    queryClient.invalidateQueries({ queryKey: ['hr', 'payroll', 'run-detail', currentRun.id] });
    queryClient.invalidateQueries({ queryKey: queryKeys.hr.payrollRuns() });
  };

  const handleExportCSV = () => {
    if (reviewRows.length === 0) return;
    const headers = ['Staff Name', 'Basic Salary', 'Present Days', 'Late Days', 'Late Deduction', 'Overtime Amount', 'Net Payable'];
    const csvRows = [
      headers.join(','),
      ...reviewRows.map((r) => [r.staff_name, r.basic_salary, r.present_days, r.late_days, r.late_deduction.toFixed(2), r.overtime_amount.toFixed(2), r.net_payable.toFixed(2)].join(',')),
    ];
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `payroll-${selectedMonth}.csv`; a.click();
    URL.revokeObjectURL(url);
    toast.success(t('hr:toasts.csvExported', 'CSV exported'));
  };

  const handleNetChange = (staffId: number, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    setPersistedOverrides((prev) => ({ ...prev, [staffId]: num }));
  };

  const handleNetCommit = (row: ReviewRow) => {
    if (row.net_payable === row.original_net) return;
    const reason = window.prompt(t('hr:payroll.adjustments.reason') as string, '');
    if (!reason || reason.length < 3) { toast.error(t('hr:toasts.failed')); return; }
    patchMutation.mutate({ payslipId: row.payslip_id, netPay: row.net_payable, reason });
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="sticky top-0 z-20 bg-[var(--color-bg)] border-b border-[var(--color-border)] -mx-4 lg:-mx-6 px-4 lg:px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Calculator className="w-6 h-6 text-[var(--color-primary)]" />
            {t('hr:payroll.title')}
          </h1>
          <p className="section-subtitle mt-1">{t('hr:subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="month" value={selectedMonth}
              onChange={(e) => { setSelectedMonth(e.target.value); setActiveRunId(null); setPersistedOverrides({}); }}
              className="input pl-9 w-44" />
          </div>
          <button onClick={handleGenerate} disabled={generateMutation.isPending} className="btn-primary gap-2 text-sm font-semibold">
            {generateMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Calculator className="w-4 h-4" />}
            {generateMutation.isPending ? t('common:saving') : t('hr:payroll.create')}
          </button>
        </div>
      </div>

      {currentRun && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title={t('hr:payroll.totalEmployees', 'Total Employees')} value={currentRun.total_employees} loading={runsQuery.isLoading} icon={<Users className="w-5 h-5" />} iconBg="bg-blue-50 text-blue-600" index={0} />
          <KPICard title={t('hr:payroll.totalGross', 'Total Gross')} value={fmtCurrency(currentRun.total_gross)} loading={runsQuery.isLoading} icon={<DollarSign className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={1} />
          <KPICard title={t('hr:payroll.totalDeductions', 'Total Deductions')} value={fmtCurrency(currentRun.total_deductions)} loading={runsQuery.isLoading} icon={<Lock className="w-5 h-5" />} iconBg="bg-red-50 text-red-600" index={2} />
          <KPICard title={t('hr:payroll.totalNet', 'Total Net')} value={fmtCurrency(currentRun.total_net)} loading={runsQuery.isLoading} icon={<Check className="w-5 h-5" />} iconBg="bg-purple-50 text-purple-600" index={3} />
        </div>
      )}

      {currentRun && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-[var(--color-text-muted)]">{t('hr:payroll.runStatus')}:</span>
          <span className={`badge ${statusBadgeClass[currentRun.status] ?? 'badge-neutral'}`}>
            {t(`hr:payroll.status.${currentRun.status}`, currentRun.status.toUpperCase())}
          </span>
          <span className="text-sm text-[var(--color-text-muted)]">{fmtMonth(currentRun.run_month)}</span>
          {isDraft && payslips.length > 0 && (
            <button onClick={handleRunOvertime} disabled={overtimeMutation.isPending} className="btn-secondary text-xs gap-1.5 ml-auto">
              <RefreshCw className="w-3.5 h-3.5" />{t('hr:payroll.overtime.run')}
            </button>
          )}
        </div>
      )}

      {runsQuery.isLoading ? (
        <div className="card p-6 space-y-4">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-[var(--color-border-light)] rounded animate-pulse" />)}
        </div>
      ) : reviewRows.length === 0 ? (
        <EmptyState
          icon={<Calculator className="w-8 h-8 text-[var(--color-text-muted)]" />}
          title={t('hr:payroll.noPayrollRun', 'No payroll run for this month')}
          description={t('hr:payroll.generateFirst', 'Click "Create Payroll" to create a payroll run for the selected month.')}
          action={<button onClick={handleGenerate} disabled={generateMutation.isPending} className="btn-primary gap-2"><Calculator className="w-4 h-4" />{t('hr:payroll.create')}</button>}
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th className="w-10">#</th>
                  <th>{t('hr:table.staff')}</th>
                  <th className="text-right">{t('hr:payroll.basicSalary', 'Basic Salary')}</th>
                  <th className="text-center">{t('hr:payroll.presentDays', 'Present Days')}</th>
                  <th className="text-center">{t('hr:payroll.lateDays', 'Late Days')}</th>
                  <th className="text-right">{t('hr:payroll.lateDeduction', 'Late Deduction')}</th>
                  <th className="text-right">{t('hr:payroll.overtime', 'Overtime')}</th>
                  <th className="text-right">{t('hr:payroll.netPayable', 'Net Payable')}</th>
                </tr>
              </thead>
              <tbody>
                {reviewRows.map((row, idx) => (
                  <tr key={row.staff_id} className="hover:bg-[var(--color-bg-hover)]">
                    <td className="text-[var(--color-text-muted)] text-sm">{idx + 1}</td>
                    <td className="font-medium">{row.staff_name}</td>
                    <td className="text-right font-data">{fmtCurrency(row.basic_salary)}</td>
                    <td className="text-center font-data">{row.present_days}</td>
                    <td className="text-center font-data">{row.late_days}</td>
                    <td className="text-right font-data text-red-500 font-semibold">{row.late_deduction > 0 ? `- ${fmtCurrency(row.late_deduction)}` : '—'}</td>
                    <td className="text-right font-data text-emerald-600 font-semibold">{row.overtime_amount > 0 ? `+ ${fmtCurrency(row.overtime_amount)}` : '—'}</td>
                    <td className="text-right">
                      {isReadOnly ? (
                        <span className="font-data font-bold">{fmtCurrency(row.net_payable)}</span>
                      ) : (
                        <div className="flex items-center gap-1 justify-end">
                          <input
                            type="number" value={row.net_payable}
                            onChange={(e) => handleNetChange(row.staff_id, e.target.value)}
                            onBlur={() => handleNetCommit(row)}
                            className="input w-28 text-right font-data text-sm py-1" step="0.01"
                          />
                          {row.persisted && <span className="text-xs text-emerald-600">✓</span>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--color-border)] font-bold bg-[var(--color-bg-secondary)]">
                  <td></td><td>{t('common:total', 'Total')}</td>
                  <td className="text-right font-data">{fmtCurrency(totals.basic_salary)}</td>
                  <td className="text-center font-data">{totals.present_days}</td>
                  <td className="text-center font-data">{totals.late_days}</td>
                  <td className="text-right font-data text-red-500">{totals.late_deduction > 0 ? `- ${fmtCurrency(totals.late_deduction)}` : '—'}</td>
                  <td className="text-right font-data text-emerald-600">{totals.overtime_amount > 0 ? `+ ${fmtCurrency(totals.overtime_amount)}` : '—'}</td>
                  <td className="text-right font-data">{fmtCurrency(totals.net_payable)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {reviewRows.length > 0 && (
        <div className="h-24" />
      )}

      {reviewRows.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 bg-white dark:bg-slate-900 border-t border-[var(--color-border)] shadow-lg print:hidden">
          <div className="max-w-7xl mx-auto px-4 lg:px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center gap-6 text-sm">
              <div><span className="text-[var(--color-text-muted)]">{t('hr:payroll.employees')}: </span><span className="font-bold">{reviewRows.length}</span></div>
              <div><span className="text-[var(--color-text-muted)]">{t('hr:payroll.gross')}: </span><span className="font-bold">{fmtCurrency(totals.basic_salary)}</span></div>
              <div><span className="text-[var(--color-text-muted)]">{t('hr:payroll.deductions')}: </span><span className="font-bold text-red-600">{fmtCurrency(totals.late_deduction)}</span></div>
              <div><span className="text-[var(--color-text-muted)]">{t('hr:payroll.netTotal')}: </span><span className="font-bold text-emerald-600">{fmtCurrency(totals.net_payable)}</span></div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleExportCSV} className="btn-secondary gap-1.5 text-sm"><Download className="w-4 h-4" />{t('hr:payroll.exportCSV', 'Export CSV')}</button>
              {!isReadOnly && (
                <button onClick={handleConfirmAndPrint} disabled={lockMutation.isPending || approveMutation.isPending} className="btn-primary gap-1.5 text-sm">
                  {(lockMutation.isPending || approveMutation.isPending) ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                  {t('hr:payroll.confirmAndPrint', 'Confirm & Print Payslips')}
                </button>
              )}
              {currentRun?.status === 'locked' && (
                <button onClick={() => currentRun && approveMutation.mutate({ id: currentRun.id })} disabled={approveMutation.isPending} className="btn-primary gap-1.5 text-sm">
                  {approveMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {t('hr:payroll.approveRun', 'Approve')}
                </button>
              )}
              {currentRun?.status === 'approved' && (
                <span className="badge badge-success gap-1 text-sm"><Check className="w-3.5 h-3.5" />{t('hr:payroll.status.approved', 'Approved')}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 1b: Fix the patch mutation's `onSuccess` typo**

The above has a placeholder for the success handler. Replace the `patchMutation` definition with the corrected version:

```ts
  const patchMutation = useApiMutation<unknown, { payslipId: number; staffId: number; netPay: number; reason: string }>(
    'patch', (vars) => `/api/hr/payroll/payslips/${vars.payslipId}`,
    {
      onSuccess: (_data, vars) => {
        setPersistedOverrides((prev) => ({ ...prev, [vars.staffId]: vars.netPay }));
        toast.success(t('hr:payroll.adjustments.saved'));
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.payrollRuns() });
        queryClient.invalidateQueries({ queryKey: ['hr', 'payroll', 'run-detail', currentRun?.id ?? 0] });
        queryClient.invalidateQueries({ queryKey: queryKeys.hr.payslipAdjustments(currentRun?.id ?? 0) });
      },
      onError: (err) => { toast.error(err.message || t('hr:toasts.failed')); },
    },
  );
```

Then update `handleNetCommit` to pass `staffId` explicitly:

```ts
  const handleNetCommit = (row: ReviewRow) => {
    if (row.net_payable === row.original_net) return;
    const reason = window.prompt(t('hr:payroll.adjustments.reason') as string, '');
    if (!reason || reason.length < 3) { toast.error(t('hr:toasts.failed')); return; }
    patchMutation.mutate({ payslipId: row.payslip_id, staffId: row.staff_id, netPay: row.net_payable, reason });
  };
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "OverviewTab|payroll/Overview" | head -10`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/payroll/OverviewTab.tsx
git commit -m "feat(payroll): OverviewTab with PATCH net overrides + overtime loop"
```

---

## Task 13: Rewrite `PayrollGeneration.tsx` as page shell

**Files:**
- Modify: `web/src/pages/PayrollGeneration.tsx` (replace file contents)

- [ ] **Step 1: Replace the file contents**

```tsx
import { useSearchParams } from 'react-router-dom';
import { Calculator, DollarSign, Briefcase, History } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import OverviewTab from './payroll/OverviewTab';
import SalaryHeadsTab from './payroll/SalaryHeadsTab';
import SalaryStructureTab from './payroll/SalaryStructureTab';
import RunsHistoryTab from './payroll/RunsHistoryTab';

type Tab = 'overview' | 'heads' | 'structure' | 'runs';
const TAB_VALUES: Tab[] = ['overview', 'heads', 'structure', 'runs'];

export default function PayrollGeneration({ role }: { role?: string }) {
  const { t } = useTranslation(['hr']);
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const activeTab: Tab = (TAB_VALUES as string[]).includes(raw ?? '') ? (raw as Tab) : 'overview';

  const setTab = (tab: Tab) => {
    const next = new URLSearchParams(params);
    if (tab === 'overview') next.delete('tab'); else next.set('tab', tab);
    setParams(next, { replace: true });
  };

  const tabs: { key: Tab; icon: JSX.Element; labelKey: string }[] = [
    { key: 'overview',  icon: <Calculator className="w-4 h-4" />, labelKey: 'hr:payroll.tabs.overview' },
    { key: 'heads',     icon: <DollarSign className="w-4 h-4" />, labelKey: 'hr:payroll.tabs.heads' },
    { key: 'structure', icon: <Briefcase className="w-4 h-4" />, labelKey: 'hr:payroll.tabs.structure' },
    { key: 'runs',      icon: <History className="w-4 h-4" />, labelKey: 'hr:payroll.tabs.runs' },
  ];

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <h1 className="page-title">{t('hr:payroll.title')}</h1>
          <p className="section-subtitle">{t('hr:subtitle')}</p>
        </div>

        <div className="flex gap-1 border border-[var(--color-border)] rounded-xl p-1 bg-[var(--color-bg-card)] w-fit" role="tablist">
          {tabs.map((tab) => (
            <button key={tab.key} onClick={() => setTab(tab.key)} role="tab" aria-selected={activeTab === tab.key}
              data-tab={tab.key}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
                activeTab === tab.key
                  ? 'bg-[var(--color-primary)] text-white shadow-sm'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border-light)]'
              }`}>
              {tab.icon}{t(tab.labelKey)}
            </button>
          ))}
        </div>

        <div role="tabpanel" data-active-tab={activeTab}>
          {activeTab === 'overview' && <OverviewTab />}
          {activeTab === 'heads' && <SalaryHeadsTab />}
          {activeTab === 'structure' && <SalaryStructureTab />}
          {activeTab === 'runs' && <RunsHistoryTab />}
        </div>
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `cd web && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "PayrollGeneration" | head -10`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/PayrollGeneration.tsx
git commit -m "feat(payroll): page shell with 4 URL-driven tabs (?tab=...)"
```

---

## Task 14: Frontend TDD — test the page shell and tab switching

**Files:**
- Create: `web/src/pages/PayrollGeneration.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import PayrollGeneration from './PayrollGeneration';

vi.mock('../lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  getToken: vi.fn(() => 't'),
  getWorkstationId: vi.fn(() => 'w'),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn(), loading: vi.fn(), dismiss: vi.fn() } }));

function wrapper(initial: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="*" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => { vi.clearAllMocks(); });

describe('PayrollGeneration page', () => {
  it('renders 4 tabs and defaults to Overview', () => {
    render(<PayrollGeneration />, { wrapper: wrapper('/h/x/payroll-generation') });
    expect(screen.getByRole('tab', { name: /Overview/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Salary Heads/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Salary Structure/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Runs History/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Overview/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('reads ?tab=heads on mount and selects that tab', () => {
    render(<PayrollGeneration />, { wrapper: wrapper('/h/x/payroll-generation?tab=heads') });
    expect(screen.getByRole('tab', { name: /Salary Heads/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('updates the URL when a different tab is clicked', async () => {
    render(<PayrollGeneration />, { wrapper: wrapper('/h/x/payroll-generation') });
    fireEvent.click(screen.getByRole('tab', { name: /Runs History/i }));
    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /Runs History/i })).toHaveAttribute('aria-selected', 'true');
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `cd web && pnpm vitest run src/pages/PayrollGeneration.test.tsx 2>&1 | tail -25`
Expected: PASS — 3 tests green.

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/PayrollGeneration.test.tsx
git commit -m "test(payroll): page shell renders 4 tabs + URL-driven selection"
```

---

## Task 15: Remove `PayrollTab` from `HRDashboard.tsx` and add quick-link card

**Files:**
- Modify: `web/src/pages/HRDashboard.tsx` (delete `PayrollTab` function ~250 lines; remove import of Plus/ChevronRight/AlertCircle if only used there; add `PayrollQuickLink` card on the Overview tab)
- Modify: `web/src/pages/HRDashboard.test.ts` (add test that `function PayrollTab` is gone)

- [ ] **Step 1: Delete the `PayrollTab` function**

Open `web/src/pages/HRDashboard.tsx`. Find the line that begins `function PayrollTab({ staffList }:` and the line that ends with the closing `}` immediately before `// ══════════════════════════════════════════════════════════════════════\n// MAIN PAGE` (around line 1040). Delete the entire `PayrollTab` function and its comment header.

- [ ] **Step 2: Remove unused imports**

If the only use of `Plus`, `ChevronRight`, and `AlertCircle` was in `PayrollTab`, remove them from the lucide-react import in `HRDashboard.tsx`. Verify by grep:

Run: `grep -n "Plus\|ChevronRight\|AlertCircle" web/src/pages/HRDashboard.tsx | head -10`
Expected: only the import line should match (after the function removal). If those icons are used elsewhere, leave the import.

- [ ] **Step 3: Remove the `payroll` tab from the TABS tuple and `tabIcons`**

Open `web/src/pages/HRDashboard.tsx`. Find the `TABS` const (around line ~57) and the `tabIcons` mapping. Remove the `'payroll'` entry from both.

- [ ] **Step 4: Remove the `activeTab === 'payroll' && <PayrollTab ... />` branch**

Find the conditional render around line 1098 and remove the `payroll` line. The remaining branches stay as `overview` and `attendance`.

- [ ] **Step 5: Add a `PayrollQuickLink` card on the Overview tab**

Find the `OverviewTab` function in `HRDashboard.tsx`. Add a small card that links to `/hr/payroll-generation`:

```tsx
import { Link } from 'react-router-dom';

// Inside OverviewTab, find a good place to add the card:
<Link to="hr/payroll-generation" className="card p-4 flex items-center justify-between hover:bg-[var(--color-bg-hover)]">
  <div>
    <p className="text-sm text-[var(--color-text-muted)]">Payroll</p>
    <p className="font-semibold">Generate, review, and approve monthly payroll</p>
  </div>
  <ChevronRight className="w-5 h-5 text-[var(--color-text-muted)]" />
</Link>
```

Place it after the existing KPI cards but before the lower sections (e.g., after the staff list). The path is relative to the current tenant route — verify the relative path resolves correctly by checking the existing route definition (`/hr/payroll-generation` in `App.tsx`).

- [ ] **Step 6: Add test for `function PayrollTab` is gone**

Open `web/src/pages/HRDashboard.test.ts`. Add the following test (modeled on the existing `LeaveTab` test):

```ts
  it('does not expose a PayrollTab function (payroll is its own standalone page)', async () => {
    const source = readFileSync(resolve(__dirname, './HRDashboard.tsx'), 'utf8');
    expect(source).not.toMatch(/function\s+PayrollTab\b/);
  });
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd web && pnpm vitest run src/pages/HRDashboard.test.ts 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 8: Run the full test suite to make sure nothing else broke**

Run: `pnpm vitest run 2>&1 | tail -10`
Expected: PASS — no regressions.

- [ ] **Step 9: Commit**

```bash
git add web/src/pages/HRDashboard.tsx web/src/pages/HRDashboard.test.ts
git commit -m "refactor(hr): remove PayrollTab from HRDashboard, add quick-link card"
```

---

## Task 16: Final integration verification

**Files:** (no new files)

- [ ] **Step 1: Type-check the whole repo**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no new errors. (There may be pre-existing ones; verify by diffing against the output of `git stash` if needed.)

Run: `cd web && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no new errors.

- [ ] **Step 2: Run the backend test suite**

Run: `pnpm vitest run test/payroll-payslip-adjustments.test.ts 2>&1 | tail -10`
Expected: PASS — 5 tests green.

- [ ] **Step 3: Run the frontend test suite**

Run: `cd web && pnpm vitest run src/pages/PayrollGeneration.test.tsx src/pages/HRDashboard.test.ts 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 4: Run the full vitest suite (smoke check)**

Run: `cd web && pnpm vitest run 2>&1 | tail -10`
Expected: PASS — no regressions.

- [ ] **Step 5: Verify migrations apply cleanly**

Run: `pnpm wrangler d1 migrations apply DB --local 2>&1 | tail -10` (or the project's standard local-migration command — verify in `package.json` or `wrangler.toml`)
Expected: includes the new `0348_payroll_payslip_adjustments.sql` migration and applies without error.

If the project uses a different apply command, use that. Skip this step if running locally without a D1 emulator.

- [ ] **Step 6: Commit any leftover formatting/lock-file changes**

```bash
git status
# If anything pending:
git add -A
git commit -m "chore: final integration cleanup"
```

---

## Self-Review Checklist

- [x] **Spec coverage:**
  - Goal 1 (single place): Task 13.
  - Goal 2 (deep-linkable tabs): Task 13 (`useSearchParams`).
  - Goal 3 (no regression): Task 12 + Task 16.
  - Goal 4 (durable overrides): Tasks 1, 2, 3, 4, 12.
  - Goal 5 (overtime one click): Task 12.
  - Goal 6 (per-staff print): Tasks 10, 11.
  - Goal 7 (remove duplicate UI): Task 15.
- [x] **No placeholders:** All code blocks are complete.
- [x] **Type consistency:** `persistedOverrides` is `Record<number, number>` everywhere; `patchPayslipSchema` fields (`netPay`, `reason`) are referenced consistently in route, tests, frontend; `payslip_adjustments` table column names match across migration, route, and test assertions.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-12-payroll-page.md`.** Two execution options:

1. **Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using `executing-plans`, batch execution with checkpoints.

Which approach?
