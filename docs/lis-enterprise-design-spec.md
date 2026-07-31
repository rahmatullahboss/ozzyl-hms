# LIS Enterprise Design Specification

## Context

Ozzyl HMS already includes a practical LIS foundation: HL7/ASTM receive endpoints, machine capability catalog, machine master, machine test mapping with unit/conversion factor, unmatched result queue, billing clearance gate, QC/Westgard/calibration workflow, result validation rules, sample workflow events, reagent mapping, reagent policy, analyzer reagent assignment, local middleware retry queue, HL7 ACK policy, bridge heartbeat, and unresolved-result candidate search.

The `openelis-reference/` repository was reviewed as an enterprise LIS benchmark. OpenELIS remains useful as a reference for analyzer profiles, analyzer field mapping, unit/qualitative mapping, validation, QC, analyzer runs, reprocessing, sample storage, shipment/referral, EQA, TAT, and analyzer harness/testing. It should not be embedded as a second production LIS for normal Ozzyl deployments.

This spec defines how to evolve Ozzyl HMS LIS by extending the existing Ozzyl modules rather than building duplicate parallel modules.

## Product decision

Do not run OpenELIS as the core LIS inside Ozzyl HMS for normal hospital deployments. Use OpenELIS as a reference and compatibility benchmark.

Reasons:

- Ozzyl is TypeScript/Cloudflare/D1/multi-tenant; OpenELIS is Java/Tomcat/PostgreSQL/standalone.
- Directly operating both creates duplicate patient/order/result data.
- Billing, reagent, validation, QC, and audit controls must stay in Ozzyl.
- Bangladesh small and medium hospitals need a simple single-login workflow.
- Future SaaS rollout requires tenant-safe isolation and predictable deployment.

OpenELIS integration can remain a future enterprise connector for hospitals that already operate OpenELIS.

## Duplicate-prevention rule

Before any LIS implementation:

1. Search existing route/lib/schema/migration/test coverage.
2. Decide whether to extend, consolidate, or deprecate.
3. Do not introduce a second table/service if an equivalent already exists.
4. Add tests against the existing domain boundary.
5. Update `docs/lis-existing-implementation-audit.md` if the boundary changes.

## Goals

1. Make Ozzyl LIS reliable for analyzer result ingestion.
2. Reduce manual lab staff data entry.
3. Keep billing/reagent/audit integrity inside Ozzyl.
4. Reuse existing validation, QC, sample workflow, reagent, and monitoring modules.
5. Support BD diagnostic workflows with simple UI.
6. Gradually add enterprise LIS controls: profile-assisted setup, qualitative mapping, machine-ingestion validation, reprocess, sample storage/referral, TAT, and EQA.
7. Keep implementation incremental and test-driven.

## Non-goals for current phase

- Full OpenELIS replacement in one release.
- Copying OpenELIS code directly.
- Running a separate OpenELIS UI for normal Ozzyl hospitals.
- Rebuilding existing Ozzyl validation, QC, sample lifecycle, reagent mapping, or analyzer health modules.
- Enabling strict reagent blocking before real mappings and stock lots are verified.

## Architecture

### Existing components to reuse

- HMS backend: tenant APIs, patient/order/result/reagent/audit source of truth.
- Lab machine module: machine master, capabilities, profiles, mappings, raw result ingestion, unmatched queue.
- Lab validation module: `labValidation.ts` with rules and `validateLabResult`.
- Lab QC module: `labQc.ts`, `labCalibrations.ts`, Westgard rules, and machine QC gate.
- Lab workflow module: `labWorkflow.ts` collect/receive/process/verify events.
- Lab reagent module: `lab-consumables.ts`, `lab-inventory-policy.ts`, `lab_test_consumable_map`, analyzer assignments, manual usage.
- Web UI: machine setup, mapping, unmatched queue, monitoring, QC dashboard, result review.
- Local lab middleware: receives ASTM/HL7 inside hospital LAN, queues transient failures, sends heartbeat.

### Data flow

1. Reception/billing creates lab order and sample barcode.
2. Lab collects/receives/processes sample through existing `labWorkflow` events.
3. Analyzer or middleware receives HL7/ASTM/file output.
4. HMS matches result using barcode/control/order/sample identifier and `lab_machine_test_map`.
5. HMS checks billing clearance.
6. HMS checks existing QC/calibration gate.
7. HMS should run existing `validateLabResult` before final machine write.
8. HMS stores result, logs raw message, and consumes mapped reagents according to existing policy.
9. Unmatched/blocked results go to the existing review queue.
10. Staff resolves candidates using existing search/autocomplete.
11. Admin monitors analyzer health, queue depth, mapping coverage, strict readiness, exceptions, and reconciliation.

## Core design principles

- Fail safe for billing, reagent, QC, validation, and tenant boundaries.
- Store raw analyzer messages for audit and future reprocessing.
- Separate permanent errors from transient errors.
- Never lose local analyzer messages due to network/API downtime.
- Prefer soft mode during go-live; enable strict controls only after readiness checks pass.
- Keep manual fallback for hospital staff when automation fails.
- Add profile defaults without replacing the existing generic machine capability catalog.
- Every critical workflow requires tests.

## Enterprise feature layers

### Layer 1: Analyzer profiles on top of machine capabilities

Existing foundation:

- Generic machine capability catalog exists in `src/lib/lab-machine-capabilities.ts`.
- Machine CRUD exists in `src/routes/tenant/labMachines.ts` and `web/src/pages/LabMachineSettings.tsx`.
- Vendor/model profile defaults exist in `src/lib/lab-analyzer-profiles.ts`.

Design rule:

- Generic capability = analyzer class/protocol support.
- Analyzer profile = vendor/model setup preset.
- Do not merge these into a duplicate second catalog; relate them clearly.

### Layer 2: Mapping expansion

Existing foundation:

- `lab_machine_test_map` maps analyzer test code to lab test/component.
- `machine_unit` and `conversion_factor` already exist and are applied during machine ingestion.
- UI already edits machine unit and conversion factor.

Enterprise expansion should add or consolidate:

- canonical unit dictionary or normalized unit validation, if needed;
- unknown-unit warning/block behavior through existing validation rules;
- qualitative result mapping by extending existing mapping/validation boundaries;
- field mapping by profile;
- mapping preview before activation.

Do not create a parallel basic unit mapping table without a migration/deprecation plan.

### Layer 3: Validation engine extension

Existing foundation:

- `src/routes/tenant/labValidation.ts` already implements validation rule CRUD and `validateLabResult`.
- Manual lab result routes already call `validateLabResult`.
- Existing rule types include range, mandatory, delta, and dependency.

Enterprise expansion should:

- wire `validateLabResult` into machine analyzer ingestion;
- add rule types only when they do not fit current schema;
- add qualitative allowlist/mapping behavior through the current validation path;
- surface warnings in machine/unmatched result review.

Do not build a second validation engine.

### Layer 4: QC, Westgard, and analyzer readiness extension

Existing foundation:

- `src/routes/tenant/labQc.ts` already has QC controls, ranges, results, and Westgard evaluation.
- `src/routes/tenant/labCalibrations.ts` already has calibration CRUD/upcoming/overdue.
- `evaluateMachineQcGate` in `labMachines.ts` already checks QC and calibration before mapping patient results.
- `web/src/pages/LabQcDashboard.tsx` already exists.

Enterprise expansion should:

- detect analyzer QC/control samples from incoming machine messages;
- route QC/control events to existing QC/manual usage paths;
- improve strict-mode UX and override audit;
- improve dashboard links from QC gate failures.

Do not build a second QC or Westgard module.

### Layer 5: Sample workflow extension

Existing foundation:

- `src/routes/tenant/labWorkflow.ts` already supports sample collection, lab receive, processing, report verification, workflow events, and audit logging.

Enterprise expansion should add:

- sample storage locations: fridge/rack/box/position;
- retained-sample disposal;
- referral/shipment and chain-of-custody events;
- TAT reporting from existing workflow timestamps/events.

Do not create a second sample status lifecycle.

### Layer 6: Analyzer run and reprocessing model

Existing foundation:

- Machine result ingestion already logs raw messages, matched/unmatched outcomes, duplicate exact results, and corrected results.

Enterprise expansion should:

- group raw messages into analyzer runs;
- add reprocess attempts after mapping/profile changes;
- reuse/extract the existing `processResult` flow;
- keep idempotency guards.

Do not write analyzer results through a separate independent writer.

### Layer 7: Reporting, EQA, and governance

Existing foundation:

- Lab monitoring already includes analyzer health, mapping coverage, strict readiness, reagent workflows, and manual usage.

Enterprise expansion should add:

- order-to-collection TAT;
- collection-to-lab-received TAT;
- received-to-result TAT;
- result-to-verification TAT;
- billed/performed/resulted/consumed reconciliation;
- EQA provider/enrollment/results;
- analyzer downtime and queue depth history.

Reports should reuse existing lab timestamps, workflow events, inventory consumption, and analyzer logs.

## Security and compliance

- All LIS bridge endpoints require either normal authenticated user context or dedicated bridge key.
- Bridge key must be stored as a secret and not committed to source control.
- Audit actor should be configured with `LIS_BRIDGE_USER_ID`.
- Raw analyzer messages should be retained for audit but protected from broad UI exposure.
- Tenant ID must be enforced in every query.
- Permanent auth/config errors should not be retried blindly.

## Rollout model

### Phase A: first hospital production safety

- Keep reagent policy soft.
- Enable heartbeat, queue, ACK mode, and unmatched queue.
- Configure profile defaults for machine setup.
- Verify sample barcode matching.
- Keep manual resolve fallback.
- Use existing QC/validation in warning mode until real setup is verified.

### Phase B: controlled automation

- Wire existing validation engine into machine ingestion.
- Add qualitative mapping through existing mapping/validation boundaries.
- Add reconciliation reports.
- Add analyzer run grouping and reprocess.

### Phase C: strict enterprise LIS

- Enable QC strict gates with clear override audit.
- Enable strict reagent mode for selected analyzers/tests.
- Add sample storage/referral/disposal.
- Add analyzer simulator CI coverage.
- Add EQA.

## Acceptance criteria

- Analyzer setup can be completed with profile-assisted defaults.
- Result ingestion never loses messages during API downtime.
- Unmatched results can be resolved without raw DB IDs.
- Billing clearance, validation, QC, and reagent policy are consistently enforced.
- Admin can see analyzer health and queue status.
- No duplicate validation/QC/sample/reagent/mapping module is introduced.
- Tests cover profile defaults, middleware retry/ACK, candidate search, billing gate, validation, QC, reagent consumption, and monitoring readiness.
