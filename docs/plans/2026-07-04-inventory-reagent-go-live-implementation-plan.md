# Inventory + Reagent Go-Live Implementation Plan

Date: 2026-07-04
Scope: small to mid-level hospital onboarding and reagent/inventory tracking polish.

## Goal
Make first hospital onboarding safer and faster without forcing an enterprise workflow on day one.

## Phase 1 — Implemented in this pass
1. Opening stock import
   - Add CSV import for current stock balance after item/vendor/store setup.
   - Create canonical InventoryStock lot.
   - Create InventoryStockTransaction ledger entry with `opening-stock` transaction type.
   - Mirror lab reagent items into lab reagent tracking so QC, expiry, usage, and reconciliation can start immediately.
2. UI support
   - Add Opening stock option to Inventory Import/Export page.
   - Add sample CSV columns for opening stock.
3. Tests
   - Backend integration test for opening stock import + lab reagent mirroring.
   - Frontend test to lock the onboarding UI affordance.

## Recommended rollout workflow
1. Admin creates default stores from Inventory Quick Start.
2. Admin imports vendors and item master.
3. Admin/storekeeper imports opening stock.
4. Inventory Manager reviews Stock Overview and prints QR labels for sensitive lots.
5. Lab Manager reviews reagent lots, QC status, and test mappings.
6. Start with soft billing-time reagent consumption.
7. Enable strict reagent controls only after mapping coverage and stock quality are clean.

## Still pending after this pass
- A guided setup wizard that chains default stores, item import, opening stock import, and lab mapping in one page.
- More user-friendly error recovery for CSV row corrections.
- Role-specific sidebar/menu visibility polish for storekeeper vs lab tech vs admin.
- Canonical stock movement service refactor for every stock mutation.
- Monthly stock close/reconciliation reports.
