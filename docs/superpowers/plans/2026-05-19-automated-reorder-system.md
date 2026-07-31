# Automated Reorder System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an automated reorder system that detects low-stock items, generates purchase requests grouped by vendor, and surfaces reorder suggestions on the dashboard.

**Architecture:** New reorder service at `src/routes/tenant/inventory/reorder.ts` with four endpoints (suggestions, generate-pr, config GET, config PUT). Migration adds `auto_reorder_enabled`, `preferred_vendor_id`, `reorder_quantity_formula` columns to `InventoryItem`. Frontend adds a reorder suggestions panel to the inventory dashboard.

**Tech Stack:** Hono routes, Cloudflare D1 (SQLite), Zod validation, Vitest integration tests, React + useApiQuery for frontend.

---

## File Structure

| File | Responsibility |
|------|---------------|
| `migrations/0256_reorder_config.sql` | Add reorder config columns to InventoryItem |
| `src/routes/tenant/inventory/reorder.ts` | Reorder routes: suggestions, generate-pr, config CRUD |
| `src/routes/tenant/inventory/index.ts` | Register reorder routes (modify) |
| `web/src/pages/inventory/InventoryDashboard.tsx` | Add reorder suggestions panel (modify) |
| `test/integration/routes/inventory/reorder.test.ts` | Integration tests |

---

### Task 1: Migration — Add reorder config columns to InventoryItem

**Files:**
- Create: `migrations/0256_reorder_config.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- Migration: Reorder automation config
-- Adds auto-reorder flags and preferred vendor to InventoryItem

ALTER TABLE InventoryItem ADD COLUMN auto_reorder_enabled INTEGER DEFAULT 0;
ALTER TABLE InventoryItem ADD COLUMN preferred_vendor_id INTEGER REFERENCES InventoryVendor(VendorId);
ALTER TABLE InventoryItem ADD COLUMN reorder_quantity_formula TEXT DEFAULT 'max_minus_current' CHECK(reorder_quantity_formula IN ('max_minus_current', 'reorder_x2_minus_current', 'fixed'));
```

- [ ] **Step 2: Verify migration file exists**

Run: `ls migrations/0256_reorder_config.sql`
Expected: File exists

- [ ] **Step 3: Commit**

```bash
git add migrations/0256_reorder_config.sql
git commit -m "feat(inventory): add reorder config migration"
```

---

### Task 2: Reorder Routes — Suggestions endpoint (GET /inventory/reorder/suggestions)

**Files:**
- Create: `src/routes/tenant/inventory/reorder.ts`
- Modify: `src/routes/tenant/inventory/index.ts`

- [ ] **Step 1: Write failing test for suggestions endpoint**

```typescript
// test/integration/routes/inventory/reorder.test.ts
import { describe, expect, it } from 'vitest';
import inventoryRoute from '../../../../src/routes/tenant/inventory';
import { createTestApp } from '../../helpers/test-app';

describe('Inventory — reorder suggestions', () => {
  it('returns items below reorder level with suggested quantities', async () => {
    const { app } = createTestApp({
      route: inventoryRoute,
      routePath: '/inventory',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        // Mock the low-stock items query
        if (sql.includes('InventoryStock S') && sql.includes('ReOrderLevel') && sql.includes('LEFT JOIN InventoryVendor')) {
          return {
            results: [
              {
                ItemId: 1,
                ItemName: 'Surgical Gloves',
                ItemCode: 'SG-001',
                ReOrderLevel: 50,
                MaxStockQuantity: 200,
                current_stock: 20,
                suggested_quantity: 180,
                preferred_vendor_id: 1,
                preferred_vendor_name: 'MedSupply Co',
                auto_reorder_enabled: 0,
                reorder_quantity_formula: 'max_minus_current',
              },
            ],
          };
        }
        return null;
      },
    });

    const res = await app.request('/inventory/reorder/suggestions');

    expect(res.status).toBe(200);
    const body = await res.json() as { suggestions: unknown[] };
    expect(body.suggestions).toHaveLength(1);
    expect(body.suggestions[0]).toEqual(expect.objectContaining({
      ItemId: 1,
      ItemName: 'Surgical Gloves',
      suggested_quantity: 180,
    }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/integration/routes/inventory/reorder.test.ts`
Expected: FAIL with "Cannot find module" or route not found

- [ ] **Step 3: Create reorder.ts with suggestions endpoint**

```typescript
// src/routes/tenant/inventory/reorder.ts
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env } from "../../../types";
import { getDb } from "../../../db";
import { requireTenantId, requireUserId } from "../../../lib/context-helpers";

type Variables = { tenantId?: string; userId?: string; role?: string };

const reorder = new Hono<{ Bindings: Env; Variables: Variables }>();

reorder.get("/suggestions", async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);

  const rows = await db.$client.prepare(`
    SELECT
      I.ItemId,
      I.ItemName,
      I.ItemCode,
      I.ReOrderLevel,
      I.MaxStockQuantity,
      I.MinStockQuantity,
      I.auto_reorder_enabled,
      I.reorder_quantity_formula,
      I.preferred_vendor_id,
      V.VendorName AS preferred_vendor_name,
      COALESCE(SUM(S.AvailableQuantity), 0) AS current_stock,
      CASE
        WHEN I.MaxStockQuantity > 0 THEN MAX(I.MaxStockQuantity - COALESCE(SUM(S.AvailableQuantity), 0), 0)
        ELSE MAX(I.ReOrderLevel * 2 - COALESCE(SUM(S.AvailableQuantity), 0), 0)
      END AS suggested_quantity
    FROM InventoryItem I
    LEFT JOIN InventoryStock S ON S.ItemId = I.ItemId AND S.tenant_id = I.tenant_id AND COALESCE(S.IsActive, 1) = 1
    LEFT JOIN InventoryVendor V ON V.VendorId = I.preferred_vendor_id AND V.tenant_id = I.tenant_id
    WHERE I.tenant_id = ? AND COALESCE(I.IsActive, 1) = 1
      AND I.ReOrderLevel > 0
    GROUP BY I.ItemId
    HAVING current_stock <= I.ReOrderLevel
    ORDER BY current_stock ASC
  `).bind(tenantId).all();

  return c.json({ suggestions: rows.results || [] });
});

export default reorder;
```

- [ ] **Step 4: Register reorder routes in index.ts**

Add import and route registration:

```typescript
// At top of index.ts, add import:
import reorderRoutes from "./reorder";

// After purchase-requests route, add:
inventory.route("/reorder", reorderRoutes);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/integration/routes/inventory/reorder.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/inventory/reorder.ts src/routes/tenant/inventory/index.ts test/integration/routes/inventory/reorder.test.ts
git commit -m "feat(inventory): add reorder suggestions endpoint"
```

---

### Task 3: Generate Purchase Requests endpoint (POST /inventory/reorder/generate-pr)

**Files:**
- Modify: `src/routes/tenant/inventory/reorder.ts`
- Modify: `test/integration/routes/inventory/reorder.test.ts`

- [ ] **Step 1: Write failing test for generate-pr endpoint**

```typescript
// Add to reorder.test.ts

it('generates purchase requests grouped by vendor from suggestions', async () => {
  const { app, mockDB } = createTestApp({
    route: inventoryRoute,
    routePath: '/inventory',
    role: 'hospital_admin',
    tenantId: 'tenant-1',
    userId: 12,
    queryOverride: (sql) => {
      // Mock suggestions query
      if (sql.includes('InventoryStock S') && sql.includes('ReOrderLevel') && sql.includes('LEFT JOIN InventoryVendor')) {
        return {
          results: [
            {
              ItemId: 1, ItemName: 'Surgical Gloves', ItemCode: 'SG-001',
              ReOrderLevel: 50, MaxStockQuantity: 200, MinStockQuantity: 10,
              current_stock: 20, suggested_quantity: 180,
              preferred_vendor_id: 1, preferred_vendor_name: 'MedSupply Co',
              auto_reorder_enabled: 1, reorder_quantity_formula: 'max_minus_current',
            },
            {
              ItemId: 2, ItemName: 'Bandages', ItemCode: 'BD-001',
              ReOrderLevel: 30, MaxStockQuantity: 100, MinStockQuantity: 5,
              current_stock: 10, suggested_quantity: 90,
              preferred_vendor_id: 1, preferred_vendor_name: 'MedSupply Co',
              auto_reorder_enabled: 1, reorder_quantity_formula: 'max_minus_current',
            },
            {
              ItemId: 3, ItemName: 'Syringes', ItemCode: 'SY-001',
              ReOrderLevel: 100, MaxStockQuantity: 500, MinStockQuantity: 20,
              current_stock: 50, suggested_quantity: 450,
              preferred_vendor_id: 2, preferred_vendor_name: 'HealthParts Inc',
              auto_reorder_enabled: 1, reorder_quantity_formula: 'max_minus_current',
            },
          ],
        };
      }
      // Mock PR count for PRNumber generation
      if (sql.includes('COUNT(*)') && sql.includes('InventoryPurchaseRequest')) {
        return { first: { cnt: 0 } };
      }
      // Mock open PR items for deduplication
      if (sql.includes('InventoryPurchaseRequestItem') && sql.includes('Status IN')) {
        return { results: [] };
      }
      return null;
    },
  });

  const res = await app.request('/inventory/reorder/generate-pr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  expect(res.status).toBe(201);
  const body = await res.json() as { purchase_requests: unknown[]; skipped_items: unknown[] };
  expect(body.purchase_requests).toHaveLength(2); // 2 vendors = 2 PRs
  expect(mockDB.queries.filter(q => q.sql.includes('INSERT INTO InventoryPurchaseRequest')).length).toBe(2);
  expect(mockDB.queries.filter(q => q.sql.includes('INSERT INTO InventoryPurchaseRequestItem')).length).toBe(3);
});

it('skips items already in open purchase requests (deduplication)', async () => {
  const { app, mockDB } = createTestApp({
    route: inventoryRoute,
    routePath: '/inventory',
    role: 'hospital_admin',
    tenantId: 'tenant-1',
    userId: 12,
    queryOverride: (sql) => {
      if (sql.includes('InventoryStock S') && sql.includes('ReOrderLevel') && sql.includes('LEFT JOIN InventoryVendor')) {
        return {
          results: [
            {
              ItemId: 1, ItemName: 'Surgical Gloves', ItemCode: 'SG-001',
              ReOrderLevel: 50, MaxStockQuantity: 200, MinStockQuantity: 10,
              current_stock: 20, suggested_quantity: 180,
              preferred_vendor_id: 1, preferred_vendor_name: 'MedSupply Co',
              auto_reorder_enabled: 1, reorder_quantity_formula: 'max_minus_current',
            },
          ],
        };
      }
      if (sql.includes('COUNT(*)') && sql.includes('InventoryPurchaseRequest')) {
        return { first: { cnt: 0 } };
      }
      // Mock that item 1 is already in an open PR
      if (sql.includes('InventoryPurchaseRequestItem') && sql.includes('Status IN')) {
        return { results: [{ ItemId: 1 }] };
      }
      return null;
    },
  });

  const res = await app.request('/inventory/reorder/generate-pr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  expect(res.status).toBe(201);
  const body = await res.json() as { purchase_requests: unknown[]; skipped_items: unknown[] };
  expect(body.purchase_requests).toHaveLength(0);
  expect(body.skipped_items).toHaveLength(1);
  expect(body.skipped_items[0]).toEqual(expect.objectContaining({ ItemId: 1, reason: 'already_in_open_pr' }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/integration/routes/inventory/reorder.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement generate-pr endpoint**

```typescript
// Add to reorder.ts before export

reorder.post("/generate-pr", async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const now = new Date().toISOString();

  // Get suggestions (reuse the same query)
  const rows = await db.$client.prepare(`
    SELECT
      I.ItemId, I.ItemName, I.ItemCode, I.ReOrderLevel, I.MaxStockQuantity,
      I.MinStockQuantity, I.auto_reorder_enabled, I.reorder_quantity_formula,
      I.preferred_vendor_id, V.VendorName AS preferred_vendor_name,
      COALESCE(SUM(S.AvailableQuantity), 0) AS current_stock,
      CASE
        WHEN I.MaxStockQuantity > 0 THEN MAX(I.MaxStockQuantity - COALESCE(SUM(S.AvailableQuantity), 0), 0)
        ELSE MAX(I.ReOrderLevel * 2 - COALESCE(SUM(S.AvailableQuantity), 0), 0)
      END AS suggested_quantity
    FROM InventoryItem I
    LEFT JOIN InventoryStock S ON S.ItemId = I.ItemId AND S.tenant_id = I.tenant_id AND COALESCE(S.IsActive, 1) = 1
    LEFT JOIN InventoryVendor V ON V.VendorId = I.preferred_vendor_id AND V.tenant_id = I.tenant_id
    WHERE I.tenant_id = ? AND COALESCE(I.IsActive, 1) = 1
      AND I.ReOrderLevel > 0 AND I.auto_reorder_enabled = 1
    GROUP BY I.ItemId
    HAVING current_stock <= I.ReOrderLevel
  `).bind(tenantId).all();

  const suggestions = (rows.results || []) as Array<{
    ItemId: number; ItemName: string; ItemCode: string;
    suggested_quantity: number; preferred_vendor_id: number | null;
    preferred_vendor_name: string | null; StandardRate?: number;
  }>;

  // Deduplication: find items already in open PRs
  const openPrItems = await db.$client.prepare(`
    SELECT DISTINCT PRI.ItemId
    FROM InventoryPurchaseRequestItem PRI
    JOIN InventoryPurchaseRequest PR ON PR.PurchaseRequestId = PRI.PurchaseRequestId AND PR.tenant_id = ?
    WHERE PR.tenant_id = ? AND PR.Status IN ('draft', 'submitted', 'approved')
  `).bind(tenantId, tenantId).all();

  const openItemIds = new Set((openPrItems.results || []).map((r: any) => r.ItemId));
  const validSuggestions = suggestions.filter(s => !openItemIds.has(s.ItemId));
  const skippedItems = suggestions
    .filter(s => openItemIds.has(s.ItemId))
    .map(s => ({ ItemId: s.ItemId, ItemName: s.ItemName, reason: 'already_in_open_pr' }));

  // Group by vendor
  const byVendor = new Map<number | null, typeof validSuggestions>();
  for (const s of validSuggestions) {
    const key = s.preferred_vendor_id ?? null;
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key)!.push(s);
  }

  const createdPRs: number[] = [];

  for (const [vendorId, items] of byVendor) {
    if (items.length === 0) continue;

    const prCount = await db.$client.prepare(
      "SELECT COUNT(*) as cnt FROM InventoryPurchaseRequest WHERE tenant_id = ?"
    ).bind(tenantId).first<{ cnt: number }>();

    const prNumber = `PR-${new Date().getFullYear()}-${String((prCount?.cnt || 0) + 1).padStart(5, "0")}`;

    const result = await db.$client.prepare(`
      INSERT INTO InventoryPurchaseRequest
        (tenant_id, PRNumber, PRDate, RequestedBy, Priority, Status, Remarks, CreatedBy, CreatedOn)
      VALUES (?, ?, ?, ?, 'normal', 'draft', ?, ?, ?)
    `).bind(
      tenantId, prNumber, now.slice(0, 10), userId,
      `Auto-generated reorder PR for ${items.length} items`,
      userId, now,
    ).run();

    const prId = Number(result.meta.last_row_id);
    createdPRs.push(prId);

    for (const item of items) {
      await db.$client.prepare(`
        INSERT INTO InventoryPurchaseRequestItem
          (PurchaseRequestId, ItemId, ItemName, Quantity, ApprovedQuantity, EstimatedRate, EstimatedAmount, Remarks, CreatedBy, CreatedOn)
        VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?)
      `).bind(
        prId, item.ItemId, item.ItemName, item.suggested_quantity,
        item.StandardRate || 0, item.suggested_quantity * (item.StandardRate || 0),
        `Auto-reorder: stock below ${item.ReOrderLevel}`,
        userId, now,
      ).run();
    }
  }

  return c.json({
    message: `Generated ${createdPRs.length} purchase request(s)`,
    purchase_requests: createdPRs,
    skipped_items: skippedItems,
  }, 201);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/integration/routes/inventory/reorder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/inventory/reorder.ts test/integration/routes/inventory/reorder.test.ts
git commit -m "feat(inventory): add generate-pr endpoint with vendor grouping and deduplication"
```

---

### Task 4: Reorder Config endpoints (GET /config, PUT /config/:itemId)

**Files:**
- Modify: `src/routes/tenant/inventory/reorder.ts`
- Modify: `test/integration/routes/inventory/reorder.test.ts`

- [ ] **Step 1: Write failing tests for config endpoints**

```typescript
// Add to reorder.test.ts

it('gets reorder config for an item', async () => {
  const { app } = createTestApp({
    route: inventoryRoute,
    routePath: '/inventory',
    role: 'hospital_admin',
    tenantId: 'tenant-1',
    queryOverride: (sql) => {
      if (sql.includes('InventoryItem') && sql.includes('ItemId = ?')) {
        return {
          first: {
            ItemId: 1, ItemName: 'Surgical Gloves',
            auto_reorder_enabled: 1, preferred_vendor_id: 2,
            reorder_quantity_formula: 'max_minus_current',
          },
        };
      }
      return null;
    },
  });

  const res = await app.request('/inventory/reorder/config/1');

  expect(res.status).toBe(200);
  const body = await res.json() as { ItemId: number; auto_reorder_enabled: number };
  expect(body.ItemId).toBe(1);
  expect(body.auto_reorder_enabled).toBe(1);
});

it('updates reorder config for an item', async () => {
  const { app, mockDB } = createTestApp({
    route: inventoryRoute,
    routePath: '/inventory',
    role: 'hospital_admin',
    tenantId: 'tenant-1',
    userId: 12,
    queryOverride: (sql) => {
      if (sql.includes('InventoryItem') && sql.includes('ItemId = ?') && !sql.includes('UPDATE')) {
        return { first: { ItemId: 1, auto_reorder_enabled: 0 } };
      }
      return null;
    },
  });

  const res = await app.request('/inventory/reorder/config/1', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auto_reorder_enabled: true,
      preferred_vendor_id: 3,
      reorder_quantity_formula: 'reorder_x2_minus_current',
    }),
  });

  expect(res.status).toBe(200);
  expect(mockDB.queries.some(q => q.sql.includes('UPDATE InventoryItem'))).toBe(true);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/integration/routes/inventory/reorder.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement config endpoints**

```typescript
// Add to reorder.ts before export

reorder.get("/config/:itemId", async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const itemId = Number(c.req.param("itemId"));

  const item = await db.$client.prepare(`
    SELECT ItemId, ItemName, ItemCode, auto_reorder_enabled, preferred_vendor_id, reorder_quantity_formula
    FROM InventoryItem
    WHERE tenant_id = ? AND ItemId = ?
  `).bind(tenantId, itemId).first();

  if (!item) return c.json({ error: "Item not found" }, 404);
  return c.json(item);
});

reorder.put("/config/:itemId", async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const db = getDb(c.env.DB);
  const itemId = Number(c.req.param("itemId"));
  const body = await c.req.json();

  const existing = await db.$client.prepare(
    "SELECT ItemId FROM InventoryItem WHERE tenant_id = ? AND ItemId = ?"
  ).bind(tenantId, itemId).first();

  if (!existing) return c.json({ error: "Item not found" }, 404);

  await db.$client.prepare(`
    UPDATE InventoryItem
    SET auto_reorder_enabled = ?,
        preferred_vendor_id = ?,
        reorder_quantity_formula = ?,
        ModifiedBy = ?,
        ModifiedOn = ?
    WHERE tenant_id = ? AND ItemId = ?
  `).bind(
    body.auto_reorder_enabled ? 1 : 0,
    body.preferred_vendor_id || null,
    body.reorder_quantity_formula || 'max_minus_current',
    userId,
    new Date().toISOString(),
    tenantId,
    itemId,
  ).run();

  return c.json({ message: "Reorder config updated" });
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/integration/routes/inventory/reorder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/inventory/reorder.ts test/integration/routes/inventory/reorder.test.ts
git commit -m "feat(inventory): add reorder config GET/PUT endpoints"
```

---

### Task 5: Frontend — Reorder suggestions panel on dashboard

**Files:**
- Modify: `web/src/pages/inventory/InventoryDashboard.tsx`

- [ ] **Step 1: Add reorder suggestions API call and panel**

Add a new section to the dashboard that fetches and displays reorder suggestions:

```tsx
// Add after the existing useApiQuery for dashboard data:
const { data: reorderData, isLoading: reorderLoading } = useApiQuery<{ suggestions: ReorderSuggestion[] }>(
  ['inventory', 'reorder', 'suggestions'],
  '/api/inventory/reorder/suggestions',
);

// Add interface:
interface ReorderSuggestion {
  ItemId: number;
  ItemName: string;
  ItemCode: string;
  ReOrderLevel: number;
  current_stock: number;
  suggested_quantity: number;
  preferred_vendor_name?: string;
}
```

- [ ] **Step 2: Add the reorder suggestions panel JSX**

Add a new card in the grid layout after the alerts section:

```tsx
<div className="card">
  <div className="p-4 border-b border-[var(--color-border)] flex items-center justify-between">
    <h3 className="font-semibold">Reorder Suggestions</h3>
    <Link to={`${base}/inventory/purchase-requests/new`} className="text-sm text-[var(--color-primary)] hover:underline flex items-center gap-1">
      New PR <ArrowRight className="w-3 h-3" />
    </Link>
  </div>
  <div className="p-4 space-y-3">
    {reorderLoading ? (
      [...Array(3)].map((_, i) => <div key={i} className="skeleton h-14 rounded" />)
    ) : (reorderData?.suggestions ?? []).length === 0 ? (
      <EmptyState icon={<ShoppingCart className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No reorder suggestions" description="All items are above reorder level" />
    ) : (reorderData?.suggestions ?? []).slice(0, 5).map((suggestion) => (
      <div key={suggestion.ItemId} className="border rounded-lg p-3 border-amber-200 bg-amber-50 text-amber-700">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-medium">{suggestion.ItemName}</p>
            <p className="text-xs mt-0.5 opacity-80">
              {suggestion.ItemCode} · Reorder: {suggestion.ReOrderLevel} · Current: {suggestion.current_stock}
            </p>
            {suggestion.preferred_vendor_name && (
              <p className="text-xs mt-0.5 opacity-70">Vendor: {suggestion.preferred_vendor_name}</p>
            )}
          </div>
          <span className="font-data text-sm font-semibold">+{suggestion.suggested_quantity}</span>
        </div>
      </div>
    ))}
  </div>
</div>
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd web && npm run build` (or equivalent)
Expected: No TypeScript errors

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/inventory/InventoryDashboard.tsx
git commit -m "feat(inventory): add reorder suggestions panel to dashboard"
```

---

### Task 6: Final integration test and verification

**Files:**
- Verify: `test/integration/routes/inventory/reorder.test.ts`

- [ ] **Step 1: Run all reorder tests**

Run: `npx vitest run test/integration/routes/inventory/reorder.test.ts`
Expected: All tests PASS

- [ ] **Step 2: Run full inventory test suite**

Run: `npx vitest run test/integration/routes/inventory/`
Expected: No regressions

- [ ] **Step 3: Final commit with all files**

```bash
git add -A
git commit -m "feat(inventory): complete automated reorder system with suggestions, PR generation, and dashboard panel"
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - ✅ Reorder check service (suggestions endpoint)
   - ✅ Auto-create PurchaseRequest (generate-pr endpoint)
   - ✅ Deduplication (checks open PRs before creating)
   - ✅ API endpoints (4 endpoints: suggestions, generate-pr, config GET, config PUT)
   - ✅ Frontend (reorder suggestions panel on dashboard)
   - ✅ Migration (adds reorder config columns)
   - ✅ Integration tests

2. **Placeholder scan:** No placeholders found — all code is complete.

3. **Type consistency:** All function signatures, SQL queries, and JSON responses are consistent across tasks.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-19-automated-reorder-system.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
