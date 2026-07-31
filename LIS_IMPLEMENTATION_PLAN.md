# LIS Implementation Plan

Branch: `codex/lis-full-implementation`  
Date: 2026-05-18  
Status: Review completed, implementation in progress

## 1. Review Summary

### Current tech stack
- Backend: Cloudflare Workers + Hono + D1 + Drizzle + raw SQL + R2 + KV
- Frontend: React + Vite + TypeScript + React Query style hooks
- Testing: Vitest, integration Vitest, Playwright E2E/browser workflows
- Deployment: `pnpm build && wrangler deploy --env production`

### Current LIS-related code areas
- Core lab routes: `src/routes/tenant/lab.ts`
- Machine integration: `src/routes/tenant/labMachines.ts`, `src/lib/hl7-parser.ts`, `src/lib/astm-parser.ts`
- Validation/QC/calibration: `src/routes/tenant/labValidation.ts`, `src/routes/tenant/labQc.ts`, `src/routes/tenant/labCalibrations.ts`
- Components/ranges/rejection reasons: `src/routes/tenant/labComponents.ts`
- Settings/templates/vendors/run numbers: `src/routes/tenant/labSettings.ts`
- Consumables/alerts/critical list: `src/routes/tenant/labMonitoring.ts`, `src/lib/lab-consumables.ts`
- Billing/accounting hooks: `src/lib/diagnostic-billing.ts`, `src/lib/lab-finance.ts`, `src/lib/diagnostic-catalog.ts`
- UI: `web/src/pages/LaboratoryDashboard.tsx`, `LabTestOrderForm.tsx`, `LabSettingsPage.tsx`, `LabReportPrint.tsx`, `ReportLabPage.tsx`

### Reference projects found inside repo root
- `DanpheEMR reference/`
- `openemr-reference/`

### Reference workflow observations
- DanpheEMR provides richer operator workflow objects for requisition, specimen, component results, report templates, signatories, run numbers, and final report lists.
- OpenEMR provides stronger lab provider abstraction, result/provider workflow, HL7 inbound/outbound concepts, and order/result separation.
- Current HMS should adapt those workflow ideas, not copy their code or table naming blindly.

## 2. What LIS Features Already Exist

- Lab test catalog with pricing, category, department, specimen metadata, panels, value types, and LOINC-ready fields
- Lab order creation with auto-billing, invoice items, visit-service linkage, and accounting side effects
- Payment gate support for lab processing
- Basic sample lifecycle on `lab_order_items`: `pending -> collected -> received -> processing -> completed -> verified -> rejected/cancelled`
- Barcode generation and barcode scan endpoints
- Lab report and lab result tables
- Bulk result entry, formula-based component calculation, abnormal flag detection, delta check, structured reference ranges
- Validation rules engine
- Machine registry, machine test mapping, HL7/ASTM parsing, raw machine message logging, machine readiness tests
- Consumable mapping, stock deduction, low-stock/expiry alerts, profitability reporting
- QC controls, ranges, results, calibrations, machine downtime tracking
- Lab settings for categories, templates, vendors, run numbers, signatories
- Patient chart quick lab ordering, doctor quick-order UI hooks, patient timeline visibility, nursing investigation result aggregation
- Existing lab/unit/integration/e2e coverage across Vitest and Playwright

## 3. What Is Incomplete

- `LaboratoryDashboard.tsx` is only partially live; it still depends on demo structures and does not expose a full production LIS workflow
- No dedicated sample collection worklist, sample receiving queue, validation queue, or report delivery queue screen
- No first-class department master with assigned users and workflow-role mapping
- No first-class sample entity; specimen data is spread across order/item/report fields
- No unified scanner workflow that resolves scan target and opens the correct next action
- Validation is split across `verify` and `review`, but not modeled as technician -> verifier -> validator -> published -> delivered
- Report delivery logging is not a first-class workflow
- Critical value acknowledgement is only appended to notes, not stored structurally
- Result correction is not a first-class auditable workflow
- Doctor/reception/IPD ordering exists, but the lab-side operator flow after ordering is fragmented
- TAT analytics exist, but action-oriented delayed worklists are limited

## 4. What Is Broken or Risky

- Current dashboard route and test route both point to the same operator page, which mixes queue/demo/dashboard behavior
- Core status data is split across `status`, `sample_status`, `result_status`, `review_status`, and ad-hoc note text; this makes lifecycle reporting fragile
- Critical acknowledgment currently writes into `notes` instead of a structured table
- Report printing works, but delivery, correction, and audit depth are weaker than the billing and accounting modules
- Nursing lab summary queries still reference older field assumptions such as `ordered_at`/`test_name` in places where the newer schema is richer
- Global auth roles do not yet represent `sample_collector`, `lab_technologist`, `pathologist`, etc., so LIS workflow permissioning must be layered without breaking existing role constraints

## 5. What Can Be Reused

- Existing `lab_order_items` billing-gated lifecycle
- Existing result entry, abnormal detection, delta check, formula engine, and reference-range matching
- Existing barcode generator and barcode utilities
- Existing machine readiness layer and HL7/ASTM parser infrastructure
- Existing consumables monitoring and stock movement logging
- Existing audit log helper and accounting posting helper
- Existing report templates, signatories, and printable report route
- Existing patient chart, doctor quick-order, and nursing aggregation endpoints

## 6. What Needs Refactor

- Centralize LIS workflow status derivation in one service/helper instead of scattering status logic across routes and pages
- Replace note-based critical acknowledgements with structured records
- Replace demo-heavy dashboard behavior with real worklist and KPI queries
- Introduce a consistent specimen/sample abstraction without rebuilding the whole historical data model
- Normalize lab UI navigation around operational stages instead of catalog/reporting/settings mixed together

## 7. Database Tables Needed

### Existing tables to keep using
- `lab_test_catalog`
- `lab_test_components`
- `lab_reference_ranges`
- `lab_orders`
- `lab_order_items`
- `lab_reports`
- `lab_results`
- `lab_rejection_reasons`
- `lab_machines`
- `lab_machine_test_map`
- `lab_machine_result_log`
- `lab_consumables`
- `lab_consumable_stock`
- `lab_consumable_movements`
- `lab_test_consumable_map`
- `lab_operation_logs`

### New or expanded tables/fields needed in this implementation pass
- `lab_departments`
- `lab_department_users`
- `lab_workflow_events`
- `lab_critical_acknowledgements`
- `lab_report_deliveries`
- `lab_result_corrections`

### Existing tables to expand
- `lab_test_catalog`
  - `container_type`
  - `report_format`
  - `result_type`
  - `patient_instruction`
  - `collector_instruction`
  - `department_id`
- `lab_orders`
  - `order_source`
  - `patient_context`
  - `admission_id`
  - `ward_name`
  - `bed_number`
  - `emergency_approved_by`
  - `payment_policy`
- `lab_order_items`
  - `sample_id`
  - `sample_label_code`
  - `department_id`
  - `workflow_status`
  - `received_at`
  - `result_entered_at`
  - `validated_at`
  - `published_at`
  - `delivered_at`
- `lab_reports`
  - `validated_by`
  - `validated_at`
  - `published_by`
  - `published_at`
  - `is_corrected`
  - `correction_reason`

## 8. Backend APIs Needed

### Extend existing `/api/lab`
- Real dashboard summary and actionable widgets
- Department/filter aware worklists
- Scanner resolve endpoint
- Sample collect / receive workflow endpoints
- Result draft / verification / validation / publish / deliver / correct endpoints
- Structured critical acknowledgment endpoints
- Direct delivery log endpoints

### New operational surfaces
- Department CRUD and assignment APIs
- Workflow event timeline APIs
- Report delivery history APIs
- Correction history APIs

### Keep existing integration routes
- Doctor quick order
- Patient chart quick order
- Billing-linked auto order creation
- Machine receive endpoints
- Monitoring, QC, calibration, settings, report analytics

## 9. Frontend Pages Needed

- LIS Dashboard
- Sample Collection
- Sample Receiving
- Department Worklist
- Result Entry
- Result Verification / Validation
- Report Delivery
- Rejected / Recollection queue
- Test Master / Panel Master / Department Master

### Practical UI plan for this pass
- Replace the current `LaboratoryDashboard.tsx` with a real multi-workflow operator page
- Add focused reusable panels/drawers for collection, receiving, result entry, validation, delivery, and critical acknowledgment
- Keep settings/reporting pages, but connect the main LIS operational flow to real data

## 10. Permissions Needed

### Global app roles already present and reusable
- `hospital_admin`
- `laboratory`
- `doctor`
- `md`
- `nurse`
- `reception`
- `director`

### LIS workflow roles to layer inside lab module
- `lab_admin`
- `lab_reception`
- `sample_collector`
- `lab_technician`
- `lab_technologist`
- `pathologist`
- `auditor`

### Permission model for this pass
- Keep existing global auth role constraints intact
- Add department-user workflow-role assignments inside LIS
- Enforce stage-specific actions through department assignment + existing role guard

## 11. Integrations Needed

- Doctor consultation / patient chart ordering
- Reception direct lab billing flow
- Billing payment clearance and emergency override behavior
- OPD flow
- IPD running bill / ward metadata flow
- Consumable stock deduction after result completion/validation
- Accounting posting via existing diagnostic billing/accounting hooks
- Patient timeline / doctor visibility / nursing visibility
- Report printing and delivery tracking

## 12. Tests Needed

### Unit
- Workflow status derivation
- reference-range + age/gender match
- abnormal + critical detection
- scanner resolve logic
- delivery log payload normalization
- correction diff persistence

### Integration
- doctor/reception direct order -> bill gate -> collection -> receive -> result -> validate -> deliver
- rejected sample -> recollection -> completion
- critical acknowledgment persistence
- consumable deduction on completed result
- IPD order metadata carrying through to LIS worklists

### E2E / browser
- direct lab flow
- doctor ordered lab flow
- scanner-driven collection/receiving/result flow
- report delivery and print flow

## 13. Implementation Order

1. Add LIS workflow schema expansion migration
2. Add centralized workflow helper/service
3. Add department, delivery, correction, critical acknowledgment, and workflow event APIs
4. Extend core lab endpoints to use the new workflow helper
5. Replace demo-heavy lab dashboard with real dashboard/worklists
6. Add collection, receiving, result entry, validation, delivery, and rejected-sample UI panels
7. Wire patient/doctor/reception/IPD visibility to the refined workflow status
8. Add targeted tests for new workflow paths
9. Run lint/typecheck/tests/build
10. Deploy only if the full tree is verifiably safe; otherwise provide exact production steps and blockers

## 14. Risk Areas

- Existing dirty tree on the starting branch means deployment risk must be called out honestly even if LIS changes are clean
- `lab.ts` is already large; new logic should go into helpers where possible
- Historical data may not have new workflow fields populated, so migration defaults and derived fallback logic must be safe
- Global auth role expansion is risky because invitations and shared authz tables are constrained; LIS workflow roles should stay subsystem-local
- Report and timeline queries must not break older lab rows

## 15. Final Target Workflow

### OPD
Doctor orders test -> bill created/linked -> payment policy evaluated -> sample collection queue -> sample received in department -> result entered -> verified/validated -> report published -> delivery logged -> doctor/patient/reception can view/print

### Direct lab
Reception creates direct lab order -> bill linked -> payment completed or approved override -> collection -> receiving -> result -> validation -> print/delivery

### IPD
Doctor or nurse orders test -> IPD running bill linkage preserved -> ward/bed metadata visible in LIS -> sample collected from ward -> result validated -> report visible in patient/IPD context

### Critical value
Result entered -> flagged critical -> dashboard alert + structured acknowledgment -> doctor/ward visibility -> audit trail retained

### Rejected sample
Sample rejected with reason -> recollection requested -> sample recollected -> workflow resumes without losing audit trail

### Inventory/accounting
Validated/completed diagnostic work deducts mapped consumables -> low stock alerts surface -> billing/accounting adapters continue to post revenue and reversals through existing finance hooks

## 16. Execution Scope for This Branch

This implementation pass will prioritize:
- completing the lab operator workflow end to end
- making the dashboard and worklists production-usable
- structuring critical/delivery/correction audit paths
- preserving existing billing/accounting/patient/doctor integrations

This pass will not blindly redesign the entire hospital system or replace working lab submodules that already exist.
