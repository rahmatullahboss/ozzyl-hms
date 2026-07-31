# LIS Existing Implementation Audit

Date: 2026-07-09
Workspace: `@Hms` branch `abdullah`
Purpose: prevent duplicate implementation while evolving Ozzyl HMS LIS using OpenELIS as a reference.

## Executive conclusion

The repository already has a broader LIS/reagent foundation than the initial OpenELIS comparison implied. Future work must extend and consolidate the current modules, not rebuild parallel modules.

The correct product direction is:

- Keep Ozzyl HMS as the source of truth.
- Use OpenELIS only as a reference benchmark.
- Reuse existing Ozzyl routes, tables, and services.
- Add missing layers through current service boundaries.
- Avoid creating second versions of validation, QC, sample lifecycle, unit mapping, or reagent mapping.

## Existing implementation found

### 1. Machine capabilities and machine master

Existing files:

- `src/lib/lab-machine-capabilities.ts`
- `src/schemas/labMachine.ts`
- `src/routes/tenant/labMachines.ts`
- `web/src/pages/LabMachineSettings.tsx`

Current capability:

- Supported machine protocols/types are already centralized in `lab-machine-capabilities.ts`.
- Machine CRUD already supports machine type, manufacturer, model, protocol, connection type, host, port, baud, and bidirectional flag.
- New `lab-analyzer-profiles.ts` should remain vendor/model profile defaults and should not replace the generic capability catalog.

Duplicate-prevention rule:

- Do not create another generic machine capability registry.
- Keep generic capabilities in `lab-machine-capabilities.ts`.
- Keep vendor/model setup presets in `lab-analyzer-profiles.ts`.

### 2. Analyzer ingestion and matching

Existing files:

- `src/routes/tenant/labMachines.ts`
- `src/lib/hl7-parser.ts`
- `src/lib/astm-parser.ts`
- `tools/lab-middleware/index.js`

Current capability:

- Raw HL7/ASTM receive paths exist.
- Machine test mapping is used during ingestion.
- Result matching supports barcode, specimen number, control ID, and order number.
- Payment/billing clearance gate exists before machine result mapping.
- QC gate exists before machine result mapping.
- Duplicate exact result is skipped.
- Corrected result is logged.
- Final-like machine results can consume mapped lab reagents according to policy.
- Result writes `lab_order_items`, `lab_results`, and `lab_observation_audit` where available.

Duplicate-prevention rule:

- Do not create a separate analyzer-result writer.
- Reprocess/rerun features should call or extract the existing `processResult` flow rather than writing result tables independently.

### 3. Unmatched result queue

Existing files:

- `src/routes/tenant/labMachines.ts`
- `web/src/pages/LabMachineSettings.tsx`
- `test/lis-unmatched-candidates.test.ts`
- `docs/reports/2026-06-29-lab-reagent-phase1-slice-22.md`

Current capability:

- Unmatched queue table is used by machine ingestion.
- List/filter endpoint exists.
- Manual resolve/ignore exists.
- Candidate search endpoint exists.
- UI allows candidate search and manual ID fallback.
- Resolving can consume mapped reagents once.

Duplicate-prevention rule:

- Do not build another unmatched queue page or table.
- Next improvements should add richer context/confidence to the existing queue.

### 4. Unit conversion/machine unit mapping

Existing files:

- `src/schemas/labMachine.ts`
- `src/routes/tenant/labMachines.ts`
- `web/src/pages/LabMachineSettings.tsx`
- `migrations/0143_lis_full_upgrade.sql`

Current capability:

- `lab_machine_test_map` already stores `machine_unit` and `conversion_factor`.
- Machine ingestion applies `conversion_factor` before saving numeric result.
- UI already shows/edits machine unit and conversion factor in test mapping.

Gap:

- There is no separate canonical unit dictionary or reusable conversion rule registry.
- Unknown unit handling is not formalized as validation/warning/block mode.

Duplicate-prevention rule:

- Do not create a second basic unit mapping table without migration design.
- Next unit work should extend `lab_machine_test_map` or add a normalized unit dictionary referenced by it.

### 5. Result validation engine

Existing files:

- `src/routes/tenant/labValidation.ts`
- `src/schemas/lab.ts`
- `src/routes/tenant/lab.ts`
- `src/routes/tenant/lab-results.ts`
- `migrations/0172_lab_validation_rules.sql`
- `test/lab-routes.test.ts`
- `test/integration/real-db/lab-validation.test.ts`

Current capability:

- Validation rule CRUD exists.
- Validation engine exists with range, mandatory, delta, and dependency rule types.
- Manual lab result entry calls `validateLabResult`.
- `lab-results` route calls `validateLabResult`.
- Blocking and warning behavior already exists.

Gap:

- Machine analyzer ingestion path does not visibly call `validateLabResult` before writing machine results.
- Validation UI and profile-specific qualitative rules may need extension.

Duplicate-prevention rule:

- Do not build another validation engine.
- Next validation work should wire existing `validateLabResult` into machine ingestion and extend the existing rule schema only when needed.

### 6. QC, Westgard, and calibration

Existing files:

- `src/routes/tenant/labQc.ts`
- `src/routes/tenant/labCalibrations.ts`
- `src/routes/tenant/labMachines.ts`
- `web/src/pages/LabQcDashboard.tsx`
- `migrations/0172_lab_qc_calibrations.sql`
- `test/lab-core-units.test.ts`
- `test/lab-critical-fixes.test.ts`
- `web/src/pages/LabQcDashboard.test.tsx`

Current capability:

- QC controls CRUD exists.
- QC ranges CRUD exists.
- QC result recording exists.
- Westgard evaluator exists with 1-3s, 1-2s, 2-2s, R-4s, 4-1s, and 10-x checks.
- Calibration CRUD and upcoming/overdue views exist.
- Machine QC gate checks QC ranges, latest QC result, Westgard violations, and calibration state.
- QC dashboard exists.

Gap:

- Analyzer QC/control samples are not yet automatically detected from incoming analyzer messages.
- QC strictness is available through gate logic but needs rollout/UX consistency.

Duplicate-prevention rule:

- Do not build a second QC or Westgard module.
- Extend existing `labQc.ts`, `labCalibrations.ts`, and `evaluateMachineQcGate`.

### 7. Reagent inventory, mapping, policy, and analyzer assignment

Existing files:

- `src/lib/lab-consumables.ts`
- `src/lib/lab-inventory-policy.ts`
- `src/lib/lab-reagent-defaults.ts`
- `src/routes/tenant/labMonitoring.ts`
- `src/routes/tenant/billingCounter.ts`
- `migrations/0392_lab_reagent_analyzer_assignments.sql`
- `migrations/0393_lab_inventory_policy.sql`
- `migrations/0395_lab_inventory_policy_modes.sql`
- `migrations/0396_lab_test_consumable_map_lifecycle.sql`
- `test/lab-consumables-hardening.test.ts`
- `test/lab-consumables-automation.test.ts`
- `test/lab-consumable-stock-lifecycle-db.test.ts`
- `test/integration/routes/lab-monitoring-critical.test.ts`

Current capability:

- Test-to-consumable mapping exists through `lab_test_consumable_map`.
- Mapping has lifecycle fields: active/effective/deleted metadata.
- Lab Monitoring exposes test-consumable map CRUD and bulk import.
- Reagent consumption policy exists: disabled/soft/strict and billing/result timing.
- Analyzer assignment table exists for reagent lots.
- Analyzer health endpoint exists and reports unmatched results and assignment coverage.
- Manual usage supports manual, rerun, control, QC, calibration, and other.
- Consumption idempotency and strict readiness tests exist.

Gap:

- Reconciliation UI/reporting can be improved.
- Setup wizard could guide profile selection, mapping, analyzer assignment, and strict readiness.
- Analyzer event types for QC/calibration/blank/waste should feed current manual usage/canonical consumption paths, not new stock ledgers.

Duplicate-prevention rule:

- Do not create another reagent mapping table unless migration plan explicitly deprecates or normalizes `lab_test_consumable_map`.
- Do not create another analyzer assignment table.
- Do not bypass `consumeMappedLabConsumables` or the canonical inventory issue path.

### 8. Sample lifecycle

Existing files:

- `src/routes/tenant/labWorkflow.ts`
- `migrations/0022_lab_enhancements.sql`
- `migrations/0182_diagnostic_lis_ris_readiness.sql`

Current capability:

- Sample collection exists.
- Lab receive exists.
- Sample processing exists.
- Report verification exists.
- Workflow events are recorded with `recordLabWorkflowEvent`.
- Barcode/specimen number generation exists in collection flow.

Gap:

- Physical storage location/rack/box/position for retained samples is not yet confirmed in current HMS code.
- Referral/shipment/custody layer is not complete.

Duplicate-prevention rule:

- Do not create another sample status lifecycle from scratch.
- Add storage/referral events on top of `labWorkflow` and existing workflow event log.

### 9. Reporting and monitoring

Existing files:

- `src/routes/tenant/labMonitoring.ts`
- `web/src/pages/LabMonitoringDashboard.tsx`
- `docs/reports/2026-07-04-inventory-a-z-enterprise-review.md`

Current capability:

- Analyzer health endpoint exists.
- Mapping coverage and strict readiness exist.
- Lab monitoring dashboard already includes reagent/manual usage/QC-related workflows.

Gap:

- TAT report for LIS stages should be implemented as an extension over existing timestamps and workflow events.
- Reagent reconciliation can be improved using billed/performed/resulted/consumed views.

Duplicate-prevention rule:

- Reports should reuse existing lab order timestamps, workflow events, inventory consumption, and lab monitoring endpoints.

## Test/audit verification run

Commands run during this audit:

```bash
pnpm exec vitest run test/lab-routes.test.ts test/lab-machine-integration-readiness.test.ts test/lab-analyzer-profiles.test.ts
pnpm exec vitest run test/lab-consumables-hardening.test.ts test/lab-consumables-automation.test.ts test/integration/routes/lab-monitoring-critical.test.ts
pnpm exec vitest run test/lab-critical-fixes.test.ts test/lab-core-units.test.ts
cd web && pnpm exec vitest run src/pages/LabMachineSettings.test.ts src/pages/LabQcDashboard.test.tsx
pnpm exec tsc --noEmit
cd web && pnpm exec tsc --noEmit
```

Observed result:

- Backend targeted lab/LIS/validation/reagent/QC tests: 90 tests passed.
- Web LIS/QC page tests: 10 tests passed.
- Root typecheck passed.
- Web typecheck passed.

## Corrected next-work rule

Before implementing any LIS feature:

1. Search for existing route/lib/schema/migration/test.
2. Decide: extend, consolidate, or deprecate.
3. Do not introduce a second table/service if an equivalent exists.
4. Add tests against the existing domain boundary.
5. Update this audit if the boundary changes.

## Correct next backlog after audit

1. Wire existing `validateLabResult` into machine analyzer ingestion.
2. Add analyzer profile relation to existing machine capabilities, not a duplicate capability catalog.
3. Generate middleware config snippet from existing machine/profile data.
4. Add qualitative mapping by extending machine test mapping/validation, not creating a separate result engine.
5. Add analyzer reprocess by extracting/reusing `processResult` logic.
6. Add sample storage/referral on top of `labWorkflow`, not a new sample lifecycle.
7. Improve TAT/reconciliation reports using existing workflow timestamps and consumption records.
