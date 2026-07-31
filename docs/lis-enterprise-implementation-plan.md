# LIS Enterprise Implementation Plan

## Current baseline after audit

This plan is not a replacement for existing LIS/reagent work. It is a consolidation plan that must respect current Ozzyl HMS implementation.

Detailed audit: `docs/lis-existing-implementation-audit.md`.

Existing foundations already present:

- Generic machine capability catalog: `src/lib/lab-machine-capabilities.ts`.
- Machine master and setup UI: `src/routes/tenant/labMachines.ts`, `web/src/pages/LabMachineSettings.tsx`.
- Analyzer profile defaults API/UI: `src/lib/lab-analyzer-profiles.ts`, `GET /api/lab-machines/analyzer-profiles`.
- HL7/ASTM receive endpoints and local middleware.
- Machine result matching by machine test code and barcode/order/control identifiers.
- Machine test mapping with `machine_unit` and `conversion_factor`.
- Unmatched result queue, candidate search, and resolve/ignore UI.
- Billing clearance gate before machine result mapping.
- Existing validation engine: `src/routes/tenant/labValidation.ts` and `validateLabResult`.
- Existing QC/Westgard/calibration modules: `src/routes/tenant/labQc.ts`, `src/routes/tenant/labCalibrations.ts`, `evaluateMachineQcGate`.
- Existing sample workflow: `src/routes/tenant/labWorkflow.ts` collect/receive/process/verify events.
- Existing reagent mapping/policy/analyzer assignment: `lab_test_consumable_map`, `lab_inventory_policy`, `lab_reagent_analyzer_assignments`.
- Lab Monitoring analyzer health, mapping coverage, strict readiness, manual usage, and reagent workflows.
- Middleware retry queue, ACK policy, heartbeat, and bridge deployment docs.

## Non-negotiable implementation rules

1. Search existing routes/libs/schemas/migrations/tests before coding.
2. Extend existing modules instead of building duplicate modules.
3. Do not create a second validation engine, QC module, sample lifecycle, reagent mapping table, analyzer assignment table, or result writer.
4. New code must call current domain services where possible.
5. Tests must target current service boundaries.
6. Update `docs/lis-existing-implementation-audit.md` whenever a boundary changes.

## Phase 1: setup and matching usability

### 1.1 Analyzer profile UI auto-fill

Status: implemented in commit `ffa313be Add LIS enterprise design plan and profile UI`.

Implemented:

- Machine form loads `/api/lab-machines/analyzer-profiles`.
- Profile selector auto-fills manufacturer, model, machine type, protocol, port, and bidirectional flag.
- Manual override remains possible.
- Web tests cover profile label and form auto-fill helper.

Follow-up:

- Keep profile catalog as vendor/model defaults, not a duplicate of `lab-machine-capabilities.ts`.

### 1.2 Machine capability/profile consistency

Scope:

- Align LabMachineSettings UI protocol/type selectors with `LAB_MACHINE_PROTOCOLS`, `LAB_MACHINE_CONNECTION_TYPES`, and `LAB_MACHINE_TYPES` from backend capability API or shared list.
- Avoid local UI constants drifting from backend schema.
- Display generic capability notes beside selected profile when useful.

Acceptance:

- UI does not reject backend-supported protocols like `hl7_mllp`, `json`, `csv`, or `file_drop`.
- Profile defaults remain vendor/model presets.
- Generic capability catalog remains the protocol/type source.

### 1.3 Profile-backed middleware templates

Scope:

- Generate suggested middleware config snippet from existing machine/profile data.
- Include machine code, protocol, connection type, port, ACK mode, queue path, heartbeat agent code, and bridge key placeholder.
- Keep secrets as placeholders only.

Acceptance:

- Admin can copy a safe local bridge config without reading source code.
- No bridge key is exposed.

### 1.4 Improved unmatched result context

Existing foundation:

- Unmatched result queue, candidate search, and resolve/ignore UI already exist.

Scope:

- Show parsed raw payload fields in the existing unmatched queue detail.
- Add likely candidate/confidence hints using current candidate search endpoint.
- Show reason-specific guidance: unmapped test, no identifier, no order item, payment required, QC review.

Acceptance:

- Lab staff can resolve unmatched results without developer help.
- No second unmatched queue table or page is created.

## Phase 2: mapping expansion through current boundaries

### 2.1 Unit normalization on existing machine mapping

Existing foundation:

- `lab_machine_test_map.machine_unit` and `conversion_factor` already exist.
- Machine ingestion already applies conversion factor.

Scope:

- Add canonical unit dictionary only if needed.
- Reference canonical unit from existing machine test mapping rather than creating a parallel mapping flow.
- Add unknown-unit warning/block through existing validation rules.

Tests:

- conversion factor still works;
- unknown unit creates warning/block according to mode;
- no duplicate unit table is introduced without migration plan.

### 2.2 Qualitative result mapping

Scope:

- Add qualitative mapping by extending existing machine mapping and/or `lab_validation_rules`.
- Examples: POS, Positive, Detected, Reactive.
- Support profile/test-specific mapping where required.

Tests:

- positive/negative mapping;
- unknown qualitative value warning/block;
- profile/test-specific override.

### 2.3 Mapping preview

Scope:

- Preview how a raw analyzer message maps without persisting a result.
- Reuse/extract current `processResult` matching logic in dry-run mode where possible.
- Show machine test code, mapped lab test, unit conversion, qualitative mapping, validation outcome, billing gate, and QC gate.

Tests:

- preview endpoint returns no persisted result;
- unmatched fields are surfaced;
- existing machine ingestion behavior is unchanged.

## Phase 3: wire existing validation into machine ingestion

### 3.1 Machine ingestion validation wiring

Existing foundation:

- `validateLabResult` already exists and is used by manual lab result entry.
- Machine ingestion currently performs normal/critical flag detection and duplicate/correction logic.

Scope:

- Call existing `validateLabResult` inside machine result ingestion before final write.
- Blocking validation should route result to current unmatched/review queue or return controlled failure based on bridge ACK policy.
- Warnings should be stored in result comments/audit/log context without blocking unless configured.

Tests:

- machine result blocked by existing blocking rule;
- machine result warning is logged but not duplicated;
- manual result validation behavior remains unchanged.

### 3.2 Validation UI extension

Scope:

- Show validation warnings in existing result review and unmatched result UI.
- Require override reason only through existing approval/audit pattern.

## Phase 4: extend existing QC and calibration

### 4.1 Analyzer QC/control sample detection

Existing foundation:

- QC controls/ranges/results and Westgard evaluator already exist.
- Machine QC gate already checks latest QC result and calibration status.

Scope:

- Detect QC/control sample identifiers from analyzer payload/profile rules.
- Route QC/control results to existing `labQc` result recording path.
- Route reagent usage for control/QC/calibration to existing manual usage/canonical consumption path.

Tests:

- QC/control message is not written as patient result;
- Westgard evaluation still works;
- QC failed state blocks patient result only through existing QC gate.

### 4.2 QC gate UX and override audit

Scope:

- Improve existing QC failure visibility in unmatched queue and analyzer health.
- Add override only if it uses existing audit/approval boundaries.

## Phase 5: analyzer run and reprocessing

### 5.1 Analyzer run grouping

Scope:

- Group raw messages/logs into analyzer run records or a compatible run view.
- Track received, matched, unmatched, blocked, duplicate, corrected, and processed counts.

Acceptance:

- Existing raw message logs remain source data.
- No independent result writer is introduced.

### 5.2 Reprocess flow

Scope:

- Reprocess raw messages after mapping/profile changes.
- Extract/reuse current `processResult` logic.
- Keep idempotency and correction behavior.

Tests:

- reprocess after mapping resolves a previously unmatched result;
- exact duplicate reprocess does not deduct reagent twice;
- corrected reprocess is logged.

## Phase 6: sample workflow storage and referral

### 6.1 Sample storage on top of `labWorkflow`

Existing foundation:

- collect/receive/process/verify workflow events already exist.

Scope:

- Add storage location support: fridge, rack, box, position.
- Add retained-sample disposal events.
- Use existing workflow event/audit pattern.

### 6.2 Referral/shipment

Scope:

- Add referred sample package, destination lab, dispatch/receive events, and chain-of-custody.
- Do not create a second status lifecycle.

## Phase 7: reporting and governance

### 7.1 TAT monitoring

Scope:

- order-to-collection;
- collection-to-lab-received;
- received-to-result;
- result-to-verification.

Implementation rule:

- Use existing lab order timestamps and `labWorkflow` events.

### 7.2 Reagent reconciliation

Scope:

- billed vs performed vs resulted vs consumed;
- missing deductions and over-deductions;
- analyzer assignment coverage;
- stock exceptions.

Implementation rule:

- Use existing `lab_test_consumable_map`, `InventoryConsumption`, `lab_inventory_exceptions`, and analyzer logs.

### 7.3 EQA module

Scope:

- EQA provider/enrollment;
- EQA samples/results;
- performance tracking.

## Release gates

### MVP go-live gate

- Middleware queue enabled.
- Heartbeat visible.
- At least one machine profile selected or manually confirmed.
- Test mapping completed for top tests.
- Unmatched resolve tested.
- Reagent policy soft mode unless verified.
- Existing validation/QC behavior known and documented for the site.

### Strict reagent gate

- Active consumables exist.
- Stock lots exist.
- All active billable lab tests have mappings.
- No open stock shortage exceptions.
- QC risk clear for strict analyzers.
- Validation rules have been tested against real analyzer payloads.

### Enterprise gate

- Machine ingestion uses existing validation engine.
- Qualitative mapping active for needed profiles/tests.
- QC workflow active and connected to machine results where applicable.
- Reprocess flow available.
- Sample storage/referral tracked.
- TAT and reconciliation reports available.

## Correct immediate backlog after audit

1. Wire existing `validateLabResult` into machine analyzer ingestion.
2. Align machine profile UI with existing backend machine capabilities.
3. Generate middleware config snippet from existing machine/profile data.
4. Add qualitative mapping by extending existing machine mapping/validation boundaries.
5. Add analyzer reprocess by extracting/reusing `processResult` logic.
6. Add sample storage/referral on top of `labWorkflow`.
7. Improve TAT/reconciliation reports using existing workflow timestamps and consumption records.
