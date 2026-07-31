# Inventory Intelligence UI + System Review

Date: 2026-07-05
Scope: Smart Stock Assistant UI, inventory intelligence backend slice, schema/migration, forecast helpers, dashboard wiring, tests/build status.

## Executive Verdict

The current implementation is a strong UI and backend foundation, but it is not yet a complete intelligent stock-management system. It is safe to keep as a first slice because it compiles, targeted tests pass, and it degrades gracefully when intelligence tables are missing. However, it should not be presented to hospitals as fully intelligent until the recompute/data-population layer is implemented.

Current maturity: 65/100
- UI direction: 82/100
- Backend foundation: 70/100
- Data completeness: 45/100
- Operational readiness for small hospitals: 68/100
- Verification quality: 72/100

## What Is Good

1. The UI has moved from static inventory KPIs toward an action-first command center.
   - Hero communicates deterministic rules, not AI magic.
   - Verdict card gives staff a simple daily status: Ready, Ready with risk, Blocked today.
   - Smart stock action queue supports recommendations from the backend.
   - Reorder, alerts, recent movements, quick operations and barcode traceability are visible on one page.

2. The backend has a sensible first intelligence abstraction.
   - Forecast helpers calculate days of cover, reorder point, suggested order quantity, stockout date, trend, and recommendation status.
   - New route `/api/inventory/intelligence/dashboard` gives a dashboard-friendly summary.
   - Missing table errors are now handled specifically instead of hiding every DB failure.
   - Dismiss validates positive integer ids.

3. The schema covers the right concepts.
   - consumption rules
   - rule items
   - daily demand
   - stock intelligence snapshots
   - recommendation action cards

4. Tests are improved.
   - Pure forecast helper tests pass.
   - Dashboard smart helper tests pass.
   - Route helper tests pass.
   - InventoryDashboard render test passes in web Vitest.
   - Production web build passes.

## Critical Gaps Before Calling It Complete

### P0 — Intelligence data is not being generated yet

The UI reads from `inventory_stock_intelligence_snapshot` and `inventory_recommendation`, but there is no recompute service, scheduled job, queue consumer, or manual recompute endpoint that populates these tables from real InventoryStock, stock movements, lab consumption, PR/PO and demand history.

Impact: hospitals will see a polished dashboard, but the smart cards may remain empty or misleading unless data is manually inserted.

Required fix:
- Add `src/lib/inventory-intelligence/recompute.ts`.
- Compute usable stock, blocked stock, avg 7/30/90-day usage, days cover, reorder point, open PR/PO qty, stockout date and recommendation status.
- Upsert snapshots into `inventory_stock_intelligence_snapshot`.
- Upsert open recommendation cards with dedupe.
- Add `POST /api/inventory/intelligence/recompute` for admin/manual refresh.
- Later run via queue/cron after stock movement, GRN, issue, lab consumption, PR/PO changes.

### P0 — Existing reorder suggestions are still static

`src/routes/tenant/inventory/reorder.ts` still uses current stock <= ReOrderLevel and suggested quantity = MaxStockQuantity gap or ReOrderLevel * 2 gap. It does not yet use average usage, lead time, safety stock, open PR/PO, expiry/QC/blocked stock, or intelligence snapshots.

Impact: the old reorder card can contradict the new smart stock assistant.

Required fix:
- Reorder endpoint should prefer intelligence snapshots.
- Fallback to legacy static logic only when snapshots are missing.
- Show source in API response: `source: intelligence_snapshot | legacy_reorder_level`.

### P1 — Reorder formula enum mismatch exists

Migration `0256_reorder_config.sql` allows `reorder_x2_minus_current`, but `src/routes/tenant/inventory/reorder.ts` accepts `reorder_level_multiply`. This can break updates against a real database with CHECK constraints.

Required fix:
- Align enum names across migration, API schema, tests and UI.
- Prefer one of: `reorder_x2_minus_current` or `reorder_level_multiply`, not both.

### P1 — Dashboard has duplicated rule examples

The page currently has both:
- Lab & OT readiness model
- Reagent readiness

Both show the same DEFAULT_RULE_EXAMPLES. This is useful for initial demo, but for a real small hospital it creates duplicated cognitive load.

Required fix:
- Merge these into one `Service readiness` panel.
- Split actual data into tabs/chips: Lab Tests, Radiology, OT, Ward.
- Keep only one safety note.

### P1 — Verdict can say Ready even when intelligence is not calibrated

If intelligence tables exist but no recompute has run, summary can be 0/0/0/0. The helper then returns Ready when old summary has no alerts.

Impact: a newly installed hospital may think the stock brain is active although no intelligence data exists.

Required fix:
- Add status to backend response: `not_configured | computing | ready | stale | error`.
- UI verdict should show `Setup needed` or `Learning mode` when snapshot count is zero.
- Show `lastComputedAt` and stale warning.

### P1 — Schema needs stronger production constraints

Migration 0399 is intentionally additive and light, but production should add constraints/indexes:
- CHECK for rule_scope, trigger_event, status, confidence, trend_label, recommendation_status, severity.
- FK to inventory items where safe.
- Unique active rule per tenant/scope/reference/trigger where appropriate.
- Dedup key for open recommendations to prevent repeated cards.
- Tenant-scope consistency for rule items.

### P1 — Usable stock needs FEFO/QC/expiry semantics at recompute level

The lab consumption path already filters usable stock with FEFO/QC/expiry behavior, but the intelligence snapshot currently has no recompute service enforcing the same logic.

Required fix:
- Use the same usable stock semantics as consumption: active stock, accepted QC, not expired, after-open expiry safe, not blocked/reserved.

### P2 — Human factors and accessibility need hardening

The dashboard is visually strong, but should add:
- explicit aria-label for scan input and icon-only controls where missing
- keyboard shortcut/help for scanner flow
- clear color + text labels together, not color-only status
- reduced motion/focus states for critical buttons
- mobile stacking review for 360px Android screens
- axe test for InventoryDashboard

### P2 — Recommendation cards need direct action flows

Cards currently show text and suggested quantity, but no per-card action button except page-level Create PO.

Required fix:
- Critical card actions: Create PR/PO, Fix rule, View stock batch, Dismiss, Snooze.
- Show item code/store/vendor/lead-time in action-card metadata.
- Keep all action clicks audited.

## Best-Practice Comparison

### Healthcare dashboard best practice

Healthcare dashboards should support task performance, interaction workflow, perceived utility, algorithm performance and implementation reliability. Current UI supports task orientation, but algorithm performance and implementation reliability are incomplete until recompute, stale-state and data-quality monitoring exist.

### Inventory best practice

Reorder point should be based on expected lead-time demand plus safety stock. Current forecast helpers support this, but legacy reorder suggestions do not yet use it. FEFO is important for expiring products such as pharmaceuticals and chemicals; intelligence recompute must use FEFO/expiry/QC/blocked stock logic.

### Human-AI/decision-support best practice

The UI correctly avoids AI magic and says deterministic rules. It still needs explanation and confidence/status around recommendations: why this is blocked, what data was used, when it was last computed, and whether the rule is verified or starter.

## Verification Performed

Passed:
- `pnpm exec vitest run test/unit/inventory-dashboard-smart-assistant.test.ts test/unit/inventory-intelligence-forecast.test.ts test/unit/inventory-intelligence-route-helpers.test.ts`
  - 3 files, 15 tests passed.
- `pnpm exec vitest run src/pages/inventory/InventoryDashboard.render.test.tsx` from `web/`
  - 1 file, 8 tests passed.
- `pnpm --filter web build`
  - TypeScript + Vite production build passed.

Not clean globally:
- `pnpm --filter web test -- src/pages/inventory/InventoryDashboard.render.test.tsx` invoked the full web test suite and failed on unrelated existing tests:
  - adminSidebarConfig: expected compact menu limits no longer match current menu size.
  - IPDRunningBillPrint: footer/deposit layout assertion.
- InventoryDashboard render test itself passed.

## Recommended Next Implementation Order

1. Build recompute service and manual recompute endpoint.
2. Wire reorder suggestions to intelligence snapshots with legacy fallback.
3. Add intelligence setup/stale state to backend and UI verdict.
4. Merge duplicate readiness panels and add real service readiness matrix.
5. Add recommendation card actions and audit trail.
6. Add InventoryDashboard axe/a11y test and mobile layout test.
7. Add schema constraints/dedup keys in a follow-up migration.

## Final Decision

Do not remove this implementation. It is directionally correct and visually strong. But it is currently a UI + backend foundation, not the full intelligent inventory system. The next must-build slice is the recompute engine; without it, the smart dashboard cannot be trusted for real hospital operations.
