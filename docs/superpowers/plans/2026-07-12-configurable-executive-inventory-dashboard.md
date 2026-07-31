# Configurable Executive Inventory Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the financial dashboard work, expand it into a tenant-configurable control panel, add inventory/laboratory reagent/radiology stock monitoring, update stale tests, apply the dashboard migration locally, and prepare a clean reviewed branch for main integration.

**Architecture:** Keep calculations in a server-whitelisted registry. Extend the existing tenant KPI configuration to all dashboard widgets while grouping widgets into server-defined sections. Add a focused inventory KPI module that reads existing inventory, lab-consumable, lab-order, and radiology tables; summary requests execute source-only batched queries while drilldowns fetch paginated item/lot rows.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers/D1, SQLite SQL, React 19, TanStack Query, Vitest, Testing Library.

## Global Constraints

- No arbitrary SQL, formulas, or API paths in tenant configuration.
- All queries must be tenant-scoped.
- Do not add incompatible quantities across different units.
- Card total and drilldown total must use the same backend helper.
- Summary endpoints must not execute paginated detail SQL.
- Preserve existing clinical/nursing changes and unrelated branch work.
- Use test-first RED/GREEN cycles for every behavior change.

---

### Task 1: Lock the section-aware widget registry contract

**Files:**
- Modify: `src/routes/tenant/dashboard.ts`
- Modify: `test/integration/routes/dashboard-kpi-config.test.ts`
- Modify: `test/integration/routes/dashboard-kpi-summary.test.ts`
- Modify: `web/src/hooks/useExecutiveDashboardKpis.ts`

**Interfaces:**
- Produces: `ExecutiveDashboardSection = 'management' | 'cash_control' | 'inventory' | 'lab_reagent' | 'radiology_stock'`
- Produces: stable widget keys for inventory, reagent, and radiology metrics.

- [ ] Add failing backend tests asserting the GET config response contains all five sections and the new whitelisted widget keys.
- [ ] Add failing tests asserting PUT rejects unknown widget keys and accepts enable/order/label updates for new keys.
- [ ] Run `pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/dashboard-kpi-config.test.ts test/integration/routes/dashboard-kpi-summary.test.ts` and confirm whitelist failures.
- [ ] Extend the server registry and frontend metric union/default registry with the exact section and widget keys.
- [ ] Re-run the focused tests and confirm they pass.

### Task 2: Add inventory and domain metric helpers

**Files:**
- Create: `src/lib/executive-inventory-kpis.ts`
- Create: `test/integration/routes/dashboard-inventory-kpis.test.ts`
- Modify: `src/routes/tenant/dashboard.ts`

**Interfaces:**
- Produces: `getExecutiveInventoryKpiBreakdown(dbBinding, tenantId, metric, startDate, endDate, page, includeDetails)`.
- Supports metrics: `inventory_stock_skus`, `inventory_low_stock`, `inventory_out_of_stock`, `inventory_expiring_soon`, `inventory_expired`, `inventory_pending_purchase`, `lab_tests_completed`, `lab_reagent_consumed`, `lab_reagent_stock_skus`, `lab_reagent_low_stock`, `lab_reagent_out_of_stock`, `lab_reagent_expiring_soon`, `lab_reagent_qc_issues`, `radiology_exams_completed`, `radiology_stock_skus`, `radiology_low_stock`, `radiology_out_of_stock`, `radiology_expiring_soon`, `radiology_issue_lines`.

- [ ] Write failing integration tests using production-shaped SQLite fixtures for aggregated item stock, duplicate lots, reorder thresholds, expired/near-expiry lots, and pending purchase requests.
- [ ] Add failing tests that count distinct SKUs rather than stock rows.
- [ ] Add failing tests that summary totals equal drilldown totals and detail rows retain unit, lot, expiry, store, available quantity, and reorder level.
- [ ] Run the new test file and confirm RED failures.
- [ ] Implement domain predicates: inventory is all active items; lab reagent is `ItemType='lab_reagent'`; radiology is explicit `radiology_consumable` plus category/subcategory/store fallback matching `radiology`, `imaging`, `xray`, or `x-ray`.
- [ ] Implement source-only and detailed query paths; use D1 batch for independent summaries.
- [ ] Wire new metrics into `/kpi-summary` and `/kpi-breakdown`.
- [ ] Re-run the focused tests and confirm GREEN.

### Task 3: Reconcile laboratory tests, reagent consumption, and QC

**Files:**
- Modify: `src/lib/executive-inventory-kpis.ts`
- Modify: `test/integration/routes/dashboard-inventory-kpis.test.ts`

**Interfaces:**
- `lab_tests_completed` counts completed/resulted/verified lab order items in the selected period.
- `lab_reagent_consumed` sums canonical out-quantity only for `lab_reagent` items and exposes per-item unit in drilldown.
- `lab_reagent_qc_issues` counts active lots with pending, failed, rejected, or quarantined QC states.

- [ ] Add failing tests for completed versus cancelled/pending lab tests.
- [ ] Add failing tests for reagent consumption reversal/net quantity and non-reagent exclusion.
- [ ] Add failing tests for QC issue statuses and tenant isolation.
- [ ] Run focused tests and verify expected failures.
- [ ] Implement the minimum SQL needed to pass, preferring existing lab movement and inventory transaction records without duplicating consumption.
- [ ] Re-run tests and confirm all reagent reconciliation assertions pass.

### Task 4: Add radiology/X-ray inventory classification

**Files:**
- Modify: `src/schemas/inventory.ts`
- Modify: `web/src/pages/inventory/InventoryMasterDataPage.tsx`
- Modify: `test/integration/routes/inventory/inventory-items.test.ts`
- Modify: `web/src/pages/inventory/InventoryMasterDataPage.test.tsx` if present, otherwise create it.

**Interfaces:**
- Produces accepted `ItemType='radiology_consumable'`.
- Existing consumable records remain supported through backend fallback classification.

- [ ] Add failing API schema test for creating a radiology consumable item.
- [ ] Add failing UI test asserting the item-type selector offers Radiology / X-ray Consumable.
- [ ] Run the focused backend and web tests and confirm RED.
- [ ] Extend Zod validation and item-master options without changing persisted existing records.
- [ ] Re-run tests and confirm GREEN.

### Task 5: Render configurable sections and section master switches

**Files:**
- Modify: `web/src/hooks/useExecutiveDashboardKpis.ts`
- Modify: `web/src/components/dashboard/DashboardKpiConfigurator.tsx`
- Modify: `web/src/components/dashboard/DashboardKpiConfigurator.test.tsx`
- Modify: `web/src/components/dashboard/ExecutiveControlKpis.tsx`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`
- Modify: corresponding focused component tests.

**Interfaces:**
- Produces `sections` with title, enabled widgets, and all widgets.
- Section master switch updates every child widget in the local draft; save remains a single validated PUT.

- [ ] Add failing configurator tests for five section headings, section on/off, child override, order, label, and unauthorized role behavior.
- [ ] Add failing dashboard tests asserting empty sections are hidden and enabled inventory/reagent/radiology cards render server totals.
- [ ] Run focused web tests and confirm RED.
- [ ] Implement section grouping and master toggles while preserving individual widget controls.
- [ ] Render new sections in Admin, MD, and Director dashboards through the shared hook.
- [ ] Re-run focused tests and accessibility tests.

### Task 6: Update stale tests and complete review findings

**Files:**
- Review and update only stale assertions/mocks in:
  - `web/src/App.inventory-permission-routes.test.ts`
  - `web/src/components/dashboard/AdminKpiInvoiceModal.test.tsx`
  - `web/src/components/dashboard/Header.test.tsx`
  - `web/src/components/dashboard/adminSidebarConfig.test.ts`
  - `web/src/components/reception/ReceptionPatientDrawer.test.tsx`
  - `web/src/pages/ReceptionReportsPage.test.ts`

**Interfaces:**
- No production behavior change unless a failing test exposes a verified defect; every defect fix requires a reproducing test.

- [ ] Run each stale test file individually and classify failure as stale test or production bug.
- [ ] For stale tests, update fixtures, accessible queries, mocks, and expected current labels/routes.
- [ ] For production bugs, keep the failing test and implement the minimal fix.
- [ ] Run the six files together until all pass.
- [ ] Run full web Vitest and confirm no failures.

### Task 7: Migration, schema, and local apply verification

**Files:**
- Review/modify: `migrations/0416_dashboard_kpi_configuration.sql`
- Review/modify: `src/db/schema/schema.ts`
- Review/modify: `tenant-schema.sql`
- Add migration safety assertions to `test/integration/routes/dashboard-kpi-config.test.ts` or migration tests.

**Interfaces:**
- Migration remains idempotent and tenant-scoped.
- No metric/widget SQL is persisted.

- [ ] Add or confirm tests for table constraints, tenant composite primary key, label length, enabled boolean, and position bounds.
- [ ] Run migration manifest build.
- [ ] Apply all pending migrations to the configured local D1 database using the repository migration command.
- [ ] Query/verify the local schema through the repository-supported migration verification test or command.
- [ ] Re-run dashboard config integration tests.

### Task 8: Final adversarial review and integration readiness

**Files:**
- Review all task-related diffs.
- Update: `docs/task-logs/2026-07-11-daily-cash-closing-report-refactoring.md`
- Update: `.ai-bridge/current-plan.md` only as required by the workspace workflow.

**Interfaces:**
- Produces a clean, verified branch ready for main integration.

- [ ] Run `pnpm exec vitest run`.
- [ ] Run `pnpm test:integration`.
- [ ] Run `pnpm --filter web test`.
- [ ] Run root and web TypeScript checks.
- [ ] Run migration manifest build and production web build.
- [ ] Run diff hygiene checks and search for old client-side formulas.
- [ ] Review tenant scoping, mixed-unit aggregation, role visibility, summary/detail equality, date boundaries, pagination, and missing optional table behavior.
- [ ] Confirm unrelated clinical/nursing changes were not rewritten.
- [ ] Prepare task-related commits and integrate into `main` only after all checks are green and the working tree contains no ambiguous unrelated changes.
