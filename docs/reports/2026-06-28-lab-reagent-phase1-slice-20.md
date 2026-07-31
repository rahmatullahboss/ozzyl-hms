Lab Reagent Inventory Phase 1 Slice 20

Date: 2026-06-29
Branch: feature/lab-reagent-mis-ready-inventory

Goal
Add operational Lab Monitoring cues for LIS/analyzer health and reagent analyzer assignment coverage.

Completed
- Added GET /api/lab-monitoring/analyzer-health.
- Endpoint summarizes open unmatched LIS results, machine count, active reagent analyzer assignments, machines covered by assignment, inventory-backed reagent lots, and unassigned inventory-backed reagent lots.
- Endpoint is defensive: missing optional LIS/inventory tables return zeroed metrics instead of breaking Lab Monitoring overview.
- Added Lab Monitoring overview card showing Analyzer / LIS health.
- UI card highlights Needs attention when open unmatched results or unassigned inventory-backed reagent lots exist.
- Added exported helper analyzerHealthNeedsAttention.
- Added backend DB integration test for analyzer health metrics.
- Added frontend helper test for health attention state.
- Synced src/routes/tenant/labMonitoring.js sibling.

Verification
- pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts: 1 file passed, 11 tests passed.
- pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.test.ts: 1 file passed, 5 tests passed.
- pnpm --filter web exec tsc --noEmit: passed.
- pnpm exec tsc --noEmit: passed.
- pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts test/lab-monitoring-stock-queries.test.ts test/integration/routes/lab-monitoring-critical.test.ts test/lab-machine-integration-readiness.test.ts: 4 files passed, 31 tests passed.
- pnpm exec vitest run: 678 files passed, 14,310 tests passed.

Notes
- This does not add automatic alerting yet; it adds dashboard visibility and health metrics.
- The health endpoint is intentionally Lab Monitoring scoped so lab/admin users can see reagent assignment and unmatched LIS queue pressure in the same page.

Next
- Add drill-down links/buttons from the health card to unmatched LIS queue and stock assignment workflows.
- Optionally add machine-wise breakdown for which analyzer has unmatched results or no assigned reagent lots.
