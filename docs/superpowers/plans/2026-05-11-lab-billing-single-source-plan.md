# Lab Test Pricing Single Source of Truth - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `lab_test_catalog` the single source of truth for lab test prices across all billing/reception APIs.

**Architecture:** Modify `/api/reception/services` and `/api/billing-counter/service-items` to include lab tests from `lab_test_catalog` alongside `billing_service_items`, so lab test prices are dynamically read (not copied).

**Tech Stack:** Hono router, SQLite, React Query frontend

---

## Before Starting

Verify current state:
- `src/routes/tenant/reception.ts` - lines ~93-139 for `/services` endpoint
- `src/routes/tenant/billingMaster.ts` - lines ~292-329 for `/service-items` endpoint
- `src/routes/tenant/lab.ts` - for reference on lab catalog structure

---

### Task 1: Modify `/api/reception/services` to include lab test catalog

**Files:**
- Modify: `src/routes/tenant/reception.ts:93-139`

- [ ] **Step 1: Read current implementation**

Read lines 93-139 of `src/routes/tenant/reception.ts` to understand current SQL query structure.

- [ ] **Step 2: Identify lab department**

Find or create a query that identifies the "Laboratory" service department. Check `billing_service_departments` table for existing lab-related departments.

```typescript
// Add after line 111 (after LEFT JOIN for price_category_maps):
// Check if service department is for lab (IntegrationName = 'Lab' or department name contains 'Lab')
const labDeptCheck = await db.$client.prepare(
  "SELECT id FROM billing_service_departments WHERE tenant_id = ? AND (LOWER(department_name) LIKE '%lab%' OR integration_name = 'Lab') LIMIT 1"
).bind(tenantId).first<{ id: number }>();
```

- [ ] **Step 3: Union with lab test catalog**

Modify the SQL query to union `billing_service_items` with `lab_test_catalog` for lab department.

```typescript
// After the main query (line ~137), add lab test catalog items:
// Get lab tests from catalog
const labSql = `
  SELECT lt.id as id, lt.name as item_name, lt.code as item_code,
         'Laboratory' as department_name,
         COALESCE(m.price, lt.price) as price,
         lt.price as base_price,
         1 as is_lab_catalog
  FROM lab_test_catalog lt
  LEFT JOIN billing_item_price_category_maps m
    ON m.service_item_id = lt.id AND m.tenant_id = ? AND m.is_active = 1
  WHERE lt.tenant_id = ? AND lt.is_active = 1
`;
// Note: This approach needs adjustment - we need a way to map lab tests to billing
```

- [ ] **Step 4: Simplify approach - add lab tests via subquery**

Use a simpler approach: add lab tests as a separate subquery in UNION.

```typescript
// Replace the query structure to use UNION ALL:
const basePriceSql = `
  SELECT si.id, si.item_name, si.item_code, sd.department_name,
         COALESCE(m.price, si.price) as price, si.price as base_price,
         0 as is_lab_catalog
  FROM billing_service_items si
  LEFT JOIN billing_service_departments sd ON si.service_department_id = sd.id
  LEFT JOIN billing_item_price_category_maps m
    ON m.service_item_id = si.id AND m.tenant_id = ? AND m.is_active = 1
  WHERE si.tenant_id = ? AND si.is_active = 1
`;

// Lab catalog items - add a prefix identifier
const labPriceSql = `
  SELECT lt.id, lt.name as item_name, lt.code as item_code,
         'Laboratory' as department_name,
         COALESCE(m.price, lt.price) as price, lt.price as base_price,
         1 as is_lab_catalog
  FROM lab_test_catalog lt
  LEFT JOIN billing_item_price_category_maps m
    ON m.service_item_id = lt.id AND m.tenant_id = ? AND m.is_active = 1
  WHERE lt.tenant_id = ? AND lt.is_active = 1
`;

const combinedSql = `(${basePriceSql}) UNION ALL (${labPriceSql}) ORDER BY department_name, item_name`;
```

- [ ] **Step 5: Add search filter for lab items**

Add search condition that works for both tables.

```typescript
// Modify search pattern to work with UNION:
// Pattern: `AND (si.item_name LIKE ? OR si.item_code LIKE ?)`
// For lab tests in UNION: `AND (lt.name LIKE ? OR lt.code LIKE ?)`
```

- [ ] **Step 6: Add price_category_id parameter handling**

Ensure price category override works for both.

- [ ] **Step 7: Test the endpoint**

Run: `npm run dev` and test with curl:
```bash
curl "http://localhost:8787/api/reception/services?search="
```

Verify response includes lab test items with correct prices.

- [ ] **Step 8: Commit**

```bash
git add src/routes/tenant/reception.ts
git commit -m "feat(reception): include lab test catalog in services API"
```

---

### Task 2: Modify `/api/billing-master/service-items` to include lab tests

**Files:**
- Modify: `src/routes/tenant/billingMaster.ts:292-329`

- [ ] **Step 1: Read current implementation**

Read lines 292-329 of `src/routes/tenant/billingMaster.ts`.

- [ ] **Step 2: Apply same UNION pattern**

Add lab test catalog items alongside billing service items.

```typescript
// Before line 298, add lab catalog SQL:
const labCatalogSql = `
  SELECT lt.id, lt.name as item_name, lt.code as item_code,
         'Laboratory' as department_name, lt.price,
         0 as display_order, 1 as is_active,
         ? as tenant_id, NULL as created_by, NULL as created_at,
         NULL as updated_at, 1 as is_lab_catalog
  FROM lab_test_catalog lt
  WHERE lt.tenant_id = ? AND lt.is_active = 1
`;

const unionSql = `
  SELECT si.*, sd.department_name, 0 as is_lab_catalog
  FROM billing_service_items si
  LEFT JOIN billing_service_departments sd ON si.service_department_id = sd.id
  WHERE si.tenant_id = ? AND si.is_active = 1
  UNION ALL
  SELECT id, item_name, item_code, department_name, price,
         display_order, is_active, tenant_id, created_by, created_at,
         updated_at, 1 as is_lab_catalog
  FROM (${labCatalogSql}) as lab
  ORDER BY department_name, item_name
  LIMIT ? OFFSET ?
`;
```

- [ ] **Step 3: Add search filter for UNION**

Search must work for both `billing_service_items` and `lab_test_catalog`.

- [ ] **Step 4: Handle pagination with UNION**

Pagination is trickier with UNION. Use a wrapper:

```typescript
// Instead of UNION with pagination, use two queries and combine:
const serviceItems = await db.$client.prepare(baseSql).bind(...params).all();
const labItems = await db.$client.prepare(labSql).bind(...labParams).all();
const combined = [...serviceItems.results, ...labItems.results];
// Apply LIMIT/OFFSET to combined results
```

- [ ] **Step 5: Test the endpoint**

```bash
curl "http://localhost:8787/api/billing-master/service-items?search="
```

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/billingMaster.ts
git commit -m "feat(billing): include lab test catalog in service items API"
```

---

### Task 3: Handle price category overrides for lab tests

**Files:**
- Modify: `src/routes/tenant/reception.ts`
- Modify: `src/routes/tenant/billingMaster.ts`

- [ ] **Step 1: Check billing_item_price_category_maps table**

This table links `service_item_id` to price categories. For lab tests, we need to ensure this works with `lab_test_catalog` IDs.

- [ ] **Step 2: Update price category join for lab items**

In the UNION queries, the price category join should work for both:

```typescript
// For billing_service_items: m.service_item_id = si.id
// For lab_test_catalog: m.service_item_id = lt.id
```

- [ ] **Step 3: Test with different price categories**

Ensure that when `price_category_id` is passed, lab test prices also get overridden.

- [ ] **Step 4: Commit**

```bash
git commit -m "fix(billing): ensure price category overrides work for lab tests"
```

---

### Task 4: Clean up frontend if needed

**Files:**
- Check: `web/src/pages/LabSettingsPage.tsx`
- Check: `web/src/pages/BillingMasterPage.tsx`

- [ ] **Step 1: Verify LabTestSelector still works**

The `LabTestSelector` component in ReceptionDashboard uses `/api/lab?search=` which already reads from `lab_test_catalog`. No changes needed.

- [ ] **Step 2: Check BillingMaster service items tab**

Ensure the service items tab shows lab tests correctly when viewing.

- [ ] **Step 3: Verify prices display correctly**

In Reception Dashboard "Add Service" modal, lab tests should show correct prices from `lab_test_catalog`.

- [ ] **Step 4: Commit if changes needed**

---

### Task 5: Verify end-to-end flow

- [ ] **Step 1: Test adding a lab test in billing**

1. Go to Lab Test Catalog, set price for a test (e.g., 50000)
2. Go to Reception Dashboard, click "Add Lab"
3. Select the test, verify price shows as 50000
4. Proceed to bill generation, verify correct price

- [ ] **Step 2: Test price update propagation**

1. Change price in Lab Test Catalog
2. Check in Reception "Add Lab" - should show new price immediately

- [ ] **Step 3: Test price categories**

1. Set different price for a price category
2. Verify it shows correctly for that category

---

## Summary

This implementation makes `lab_test_catalog` the single source of truth by:
1. Including lab tests in reception/billing APIs via UNION
2. Reading prices dynamically (no copying)
3. Supporting price category overrides

**Files to modify:**
- `src/routes/tenant/reception.ts` - add lab catalog to `/services`
- `src/routes/tenant/billingMaster.ts` - add lab catalog to `/service-items`