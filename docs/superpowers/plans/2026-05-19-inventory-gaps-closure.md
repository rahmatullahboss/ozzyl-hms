# Inventory Module Gaps Closure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the top priority gaps in the inventory module — missing Adjustment Request frontend, missing edge-case tests, and RBAC permission tests — using strict TDD.

**Architecture:** Cloudflare Workers + Hono + D1. Frontend: React + React Query + Tailwind. Tests: Vitest integration tests with mock DB. All new code follows existing patterns in the branch.

**Tech Stack:** Hono, D1 (SQLite), React, Vitest, Zod, React Query

---

## File Structure

### New Files to Create

| File | Responsibility |
|---|---|
| `web/src/pages/inventory/InventoryAdjustmentRequestPage.tsx` | Adjustment request list + create form |
| `test/integration/routes/inventory/inventory-adjustment-requests.test.ts` | Adjustment request backend tests |
| `test/integration/routes/inventory/inventory-rbac-permissions.test.ts` | RBAC permission enforcement tests |
| `test/integration/routes/inventory/inventory-issues-edge-cases.test.ts` | Issue/consumption edge case tests |
| `test/integration/routes/inventory/inventory-reports-edge-cases.test.ts` | Report edge case tests |

### Files to Modify

| File | Change |
|---|---|
| `web/src/App.tsx` | Add route for `/inventory/adjustment-requests` |

---

## Task 1: Adjustment Request Backend — Edge Case Tests

**Files:**
- Create: `test/integration/routes/inventory/inventory-adjustment-requests.test.ts`

- [ ] **Step 1: Write failing test for adjustment request creation with stock lookup**

```typescript
import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — adjustment requests', () => {
  it('creates an adjustment request and records current vs new quantity', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 12,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StoreId = ?') && sql.includes('ItemId = ?')) {
          return {
            first: {
              StockId: 42,
              ItemId: 10,
              StoreId: 1,
              AvailableQuantity: 50,
              BatchNo: 'BATCH-A',
              IsActive: 1,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/adjustment-requests', {
      method: 'POST',
      body: {
        StoreId: 1,
        Reason: 'Physical count discrepancy',
        Items: [
          { ItemId: 10, StockId: 42, NewQuantity: 45, Remarks: 'Found 5 damaged' },
        ],
      },
    });

    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.AdjustmentNo).toMatch(/^ADJ-/);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryAdjustmentRequest'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('INSERT INTO InventoryAdjustmentRequestItem'))).toBe(true);
    expect(mockDB.queries.some(q => q.sql.includes('stock_adjustment_requested'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/routes/inventory/inventory-adjustment-requests.test.ts`
Expected: FAIL — route not found or missing table references

- [ ] **Step 3: Verify the test structure matches existing patterns (no code changes needed — the backend already exists)**

The backend `adjustmentRequests.ts` already implements all CRUD. The test just needs to exercise it. Verify the test app setup matches the pattern from `inventory-transfers.test.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/integration/routes/inventory/inventory-adjustment-requests.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for approval posting stock changes**

```typescript
it('approval updates stock and writes adjustment ledger entries', async () => {
  const { app, mockDB } = createTestApp({
    route: inventoryRoute,
    routePath: '/inventory',
    role: 'hospital_admin',
    tenantId: 'tenant-1',
    userId: 12,
    queryOverride: (sql) => {
      if (sql.includes('FROM InventoryAdjustmentRequest WHERE') && sql.includes('AdjustmentRequestId = ?')) {
        return {
          first: {
            AdjustmentRequestId: 1,
            AdjustmentNo: 'ADJ-1',
            StoreId: 1,
            Status: 'submitted',
            Reason: 'Count discrepancy',
          },
        };
      }
      if (sql.includes('FROM InventoryAdjustmentRequestItem WHERE')) {
        return {
          results: [
            { AdjustmentRequestItemId: 1, AdjustmentRequestId: 1, ItemId: 10, StockId: 42, BatchNo: 'BATCH-A', CurrentQuantity: 50, NewQuantity: 45 },
          ],
        };
      }
      if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
        return {
          first: {
            StockId: 42,
            ItemId: 10,
            StoreId: 1,
            AvailableQuantity: 50,
            BatchNo: 'BATCH-A',
          },
        };
      }
      return null;
    },
  });

  const res = await jsonRequest(app, '/inventory/adjustment-requests/1/approve', {
    method: 'POST',
    body: { Remarks: 'Verified by supervisor' },
  });

  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.Status).toBe('posted');
  expect(mockDB.queries.some(q => q.sql.includes('UPDATE InventoryStock SET AvailableQuantity'))).toBe(true);
  expect(mockDB.queries.some(q => q.sql.includes('adjustment_minus'))).toBe(true);
  expect(mockDB.queries.some(q => q.sql.includes("Status = 'posted'"))).toBe(true);
});
```

- [ ] **Step 6: Run test — should pass (backend already implements this)**

Run: `npx vitest run test/integration/routes/inventory/inventory-adjustment-requests.test.ts`

- [ ] **Step 7: Write failing test for rejection flow**

```typescript
it('rejection marks request as rejected without changing stock', async () => {
  const { app, mockDB } = createTestApp({
    route: inventoryRoute,
    routePath: '/inventory',
    role: 'hospital_admin',
    tenantId: 'tenant-1',
    userId: 12,
    queryOverride: (sql) => {
      if (sql.includes('FROM InventoryAdjustmentRequest WHERE')) {
        return { first: { AdjustmentRequestId: 2, Status: 'submitted', StoreId: 1 } };
      }
      return null;
    },
  });

  const res = await jsonRequest(app, '/inventory/adjustment-requests/2/reject', {
    method: 'POST',
    body: { Remarks: 'Insufficient evidence' },
  });

  expect(res.status).toBe(200);
  const body = await res.json() as any;
  expect(body.Status).toBe('rejected');
  expect(mockDB.queries.some(q => q.sql.includes("Status = 'rejected'"))).toBe(true);
  expect(mockDB.queries.some(q => q.sql.includes('UPDATE InventoryStock'))).toBe(false);
});
```

- [ ] **Step 8: Run all adjustment request tests**

Run: `npx vitest run test/integration/routes/inventory/inventory-adjustment-requests.test.ts`
Expected: All 3 PASS

- [ ] **Step 9: Commit**

```bash
git add test/integration/routes/inventory/inventory-adjustment-requests.test.ts
git commit -m "test: add adjustment request create/approve/reject integration tests"
```

---

## Task 2: RBAC Permission Enforcement Tests

**Files:**
- Create: `test/integration/routes/inventory/inventory-rbac-permissions.test.ts`

- [ ] **Step 1: Write failing test — non-admin blocked from approving adjustments**

```typescript
import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — RBAC permission enforcement', () => {
  it('blocks user without inventory:approve from approving adjustment requests', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'receptionist',
      tenantId: 'tenant-1',
      userId: 99,
    });

    const res = await jsonRequest(app, '/inventory/adjustment-requests/1/approve', {
      method: 'POST',
      body: { Remarks: 'test' },
    });

    expect(res.status).toBe(403);
  });

  it('blocks user without inventory:transfer from sending transfers', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'receptionist',
      tenantId: 'tenant-1',
      userId: 99,
    });

    const res = await jsonRequest(app, '/inventory/transfers/1/send', {
      method: 'POST',
      body: {},
    });

    expect(res.status).toBe(403);
  });

  it('blocks user without inventory:consume from creating issues', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'receptionist',
      tenantId: 'tenant-1',
      userId: 99,
    });

    const res = await jsonRequest(app, '/inventory/issues', {
      method: 'POST',
      body: {
        IssueType: 'department_issue',
        FromStoreId: 1,
        Department: 'Lab',
        Items: [{ ItemId: 1, Quantity: 1 }],
      },
    });

    expect(res.status).toBe(403);
  });

  it('allows hospital_admin full access to all inventory operations', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 1, ItemId: 1, StoreId: 1, AvailableQuantity: 100,
              BatchNo: 'B1', ExpiryDate: '2027-12-31', CostPrice: 10, MRP: 15, IsActive: 1,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/transfers', {
      method: 'POST',
      body: {
        FromStoreId: 1, ToStoreId: 2,
        Items: [{ ItemId: 1, StockId: 1, Quantity: 5 }],
      },
    });

    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/routes/inventory/inventory-rbac-permissions.test.ts`
Expected: FAIL — the RBAC middleware may not be blocking `receptionist` role

- [ ] **Step 3: Check if requirePermission middleware is actually enforced in index.ts**

Read `src/routes/tenant/inventory/index.ts` and verify the permission middleware is applied to the routes. If it's not blocking, the test correctly identifies the gap.

- [ ] **Step 4: If middleware is missing, implement minimal RBAC enforcement**

Add permission check middleware to `index.ts` that returns 403 for unauthorized roles on protected paths.

- [ ] **Step 5: Run RBAC tests**

Run: `npx vitest run test/integration/routes/inventory/inventory-rbac-permissions.test.ts`
Expected: All 4 PASS

- [ ] **Step 6: Commit**

```bash
git add test/integration/routes/inventory/inventory-rbac-permissions.test.ts
git commit -m "test: add RBAC permission enforcement tests for inventory module"
```

---

## Task 3: Issue/Consumption Edge Case Tests

**Files:**
- Create: `test/integration/routes/inventory/inventory-issues-edge-cases.test.ts`

- [ ] **Step 1: Write failing test for expired stock rejection**

```typescript
import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — issue edge cases', () => {
  it('rejects issuing expired stock', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 10, ItemId: 5, StoreId: 1, AvailableQuantity: 20,
              BatchNo: 'EXP-2024', ExpiryDate: '2024-06-01', CostPrice: 10, MRP: 15, IsActive: 1,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/issues', {
      method: 'POST',
      body: {
        IssueType: 'department_issue',
        FromStoreId: 1,
        Department: 'Lab',
        Items: [{ ItemId: 5, StockId: 10, Quantity: 2 }],
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('expired');
  });

  it('rejects issuing more than available quantity', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 10, ItemId: 5, StoreId: 1, AvailableQuantity: 3,
              BatchNo: 'B1', ExpiryDate: '2027-12-31', CostPrice: 10, MRP: 15, IsActive: 1,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/issues', {
      method: 'POST',
      body: {
        IssueType: 'department_issue',
        FromStoreId: 1,
        Department: 'Lab',
        Items: [{ ItemId: 5, StockId: 10, Quantity: 10 }],
      },
    });

    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error).toContain('insufficient');
  });

  it('rejects cross-store stock access', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      queryOverride: (sql) => {
        if (sql.includes('FROM InventoryStock') && sql.includes('StockId = ?')) {
          return {
            first: {
              StockId: 10, ItemId: 5, StoreId: 2, AvailableQuantity: 20,
              BatchNo: 'B1', ExpiryDate: '2027-12-31', CostPrice: 10, MRP: 15, IsActive: 1,
            },
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/issues', {
      method: 'POST',
      body: {
        IssueType: 'department_issue',
        FromStoreId: 1,
        Department: 'Lab',
        Items: [{ ItemId: 5, StockId: 10, Quantity: 2 }],
      },
    });

    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify behavior**

Run: `npx vitest run test/integration/routes/inventory/inventory-issues-edge-cases.test.ts`

- [ ] **Step 3: If tests fail because validation is missing in issues.ts, add minimal validation**

Check if `issues.ts` validates:
1. Expiry date before issuing
2. AvailableQuantity >= requested quantity
3. Stock belongs to the correct store

If not, add the validation guards.

- [ ] **Step 4: Run tests again — all should pass**

- [ ] **Step 5: Commit**

```bash
git add test/integration/routes/inventory/inventory-issues-edge-cases.test.ts
git commit -m "test: add issue edge case tests (expired, insufficient, cross-store)"
```

---

## Task 4: Report Edge Case Tests

**Files:**
- Create: `test/integration/routes/inventory/inventory-reports-edge-cases.test.ts`

- [ ] **Step 1: Write failing test for invalid report type rejection**

```typescript
import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp, jsonRequest } from '../../helpers/test-app';

describe('Inventory — report edge cases', () => {
  it('rejects invalid report type with 400', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
    });

    const res = await jsonRequest(app, '/inventory/reports/nonexistent_report');
    expect(res.status).toBe(400);
  });

  it('returns CSV with correct headers for current_stock report', async () => {
    const { app, mockDB } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
      queryOverride: (sql) => {
        if (sql.includes('InventoryStock') && sql.includes('JOIN')) {
          return {
            results: [
              { StockId: 1, ItemName: 'Gloves', StoreName: 'Main', AvailableQuantity: 100, BatchNo: 'B1', CostPrice: 5 },
            ],
          };
        }
        return null;
      },
    });

    const res = await jsonRequest(app, '/inventory/reports/current_stock?format=csv');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('enforces max limit of 5000 rows', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      userId: 1,
    });

    const res = await jsonRequest(app, '/inventory/reports/current_stock?limit=9999');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.meta?.limit ?? body.limit ?? 5000).toBeLessThanOrEqual(5000);
  });
});
```

- [ ] **Step 2: Run test**

Run: `npx vitest run test/integration/routes/inventory/inventory-reports-edge-cases.test.ts`

- [ ] **Step 3: Fix any missing validation in reports.ts if tests fail**

- [ ] **Step 4: Run tests — all should pass**

- [ ] **Step 5: Commit**

```bash
git add test/integration/routes/inventory/inventory-reports-edge-cases.test.ts
git commit -m "test: add report edge case tests (invalid type, CSV headers, limit enforcement)"
```

---

## Task 5: Adjustment Request Frontend Page

**Files:**
- Create: `web/src/pages/inventory/InventoryAdjustmentRequestPage.tsx`
- Modify: `web/src/App.tsx` (add route)

- [ ] **Step 1: Write the frontend component following existing patterns**

Reference: `InventoryTransferPage.tsx` for the pattern (stores query, stock query, form, table).

```tsx
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ClipboardCheck, ClipboardX, FileText, Plus, Send, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface Store { StoreId: number; StoreName: string; }
interface StockRow { StockId: number; ItemId: number; ItemName: string; StoreId: number; BatchNo?: string; AvailableQuantity: number; }
interface AdjustmentItem { ItemId: number; StockId: number; BatchNo: string; CurrentQuantity: number; NewQuantity: number; Remarks: string; }
interface AdjustmentRequest { AdjustmentRequestId: number; AdjustmentNo: string; StoreName?: string; Status: string; Reason: string; CreatedOn?: string; }

export default function InventoryAdjustmentRequestPage({ role = 'hospital_admin' }: { role?: string }) {
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ StoreId: '', Reason: '', Remarks: '' });
  const [items, setItems] = useState<AdjustmentItem[]>([{ ItemId: 0, StockId: 0, BatchNo: '', CurrentQuantity: 0, NewQuantity: 0, Remarks: '' }]);

  const { data: storesData } = useApiQuery<{ data: Store[] }>(queryKeys.inventory.stores(), '/api/inventory/stores?page=1&limit=100');
  const { data: stockData } = useApiQuery<{ data: StockRow[] }>(['inventory', 'adj-stock', form.StoreId], `/api/inventory/stock/overview?limit=300${form.StoreId ? `&StoreId=${form.StoreId}` : ''}`);
  const { data: requestsData } = useApiQuery<{ data: AdjustmentRequest[] }>(['inventory', 'adjustment-requests'], '/api/inventory/adjustment-requests?page=1&limit=20');
  const stores = storesData?.data ?? [];
  const stocks = stockData?.data ?? [];
  const requests = requestsData?.data ?? [];

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['inventory', 'adjustment-requests'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.inventory.stock() });
  };

  const createRequest = useApiMutation<any, any>('post', '/api/inventory/adjustment-requests', {
    onSuccess: () => { toast.success('Adjustment request submitted'); invalidate(); },
    onError: err => toast.error(err.message),
  });
  const approveRequest = useApiMutation<any, { id: number }>('post', vars => `/api/inventory/adjustment-requests/${vars.id}/approve`, {
    onSuccess: () => { toast.success('Approved and posted'); invalidate(); },
    onError: err => toast.error(err.message),
  });
  const rejectRequest = useApiMutation<any, { id: number }>('post', vars => `/api/inventory/adjustment-requests/${vars.id}/reject`, {
    onSuccess: () => { toast.success('Rejected'); invalidate(); },
    onError: err => toast.error(err.message),
  });

  const selectStock = (idx: number, stockId: number) => {
    const stock = stocks.find(s => s.StockId === stockId);
    setItems(prev => prev.map((item, i) => i === idx ? {
      ...item,
      StockId: stockId,
      ItemId: Number(stock?.ItemId || 0),
      BatchNo: stock?.BatchNo || '',
      CurrentQuantity: stock?.AvailableQuantity || 0,
    } : item));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.StoreId || !form.Reason || items.some(i => !i.ItemId || i.NewQuantity < 0)) {
      toast.error('Fill required fields');
      return;
    }
    createRequest.mutate({
      StoreId: Number(form.StoreId),
      Reason: form.Reason,
      Remarks: form.Remarks || undefined,
      Items: items.map(i => ({
        ItemId: i.ItemId,
        StockId: i.StockId || undefined,
        BatchNo: i.BatchNo || undefined,
        NewQuantity: i.NewQuantity,
        Remarks: i.Remarks || undefined,
      })),
    });
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title"><ClipboardCheck className="w-6 h-6 inline mr-2" />Adjustment Requests</h1>
            <p className="section-subtitle">Request stock adjustments with approval workflow</p>
          </div>
          <Link to={`${base}/inventory/stock`} className="btn-secondary text-sm">Stock overview</Link>
        </div>

        <form onSubmit={submit} className="space-y-5">
          <div className="card p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="label">Store *</label>
              <select className="input" required value={form.StoreId} onChange={e => setForm({ ...form, StoreId: e.target.value })}>
                <option value="">Select store</option>
                {stores.map(s => <option key={s.StoreId} value={s.StoreId}>{s.StoreName}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Reason *</label>
              <input className="input" required value={form.Reason} onChange={e => setForm({ ...form, Reason: e.target.value })} placeholder="e.g. Physical count discrepancy" />
            </div>
            <div>
              <label className="label">Remarks</label>
              <input className="input" value={form.Remarks} onChange={e => setForm({ ...form, Remarks: e.target.value })} />
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex justify-between items-center">
              <h3 className="font-semibold">Adjustment items</h3>
              <button type="button" className="btn-secondary text-sm" onClick={() => setItems(prev => [...prev, { ItemId: 0, StockId: 0, BatchNo: '', CurrentQuantity: 0, NewQuantity: 0, Remarks: '' }])}>
                <Plus className="w-4 h-4" /> Add
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr><th>Stock *</th><th>Batch</th><th>Current Qty</th><th>New Qty *</th><th>Remarks</th><th></th></tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => {
                    const stock = stocks.find(s => s.StockId === item.StockId);
                    return (
                      <tr key={idx}>
                        <td>
                          <select className="input min-w-64" value={item.StockId} onChange={e => selectStock(idx, Number(e.target.value))}>
                            <option value="">Select stock</option>
                            {stocks.map(s => <option key={s.StockId} value={s.StockId}>{s.ItemName} · {s.BatchNo || 'No batch'} · Qty: {s.AvailableQuantity}</option>)}
                          </select>
                        </td>
                        <td>{item.BatchNo || '—'}</td>
                        <td className="font-data">{stock?.AvailableQuantity ?? item.CurrentQuantity ?? '—'}</td>
                        <td><input className="input w-20" type="number" min="0" value={item.NewQuantity} onChange={e => setItems(prev => prev.map((r, i) => i === idx ? { ...r, NewQuantity: Number(e.target.value) || 0 } : r))} /></td>
                        <td><input className="input w-44" value={item.Remarks} onChange={e => setItems(prev => prev.map((r, i) => i === idx ? { ...r, Remarks: e.target.value } : r))} /></td>
                        <td>{items.length > 1 && <button type="button" className="btn-ghost p-1 text-red-500" onClick={() => setItems(prev => prev.filter((_, i) => i !== idx))}><Trash2 className="w-4 h-4" /></button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end">
            <button className="btn-primary" disabled={createRequest.isPending}>
              <Send className="w-4 h-4" /> {createRequest.isPending ? 'Submitting...' : 'Submit adjustment request'}
            </button>
          </div>
        </form>

        <div className="card overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)]">
            <h3 className="font-semibold">Adjustment requests</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>No</th><th>Date</th><th>Store</th><th>Reason</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-[var(--color-text-muted)]">No adjustment requests</td></tr>
                ) : requests.map(req => (
                  <tr key={req.AdjustmentRequestId}>
                    <td className="font-medium">{req.AdjustmentNo}</td>
                    <td>{req.CreatedOn?.slice(0, 10) || '—'}</td>
                    <td>{req.StoreName || '—'}</td>
                    <td>{req.Reason}</td>
                    <td><span className={`badge ${req.Status === 'posted' ? 'badge-success' : req.Status === 'rejected' ? 'badge-destructive' : 'badge-secondary'}`}>{req.Status}</span></td>
                    <td className="flex gap-2">
                      {req.Status === 'submitted' && (
                        <>
                          <button className="btn-secondary text-xs" onClick={() => approveRequest.mutate({ id: req.AdjustmentRequestId })}>
                            <ClipboardCheck className="w-3 h-3" /> Approve
                          </button>
                          <button className="btn-secondary text-xs text-red-500" onClick={() => rejectRequest.mutate({ id: req.AdjustmentRequestId })}>
                            <ClipboardX className="w-3 h-3" /> Reject
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Add route to App.tsx**

Find the inventory routes section in `web/src/App.tsx` and add:
```tsx
<Route path="inventory/adjustment-requests" element={<InventoryAdjustmentRequestPage />} />
```
And the import:
```tsx
import InventoryAdjustmentRequestPage from '../pages/inventory/InventoryAdjustmentRequestPage';
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `pnpm tsc --noEmit` (or `npx tsc --noEmit` from the web directory)

- [ ] **Step 4: Run existing tests to verify no regressions**

Run: `npx vitest run test/integration/routes/inventory/`

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/inventory/InventoryAdjustmentRequestPage.tsx web/src/App.tsx
git commit -m "feat: add adjustment request frontend page with approval workflow"
```

---

## Task 6: Run Full Test Suite and Verify

- [ ] **Step 1: Run all inventory integration tests**

Run: `npx vitest run test/integration/routes/inventory/`
Expected: All tests pass

- [ ] **Step 2: Run TypeScript check**

Run: `pnpm tsc --noEmit`

- [ ] **Step 3: Run linter**

Run: `pnpm lint` (if available)

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address test/lint feedback for inventory gap closure"
```

---

## Verification Checklist

- [ ] Every new test was watched fail before implementation
- [ ] Adjustment request frontend follows existing page patterns (TransferPage, ReturnPage)
- [ ] RBAC tests verify permission enforcement
- [ ] Edge case tests cover expired stock, insufficient stock, cross-store access
- [ ] Report tests cover invalid type, CSV export, limit enforcement
- [ ] All tests pass
- [ ] TypeScript compiles cleanly
- [ ] No regressions in existing tests
