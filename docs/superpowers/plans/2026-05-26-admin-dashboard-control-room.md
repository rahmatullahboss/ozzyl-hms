# Admin Dashboard "Control Room" Enhancement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Hospital Admin Dashboard into a true "Control Room" with fraud detection alerts, missing financial cards, and security monitoring — matching the blueprint spec.

**Architecture:** Extend the existing `/api/dashboard/stats` endpoint with 3 new batched queries (today's discount, today's expense, canceled bills today). Add a new `/api/dashboard/security-alerts` endpoint for fraud detection. Frontend adds 2 new KPI cards + a new Security Alerts widget section.

**Tech Stack:** Hono (API), D1 (SQLite), React + Recharts (frontend), existing `useApiQuery` hook pattern

---

## File Structure

### Backend (API)
- Modify: `src/routes/tenant/dashboard.ts` — add 3 new batch queries to `/stats`, add new `/security-alerts` endpoint

### Frontend
- Modify: `web/src/pages/HospitalAdminDashboard.tsx` — add Discount + Expense cards, add Security Alerts section
- Modify: `web/src/hooks/useApiQuery.ts` — (if needed, add new query key)
- Modify: `web/src/lib/queryKeys.ts` — add `securityAlerts` query key

---

## Task 1: Add Today's Discount & Today's Expense to Dashboard API

**Files:**
- Modify: `src/routes/tenant/dashboard.ts:69-261` (batch queries section)

- [ ] **Step 1: Add 2 new batch queries to the existing batch**

In `src/routes/tenant/dashboard.ts`, inside the `db.$client.batch([...])` array (after the existing 27 queries, before the closing `]`), add:

```typescript
      // ── Today's total discount ──
      db.$client.prepare(`
        SELECT COALESCE(SUM(discount), 0) as total_discount
        FROM bills
        WHERE tenant_id = ? AND date(created_at) = ?
          AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      `).bind(tenantId, today),
      // ── Today's total expense ──
      db.$client.prepare(`
        SELECT COALESCE(SUM(amount), 0) as total_expense
        FROM expenses
        WHERE tenant_id = ? AND date = ?
      `).bind(tenantId, today),
```

- [ ] **Step 2: Destructure the new batch results**

In the destructuring of `batchResults` (around line 263), add 2 new variables:

```typescript
      todayDiscountBatch,
      todayExpenseBatch,
```

After the existing destructuring (after `bedStatusBatch`), add:

```typescript
    const todayDiscount = todayDiscountBatch.results[0] as { total_discount: number } | undefined;
    const todayExpense = todayExpenseBatch.results[0] as { total_expense: number } | undefined;
```

- [ ] **Step 3: Add new fields to the JSON response**

In the `todaySummary` object (around line 349), add:

```typescript
        totalDiscount: roundMoney(todayDiscount?.total_discount ?? 0),
```

In the `finance` object (around line 402), add:

```typescript
        todayExpense: roundMoney(todayExpense?.total_expense ?? 0),
```

- [ ] **Step 4: Update TypeScript interfaces**

In `web/src/pages/HospitalAdminDashboard.tsx`, update the `TodaySummary` interface (around line 35):

```typescript
interface TodaySummary {
  // ... existing fields ...
  totalDiscount: number;
}
```

Update the `DashboardFinance` interface (around line 106):

```typescript
interface DashboardFinance {
  // ... existing fields ...
  todayExpense: number;
}
```

Update `EMPTY_DASHBOARD_DATA` (around line 128):

```typescript
  todaySummary: {
    // ... existing fields ...
    totalDiscount: 0,
  },
  finance: {
    // ... existing fields ...
    todayExpense: 0,
  },
```

- [ ] **Step 5: Run typecheck**

```bash
cd /Users/rahmatullahzisan/Desktop/Dev/hms && pnpm typecheck
```

Expected: PASS (no type errors)

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/dashboard.ts web/src/pages/HospitalAdminDashboard.tsx
git commit -m "feat(dashboard): add today's discount and expense to stats API"
```

---

## Task 2: Add Discount & Expense KPI Cards to Dashboard UI

**Files:**
- Modify: `web/src/pages/HospitalAdminDashboard.tsx:273-309` (financeCards section)

- [ ] **Step 1: Add Total Discount card to financeCards array**

In `HospitalAdminDashboard.tsx`, in the `financeCards` array (around line 273), add after the existing cards:

```typescript
    {
      title: t('todayDiscount', { defaultValue: 'Today Discount' }),
      value: formatCurrency(todaySummary.totalDiscount),
      detail: t('discountGiven', { defaultValue: 'Discount given today' }),
      icon: <Tag className="w-4 h-4" />,
      iconBg: 'bg-pink-50 text-pink-700',
    },
    {
      title: t('todayExpense', { defaultValue: 'Today Expense' }),
      value: formatCurrency(finance.todayExpense),
      detail: t('dailyExpense', { defaultValue: 'Daily operational expense' }),
      icon: <TrendingDown className="w-4 h-4" />,
      iconBg: 'bg-orange-50 text-orange-700',
    },
```

- [ ] **Step 2: Import missing icons**

At the top of the file, add to the lucide-react imports:

```typescript
import { Tag, TrendingDown } from 'lucide-react';
```

- [ ] **Step 3: Update grid columns for financeCards**

Change the grid from `xl:grid-cols-5` to `xl:grid-cols-7` (or keep 5 and use 2 rows):

```typescript
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-7 gap-4">
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/HospitalAdminDashboard.tsx
git commit -m "feat(dashboard): add discount and expense KPI cards"
```

---

## Task 3: Create Security Alerts API Endpoint

**Files:**
- Modify: `src/routes/tenant/dashboard.ts` — add new `/security-alerts` route

- [ ] **Step 1: Add the security alerts endpoint**

At the end of `src/routes/tenant/dashboard.ts`, before `export default dashboardRoutes`:

```typescript
// GET /security-alerts — fraud detection & security monitoring
dashboardRoutes.get('/security-alerts', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const today = new Date().toISOString().split('T')[0];

  try {
    const batchResults = await db.$client.batch([
      // Canceled bills today (suspicious activity)
      db.$client.prepare(`
        SELECT b.id, b.invoice_no, b.total, b.discount, b.cancelled_at,
               u.name as cancelled_by_name, b.cancel_reason
        FROM bills b
        LEFT JOIN users u ON b.cancelled_by = u.id
        WHERE b.tenant_id = ? AND date(b.cancelled_at) = ?
        ORDER BY b.cancelled_at DESC
        LIMIT 20
      `).bind(tenantId, today),
      // High discount bills today (> 10% of total)
      db.$client.prepare(`
        SELECT b.id, b.invoice_no, b.total, b.discount,
               CASE WHEN b.total > 0 THEN ROUND((b.discount * 100.0 / b.total), 1) ELSE 0 END as discount_pct,
               u.name as created_by_name, b.created_at
        FROM bills b
        LEFT JOIN users u ON b.created_by = u.id
        WHERE b.tenant_id = ? AND date(b.created_at) = ?
          AND b.discount > 0
          AND b.total > 0
          AND (b.discount * 100.0 / b.total) > 10
          AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
        ORDER BY discount_pct DESC
        LIMIT 20
      `).bind(tenantId, today),
      // Shift handover discrepancies (shortage alerts)
      db.$client.prepare(`
        SELECT h.id, h.counter_name, h.handover_amount, h.received_amount,
               h.variance, h.status, h.created_at,
               u.name as handed_over_by
        FROM billing_handovers h
        LEFT JOIN users u ON h.handed_over_by = u.id
        WHERE h.tenant_id = ? AND date(h.created_at) = ?
          AND h.variance != 0
          AND h.handover_type = 'counter'
        ORDER BY ABS(h.variance) DESC
        LIMIT 20
      `).bind(tenantId, today),
      // Suspicious: bills edited after creation (audit trail)
      db.$client.prepare(`
        SELECT al.id, al.action, al.table_name, al.record_id,
               al.created_at, u.name as user_name,
               al.old_values, al.new_values
        FROM audit_logs al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE al.tenant_id = ? AND date(al.created_at) = ?
          AND al.table_name = 'bills'
          AND al.action IN ('UPDATE', 'DELETE')
        ORDER BY al.created_at DESC
        LIMIT 20
      `).bind(tenantId, today),
    ]);

    const [
      canceledBillsBatch,
      highDiscountBillsBatch,
      handoverDiscrepanciesBatch,
      billEditsBatch,
    ] = batchResults;

    return c.json({
      canceledBills: (canceledBillsBatch.results || []).map((r: any) => ({
        id: r.id,
        invoiceNo: r.invoice_no,
        total: Number(r.total ?? 0),
        discount: Number(r.discount ?? 0),
        cancelledAt: r.cancelled_at,
        cancelledBy: r.cancelled_by_name,
        reason: r.cancel_reason,
      })),
      highDiscountBills: (highDiscountBillsBatch.results || []).map((r: any) => ({
        id: r.id,
        invoiceNo: r.invoice_no,
        total: Number(r.total ?? 0),
        discount: Number(r.discount ?? 0),
        discountPct: Number(r.discount_pct ?? 0),
        createdBy: r.created_by_name,
        createdAt: r.created_at,
      })),
      handoverDiscrepancies: (handoverDiscrepanciesBatch.results || []).map((r: any) => ({
        id: r.id,
        counterName: r.counter_name,
        handoverAmount: Number(r.handover_amount ?? 0),
        receivedAmount: Number(r.received_amount ?? 0),
        variance: Number(r.variance ?? 0),
        status: r.status,
        handedOverBy: r.handed_over_by,
        createdAt: r.created_at,
      })),
      billEdits: (billEditsBatch.results || []).map((r: any) => ({
        id: r.id,
        action: r.action,
        tableName: r.table_name,
        recordId: r.record_id,
        createdAt: r.created_at,
        userName: r.user_name,
        oldValues: r.old_values,
        newValues: r.new_values,
      })),
      summary: {
        canceledCount: (canceledBillsBatch.results || []).length,
        highDiscountCount: (highDiscountBillsBatch.results || []).length,
        discrepancyCount: (handoverDiscrepanciesBatch.results || []).length,
        billEditCount: (billEditsBatch.results || []).length,
      },
    });
  } catch (error) {
    console.error('Security alerts error:', error);
    return c.json({ error: 'Failed to fetch security alerts' }, 500);
  }
});
```

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/dashboard.ts
git commit -m "feat(dashboard): add /security-alerts endpoint for fraud detection"
```

---

## Task 4: Add Security Alerts Widget to Dashboard UI

**Files:**
- Modify: `web/src/pages/HospitalAdminDashboard.tsx` — add Security Alerts section + query key
- Modify: `web/src/lib/queryKeys.ts` — add securityAlerts key

- [ ] **Step 1: Add query key**

In `web/src/lib/queryKeys.ts`, add to the admin section:

```typescript
  securityAlerts: () => ['admin', 'security-alerts'] as const,
```

- [ ] **Step 2: Add SecurityAlerts interface and query**

In `HospitalAdminDashboard.tsx`, after the existing interfaces, add:

```typescript
interface SecurityAlerts {
  canceledBills: Array<{
    id: number;
    invoiceNo: string;
    total: number;
    discount: number;
    cancelledAt: string;
    cancelledBy: string;
    reason: string;
  }>;
  highDiscountBills: Array<{
    id: number;
    invoiceNo: string;
    total: number;
    discount: number;
    discountPct: number;
    createdBy: string;
    createdAt: string;
  }>;
  handoverDiscrepancies: Array<{
    id: number;
    counterName: string;
    handoverAmount: number;
    receivedAmount: number;
    variance: number;
    status: string;
    handedOverBy: string;
    createdAt: string;
  }>;
  billEdits: Array<{
    id: number;
    action: string;
    tableName: string;
    recordId: number;
    createdAt: string;
    userName: string;
  }>;
  summary: {
    canceledCount: number;
    highDiscountCount: number;
    discrepancyCount: number;
    billEditCount: number;
  };
}
```

- [ ] **Step 3: Add the security alerts query**

After the existing `useApiQuery` call, add:

```typescript
  const { data: securityAlerts } = useApiQuery<SecurityAlerts>(
    queryKeys.admin.securityAlerts(),
    '/api/dashboard/security-alerts',
  );
```

- [ ] **Step 4: Add Security Alerts UI section**

Before the Recent Activity section (around line 713), add:

```typescript
        {/* ══════════════════════════════════════════════════════════ */}
        {/* ── SECURITY ALERTS (Fraud Detection) ─────────────────── */}
        {/* ══════════════════════════════════════════════════════════ */}
        {(securityAlerts?.summary?.canceledCount ?? 0) > 0 ||
         (securityAlerts?.summary?.highDiscountCount ?? 0) > 0 ||
         (securityAlerts?.summary?.discrepancyCount ?? 0) > 0 ? (
          <div className="card overflow-hidden border-2 border-red-200">
            <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-red-100 bg-red-50">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <h3 className="section-title text-red-800">
                  {t('securityAlerts', { defaultValue: 'Security Alerts' })}
                </h3>
              </div>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-red-100 text-red-700">
                {(securityAlerts?.summary?.canceledCount ?? 0) +
                 (securityAlerts?.summary?.highDiscountCount ?? 0) +
                 (securityAlerts?.summary?.discrepancyCount ?? 0)}
              </span>
            </div>

            <div className="p-4 space-y-4">
              {/* Canceled Bills */}
              {(securityAlerts?.canceledBills?.length ?? 0) > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-red-700 mb-2 flex items-center gap-1.5">
                    <XCircle className="w-4 h-4" />
                    {t('canceledBillsToday', { defaultValue: 'Canceled Bills Today' })} ({securityAlerts?.canceledBills?.length})
                  </h4>
                  <div className="space-y-2">
                    {securityAlerts?.canceledBills?.slice(0, 5).map((bill) => (
                      <div key={bill.id} className="flex items-center justify-between p-2 bg-red-50 rounded-lg text-sm">
                        <div>
                          <span className="font-medium text-red-800">{bill.invoiceNo}</span>
                          <span className="text-red-600 ml-2">— {bill.cancelledBy}</span>
                          {bill.reason && <span className="text-red-500 ml-1">({bill.reason})</span>}
                        </div>
                        <span className="font-data font-bold text-red-700">{formatCurrency(bill.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* High Discount Bills */}
              {(securityAlerts?.highDiscountBills?.length ?? 0) > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4" />
                    {t('highDiscountAlert', { defaultValue: 'High Discount (>10%)' })} ({securityAlerts?.highDiscountBills?.length})
                  </h4>
                  <div className="space-y-2">
                    {securityAlerts?.highDiscountBills?.slice(0, 5).map((bill) => (
                      <div key={bill.id} className="flex items-center justify-between p-2 bg-amber-50 rounded-lg text-sm">
                        <div>
                          <span className="font-medium text-amber-800">{bill.invoiceNo}</span>
                          <span className="text-amber-600 ml-2">by {bill.createdBy}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-data font-bold text-amber-700">{bill.discountPct}%</span>
                          <span className="text-amber-500 ml-1">({formatCurrency(bill.discount)})</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Handover Discrepancies */}
              {(securityAlerts?.handoverDiscrepancies?.length ?? 0) > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-orange-700 mb-2 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4" />
                    {t('handoverDiscrepancy', { defaultValue: 'Handover Discrepancy' })} ({securityAlerts?.handoverDiscrepancies?.length})
                  </h4>
                  <div className="space-y-2">
                    {securityAlerts?.handoverDiscrepancies?.slice(0, 5).map((h) => (
                      <div key={h.id} className="flex items-center justify-between p-2 bg-orange-50 rounded-lg text-sm">
                        <div>
                          <span className="font-medium text-orange-800">{h.counterName}</span>
                          <span className="text-orange-600 ml-2">by {h.handedOverBy}</span>
                        </div>
                        <span className={`font-data font-bold ${h.variance < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                          {h.variance < 0 ? '▼' : '▲'} {formatCurrency(Math.abs(h.variance))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}
```

- [ ] **Step 5: Import AlertTriangle and XCircle icons**

Add to the lucide-react imports at the top:

```typescript
import { AlertTriangle, XCircle } from 'lucide-react';
```

- [ ] **Step 6: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add web/src/pages/HospitalAdminDashboard.tsx web/src/lib/queryKeys.ts
git commit -m "feat(dashboard): add Security Alerts widget with fraud detection"
```

---

## Task 5: Add Department-wise Revenue Donut Chart

**Files:**
- Modify: `src/routes/tenant/dashboard.ts` — add department revenue query to `/stats`
- Modify: `web/src/pages/HospitalAdminDashboard.tsx` — add donut chart

- [ ] **Step 1: Add department revenue query to dashboard stats**

In `src/routes/tenant/dashboard.ts`, add to the batch array:

```typescript
      // ── Department-wise revenue today ──
      db.$client.prepare(`
        SELECT
          COALESCE(item_category, 'other') as department,
          COALESCE(SUM(line_total), 0) as total
        FROM bill_items
        WHERE tenant_id = ? AND date(created_at) = ?
          AND bill_id IN (
            SELECT id FROM bills WHERE tenant_id = ? AND date(created_at) = ?
              AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
          )
        GROUP BY item_category
        ORDER BY total DESC
      `).bind(tenantId, today, tenantId, today),
```

- [ ] **Step 2: Destructure and format the result**

Add to destructuring:

```typescript
      departmentRevenueBatch,
```

Format the result:

```typescript
    const departmentRevenue = (departmentRevenueBatch.results || []) as { department: string; total: number }[];
```

Add to the JSON response:

```typescript
      departmentRevenue: departmentRevenue.map((d) => ({
        name: d.department === 'test' ? 'Lab' :
              d.department === 'doctor_visit' ? 'OPD' :
              d.department === 'medicine' ? 'Pharmacy' :
              d.department === 'admission' ? 'IPD' :
              d.department === 'operation' ? 'OT' :
              d.department,
        value: roundMoney(d.total),
      })),
```

- [ ] **Step 3: Add donut chart to frontend**

In `HospitalAdminDashboard.tsx`, add to imports:

```typescript
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
```

Add the interface:

```typescript
interface DepartmentRevenue {
  name: string;
  value: number;
}
```

Add to the response interface and empty data.

Before the charts section (around line 655), add:

```typescript
        {/* ── Department Revenue Donut ── */}
        <div className="card p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4 sm:mb-5">
            <h3 className="section-title">{t('departmentRevenue', { defaultValue: 'Department Revenue' })}</h3>
            <span className="section-subtitle">{t('today', { defaultValue: 'Today' })}</span>
          </div>
          <SafeChartFrame className="h-56">
            <ResponsiveContainer width="100%" height="100%" minHeight={0} minWidth={0}>
              <PieChart>
                <Pie
                  data={data?.departmentRevenue ?? []}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {(data?.departmentRevenue ?? []).map((_, index) => (
                    <Cell key={`cell-${index}`} fill={['#059669', '#2563eb', '#d97706', '#7c3aed', '#dc2626'][index % 5]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => [`৳${(Number(v) ?? 0).toLocaleString()}`, 'Revenue']} />
              </PieChart>
            </ResponsiveContainer>
          </SafeChartFrame>
        </div>
```

- [ ] **Step 4: Run typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/dashboard.ts web/src/pages/HospitalAdminDashboard.tsx
git commit -m "feat(dashboard): add department-wise revenue donut chart"
```

---

## Task 6: Final Integration Test

- [ ] **Step 1: Run full typecheck**

```bash
pnpm typecheck
```

Expected: PASS

- [ ] **Step 2: Run lint**

```bash
pnpm lint
```

Expected: PASS (or only pre-existing warnings)

- [ ] **Step 3: Build**

```bash
pnpm build
```

Expected: PASS

- [ ] **Step 4: Deploy to staging and verify**

```bash
pnpm build && wrangler deploy --env staging
```

Verify:
1. Dashboard loads without errors
2. Today's Discount card shows correct amount
3. Today's Expense card shows correct amount
4. Department Revenue donut chart renders
5. Security Alerts section appears when there are alerts
6. Security Alerts shows canceled bills, high discount bills, handover discrepancies

- [ ] **Step 5: Final commit**

```bash
git add -A && git commit -m "feat: admin dashboard control room - fraud detection & financial cards"
```

---

## Summary

| Task | Feature | Impact |
|------|---------|--------|
| 1 | Today's Discount & Expense API | Backend data |
| 2 | Discount & Expense KPI Cards | Frontend display |
| 3 | Security Alerts API | Fraud detection backend |
| 4 | Security Alerts Widget | Fraud detection UI |
| 5 | Department Revenue Donut | Analytics chart |
| 6 | Integration Test | Quality gate |
