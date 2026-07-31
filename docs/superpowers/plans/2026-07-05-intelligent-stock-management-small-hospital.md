# Intelligent Stock Management for Small Hospitals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing manual/static inventory and lab reagent workflows into a small-hospital-friendly intelligent stock system that auto-suggests shortage, stockout, reorder, mapping gaps, and upcoming demand for lab tests, OT operations, ward use, and general hospital consumables.

**Architecture:** Keep `InventoryStock` as the canonical stock source of truth. Add an intelligence layer above the existing inventory/lab/OT engines: default consumption rules, tenant overrides, availability/readiness calculation, daily demand snapshots, forecast/reorder recommendations, and simple action-card UI. Do not put heavy forecasting in synchronous request handlers; recompute snapshots through an explicit endpoint first and later through Queues/scheduled jobs.

**Tech Stack:** Cloudflare Workers, Hono, D1, raw SQL migrations, Zod validation, React 19, Vite, React Query, Vitest.

## Global Constraints

- Preserve the existing canonical inventory design: `InventoryStock` remains the operational source of truth for quantity.
- Preserve current lab reagent safety: actual deduction remains idempotent and FEFO/QC/expiry aware through `src/lib/lab-consumables.ts` and `src/lib/inventory-issue-service.ts`.
- Do not force real mL values as universal defaults. Analyzer reagent volume is kit/analyzer/IFU-specific. Seed safe “test-equivalent” defaults, but allow each hospital to override mL/pcs/test values per reagent, analyzer, and operation.
- Small hospitals must not be forced to configure everything manually before going live. The first-run UX must show defaults, missing mappings, and “fix this” actions.
- Suggestions must be advisory first. Auto-create purchase requests only as draft/reviewable PRs, not automatic approved purchase orders.
- Use usable stock, not total stock, for recommendations: exclude expired, QC failed/pending where required, blocked, damaged, and onboard-expired lots.
- Reorder logic must use at least: average daily usage, lead time days, safety stock days, min/max stock, open purchase request quantity, and open purchase order quantity.

---

## Current System Review

### What already exists and should be reused

- `src/lib/lab-reagent-defaults.ts` seeds default lab tests and default consumable mappings for common tests such as CBC, ESR, RBS, HbA1c, Creatinine, Lipid, LFT, KFT, and TSH.
- `src/lib/lab-consumables.ts` already supports mapped lab consumable deduction, idempotency claims, lab inventory exceptions, FEFO stock selection, QC/expiry/onboard-expiry filtering, and canonical inventory-backed consumption.
- `src/routes/tenant/inventory/reorder.ts` already has a reorder suggestions endpoint and draft purchase request generation.
- `docs/superpowers/specs/2026-06-28-lab-reagent-mis-ready-inventory-design.md` already defines the correct lab reagent direction: canonical inventory, mapping, soft/strict mode, QC, open-vial, exceptions, and reports.
- `docs/reports/2026-07-03-enterprise-inventory-reagent-review.md` already identifies transaction/reconciliation hardening gaps.

### Main gaps causing the system to feel manual

1. Reorder suggestions are static: `current_stock <= ReOrderLevel`. They do not calculate days of cover, expected stockout date, trend, lead-time demand, safety stock, or open PR/PO coverage.
2. Default deduction rules exist for lab tests, but they are lab-specific and not generalized for OT/procedure/ward/radiology/default packs.
3. Existing defaults use “test-equivalent” units for safety. There is no friendly calibration workflow that says: “CBC currently deducts 1 test-equivalent; click to set real mL/pcs after checking kit/analyzer.”
4. The UI does not give a single intelligent answer: “Can we run today’s common tests/operations with current stock?”
5. Mapping coverage exists, but the system does not convert missing mappings into a prioritized setup queue for admins.
6. There is no stock intelligence snapshot table, so every page must calculate its own low stock/expiry/mapping state.
7. There is no unified action center: order needed, mapping missing, stock exists but not usable, expiry risk, dead stock, abnormal consumption, and open exception are not shown together.
8. OT operation consumption exists as a thin adapter but lacks operation-pack defaults and a pre-op readiness checklist.

---

## Target User Experience

### Small hospital default mode

The operator should see three simple sections instead of a complicated ERP screen:

1. **Today’s Stock Safety**
   - “Ready”: stock enough for usual work.
   - “Low”: stock available but below safe days of cover.
   - “Blocked”: test/operation cannot safely deduct because stock/mapping/QC/expiry has a problem.

2. **What to Buy**
   - Suggested item, current usable stock, estimated days left, suggested order quantity, preferred vendor, existing PR/PO coverage.
   - Button: “Create Draft PR”.

3. **What to Fix**
   - Missing test/operation mapping.
   - Stock exists but unusable because expired/QC pending/onboard expired.
   - Default rule still using test-equivalent and needs calibration.
   - Unresolved lab inventory exception.

### Lab test order/reception experience

When a receptionist selects lab tests, the system should not force them to understand inventory. It should show simple badges:

- `OK`: enough usable stock.
- `Low`: enough for this order but needs reorder soon.
- `No stock`: stock not enough or not usable.
- `No rule`: this test has no deduction rule.

Actual deduction should still happen at result finalization by default, but billing/order time should warn early so the hospital does not sell a test that lab cannot run.

### OT operation experience

When an operation is scheduled or moved to “ready for OT”, the system should show an operation-pack readiness checklist:

- mandatory items ready/missing
- optional items low
- blood/consumable/procedure kit status if configured
- estimated chargeable vs non-chargeable consumables

Actual deduction should happen at a controlled trigger: “operation completed”, “OT nurse confirms used items”, or “procedure pack consumed”.

---

## Proposed Architecture

```text
Existing inventory source of truth
  InventoryItem
  InventoryStock
  InventoryStockTransaction
  InventoryConsumption
  InventoryConsumptionItem

Existing domain events
  Lab order item billed/finalized
  OT case scheduled/completed
  Ward consumption
  Manual issue/return/adjustment

New intelligence layer
  consumption rule templates/defaults
  tenant consumption rule overrides
  availability/readiness calculator
  demand daily snapshots
  forecast/reorder engine
  recommendation/action cards

UI
  Inventory Smart Dashboard
  Lab Test Readiness Matrix
  OT Operation Pack Readiness
  Draft PR from recommendation
```

---

## Data Model Changes

### Create: `migrations/0XXX_inventory_intelligence.sql`

Use the next available migration number after checking the repository.

Recommended additive tables:

```sql
CREATE TABLE IF NOT EXISTS inventory_consumption_rule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  rule_scope TEXT NOT NULL CHECK(rule_scope IN ('lab_test','ot_operation','procedure','radiology','ward_task','general_service')),
  reference_id INTEGER,
  reference_code TEXT,
  reference_name TEXT NOT NULL,
  trigger_event TEXT NOT NULL CHECK(trigger_event IN ('billing','order_confirmed','result_finalized','procedure_completed','manual_confirm')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('draft','active','inactive')),
  source TEXT NOT NULL DEFAULT 'tenant' CHECK(source IN ('system_default','tenant','imported')),
  confidence TEXT NOT NULL DEFAULT 'starter' CHECK(confidence IN ('starter','verified','machine_specific','vendor_ifu')),
  notes TEXT,
  effective_from DATETIME DEFAULT CURRENT_TIMESTAMP,
  effective_to DATETIME,
  created_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_consumption_rule_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  rule_id INTEGER NOT NULL REFERENCES inventory_consumption_rule(id),
  inventory_item_id INTEGER,
  lab_consumable_id INTEGER,
  item_name TEXT NOT NULL,
  quantity_per_event REAL NOT NULL,
  unit TEXT NOT NULL DEFAULT 'test',
  is_mandatory INTEGER NOT NULL DEFAULT 1,
  allow_substitute INTEGER NOT NULL DEFAULT 0,
  deduction_mode TEXT NOT NULL DEFAULT 'auto' CHECK(deduction_mode IN ('auto','suggest_only','manual_confirm')),
  calibration_status TEXT NOT NULL DEFAULT 'needs_review' CHECK(calibration_status IN ('default','needs_review','verified')),
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_demand_daily (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  inventory_item_id INTEGER NOT NULL,
  demand_date DATE NOT NULL,
  source_scope TEXT NOT NULL,
  consumed_qty REAL NOT NULL DEFAULT 0,
  billed_event_count INTEGER NOT NULL DEFAULT 0,
  completed_event_count INTEGER NOT NULL DEFAULT 0,
  waste_qty REAL NOT NULL DEFAULT 0,
  adjustment_qty REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, inventory_item_id, demand_date, source_scope)
);

CREATE TABLE IF NOT EXISTS inventory_stock_intelligence_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  inventory_item_id INTEGER NOT NULL,
  usable_stock REAL NOT NULL DEFAULT 0,
  blocked_stock REAL NOT NULL DEFAULT 0,
  current_stock REAL NOT NULL DEFAULT 0,
  avg_daily_usage_7d REAL NOT NULL DEFAULT 0,
  avg_daily_usage_30d REAL NOT NULL DEFAULT 0,
  avg_daily_usage_90d REAL NOT NULL DEFAULT 0,
  trend_label TEXT NOT NULL DEFAULT 'stable' CHECK(trend_label IN ('new','up','down','stable','spiky','no_data')),
  lead_time_days INTEGER NOT NULL DEFAULT 7,
  safety_stock_days INTEGER NOT NULL DEFAULT 7,
  reorder_point REAL NOT NULL DEFAULT 0,
  suggested_order_qty REAL NOT NULL DEFAULT 0,
  days_of_cover REAL,
  estimated_stockout_date DATE,
  open_pr_qty REAL NOT NULL DEFAULT 0,
  open_po_qty REAL NOT NULL DEFAULT 0,
  recommendation_status TEXT NOT NULL DEFAULT 'ok' CHECK(recommendation_status IN ('ok','watch','low','stockout','overstock','mapping_gap','blocked')),
  computed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, inventory_item_id)
);

CREATE TABLE IF NOT EXISTS inventory_recommendation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  recommendation_type TEXT NOT NULL CHECK(recommendation_type IN ('buy_now','buy_soon','fix_mapping','verify_default_rule','resolve_exception','use_before_expiry','review_abnormal_usage','dead_stock')),
  severity TEXT NOT NULL DEFAULT 'info' CHECK(severity IN ('info','warning','critical')),
  inventory_item_id INTEGER,
  rule_id INTEGER,
  reference_type TEXT,
  reference_id INTEGER,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  suggested_action TEXT NOT NULL,
  suggested_quantity REAL,
  metadata_json TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','snoozed','dismissed','converted','resolved')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Additive columns to `InventoryItem` if missing

```sql
ALTER TABLE InventoryItem ADD COLUMN LeadTimeDays INTEGER DEFAULT 7;
ALTER TABLE InventoryItem ADD COLUMN SafetyStockDays INTEGER DEFAULT 7;
ALTER TABLE InventoryItem ADD COLUMN PreferredVendorId INTEGER;
ALTER TABLE InventoryItem ADD COLUMN IntelligenceEnabled INTEGER DEFAULT 1;
```

Before adding, check current migrations because some vendor/reorder columns already exist.

---

## Backend Interfaces

### Create: `src/lib/inventory-intelligence/types.ts`

```ts
export type RuleScope = 'lab_test' | 'ot_operation' | 'procedure' | 'radiology' | 'ward_task' | 'general_service';
export type TriggerEvent = 'billing' | 'order_confirmed' | 'result_finalized' | 'procedure_completed' | 'manual_confirm';
export type ReadinessStatus = 'ok' | 'low' | 'blocked' | 'no_rule' | 'no_stock';

export interface ConsumptionRuleItem {
  id: number;
  inventoryItemId?: number | null;
  labConsumableId?: number | null;
  itemName: string;
  quantityPerEvent: number;
  unit: string;
  isMandatory: boolean;
  calibrationStatus: 'default' | 'needs_review' | 'verified';
}

export interface ServiceReadinessRequest {
  tenantId: string;
  ruleScope: RuleScope;
  referenceIds?: number[];
  referenceCodes?: string[];
  eventCount?: number;
}

export interface ServiceReadinessItem {
  itemId?: number | null;
  itemName: string;
  requiredQty: number;
  usableStock: number;
  remainingEvents: number | null;
  status: ReadinessStatus;
  message: string;
}

export interface ServiceReadinessResult {
  referenceId?: number | null;
  referenceCode?: string | null;
  referenceName: string;
  status: ReadinessStatus;
  items: ServiceReadinessItem[];
  actionText: string;
}
```

### Create: `src/lib/inventory-intelligence/readiness.ts`

Responsibility:

- Load active rules by scope/reference.
- Reuse usable-stock rules from existing inventory/lab logic.
- Calculate whether a test/procedure can run now.
- Return simple status and action copy.

Implementation rules:

- For lab tests, prefer existing `lab_test_consumable_map` and `lab_consumables.inventory_item_id` where available; expose as normalized rule output.
- If no normalized rule exists but legacy lab mapping exists, return readiness from legacy mapping.
- If neither exists, return `no_rule`.
- Do not deduct stock here.

### Create: `src/lib/inventory-intelligence/forecast.ts`

Responsibility:

- Aggregate consumption history into average daily usage.
- Compute days of cover.
- Compute reorder point.
- Compute suggested quantity.
- Generate recommendation rows.

Suggested formulas:

```ts
reorderPoint = avgDailyUsage30d * leadTimeDays + avgDailyUsage30d * safetyStockDays;
daysOfCover = avgDailyUsage30d > 0 ? usableStock / avgDailyUsage30d : null;
suggestedOrderQty = Math.max(maxStockQty - usableStock - openPrQty - openPoQty, reorderPoint - usableStock - openPrQty - openPoQty, 0);
```

Trend label:

```ts
if (avg30 === 0 && avg7 === 0) trend = 'no_data';
else if (avg30 === 0 && avg7 > 0) trend = 'new';
else if (avg7 > avg30 * 1.3) trend = 'up';
else if (avg7 < avg30 * 0.7) trend = 'down';
else trend = 'stable';
```

### Create: `src/routes/tenant/inventory/intelligence.ts`

Endpoints:

```text
GET  /api/inventory/intelligence/dashboard
GET  /api/inventory/intelligence/recommendations?status=open&severity=critical
GET  /api/inventory/intelligence/readiness?scope=lab_test&referenceIds=1,2,3
POST /api/inventory/intelligence/recompute
POST /api/inventory/intelligence/recommendations/:id/dismiss
POST /api/inventory/intelligence/recommendations/:id/convert-to-pr
```

### Create or extend: `src/routes/tenant/inventory/consumptionRules.ts`

Endpoints:

```text
GET  /api/inventory/consumption-rules?scope=lab_test
GET  /api/inventory/consumption-rules/:id
POST /api/inventory/consumption-rules
PUT  /api/inventory/consumption-rules/:id
POST /api/inventory/consumption-rules/import-defaults
POST /api/inventory/consumption-rules/:id/verify
```

---

## Frontend UX Changes

### Modify: `web/src/pages/inventory/InventoryDashboard.tsx`

Add a top section: **Smart Stock Assistant**

Cards:

- Critical stockout risk
- Buy within 7 days
- Mapping/rule gaps
- Expiring usable stock
- Abnormal usage

Each card opens a drawer with action rows:

```text
CBC reagent pack
Usable: 35 tests | Avg use: 9/day | Days left: 3.9
Action: Create draft PR for 500 tests
Reason: stock below lead-time + safety-stock requirement
```

### Modify: `web/src/pages/inventory/StockList.tsx`

Add columns:

- usable stock
- blocked stock
- days of cover
- estimated stockout date
- trend
- recommendation status

### Modify: `web/src/pages/LabMonitoringDashboard.tsx`

Add a **Test Readiness Matrix** tab:

- List all active lab tests.
- Badge: OK / Low / No stock / No rule.
- Show required consumables per test.
- Button for “Use default rule”, “Edit quantity”, “Verify rule”.

### Modify: OT UI page

Find current OT page route/component, then add **Operation Pack Readiness**:

- operation/procedure template
- mandatory consumables
- optional consumables
- per-operation default quantity
- actual-used confirmation before deduction

---

## Default Rule Strategy

### Lab defaults

Keep existing `src/lib/lab-reagent-defaults.ts` but evolve it from only seeding legacy `lab_test_consumable_map` to also seeding normalized `inventory_consumption_rule` rows.

Important: the default must not pretend every analyzer consumes the same mL. Store starter defaults as:

```text
unit = test
quantity_per_event = 1
calibration_status = needs_review
confidence = starter
notes = Validate/override per analyzer kit IFU and hospital SOP.
```

Then allow hospitals to set:

```text
CBC → CBC reagent pack → 0.35 mL per test
CBC → EDTA tube → 1 pcs per test
LFT → ALT/AST/ALP/Bilirubin reagents → analyzer-specific mL/test
```

### OT defaults

Seed general starter templates, but keep them inactive until hospital enables them:

- Normal delivery pack
- C-section pack
- Appendectomy pack
- D&C pack
- General minor procedure pack
- Dressing pack

Each pack should use `manual_confirm` by default because actual OT usage varies.

---

## Task Breakdown

### Task 1: Add inventory intelligence schema

**Files:**
- Create: `migrations/0XXX_inventory_intelligence.sql`
- Test: `test/integration/routes/inventory/inventory-intelligence-schema.test.ts`

- [ ] Find the next available migration number.
- [ ] Create additive tables listed in “Data Model Changes”.
- [ ] Add indexes:
  - `inventory_consumption_rule(tenant_id, rule_scope, reference_id, status)`
  - `inventory_consumption_rule_item(tenant_id, rule_id)`
  - `inventory_demand_daily(tenant_id, inventory_item_id, demand_date)`
  - `inventory_stock_intelligence_snapshot(tenant_id, recommendation_status)`
  - `inventory_recommendation(tenant_id, status, severity, created_at)`
- [ ] Write a migration smoke test that verifies all tables can be queried.

### Task 2: Build readiness calculator

**Files:**
- Create: `src/lib/inventory-intelligence/types.ts`
- Create: `src/lib/inventory-intelligence/readiness.ts`
- Test: `test/unit/inventory-intelligence/readiness.test.ts`

- [ ] Test `no_rule` when no active rule or legacy mapping exists.
- [ ] Test `ok` when usable stock covers required quantity.
- [ ] Test `low` when current event is covered but remaining events/days of cover is low.
- [ ] Test `no_stock` when mandatory stock is missing.
- [ ] Test that expired/QC-blocked/onboard-expired stock is not counted.
- [ ] Implement calculator without stock mutation.

### Task 3: Build forecast and recommendation service

**Files:**
- Create: `src/lib/inventory-intelligence/forecast.ts`
- Test: `test/unit/inventory-intelligence/forecast.test.ts`

- [ ] Test average usage windows: 7d/30d/90d.
- [ ] Test reorder point = lead-time demand + safety stock demand.
- [ ] Test suggested quantity considers max stock, open PR, and open PO.
- [ ] Test trend labels: new/up/down/stable/no_data.
- [ ] Test estimated stockout date.
- [ ] Implement pure calculation helpers first, then DB aggregation helper.

### Task 4: Add intelligence routes

**Files:**
- Create: `src/routes/tenant/inventory/intelligence.ts`
- Modify: `src/routes/tenant/inventory/index.ts`
- Test: `test/integration/routes/inventory/inventory-intelligence.test.ts`

- [ ] Add dashboard endpoint.
- [ ] Add recommendations list endpoint.
- [ ] Add readiness endpoint.
- [ ] Add recompute endpoint.
- [ ] Add dismiss endpoint.
- [ ] Add convert-to-draft-PR endpoint reusing existing purchase request tables and reorder behavior.
- [ ] Ensure tenant isolation and permissions.

### Task 5: Add normalized consumption rules

**Files:**
- Create: `src/routes/tenant/inventory/consumptionRules.ts`
- Modify: `src/routes/tenant/inventory/index.ts`
- Modify: `src/lib/lab-reagent-defaults.ts`
- Test: `test/integration/routes/inventory/inventory-consumption-rules.test.ts`

- [ ] Add CRUD for rules and rule items.
- [ ] Add default import endpoint.
- [ ] Seed normalized lab rules from existing `DEFAULT_LAB_TEST_REAGENT_PROFILES`.
- [ ] Preserve existing `lab_test_consumable_map` seeding for backward compatibility.
- [ ] Add verify endpoint that marks a rule item `calibration_status = verified`.

### Task 6: Improve reorder endpoint from static to usage-based

**Files:**
- Modify: `src/routes/tenant/inventory/reorder.ts`
- Test: `test/integration/routes/inventory/inventory-reorder-intelligent.test.ts`

- [ ] Keep old fields for compatibility.
- [ ] Add response fields: usable_stock, avg_daily_usage_30d, days_of_cover, estimated_stockout_date, reorder_point, open_pr_qty, open_po_qty, reason_code.
- [ ] Use snapshot table if fresh.
- [ ] Fall back to old static reorder if no demand data exists.

### Task 7: Inventory Smart Dashboard UI

**Files:**
- Modify: `web/src/pages/inventory/InventoryDashboard.tsx`
- Modify: `web/src/lib/queryKeys.ts`
- Test: `web/src/pages/inventory/InventoryDashboard.test.ts`

- [ ] Add Smart Stock Assistant section.
- [ ] Render critical action cards.
- [ ] Add drawer/table for recommendation details.
- [ ] Add convert-to-draft-PR button.
- [ ] Show small-hospital friendly text, not ERP jargon.

### Task 8: Stock list intelligence columns

**Files:**
- Modify: `web/src/pages/inventory/StockList.tsx`
- Test: `web/src/pages/inventory/StockList.test.ts`

- [ ] Add days-of-cover column.
- [ ] Add estimated stockout date column.
- [ ] Add trend badge.
- [ ] Add recommendation status badge.
- [ ] Keep old low-stock filter working.

### Task 9: Lab Test Readiness Matrix

**Files:**
- Modify: `web/src/pages/LabMonitoringDashboard.tsx`
- Test: `web/src/pages/LabMonitoringDashboard.test.ts`

- [ ] Add readiness tab.
- [ ] Load `/api/inventory/intelligence/readiness?scope=lab_test`.
- [ ] Render OK/Low/No stock/No rule badges.
- [ ] Show default rule verification state.
- [ ] Add CTA to import default rules.
- [ ] Add CTA to edit/verify quantity.

### Task 10: OT Operation Pack Readiness

**Files:**
- Search current OT page/component first.
- Modify the OT dashboard/page only after identifying the active route.
- Test corresponding OT page test.

- [ ] Add operation-pack rules with `scope = ot_operation`.
- [ ] Add readiness panel before operation completion.
- [ ] Keep deduction manual-confirm by default.
- [ ] Do not auto-deduct OT packs without nurse confirmation.

### Task 11: Reconciliation and recommendation cleanup

**Files:**
- Modify: `src/routes/tenant/labMonitoring.ts` only if needed.
- Modify: `src/lib/lab-consumables.ts` only if needed.
- Test: existing lab reagent tests plus new integration tests.

- [ ] Ensure lab exceptions create `resolve_exception` recommendations.
- [ ] Ensure missing mappings create `fix_mapping` recommendations.
- [ ] Ensure default/test-equivalent rules create `verify_default_rule` recommendations.
- [ ] Ensure stock deduction still happens exactly once per lab order item.

### Task 12: Verification

**Commands:**

```bash
pnpm exec vitest run test/unit/inventory-intelligence
pnpm exec vitest run test/integration/routes/inventory/inventory-intelligence.test.ts test/integration/routes/inventory/inventory-consumption-rules.test.ts test/integration/routes/inventory/inventory-reorder-intelligent.test.ts
pnpm exec vitest run web/src/pages/inventory/InventoryDashboard.test.ts web/src/pages/inventory/StockList.test.ts web/src/pages/LabMonitoringDashboard.test.ts
pnpm build
```

Expected result:

- New unit tests pass.
- New inventory integration tests pass.
- Updated dashboard/stock/lab UI tests pass.
- Build passes.

---

## Acceptance Criteria

- A small hospital can import default lab/OT rules and immediately see which stock is OK, low, missing, or unmapped.
- Billing/order screens can warn about stock readiness before the lab tries to run the test.
- Lab result finalization still deducts mapped stock once and only once.
- Reorder suggestions include days of cover, expected stockout date, suggested order quantity, and reason.
- Draft purchase requests can be generated from recommendations.
- Default rules are transparent: users can see “starter/default” vs “verified”.
- OT packs are supported without unsafe automatic deduction.
- Existing inventory, lab reagent, pharmacy, ward, and accounting flows are not destructively rewritten.

## Product Decision

Recommended approach: **incremental intelligence layer**, not full AI first.

Start with deterministic calculations and clear suggestions:

- rule-based deduction
- usage trend
- reorder point
- safety stock
- days of cover
- exception-driven action cards

Later, add AI explanations only as a copy/help layer, not as the source of stock truth.
