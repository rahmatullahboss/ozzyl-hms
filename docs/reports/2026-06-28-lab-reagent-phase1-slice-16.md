Lab Reagent Inventory Phase 1 Slice 16

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

Goal
Add analyzer assignment tracking for canonical lab reagent stock lots.

Completed
- Added migration 0392_lab_reagent_analyzer_assignments.sql.
- Added analyzer assignment table for InventoryStock reagent lots.
- Added backend route to assign a linked reagent lot to analyzer machine or analyzer location.
- Route validates linked canonical stock, machine/location, ends previous active assignment, inserts new active assignment, touches InventoryStock metadata, writes compatibility operation log, and writes InventoryAuditLog when available.
- Synced labMonitoring.js.
- Added DB integration test for first assignment, replacement assignment, one active assignment, ended previous assignment, operation logs, and audit logs.

Verification
- pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts: 1 file passed, 10 tests passed.
- pnpm exec vitest run test/integration/routes/lab-monitoring-critical.test.ts: 1 file passed, 2 tests passed.
- pnpm exec vitest run test/lab-monitoring-stock-queries.test.ts: 1 file passed, 9 tests passed.
- pnpm vitest run: 678 files passed, 14,304 tests passed.

Notes
- First full backend run had a transport payload interruption, then rerun passed.
- Analyzer assignment is canonical-only for linked InventoryStock reagent lots.

Remaining work
- Add UI controls for analyzer assignment.
- Show active analyzer assignment in stock lot detail.
- Add LIS event ingestion skeleton using active assignment context.
