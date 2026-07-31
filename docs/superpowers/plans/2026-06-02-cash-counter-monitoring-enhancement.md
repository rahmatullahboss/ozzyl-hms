# Cash Counter Monitoring Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance admin cash counter monitoring with real-time status board, denomination-wise counting, X/Z reports, cash drops, operator performance metrics, fraud detection, and automated reconciliation.

**Architecture:** Extend existing `billing_counter_sessions` and `emp_cash_transactions` tables with new fields. Add new API endpoints following existing Hono patterns. Integrate with existing dashboard and counter pages. All changes are backward-compatible.

**Tech Stack:** Hono (API), D1 (SQLite), Zod (validation), React (frontend)

---

## Task 1: Real-time Counter Status Board

**Files:**
- Modify: `src/routes/tenant/dashboard.ts` — add active counters query
- Modify: `web/src/pages/HospitalAdminDashboard.tsx` — add counter status section

- [ ] **Step 1: Add active counters endpoint to dashboard.ts**

```typescript
// Add after existing dashboard routes
dashboardRoutes.get('/active-counters', requireRole(...ADMIN_DASHBOARD_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const counters = await db.$client.prepare(`
    SELECT
      s.id as session_id,
      s.counter_id,
      c.counter_name,
      c.counter_code,
      c.location,
      u.name as operator_name,
      u.id as operator_id,
      s.opening_cash,
      s.opened_at,
      COALESCE(ect.cash_in, 0) as cash_in,
      COALESCE(ect.cash_out, 0) as cash_out,
      COALESCE(ect.transaction_count, 0) as transaction_count
    FROM billing_counter_sessions s
    JOIN billing_counters c ON c.id = s.counter_id AND c.tenant_id = s.tenant_id
    LEFT JOIN users u ON u.id = s.employee_id
    LEFT JOIN (
      SELECT
        counter_session_id,
        SUM(CASE WHEN transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived') THEN amount ELSE 0 END) as cash_in,
        SUM(CASE WHEN transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven') THEN amount ELSE 0 END) as cash_out,
        COUNT(*) as transaction_count
      FROM emp_cash_transactions
      WHERE tenant_id = ?
      GROUP BY counter_session_id
    ) ect ON ect.counter_session_id = s.id
    WHERE s.tenant_id = ? AND s.status = 'active'
    ORDER BY s.opened_at DESC
  `).bind(tenantId, tenantId, tenantId).all();

  return c.json({
    activeCounters: counters.results.map((row: any) => ({
      sessionId: row.session_id,
      counterId: row.counter_id,
      counterName: row.counter_name,
      counterCode: row.counter_code,
      location: row.location,
      operatorName: row.operator_name || 'Unknown',
      operatorId: row.operator_id,
      openingCash: Number(row.opening_cash ?? 0),
      cashIn: Number(row.cash_in ?? 0),
      cashOut: Number(row.cash_out ?? 0),
      expectedCash: Number(row.opening_cash ?? 0) + Number(row.cash_in ?? 0) - Number(row.cash_out ?? 0),
      transactionCount: Number(row.transaction_count ?? 0),
      openedAt: row.opened_at,
    })),
    totalActive: counters.results.length,
  });
});
```

- [ ] **Step 2: Add CounterStatusBoard component to HospitalAdminDashboard.tsx**

```tsx
// Add to imports
import { Monitor, Clock, Banknote, ArrowRightLeft } from 'lucide-react';

// Add interface
interface ActiveCounter {
  sessionId: number;
  counterId: number;
  counterName: string;
  counterCode: string | null;
  location: string | null;
  operatorName: string;
  operatorId: number;
  openingCash: number;
  cashIn: number;
  cashOut: number;
  expectedCash: number;
  transactionCount: number;
  openedAt: string;
}

// Add to DashboardStats interface
activeCounters?: ActiveCounter[];
totalActiveCounters?: number;

// Add API query
const { data: counterStatus } = useApiQuery({
  queryKey: queryKeys.dashboardActiveCounters(tenant),
  queryFn: () => fetch(`/api/dashboard/active-counters`, { headers: { 'x-tenant-id': tenant } }).then(r => r.json()),
  refetchInterval: 30000, // Refresh every 30 seconds
});

// Add UI section after financial summary
{counterStatus && counterStatus.totalActive > 0 && (
  <div className="bg-white rounded-xl border p-4 sm:p-6">
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
        <Monitor className="w-5 h-5 text-green-600" />
        Active Counters ({counterStatus.totalActive})
      </h3>
    </div>
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {counterStatus.activeCounters.map((counter) => (
        <div key={counter.sessionId} className="border rounded-lg p-4 bg-green-50 border-green-200">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-gray-900">{counter.counterName}</span>
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Active</span>
          </div>
          <div className="text-sm text-gray-600 space-y-1">
            <p>Operator: {counter.operatorName}</p>
            <p>Location: {counter.location || 'N/A'}</p>
            <p>Transactions: {counter.transactionCount}</p>
            <p className="font-medium text-gray-900">Expected: ৳{counter.expectedCash.toLocaleString()}</p>
          </div>
          <div className="mt-2 text-xs text-gray-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Opened: {new Date(counter.openedAt).toLocaleTimeString()}
          </div>
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 3: Add query key**

```typescript
// In web/src/lib/queryKeys.ts
dashboardActiveCounters: (tenant: string) => ['dashboard', tenant, 'active-counters'] as const,
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/tenant/dashboard.ts web/src/pages/HospitalAdminDashboard.tsx web/src/lib/queryKeys.ts
git commit -m "feat: add real-time counter status board to admin dashboard"
```

---

## Task 2: Denomination-wise Cash Counting

**Files:**
- Modify: `src/db/schema/schema.ts` — add denomination fields to billing_counter_sessions
- Create: `migrations/0272_counter_denomination_tracking.sql`
- Modify: `src/schemas/billingCounter.ts` — add denomination schemas
- Modify: `src/routes/tenant/billingCounter.ts` — add denomination endpoints
- Modify: `web/src/pages/BillingCounterPage.tsx` — add denomination modal

- [ ] **Step 1: Create migration**

```sql
-- migrations/0272_counter_denomination_tracking.sql
ALTER TABLE billing_counter_sessions ADD COLUMN opening_denominations TEXT;
ALTER TABLE billing_counter_sessions ADD COLUMN closing_denominations TEXT;
ALTER TABLE billing_counter_sessions ADD COLUMN float_amount REAL DEFAULT 0;
ALTER TABLE billing_counter_sessions ADD COLUMN cash_drop_total REAL DEFAULT 0;
```

- [ ] **Step 2: Run migration**

```bash
npx wrangler d1 execute hms-saas-db --local --file=migrations/0272_counter_denomination_tracking.sql
```

- [ ] **Step 3: Add denomination schemas**

```typescript
// Add to src/schemas/billingCounter.ts
export const denominationSchema = z.object({
  note1: z.number().int().min(0).default(0),   // 1 taka
  note2: z.number().int().min(0).default(0),   // 2 taka
  note5: z.number().int().min(0).default(0),   // 5 taka
  note10: z.number().int().min(0).default(0),  // 10 taka
  note20: z.number().int().min(0).default(0),  // 20 taka
  note50: z.number().int().min(0).default(0),  // 50 taka
  note100: z.number().int().min(0).default(0), // 100 taka
  note200: z.number().int().min(0).default(0), // 200 taka
  note500: z.number().int().min(0).default(0), // 500 taka
  note1000: z.number().int().min(0).default(0), // 1000 taka
}).transform((data) => ({
  ...data,
  total: data.note1 * 1 + data.note2 * 2 + data.note5 * 5 + data.note10 * 10 +
         data.note20 * 20 + data.note50 * 50 + data.note100 * 100 + data.note200 * 200 +
         data.note500 * 500 + data.note1000 * 1000,
}));

export const cashDropSchema = z.object({
  amount: z.number().positive(),
  reason: z.string().trim().min(1).max(300),
  denominations: denominationSchema.optional(),
});

// Update billingCounterActivateSchema
export const billingCounterActivateSchema = z.object({
  counterId: z.number().int().positive(),
  openingCash: z.number().min(0).default(0),
  openingDenominations: denominationSchema.optional(),
  remarks: z.string().trim().max(300).optional(),
});

// Update billingCounterCloseSchema
export const billingCounterCloseSchema = z.object({
  closingCash: z.number().min(0),
  closingDenominations: denominationSchema.optional(),
  handoverTo: z.number().int().positive().optional(),
  handoverAmount: z.number().min(0).optional(),
  remarks: z.string().trim().max(300).optional(),
});
```

- [ ] **Step 4: Add cash drop endpoint**

```typescript
// Add to src/routes/tenant/billingCounter.ts
billingCounterRoutes.post('/cash-drop',
  requireRole(...BILLING_COUNTER_ACCESS_ROLES),
  zValidator('json', cashDropSchema),
  async (c) => {
    const db = getDb(c.env.DB);
    const tenantId = requireTenantId(c);
    const userId = requireUserId(c);
    const { amount, reason, denominations } = c.req.valid('json');

    const session = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId);
    if (!session) {
      throw new HTTPException(400, { message: 'No active counter session found' });
    }

    const summary = await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, session.id);
    if (amount > summary.expectedCash) {
      throw new HTTPException(400, { message: 'Cash drop amount exceeds expected cash' });
    }

    // Record cash drop as a manual cash out
    await db.$client.prepare(`
      INSERT INTO cash_drawer_movements (tenant_id, counter_session_id, movement_type, amount, reason, denominations, created_by)
      VALUES (?, ?, 'cash_drop', ?, ?, ?, ?)
    `).bind(tenantId, session.id, amount, reason, denominations ? JSON.stringify(denominations) : null, userId).run();

    // Update session cash drop total
    await db.$client.prepare(`
      UPDATE billing_counter_sessions
      SET cash_drop_total = COALESCE(cash_drop_total, 0) + ?
      WHERE id = ? AND tenant_id = ?
    `).bind(amount, session.id, tenantId).run();

    await createAuditLog(c.env, tenantId, userId, 'CREATE', 'cash_drawer_movements', session.id, null, { type: 'cash_drop', amount, reason });

    return c.json({ success: true, amount, remainingCash: summary.expectedCash - amount });
  }
);
```

- [ ] **Step 5: Add denomination modal to BillingCounterPage.tsx**

```tsx
// Add denomination counting modal component
const DenominationModal = ({ isOpen, onClose, onSave, title, initialDenominations }) => {
  const [denominations, setDenominations] = useState(initialDenominations || {
    note1: 0, note2: 0, note5: 0, note10: 0, note20: 0,
    note50: 0, note100: 0, note200: 0, note500: 0, note1000: 0,
  });

  const total = Object.entries(denominations).reduce((sum, [key, count]) => {
    const value = parseInt(key.replace('note', ''));
    return sum + (Number(count) * value);
  }, 0);

  const handleChange = (note: string, value: string) => {
    setDenominations(prev => ({ ...prev, [note]: parseInt(value) || 0 }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4">
        <h3 className="text-lg font-semibold mb-4">{title}</h3>
        <div className="grid grid-cols-2 gap-3">
          {[
            { key: 'note1', label: '৳1' },
            { key: 'note2', label: '৳2' },
            { key: 'note5', label: '৳5' },
            { key: 'note10', label: '৳10' },
            { key: 'note20', label: '৳20' },
            { key: 'note50', label: '৳50' },
            { key: 'note100', label: '৳100' },
            { key: 'note200', label: '৳200' },
            { key: 'note500', label: '৳500' },
            { key: 'note1000', label: '৳1000' },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-12 text-sm font-medium">{label}</span>
              <input
                type="number"
                min="0"
                value={denominations[key]}
                onChange={(e) => handleChange(key, e.target.value)}
                className="flex-1 border rounded px-2 py-1 text-sm"
              />
              <span className="w-16 text-right text-sm text-gray-600">
                ৳{(Number(denominations[key]) * parseInt(key.replace('note', ''))).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 pt-4 border-t flex justify-between items-center">
          <span className="font-semibold">Total: ৳{total.toLocaleString()}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
            <button onClick={() => onSave(denominations, total)} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Save</button>
          </div>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 6: Commit**

```bash
git add migrations/0272_counter_denomination_tracking.sql src/schemas/billingCounter.ts src/routes/tenant/billingCounter.ts web/src/pages/BillingCounterPage.tsx
git commit -m "feat: add denomination-wise cash counting and cash drop system"
```

---

## Task 3: X Report (Mid-shift Snapshot)

**Files:**
- Modify: `src/routes/tenant/billingCounter.ts` — add X report endpoint
- Modify: `web/src/pages/BillingCounterPage.tsx` — add X report button

- [ ] **Step 1: Add X report endpoint**

```typescript
// Add to src/routes/tenant/billingCounter.ts
billingCounterRoutes.get('/x-report', requireRole(...BILLING_COUNTER_ACCESS_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  const session = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId);
  if (!session) {
    throw new HTTPException(400, { message: 'No active counter session found' });
  }

  const summary = await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, session.id);

  // Get payment method breakdown
  const paymentBreakdown = await db.$client.prepare(`
    SELECT
      COALESCE(payment_method, 'cash') as method,
      COUNT(*) as count,
      SUM(amount) as total
    FROM emp_cash_transactions
    WHERE tenant_id = ? AND counter_session_id = ?
    GROUP BY COALESCE(payment_method, 'cash')
  `).bind(tenantId, session.id).all();

  // Get transaction type breakdown
  const typeBreakdown = await db.$client.prepare(`
    SELECT
      transaction_type,
      COUNT(*) as count,
      SUM(amount) as total
    FROM emp_cash_transactions
    WHERE tenant_id = ? AND counter_session_id = ?
    GROUP BY transaction_type
  `).bind(tenantId, session.id).all();

  // Get bill count
  const billStats = await db.$client.prepare(`
    SELECT
      COUNT(*) as total_bills,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_bills,
      SUM(discount) as total_discount
    FROM bills
    WHERE tenant_id = ? AND counter_session_id = ?
  `).bind(tenantId, session.id).first();

  return c.json({
    report: {
      sessionId: session.id,
      counterName: session.counter_name,
      operatorName: (await db.$client.prepare('SELECT name FROM users WHERE id = ?').bind(userId).first())?.name || 'Unknown',
      openedAt: session.opened_at,
      reportTime: new Date().toISOString(),
      cashSummary: summary,
      paymentBreakdown: paymentBreakdown.results.map((row: any) => ({
        method: row.method,
        count: Number(row.count),
        total: Number(row.total ?? 0),
      })),
      typeBreakdown: typeBreakdown.results.map((row: any) => ({
        type: row.transaction_type,
        count: Number(row.count),
        total: Number(row.total ?? 0),
      })),
      billStats: {
        totalBills: Number(billStats?.total_bills ?? 0),
        cancelledBills: Number(billStats?.cancelled_bills ?? 0),
        totalDiscount: Number(billStats?.total_discount ?? 0),
      },
    },
  });
});
```

- [ ] **Step 2: Add X report button to BillingCounterPage.tsx**

```tsx
// Add X Report button near the counter actions
const handleXReport = async () => {
  try {
    const response = await fetch('/api/billing-counter/x-report');
    const data = await response.json();
    setXReport(data.report);
    setShowXReport(true);
  } catch (error) {
    toast.error('Failed to generate X report');
  }
};

// Add to counter actions section
<button
  onClick={handleXReport}
  className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
>
  <FileText className="w-4 h-4" />
  X Report
</button>
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/billingCounter.ts web/src/pages/BillingCounterPage.tsx
git commit -m "feat: add X report (mid-shift snapshot) for cash counters"
```

---

## Task 4: Opening Float Declaration

**Files:**
- Modify: `src/routes/tenant/billingCounter.ts` — update activate endpoint
- Modify: `web/src/pages/BillingCounterPage.tsx` — add float declaration UI

- [ ] **Step 1: Update counter activate to store denominations**

```typescript
// Update the activate endpoint in billingCounter.ts
// After the existing activate logic, add:
if (body.openingDenominations) {
  await db.$client.prepare(`
    UPDATE billing_counter_sessions
    SET opening_denominations = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(JSON.stringify(body.openingDenominations), sessionId, tenantId).run();
}
```

- [ ] **Step 2: Add float declaration to counter open flow**

```tsx
// In BillingCounterPage.tsx, add denomination modal to counter open flow
const handleOpenCounter = async () => {
  setShowDenominationModal(true);
};

const handleDenominationSave = async (denominations, total) => {
  // Include denominations in counter open request
  const response = await fetch('/api/billing-counter/activate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      counterId: selectedCounter,
      openingCash: total,
      openingDenominations: denominations,
    }),
  });
  // ... handle response
};
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/billingCounter.ts web/src/pages/BillingCounterPage.tsx
git commit -m "feat: add opening float declaration with denomination tracking"
```

---

## Task 5: Operator Performance Metrics

**Files:**
- Modify: `src/routes/tenant/empCash.ts` — add performance summary endpoint
- Modify: `web/src/pages/HospitalAdminDashboard.tsx` — add operator performance section

- [ ] **Step 1: Add operator performance endpoint**

```typescript
// Add to src/routes/tenant/empCash.ts
empCashRoutes.get('/performance', requireRole(...FINANCE_REPORT_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { date, days } = c.req.query();
  const reportDate = date || getTodayGMT6();
  const periodDays = parseInt(days || '30');

  const startDate = new Date(reportDate);
  startDate.setDate(startDate.getDate() - periodDays);
  const startDateStr = startDate.toISOString().split('T')[0];

  const performance = await db.$client.prepare(`
    SELECT
      u.id as employee_id,
      u.name as operator_name,
      COUNT(DISTINCT s.id) as total_shifts,
      SUM(CASE WHEN ect.transaction_type IN ('CashSales', 'CollectionFromReceivable') THEN 1 ELSE 0 END) as sale_count,
      SUM(CASE WHEN ect.transaction_type IN ('CashSales', 'CollectionFromReceivable') THEN ect.amount ELSE 0 END) as total_collected,
      SUM(CASE WHEN ect.transaction_type IN ('SalesReturn', 'ReturnDeposit') THEN 1 ELSE 0 END) as return_count,
      SUM(CASE WHEN ect.transaction_type IN ('SalesReturn', 'ReturnDeposit') THEN ect.amount ELSE 0 END) as total_returned,
      AVG(CASE WHEN ect.transaction_type IN ('CashSales', 'CollectionFromReceivable') THEN ect.amount END) as avg_transaction_value
    FROM users u
    LEFT JOIN billing_counter_sessions s ON s.employee_id = u.id AND s.tenant_id = u.tenant_id
    LEFT JOIN emp_cash_transactions ect ON ect.employee_id = u.id AND ect.tenant_id = u.tenant_id AND date(ect.transaction_date) >= ?
    WHERE u.tenant_id = ?
      AND u.role IN ('reception', 'receptionist', 'accountant')
    GROUP BY u.id, u.name
    HAVING total_shifts > 0
    ORDER BY total_collected DESC
  `).bind(startDateStr, tenantId).all();

  return c.json({
    period: { startDate: startDateStr, endDate: reportDate, days: periodDays },
    operators: performance.results.map((row: any) => ({
      employeeId: row.employee_id,
      operatorName: row.operator_name,
      totalShifts: Number(row.total_shifts),
      saleCount: Number(row.sale_count),
      totalCollected: Number(row.total_collected ?? 0),
      returnCount: Number(row.return_count),
      totalReturned: Number(row.total_returned ?? 0),
      avgTransactionValue: Number(row.avg_transaction_value ?? 0),
      returnRate: Number(row.sale_count) > 0
        ? ((Number(row.return_count) / Number(row.sale_count)) * 100).toFixed(2)
        : '0.00',
      netCollection: Number(row.total_collected ?? 0) - Number(row.total_returned ?? 0),
    })),
  });
});
```

- [ ] **Step 2: Add operator performance section to dashboard**

```tsx
// Add to HospitalAdminDashboard.tsx
const { data: operatorPerf } = useApiQuery({
  queryKey: ['operator-performance', tenant],
  queryFn: () => fetch(`/api/emp-cash/performance?days=30`, { headers: { 'x-tenant-id': tenant } }).then(r => r.json()),
});

// Add UI section
{operatorPerf && operatorPerf.operators.length > 0 && (
  <div className="bg-white rounded-xl border p-4 sm:p-6">
    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
      <UserCheck className="w-5 h-5 text-blue-600" />
      Operator Performance (Last 30 Days)
    </h3>
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left py-2">Operator</th>
            <th className="text-right py-2">Shifts</th>
            <th className="text-right py-2">Sales</th>
            <th className="text-right py-2">Returns</th>
            <th className="text-right py-2">Return Rate</th>
            <th className="text-right py-2">Net Collection</th>
          </tr>
        </thead>
        <tbody>
          {operatorPerf.operators.map((op) => (
            <tr key={op.employeeId} className="border-b">
              <td className="py-2">{op.operatorName}</td>
              <td className="text-right">{op.totalShifts}</td>
              <td className="text-right">৳{op.totalCollected.toLocaleString()}</td>
              <td className="text-right">৳{op.totalReturned.toLocaleString()}</td>
              <td className="text-right">
                <span className={parseFloat(op.returnRate) > 2 ? 'text-red-600' : 'text-green-600'}>
                  {op.returnRate}%
                </span>
              </td>
              <td className="text-right font-medium">৳{op.netCollection.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/empCash.ts web/src/pages/HospitalAdminDashboard.tsx
git commit -m "feat: add operator performance metrics to admin dashboard"
```

---

## Task 6: Fraud Detection Alerts

**Files:**
- Modify: `src/routes/tenant/dashboard.ts` — add fraud detection endpoint
- Modify: `web/src/pages/HospitalAdminDashboard.tsx` — add fraud alerts section

- [ ] **Step 1: Add fraud detection endpoint**

```typescript
// Add to src/routes/tenant/dashboard.ts
dashboardRoutes.get('/fraud-alerts', requireRole(...ADMIN_DASHBOARD_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const today = getTodayGMT6();

  const alerts: Array<{ type: string; severity: string; message: string; details: any }> = [];

  // Check for high void rates
  const highVoids = await db.$client.prepare(`
    SELECT
      u.name as operator_name,
      COUNT(CASE WHEN ect.transaction_type = 'SalesReturn' THEN 1 END) as void_count,
      COUNT(*) as total_transactions,
      ROUND(COUNT(CASE WHEN ect.transaction_type = 'SalesReturn' THEN 1 END) * 100.0 / COUNT(*), 2) as void_rate
    FROM emp_cash_transactions ect
    LEFT JOIN users u ON u.id = ect.employee_id
    WHERE ect.tenant_id = ? AND date(ect.transaction_date) = ?
    GROUP BY ect.employee_id
    HAVING void_rate > 5
  `).bind(tenantId, today).all();

  for (const row of highVoids.results as any[]) {
    alerts.push({
      type: 'HIGH_VOID_RATE',
      severity: 'warning',
      message: `${row.operator_name} has ${row.void_rate}% return rate (${row.void_count}/${row.total_transactions} transactions)`,
      details: row,
    });
  }

  // Check for large individual transactions
  const largeTransactions = await db.$client.prepare(`
    SELECT ect.*, u.name as operator_name
    FROM emp_cash_transactions ect
    LEFT JOIN users u ON u.id = ect.employee_id
    WHERE ect.tenant_id = ? AND date(ect.transaction_date) = ? AND ect.amount > 100000
  `).bind(tenantId, today).all();

  for (const row of largeTransactions.results as any[]) {
    alerts.push({
      type: 'LARGE_TRANSACTION',
      severity: 'info',
      message: `Large transaction: ৳${Number(row.amount).toLocaleString()} by ${row.operator_name} (${row.transaction_type})`,
      details: row,
    });
  }

  // Check for pending handovers older than 24 hours
  const staleHandovers = await db.$client.prepare(`
    SELECT h.*, u.name as handover_by_name
    FROM billing_handovers h
    LEFT JOIN users u ON u.id = h.handover_by
    WHERE h.tenant_id = ? AND h.status = 'pending'
      AND datetime(h.created_at) < datetime('now', '-24 hours')
  `).bind(tenantId).all();

  for (const row of staleHandovers.results as any[]) {
    alerts.push({
      type: 'STALE_HANDOVER',
      severity: 'warning',
      message: `Pending handover from ${row.handover_by_name} for ৳${Number(row.handover_amount).toLocaleString()} is older than 24 hours`,
      details: row,
    });
  }

  // Check for accounting posting backlog
  const pendingPosting = await db.$client.prepare(`
    SELECT COUNT(*) as count FROM accounting_posting_events WHERE tenant_id = ? AND status = 'pending'
  `).bind(tenantId).first();

  if (Number(pendingPosting?.count ?? 0) > 100) {
    alerts.push({
      type: 'ACCOUNTING_BACKLOG',
      severity: 'critical',
      message: `${pendingPosting?.count} pending accounting events — posting backlog detected`,
      details: { pendingCount: pendingPosting?.count },
    });
  }

  return c.json({
    alerts,
    summary: {
      total: alerts.length,
      critical: alerts.filter(a => a.severity === 'critical').length,
      warning: alerts.filter(a => a.severity === 'warning').length,
      info: alerts.filter(a => a.severity === 'info').length,
    },
  });
});
```

- [ ] **Step 2: Add fraud alerts to dashboard UI**

```tsx
// Add to HospitalAdminDashboard.tsx
const { data: fraudAlerts } = useApiQuery({
  queryKey: ['fraud-alerts', tenant],
  queryFn: () => fetch(`/api/dashboard/fraud-alerts`, { headers: { 'x-tenant-id': tenant } }).then(r => r.json()),
  refetchInterval: 60000,
});

// Add UI section
{fraudAlerts && fraudAlerts.alerts.length > 0 && (
  <div className="bg-white rounded-xl border p-4 sm:p-6">
    <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
      <ShieldCheck className="w-5 h-5 text-red-600" />
      Security Alerts ({fraudAlerts.summary.total})
    </h3>
    <div className="space-y-3">
      {fraudAlerts.alerts.map((alert, idx) => (
        <div key={idx} className={`p-3 rounded-lg border-l-4 ${
          alert.severity === 'critical' ? 'bg-red-50 border-red-500' :
          alert.severity === 'warning' ? 'bg-yellow-50 border-yellow-500' :
          'bg-blue-50 border-blue-500'
        }`}>
          <div className="flex items-center gap-2">
            {alert.severity === 'critical' ? <XCircle className="w-4 h-4 text-red-600" /> :
             alert.severity === 'warning' ? <AlertTriangle className="w-4 h-4 text-yellow-600" /> :
             <AlertCircle className="w-4 h-4 text-blue-600" />}
            <span className="text-sm font-medium">{alert.message}</span>
          </div>
        </div>
      ))}
    </div>
  </div>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/dashboard.ts web/src/pages/HospitalAdminDashboard.tsx
git commit -m "feat: add fraud detection alerts to admin dashboard"
```

---

## Task 7: Automated Shift Closing Integration

**Files:**
- Modify: `src/routes/tenant/shift-closing.ts` — auto-calculate from counter sessions
- Modify: `src/routes/tenant/billingCounter.ts` — trigger shift closing on counter close

- [ ] **Step 1: Add auto-calculate endpoint**

```typescript
// Add to src/routes/tenant/shift-closing.ts
shiftClosing.get('/auto-calculate', requireRole(...ADMIN_DASHBOARD_ROLES), async (c) => {
  const db = c.env.DB;
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || getTodayGMT6();

  // Get all counter sessions for the date
  const sessions = await db.prepare(`
    SELECT
      s.id as session_id,
      s.counter_id,
      c.counter_name,
      u.name as operator_name,
      s.opening_cash,
      s.opened_at,
      s.closed_at
    FROM billing_counter_sessions s
    JOIN billing_counters c ON c.id = s.counter_id AND c.tenant_id = s.tenant_id
    LEFT JOIN users u ON u.id = s.employee_id
    WHERE s.tenant_id = ? AND date(s.opened_at) = ?
    ORDER BY s.opened_at
  `).bind(tenantId, date).all();

  // Get payment totals for the date
  const payments = await db.prepare(`
    SELECT COALESCE(payment_method, 'cash') AS method, COALESCE(SUM(amount), 0) AS total
    FROM payments
    WHERE tenant_id = ? AND date(date) = date(?)
    GROUP BY COALESCE(payment_method, 'cash')
  `).bind(tenantId, date).all();

  const expected: Record<string, number> = { cash: 0, bkash: 0, nagad: 0, card: 0, bank: 0 };
  for (const row of payments.results as any[]) {
    const method = (row.method || 'cash').toLowerCase();
    if (method in expected) expected[method] = row.total;
  }

  return c.json({
    date,
    sessions: sessions.results,
    expectedPayments: expected,
  });
});
```

- [ ] **Step 2: Add shift closing trigger on counter close**

```typescript
// In billingCounter.ts, after counter close logic
// Auto-create shift closing record
const shiftClosingData = {
  shiftDate: getTodayGMT6(),
  counterId: session.counter_id,
  startTime: session.opened_at,
  submittedCash: closingCash,
};

// Insert into shift_closings
await db.$client.prepare(`
  INSERT INTO shift_closings (tenant_id, user_id, counter_id, shift_date, start_time, end_time,
   expected_cash, submitted_cash, cash_short_excess, status)
  VALUES (?, ?, ?, ?, ?, datetime('now', '+6 hours'), ?, ?, ?, 'pending')
`).bind(tenantId, userId, session.counter_id, shiftClosingData.shiftDate, session.opened_at,
  summary.expectedCash, closingCash, closingCash - summary.expectedCash).run();
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/tenant/shift-closing.ts src/routes/tenant/billingCounter.ts
git commit -m "feat: add automated shift closing integration with counter sessions"
```

---

## Task 8: Enhanced Cash Book with Reconciliation

**Files:**
- Modify: `src/routes/tenant/cash-book.ts` — add reconciliation endpoint
- Modify: `web/src/pages/CashBankBook.tsx` — add reconciliation UI

- [ ] **Step 1: Add reconciliation endpoint**

```typescript
// Add to src/routes/tenant/cash-book.ts
cashBook.post('/reconcile', requireRole('hospital_admin', 'md', 'director', 'accountant'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = c.env.DB;
  const body = await c.req.json();
  const { date, actualCash, notes } = body;

  if (!date || actualCash === undefined) {
    return c.json({ error: 'Date and actual cash amount are required' }, 400);
  }

  // Get expected cash
  const collections = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM emp_cash_transactions
    WHERE tenant_id = ?
      AND payment_method = 'cash'
      AND transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived')
      AND date(transaction_date) = date(?)
  `).bind(tenantId, date).first();

  const expenses = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM expenses
    WHERE tenant_id = ? AND status = 'approved' AND date(date) = date(?)
  `).bind(tenantId, date).first();

  const refunds = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM emp_cash_transactions
    WHERE tenant_id = ?
      AND payment_method = 'cash'
      AND transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven')
      AND date(transaction_date) = date(?)
  `).bind(tenantId, date).first();

  const expectedCash = Number(collections?.total ?? 0) - Number(expenses?.total ?? 0) - Number(refunds?.total ?? 0);
  const variance = actualCash - expectedCash;

  // Store reconciliation record
  await db.prepare(`
    INSERT INTO cash_reconciliations (tenant_id, reconciliation_date, expected_cash, actual_cash, variance, notes, reconciled_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(tenantId, date, expectedCash, actualCash, variance, notes || null, userId).run();

  await createAuditLog(c.env, tenantId, userId, 'CREATE', 'cash_reconciliations', 0, null, {
    date, expectedCash, actualCash, variance
  });

  return c.json({
    date,
    expectedCash,
    actualCash,
    variance,
    status: variance === 0 ? 'matched' : variance > 0 ? 'overage' : 'shortage',
  });
});

cashBook.get('/reconciliations', requireRole('hospital_admin', 'md', 'director', 'accountant'), async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB;
  const { startDate, endDate } = c.req.query();

  let sql = `SELECT r.*, u.name as reconciled_by_name FROM cash_reconciliations r LEFT JOIN users u ON u.id = r.reconciled_by WHERE r.tenant_id = ?`;
  const params: any[] = [tenantId];

  if (startDate) {
    sql += ` AND r.reconciliation_date >= ?`;
    params.push(startDate);
  }
  if (endDate) {
    sql += ` AND r.reconciliation_date <= ?`;
    params.push(endDate);
  }

  sql += ` ORDER BY r.reconciliation_date DESC LIMIT 100`;

  const results = await db.prepare(sql).bind(...params).all();
  return c.json({ reconciliations: results.results });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/cash-book.ts
git commit -m "feat: add cash reconciliation workflow to cash book"
```

---

## Task 9: Budget vs Actual Tracking

**Files:**
- Create: `migrations/0273_expense_budgets.sql`
- Modify: `src/routes/tenant/expenses.ts` — add budget endpoints
- Modify: `web/src/pages/accounting/ExpenseList.tsx` — add budget UI

- [ ] **Step 1: Create migration**

```sql
-- migrations/0273_expense_budgets.sql
CREATE TABLE IF NOT EXISTS expense_budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  category TEXT NOT NULL,
  monthly_budget REAL NOT NULL DEFAULT 0,
  year_month TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now', '+6 hours')),
  UNIQUE(tenant_id, category, year_month)
);

CREATE INDEX idx_expense_budgets_tenant ON expense_budgets(tenant_id, year_month);
```

- [ ] **Step 2: Run migration**

```bash
npx wrangler d1 execute hms-saas-db --local --file=migrations/0273_expense_budgets.sql
```

- [ ] **Step 3: Add budget endpoints**

```typescript
// Add to src/routes/tenant/expenses.ts
expenseRoutes.get('/budget-status', requireRole(...EXPENSE_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const yearMonth = c.req.query('month') || new Date().toISOString().slice(0, 7);

  const budgets = await db.$client.prepare(`
    SELECT category, monthly_budget FROM expense_budgets
    WHERE tenant_id = ? AND year_month = ?
  `).bind(tenantId, yearMonth).all();

  const actuals = await db.$client.prepare(`
    SELECT category, COALESCE(SUM(amount), 0) as total_spent
    FROM expenses
    WHERE tenant_id = ? AND strftime('%Y-%m', date) = ? AND status = 'approved'
    GROUP BY category
  `).bind(tenantId, yearMonth).all();

  const budgetMap = new Map(budgets.results.map((b: any) => [b.category, Number(b.monthly_budget)]));
  const actualMap = new Map(actuals.results.map((a: any) => [a.category, Number(a.total_spent)]));

  const allCategories = new Set([...budgetMap.keys(), ...actualMap.keys()]);

  return c.json({
    month: yearMonth,
    categories: Array.from(allCategories).map(cat => ({
      category: cat,
      budget: budgetMap.get(cat) || 0,
      actual: actualMap.get(cat) || 0,
      variance: (budgetMap.get(cat) || 0) - (actualMap.get(cat) || 0),
      utilization: budgetMap.get(cat) > 0
        ? ((actualMap.get(cat) || 0) / budgetMap.get(cat) * 100).toFixed(1)
        : 'N/A',
    })),
  });
});

expenseRoutes.post('/budgets', requireRole(...EXPENSE_APPROVAL_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const body = await c.req.json();
  const { category, monthlyBudget, yearMonth } = body;

  if (!category || monthlyBudget === undefined || !yearMonth) {
    return c.json({ error: 'Category, monthlyBudget, and yearMonth are required' }, 400);
  }

  await db.$client.prepare(`
    INSERT INTO expense_budgets (tenant_id, category, monthly_budget, year_month, created_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(tenant_id, category, year_month) DO UPDATE SET monthly_budget = ?
  `).bind(tenantId, category, monthlyBudget, yearMonth, userId, monthlyBudget).run();

  return c.json({ success: true });
});
```

- [ ] **Step 4: Commit**

```bash
git add migrations/0273_expense_budgets.sql src/routes/tenant/expenses.ts
git commit -m "feat: add expense budget vs actual tracking"
```

---

## Task 10: Payment Reminder System

**Files:**
- Modify: `src/routes/tenant/billing.ts` — add reminder endpoint
- Modify: `web/src/pages/BillingDashboard.tsx` — add reminder button

- [ ] **Step 1: Add payment reminder endpoint**

```typescript
// Add to src/routes/tenant/billing.ts
billingRoutes.post('/send-reminder', requireRole('hospital_admin', 'reception', 'accountant'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const body = await c.req.json();
  const { billId, method } = body; // method: 'sms', 'email', 'both'

  const bill = await db.$client.prepare(`
    SELECT b.*, p.name as patient_name, p.phone, p.email
    FROM bills b
    LEFT JOIN patients p ON p.id = b.patient_id
    WHERE b.id = ? AND b.tenant_id = ?
  `).bind(billId, tenantId).first();

  if (!bill) {
    return c.json({ error: 'Bill not found' }, 404);
  }

  const dueAmount = Number(bill.total) - Number(bill.paid);
  if (dueAmount <= 0) {
    return c.json({ error: 'No due amount on this bill' }, 400);
  }

  // Log reminder
  await db.$client.prepare(`
    INSERT INTO payment_reminders (tenant_id, bill_id, patient_id, due_amount, reminder_method, sent_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(tenantId, billId, bill.patient_id, dueAmount, method, userId).run();

  // TODO: Integrate with SMS/Email service
  // For now, just log the reminder

  await createAuditLog(c.env, tenantId, userId, 'CREATE', 'payment_reminders', billId, null, {
    patientName: bill.patient_name,
    dueAmount,
    method,
  });

  return c.json({
    success: true,
    message: `Payment reminder logged for ${bill.patient_name} — ৳${dueAmount.toLocaleString()} due`,
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/billing.ts
git commit -m "feat: add payment reminder system for due bills"
```

---

## Task 11: Automated Handover Triggers

**Files:**
- Modify: `src/routes/tenant/billingCounter.ts` — add threshold check

- [ ] **Step 1: Add threshold check to counter session**

```typescript
// Add to billingCounter.ts - check after each transaction
async function checkCashThreshold(d1: D1Database, tenantId: string, sessionId: number, threshold: number = 50000): Promise<boolean> {
  const summary = await calculateBillingCounterSessionCashSummary(d1, tenantId, sessionId);
  return summary.expectedCash > threshold;
}

// After invoice creation, check threshold
const exceedsThreshold = await checkCashThreshold(c.env.DB, tenantId, session.id);
if (exceedsThreshold) {
  // Add warning to response
  return c.json({
    ...result,
    warning: {
      type: 'CASH_THRESHOLD_EXCEEDED',
      message: `Cash in drawer exceeds ৳50,000. Consider performing a cash drop or handover.`,
      currentCash: summary.expectedCash,
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/tenant/billingCounter.ts
git commit -m "feat: add automated cash threshold alerts for handover triggers"
```

---

## Final Verification

- [ ] Run `npm run typecheck` to verify all TypeScript compiles
- [ ] Run `npm run lint` to check for linting issues
- [ ] Test each feature manually in the UI
- [ ] Verify all migrations run successfully
- [ ] Check dashboard loads with new sections
