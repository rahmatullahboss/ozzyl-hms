Lab Reagent Inventory Phase 1 Slice 22

Date: 2026-06-29
Branch: feature/lab-reagent-mis-ready-inventory

Goal
Add a dedicated unmatched LIS result queue inside LabMachineSettings so lab users can review unresolved analyzer results from the machine settings workflow.

Completed
- Added machineId/machine_id filter support to GET /api/lab-machines/unmatched-results.
- Added backend route test for filtering unmatched LIS results by machine id.
- Added Unmatched LIS detail tab in LabMachineSettings.
- The tab loads open/resolved/ignored unmatched results for the selected machine.
- Added inline resolve/ignore workflow:
  - Resolve requires lab order item ID and calls the existing resolve endpoint.
  - Ignore calls the same endpoint with status=ignored.
  - Successful action refreshes the queue and Lab Monitoring analyzer-health data.
- Added frontend helpers unmatchedResultLabel and canResolveUnmatchedResult.
- Added frontend tests for unmatched result label formatting and open-only resolve eligibility.
- Added labMachines.unmatchedResults query key.

Verification
- pnpm --filter web exec vitest run src/pages/LabMachineSettings.test.ts: 1 file passed, 3 tests passed.
- pnpm exec vitest run test/lab-machine-integration-readiness.test.ts: 1 file passed, 10 tests passed.
- pnpm --filter web exec tsc --noEmit: passed.
- pnpm exec tsc --noEmit: passed.
- pnpm exec vitest run test/lab-machine-integration-readiness.test.ts test/lab-consumables-automation.test.ts test/lab-machine-billing-gate.test.ts test/lab-consumable-stock-lifecycle-db.test.ts: 4 files passed, 27 tests passed.
- pnpm exec vitest run: 678 files passed, 14,311 tests passed.

Review notes
- Existing backend resolve endpoint already performs reagent consumption on manual resolution, so the UI uses that endpoint instead of duplicating logic.
- The UI currently accepts a lab order item ID manually. A richer future version can add search/autocomplete by barcode, patient, bill, or specimen.

Next
- Add search/autocomplete for lab order item selection in the unmatched LIS queue.
- Add direct deep link from Lab Monitoring health card to the selected machine's Unmatched LIS tab.
