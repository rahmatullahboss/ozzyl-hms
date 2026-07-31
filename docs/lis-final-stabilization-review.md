# LIS Final Stabilization Review Before Merge/Deploy

Date: 2026-07-09
Branch: `abdullah`
Scope: final Ozzyl HMS LIS stabilization review before merging/deploying the analyzer integration work.

This review follows the OpenELIS-style principles of phased deployment, site readiness, bridge health, simulator/physical smoke testing, error dashboard visibility, reprocess support, QC/control safety, and fallback operations. It maps those principles to the existing Ozzyl HMS LIS implementation rather than creating a separate workflow.

## Source of truth

Use these existing Ozzyl HMS APIs/screens:

- Go-live readiness: `/api/lab-monitoring/lis-go-live-readiness`
- First hospital deployment checklist: `/api/lab-monitoring/lis-bridge-deployment-checklist`
- Final stabilization gates: `/api/lab-monitoring/lis-stabilization-review`
- Machine middleware config: `/api/lab-machines/:machineId/middleware-config`
- Machine runs: `/api/lab-machines/:machineId/runs`
- Machine logs/unmatched queue/reprocess: Machine Settings → Runs / Logs / Unmatched LIS
- Reagent/TAT reconciliation: `/api/lab-monitoring/reagent-reconciliation`

## Must-pass before merge/deploy

1. **LIS-only commit scope**
   - Stage only LIS-related files.
   - Keep unrelated billing, reception, e2e report artifacts, local OpenELIS reference folder, and other dirty files out of this merge.

2. **Migration order**
   - Ensure LIS migrations are deployed before app code depends on new columns.
   - Important migrations from this phase include qualitative mapping and sample storage/referral fields.

3. **Bridge config and heartbeat**
   - Generate machine-specific middleware config.
   - Confirm local bridge heartbeat is healthy.
   - Keep bridge secrets out of screenshots/docs.

4. **Analyzer runs and reprocess**
   - Confirm machine runs view works.
   - Confirm raw logs remain auditable.
   - Confirm reprocess creates a new `_REPROCESS` log and does not duplicate patient result writes.

5. **Result safety**
   - Validation gate must block invalid machine results.
   - QC/control analyzer messages must route to QC results/review, not patient results.
   - Qualitative aliases must normalize before validation/write.

6. **Operator readiness**
   - Lab monitoring dashboard must surface go-live readiness/checklist.
   - Staff must know Runs, Logs, Unmatched LIS, Reprocess, QC review, and manual fallback.

## Monitor during first hospital go-live

- Open unmatched analyzer queue.
- Analyzer run errors/partial runs/qc_review runs.
- Bridge heartbeat freshness.
- QC status and QC review results.
- Reagent exceptions and stock mapping gaps.
- Reagent/TAT reconciliation for billed/performed/resulted/consumed.
- Sample storage/referral events if tests are referred out or stored physically.

## Suggested focused verification before merge

Run these focused suites before merging the LIS branch:

```bash
pnpm exec vitest run test/lis-stabilization-review.test.ts test/lis-bridge-deployment-checklist.test.ts test/integration/routes/lab-monitoring-critical.test.ts test/integration/routes/lab-workflow.test.ts test/lab-machine-runs.test.ts test/lab-machine-qc-detection.test.ts test/lab-machine-reprocess.test.ts test/lab-machine-qualitative-mapping.test.ts test/lab-machine-validation-gate.test.ts
pnpm exec tsc --noEmit
cd web && pnpm exec vitest run src/pages/LabMonitoringDashboard.test.ts src/pages/LabMachineSettings.test.ts
cd web && pnpm exec tsc --noEmit
```

## Go/no-go decision

Do not merge/deploy if any of these are true:

- Readiness API has blockers.
- Bridge heartbeat is missing for the target machine.
- Machine test mapping is empty for smoke-test tests.
- QC/control smoke test writes to patient result tables.
- Patient smoke test cannot match order/sample.
- Reprocess duplicates patient result writes.
- Unrelated dirty files are staged in the LIS merge.
- Staff cannot explain manual fallback.

Merge/deploy only after must-pass gates pass and monitor/manual-review gates have an assigned owner.
