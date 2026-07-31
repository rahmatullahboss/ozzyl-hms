Lab Reagent Inventory Phase 1 Slice 27

Date: 2026-06-29
Branch: feature/lab-reagent-mis-ready-inventory

Goal
Allow hospitals to adjust default test-to-reagent quantities directly instead of deleting and recreating reagent mappings.

Completed
- Added PUT /api/lab-monitoring/test-consumable-map/:id.
- The update endpoint supports qty_per_test, is_mandatory, and notes.
- The endpoint validates positive quantities and rejects empty update payloads.
- The endpoint is tenant-scoped and returns 404 when the mapping does not belong to the tenant.
- Synced the runtime JS sibling for labMonitoring.
- Added inline edit controls in Lab Monitoring > Test-to-reagent consumption mapping:
  - Edit button per row
  - qty_per_test numeric input
  - mandatory checkbox
  - notes input
  - Save/Cancel actions
- Added mappingUpdatePayload helper to normalize UI payload and reject invalid quantities.
- Added backend integration test verifying inline update persists qty_per_test/is_mandatory/notes and appears in list response.
- Added frontend helper test for mapping update payload behavior.

Verification
- pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts: 1 file passed, 14 tests passed.
- pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.test.ts: 1 file passed, 8 tests passed.
- pnpm exec tsc --noEmit: passed.
- pnpm --filter web exec tsc --noEmit: passed.
- pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts test/lab-reagent-defaults.test.ts test/lab-consumables-automation.test.ts: 3 files passed, 20 tests passed.
- pnpm exec vitest run: 679 files passed, 14,319 tests passed.

Product behavior now
- Default reagent mapping seed gives a useful starter configuration.
- Hospital/admin can override quantity, mandatory/optional mode, and notes from the mapping table without delete/recreate.
- Existing billing-time reagent consumption uses the updated qty_per_test value on later bills.

Next
- Add tenant-level lab inventory policy: consume mapped reagents on billing for no-LIS hospitals, or on result finalization for full-LIS hospitals.
- Show billing response reagentUsageWarnings in the UI when stock deduction fails after bill finalization.
