# LIS Enterprise Status Tracker

Date: 2026-07-09
Workspace: `@Hms` branch `abdullah`
Purpose: track what has been researched, audited, implemented, tested, committed, and what remains.

## Working method

Every LIS slice must follow this order:

1. Check OpenELIS/reference best practices.
2. Search current HMS code for existing subsystem boundaries.
3. Decide whether to extend, consolidate, or deprecate.
4. Implement only through existing HMS modules when an equivalent exists.
5. Write/update tests.
6. Update this tracker and relevant design/audit docs.
7. Commit only relevant files; do not mix unrelated dirty files.

## Reference baseline

OpenELIS reference points being used:

- End-to-end lab workflow: registration, sample tracking, results, validation, and reporting.
- Analyzer integration: ASTM, HL7, CSV/flat-file, bidirectional communication, visual mapping, preconfigured instruments, and plugin-style extensibility.
- QC: Westgard rules, Levey-Jennings charts, QC status, corrective action tracking.
- Sample management: collection, storage locations, barcode moves, disposal, and audit trail.
- Monitoring: TAT, rejection rates, system health, analyzer status.

Ozzyl implementation rule:

- Do not embed OpenELIS as a second system for normal deployments.
- Use OpenELIS as reference only.
- Keep Ozzyl HMS as source of truth.

## Existing HMS subsystem audit completed

Audit doc:

- `docs/lis-existing-implementation-audit.md`

Existing subsystems found and protected from duplication:

- Machine capability catalog: `src/lib/lab-machine-capabilities.ts`
- Analyzer profile defaults: `src/lib/lab-analyzer-profiles.ts`
- Machine CRUD and result ingestion: `src/routes/tenant/labMachines.ts`
- Validation engine: `src/routes/tenant/labValidation.ts`
- QC/Westgard: `src/routes/tenant/labQc.ts`
- Calibration: `src/routes/tenant/labCalibrations.ts`
- Sample workflow: `src/routes/tenant/labWorkflow.ts`
- Reagent mapping/policy/assignment: `src/lib/lab-consumables.ts`, `src/lib/lab-inventory-policy.ts`, `lab_test_consumable_map`, `lab_reagent_analyzer_assignments`
- Analyzer health and readiness: `src/routes/tenant/labMonitoring.ts`
- Local middleware: `tools/lab-middleware/`

## Design and plan docs

- `docs/lis-enterprise-design-spec.md`
- `docs/lis-enterprise-implementation-plan.md`
- `docs/lis-existing-implementation-audit.md`
- `docs/lis-enterprise-status-tracker.md`

## Implemented and committed

### 1. LIS bridge hardening

Commit references:

- `357ba760 Harden LIS bridge auth and retry queue`
- `d645fa28 Add configurable HL7 ACK policy`
- `00c3fae7 Report LIS bridge heartbeat status`

Implemented:

- Bridge key authentication.
- Durable retry queue.
- Configurable HL7 ACK behavior.
- Bridge heartbeat reporting.
- Middleware config example updates.

### 2. Unmatched result candidate search

Commit:

- `2bd42950 Add LIS unmatched result candidate search`

Implemented:

- `GET /api/lab-machines/unmatched-results/candidates`
- Candidate search by barcode, order number, patient, mobile, test name/code.
- Tests in `test/lis-unmatched-candidates.test.ts`.

### 3. Unmatched resolve UI

Commit:

- `1b2055b8 Add LIS unmatched resolve candidate UI`

Implemented:

- Search/select candidate UI in `web/src/pages/LabMachineSettings.tsx`.
- Manual lab order item ID fallback preserved.
- Tests in `web/src/pages/LabMachineSettings.test.ts`.

### 4. Middleware deployment docs

Commit:

- `57f7dd3e Document LIS bridge deployment setup`

Implemented:

- `tools/lab-middleware/README.md`
- Production checklist for bridge key, queue, heartbeat, ACK mode, and go-live notes.

### 5. Analyzer profile defaults

Commit:

- `ac11801f Add LIS analyzer profile defaults`

Implemented:

- `src/lib/lab-analyzer-profiles.ts`
- `GET /api/lab-machines/analyzer-profiles`
- `GET /api/lab-machines/analyzer-profiles/suggest`
- Initial Mindray, Sysmex, Abbott, and GeneXpert profiles.
- Tests in `test/lab-analyzer-profiles.test.ts`.

### 6. Enterprise design plan and profile UI

Commit:

- `ffa313be Add LIS enterprise design plan and profile UI`

Implemented:

- Initial enterprise design spec.
- Initial implementation plan.
- Analyzer profile selector in machine setup form.
- Profile auto-fills manufacturer, model, machine type, protocol, port, and bidirectional flag.

### 7. Existing implementation boundary audit

Commit:

- `1339ac86 Audit LIS implementation boundaries`

Implemented:

- Deep audit of current LIS/reagent/QC/validation/sample modules.
- Corrected design plan to prevent duplicate modules.
- Set rule: extend existing boundaries, do not rebuild.

### 8. Machine analyzer validation gate

Commit:

- `13134070 Validate analyzer results before machine write`

Implemented:

- Machine result ingestion now calls existing `validateLabResult`.
- Blocking validation routes result to existing unmatched review queue and does not write final result.
- Non-blocking warnings are appended to machine result comments.
- Tests in `test/lab-machine-validation-gate.test.ts`.

### 9. Machine-specific middleware config template

Commit:

- `ef74b9bf Add LIS middleware config template`

Implemented:

- `buildLabMiddlewareConfigSnippet` helper.
- `GET /api/lab-machines/:id/middleware-config`
- Safe config template from existing machine/profile data.
- Secret values remain placeholders.
- Tests in `test/lab-analyzer-profiles.test.ts`.

### 10. Machine capability/profile consistency

Commit:

- `bb4e1323 Align LIS machine UI with capabilities`

Implemented:

- Machine setup UI now loads `/api/lab-machines/capabilities`.
- Machine type, protocol, and connection type options are merged from backend capabilities before fallback UI options.
- Prevents UI/backend drift for `hl7_mllp`, `json`, `csv`, `file_drop`, `sftp`, `mllp`, and future capability values.
- Shows selected machine type capability notes/examples in the machine form.
- Tests added in `web/src/pages/LabMachineSettings.test.ts`.

### 11. Qualitative analyzer result mapping

Commit:

- `c300ca8d Add LIS qualitative result mapping`

Implemented:

- Added `qualitative_map_json` to existing `lab_machine_test_map` through migration `0397_lab_machine_qualitative_mapping.sql`.
- Extended existing machine test mapping schema with optional `qualitative_map` object.
- Machine ingestion now normalizes qualitative analyzer aliases before validation, duplicate detection, result write, lab result insert, and observation audit.
- Example: `POS`, `Detected` → `Positive`; `NEG` → `Negative`.
- Adds mapping context to comments: `Qualitative mapped: POS → Positive`.
- Does not create a second result engine.
- Tests added in `test/lab-machine-qualitative-mapping.test.ts`.

### 12. Qualitative mapping UI/editor

Commit:

- `ffdd0dea Add LIS qualitative mapping editor`

Implemented:

- Machine test mapping UI now has a `Qualitative aliases` textarea.
- Staff can enter aliases safely as lines like `POS=Positive`, `Detected=Positive`, `NEG=Negative`.
- JSON object input is also supported for advanced setup.
- Invalid lines are blocked before API submit, so invalid payloads are not sent.
- Mapping table shows a compact qualitative mapping summary.
- Tests added in `web/src/pages/LabMachineSettings.test.ts`.

### 13. Analyzer result log reprocess flow

Commit:

- `633e6dc7 Add LIS analyzer result reprocess`

Implemented:

- Added `POST /api/lab-machines/:id/logs/:logId/reprocess`.
- Creates a new `_REPROCESS` analyzer log so the original raw log remains auditable.
- Reuses the existing `processResult` pipeline for JSON, HL7, and ASTM logs.
- Supports reprocessing after mapping/profile changes without creating a second result writer.
- Existing duplicate/correction handling keeps reprocess idempotent and avoids duplicate writes.
- Tests added in `test/lab-machine-reprocess.test.ts`.

### 14. Sample storage and referral tracking

Commit:

- `b16f6836 Add LIS sample storage referral tracking`

Implemented:

- Added `POST /api/lab-workflow/items/:itemId/storage`.
- Added `POST /api/lab-workflow/items/:itemId/referral`.
- Extended existing `lab_order_items` with storage/referral fields through migration `0398_lab_sample_storage_referral.sql`.
- Storage supports fridge, rack, box, position, and storage condition.
- Referral supports external lab name, contact, tracking number, reason, expected return, and sent status.
- Both routes write to existing `lab_workflow_events` and audit logs.
- Does not create a second sample lifecycle table.
- Tests added in `test/integration/routes/lab-workflow.test.ts`.

### 15. TAT and reagent reconciliation enrichment

Commit:

- `02a678c1 Enrich LIS reagent reconciliation with TAT`

Review finding:

- TAT was already partially implemented in `src/routes/tenant/labWorkflow.ts` dashboard through average TAT and delayed reports.
- Reagent reconciliation was already implemented in `src/routes/tenant/labMonitoring.ts` at `/reagent-reconciliation`.
- Mapping coverage was already implemented at `/mapping-coverage`.
- Therefore this slice extends the existing reconciliation report instead of adding a parallel report.

Implemented:

- Enriched existing `GET /api/lab-monitoring/reagent-reconciliation`.
- Added billed/performed/resulted flags per lab order item.
- Added ordered, collected, received, completed timestamps.
- Added `tat_target_minutes`, `tat_minutes`, and `tat_status` (`pending`, `on_time`, `delayed`).
- Summary now includes billed, performed, resulted, delayed, on-time, observed TAT count, and average TAT minutes.
- Updated both TypeScript source and runtime `.js` route mirror because tests import the extensionless route and can resolve the JS file.
- Tests updated in `test/integration/routes/lab-monitoring-critical.test.ts`.

### 16. QC/control analyzer message detection

Commit:

- `a23126ef Route LIS analyzer QC results`

Review finding:

- QC controls, QC ranges, QC results, and Westgard-style checks already exist in `src/routes/tenant/labQc.ts`.
- Machine patient-result ingestion already checks latest QC status through `evaluateMachineQcGate` in `src/routes/tenant/labMachines.ts`.
- Missing gap was analyzer-origin QC/control samples being treated like patient samples.

Implemented:

- Added analyzer QC/control identifier detection in `src/routes/tenant/labMachines.ts`.
- QC identifiers like `QC-*`, `CTRL_*`, `CONTROL*`, `CAL*`, and comments/test names containing control/QC are detected before patient matching.
- Analyzer QC results route to existing `lab_qc_results` instead of `lab_order_items`/`lab_results`.
- Unconfigured QC controls are routed to the existing unmatched review queue with reason `qc_control_not_configured`.
- Non-numeric QC results are routed to QC review.
- Patient result write, billing gate, and patient order matching are skipped for QC/control analyzer samples.
- Tests added in `test/lab-machine-qc-detection.test.ts`.

### 17. Analyzer run/session grouping

Commit:

- `Add LIS analyzer run summaries`

Review finding:

- Existing `lab_machine_result_log` already stores one raw analyzer message/session with `parsed_data.outcomes`.
- Reprocess also writes `_REPROCESS` logs with `reprocessedFromLogId`.
- No separate run table existed, and creating one now would duplicate log state.

Implemented:

- Added `GET /api/lab-machines/:id/runs`.
- Builds analyzer run/session summaries from existing `lab_machine_result_log` rows.
- Adds helper summary for total, matched, unmatched, processed, blocked, duplicate, corrected, QC, and error outcomes.
- Includes reprocess parent link through `reprocessed_from_log_id`.
- Keeps raw log as source of truth; no duplicate analyzer result writer/table added.
- Tests added in `test/lab-machine-runs.test.ts`.

### 18. LIS operator run summary UI

Commit:

- `d7f5d70b Add LIS analyzer runs UI`

Review finding:

- OpenELIS-style analyzer workflows emphasize error dashboards, raw message review, analyzer grouping, and reprocessing visibility.
- Existing Ozzyl UI already had machine setup, test mapping, raw message logs, and unmatched queue.
- Backend run summary endpoint already exists at `/api/lab-machines/:id/runs`.
- Missing gap was surfacing those run/session summaries in the operator UI without creating a duplicate dashboard.

Implemented:

- Added a `Runs` tab to `web/src/pages/LabMachineSettings.tsx`.
- Shows run summary cards for runs, total results, blocked results, and QC results.
- Shows run table with run id, received time, status badge, outcome summary, and reprocess parent link.
- Uses existing `/api/lab-machines/:id/runs` as source of truth.
- Added helper formatters for analyzer run status badges and summary text.
- Tests updated in `web/src/pages/LabMachineSettings.test.ts`.

### 19. End-to-end LIS go-live readiness API

Commit:

- `1c85b107 Add LIS go-live readiness check`

Review finding:

- OpenELIS reference material emphasizes site readiness, analyzer bridge setup, mapping/error dashboard, QC routing, and reprocessing visibility before production use.
- Ozzyl already had separate signals: active machines, machine mappings, bridge heartbeat, QC setup, validation rules, unmatched queue, analyzer run logs, and reagent strict-mode readiness.
- The missing gap was a single go-live checklist combining those existing signals.

Implemented:

- Added `GET /api/lab-monitoring/lis-go-live-readiness`.
- Optional query: `machineId` for machine-specific readiness.
- Aggregates existing readiness signals instead of creating a duplicate subsystem.
- Checks machine config, analyzer test mapping, bridge heartbeat, QC setup, validation rules, unmatched queue, analyzer smoke-test logs, and reagent readiness.
- Returns `overall_status`, `readiness_score`, per-check statuses, and summary counts.
- Runtime `.js` route mirror updated because route tests can resolve the JS file.
- Tests updated in `test/integration/routes/lab-monitoring-critical.test.ts`.

### 20. First hospital bridge deployment checklist

Commit:

- `7352522c Add LIS bridge deployment checklist`

Review finding:

- OpenELIS reference deployment material emphasizes bridge-on-lab-PC, site readiness, protocol discovery, simulator/smoke testing, QC/control routing, and fallback operations.
- Ozzyl already has middleware config generation, bridge heartbeat, machine mapping, QC routing, run summaries, unmatched/reprocess, and go-live readiness.
- The missing gap was a field-friendly checklist that maps those existing features into a safe first hospital deployment sequence.

Implemented:

- Added reusable checklist builder in `src/lib/lis-bridge-deployment-checklist.ts` and runtime mirror `.js`.
- Added `GET /api/lab-monitoring/lis-bridge-deployment-checklist`.
- Optional query: `machineId` for machine-specific checklist labels/endpoints.
- Added deployment documentation: `docs/lis-first-hospital-bridge-deployment-checklist.md`.
- Checklist covers site survey, bridge installation, HMS mapping/readiness, QC smoke test, patient smoke test, reconciliation, operator training, and first-week monitoring.
- Tests added in `test/lis-bridge-deployment-checklist.test.ts`.

### 21. LIS go-live readiness/checklist UI card

Commit:

- `dbde4ce3 Surface LIS go-live readiness in UI`

Review finding:

- Existing `LabMonitoringDashboard` already surfaced analyzer health, mapping coverage, reagent readiness, and exception workflows.
- Backend APIs `/api/lab-monitoring/lis-go-live-readiness` and `/api/lab-monitoring/lis-bridge-deployment-checklist` already existed.
- The missing gap was a single operator/admin UI card that surfaces go-live status without creating a duplicate dashboard.

Implemented:

- Added a LIS go-live readiness card in `web/src/pages/LabMonitoringDashboard.tsx`.
- Card shows readiness status, readiness score, ready/warning/blocker counts, deployment checklist stage/item count, top checks, and first deployment next step.
- Uses existing readiness/checklist APIs as source of truth.
- Added helper functions for status labels/classes, primary action routing, and checklist progress.
- Tests updated in `web/src/pages/LabMonitoringDashboard.test.ts`.

### 22. Final LIS stabilization review

Commit:

- `3238276a Add LIS stabilization review`

Review finding:

- OpenELIS reference materials emphasize phased deployment, site readiness, bridge health, simulator/physical smoke tests, error/reprocess visibility, QC/control routing, and fallback operations.
- Ozzyl now has the matching pieces across existing APIs/UI: readiness, deployment checklist, middleware config, runs/reprocess, validation, QC routing, sample storage/referral, reagent/TAT reconciliation, and go-live card.
- The remaining merge risk is mostly operational: staging unrelated dirty files, migration order, and first-hospital monitoring ownership.

Implemented:

- Added reusable stabilization gate builder in `src/lib/lis-stabilization-review.ts` and runtime mirror `.js`.
- Added `GET /api/lab-monitoring/lis-stabilization-review`.
- Added documentation: `docs/lis-final-stabilization-review.md`.
- Stabilization review groups gates into merge hygiene, analyzer bridge, result safety, workflow/reconciliation, and operator readiness.
- Tests added in `test/lis-stabilization-review.test.ts`.

### 23. Final OpenELIS/Ozzyl QA pass and E2E smoke

Commit:

- pending

Review finding:

- OpenELIS-style LIS safety depends on local bridge, raw message visibility, mapping, validation, QC/control separation, reprocess, readiness checks, and site-level smoke testing.
- Ozzyl HMS now has matching backend/UI layers and focused tests, but real BC-10/CBC confidence still requires site raw-message and smoke-test validation.
- Live E2E against current production must tolerate 404 until this branch is deployed; strict deploy verification can enable `E2E_REQUIRE_LIS_ENDPOINTS=true`.

Implemented:

- Added final QA review document: `docs/lis-final-qa-openelis-ozzyl-review.md`.
- Added read-only Playwright E2E smoke: `test/e2e/api/lis-readiness.spec.ts`.
- Added Playwright project `lis-readiness`.
- Hardened stabilization review route to require tenant context.
- E2E covers readiness, bridge checklist, stabilization review, capabilities, profiles, runs/logs/config when deployed and configured.

## Latest verification

Recently passed:

- Root typecheck: `pnpm exec tsc --noEmit`
- Targeted LIS/reagent suite: 88 tests passed
- Profile/middleware config suite: 61 tests passed
- Validation gate suite: 26 tests passed
- Machine capability UI tests: 8 tests passed
- Web typecheck: `cd web && pnpm exec tsc --noEmit`
- Qualitative mapping targeted tests: 10 tests passed
- Broader LIS machine suite: 67 tests passed
- Qualitative mapping UI tests: 10 tests passed
- Web typecheck after UI/editor: `cd web && pnpm exec tsc --noEmit`
- Backend qualitative/validation sanity tests: 4 tests passed
- Root typecheck after UI/editor: `pnpm exec tsc --noEmit`
- Analyzer reprocess targeted tests: 6 tests passed
- Broader LIS machine suite after reprocess: 69 tests passed
- Root typecheck after reprocess: `pnpm exec tsc --noEmit`
- Sample storage/referral workflow tests: 16 tests passed
- LIS workflow/machine sanity suite after storage/referral: 22 tests passed
- Root typecheck after storage/referral: `pnpm exec tsc --noEmit`
- TAT/reagent reconciliation targeted tests: 18 tests passed
- LIS workflow/machine/monitoring sanity suite after TAT enrichment: 40 tests passed
- Root typecheck after TAT enrichment: `pnpm exec tsc --noEmit`
- QC/control analyzer detection targeted tests: 7 tests passed
- LIS machine/workflow/monitoring sanity suite after QC detection: 43 tests passed
- Root typecheck after QC detection: `pnpm exec tsc --noEmit`
- Analyzer run grouping targeted tests: 8 tests passed
- LIS machine/workflow/monitoring sanity suite after run grouping: 46 tests passed
- Root typecheck after run grouping: `pnpm exec tsc --noEmit`
- LIS operator run UI helper tests: 11 tests passed
- Web typecheck after run UI: `cd web && pnpm exec tsc --noEmit`
- Backend run/QC sanity tests after run UI: 6 tests passed
- Root typecheck after run UI: `pnpm exec tsc --noEmit`
- LIS go-live readiness targeted tests: 20 tests passed
- LIS workflow/machine/monitoring sanity suite after go-live readiness: 48 tests passed
- Root typecheck after go-live readiness: `pnpm exec tsc --noEmit`
- Bridge deployment checklist targeted tests: 23 tests passed
- LIS workflow/machine/monitoring sanity suite after deployment checklist: 51 tests passed
- Root typecheck after deployment checklist: `pnpm exec tsc --noEmit`
- LIS go-live UI card tests: 34 tests passed
- Web typecheck after go-live UI card: `cd web && pnpm exec tsc --noEmit`
- Backend readiness/checklist sanity tests after UI card: 23 tests passed
- LIS workflow/machine/monitoring sanity suite after UI card: 51 tests passed
- Root typecheck after go-live UI card: `pnpm exec tsc --noEmit`
- LIS stabilization targeted tests: 26 tests passed
- Focused LIS backend stabilization suite: 54 tests passed
- Root typecheck after stabilization review: `pnpm exec tsc --noEmit`
- Focused LIS web UI suite after stabilization review: 45 tests passed
- Web typecheck after stabilization review: `cd web && pnpm exec tsc --noEmit`
- Final OpenELIS/Ozzyl focused backend LIS suite: 64 tests passed
- Root typecheck after final QA: `pnpm exec tsc --noEmit`
- Final focused LIS web UI suite: 45 tests passed
- Web typecheck after final QA: `cd web && pnpm exec tsc --noEmit`
- LIS E2E project discovery: 3 tests discovered
- LIS E2E live run against current production: 3 skipped because branch-only endpoints are not deployed yet

## Remaining gaps

### Priority 1: Merge/deploy blocked only by unrelated dirty workspace cleanup

Need:

- Handle unrelated dirty files separately before merge/deploy.
- Do not stage e2e artifacts, billing/reception changes, local OpenELIS reference folder, or unrelated operator guide unless explicitly reviewed.

## Current next slice

Next recommended implementation:

1. Clean/review unrelated dirty workspace files separately.
2. Then merge/deploy the LIS branch when only intended LIS changes are staged.

## Dirty workspace note

There are unrelated dirty files in the workspace from other work/e2e artifacts. LIS commits must continue staging only relevant files.
