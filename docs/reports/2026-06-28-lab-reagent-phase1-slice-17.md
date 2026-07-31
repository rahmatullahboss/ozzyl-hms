Lab Reagent Inventory Phase 1 Slice 17

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

Goal
Expose active analyzer assignment context in Lab Monitoring stock lots and make assignment usable from the UI.

Completed
- Added GET /api/lab-monitoring/machines for analyzer machine options.
- Extended canonical InventoryStock stock detail projection with active analyzer assignment fields.
- Added machine assignment fields to LabMonitoringDashboard stock lot type.
- Added machine list query and machine assignment form state.
- Added stock lot display for current machine/location assignment.
- Added Assign machine button for inventory-backed lots only.
- Added Stock Controls form to assign a canonical stock lot to a machine and/or location.
- Strengthened DB integration test to assert assignment detail projection and machine list endpoint.

Verification
- pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.test.ts: 1 file passed, 4 tests passed.
- pnpm --filter web exec tsc --noEmit: passed.
- pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts: 1 file passed, 10 tests passed.
- pnpm exec vitest run test/integration/routes/lab-monitoring-critical.test.ts: 1 file passed, 2 tests passed.
- pnpm exec vitest run test/lab-monitoring-stock-queries.test.ts: 1 file passed, 9 tests passed.
- pnpm vitest run: 678 files passed, 14,304 tests passed.

Notes
- Machine assignment remains canonical-only for InventoryStock-backed lab reagent lots.
- Reassigning a lot is handled by the backend endpoint and ends the previous active assignment.
- UI form is intentionally simple and can be polished later with filtered analyzer locations.

Next
- Add LIS/analyzer event ingestion skeleton using active assignment context.
- Optionally add richer UI render tests with mocked API data.
