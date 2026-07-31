Lab Reagent Inventory Phase 1 Slice 21

Date: 2026-06-29
Branch: feature/lab-reagent-mis-ready-inventory

Goal
Improve the Lab Monitoring Analyzer / LIS health cue with direct actions and machine-wise attention breakdown.

Completed
- Extended GET /api/lab-monitoring/analyzer-health with machine_breakdown.
- machine_breakdown includes machine_id, machine name/code, open unmatched LIS queue count, active reagent assignment count, and needs_attention.
- Machine attention is true when the analyzer has open unmatched results or no active reagent assignment.
- Fixed LabMonitoringDashboard placement so Analyzer / LIS health card shows independently of stock alert banners.
- Added health-card actions:
  - Manage reagent assignment: switches to Stock Controls tab.
  - Open machine settings: links to lab machine settings route.
- Added machine-wise mini-list in the health card for the first four analyzers needing review/coverage context.
- Added frontend helper analyzerMachineNeedsAttention.
- Added frontend tests for machine-wise attention and aggregate health attention.
- Strengthened backend DB integration test to assert machine_breakdown.
- Synced src/routes/tenant/labMonitoring.js sibling.

Verification
- pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts: 1 file passed, 11 tests passed.
- pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.test.ts: 1 file passed, 6 tests passed.
- pnpm --filter web exec tsc --noEmit: passed.
- pnpm exec tsc --noEmit: passed.
- pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts test/lab-monitoring-stock-queries.test.ts test/integration/routes/lab-monitoring-critical.test.ts test/lab-machine-integration-readiness.test.ts: 4 files passed, 31 tests passed.
- pnpm exec vitest run: 678 files passed, 14,310 tests passed.

Review notes
- Previous health card placement was inside the low-stock/expiring alert banner conditional, so it could stay hidden when no stock alert existed. This slice moves it outside that conditional.
- The machine settings link targets the existing lab machine settings route; unmatched LIS result queue still has no separate dedicated frontend page.

Next
- Add a dedicated unmatched LIS result queue UI or extend LabMachineSettings with an unmatched-results tab.
- Add filters/deep links from each machine row to the matching machine settings/logs view.
