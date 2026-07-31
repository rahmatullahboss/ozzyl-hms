# HMS Lab/LIS System — Full Implementation Plan
## Date: 2026-04-26
## Goal: Close all HIGH + MEDIUM impact gaps vs DanpheEMR

---

## PHASE 1: Foundation (Database + Core APIs)
**Priority: CRITICAL | Est. Time: 2-3 days**

### 1.1 Auto-Calculation Formula Engine
**Problem:** MCHC, MCV, eGFR, LDL etc. must be manually calculated.
**Solution:** Add formula support to test components.

**DB Changes:**
- Add to `lab_test_catalog`:
  - `calculation_formula TEXT` — e.g., "{101} / {102} * 100"
  - `is_auto_calculate INTEGER DEFAULT 0`
  - `formula_description TEXT`
- Add `lab_test_components` table (if not exists):
  - `id`, `lab_test_id`, `component_name`, `component_code`, `unit`, `display_sequence`, `group_name`, `indentation_count`, `normal_range`, `critical_low`, `critical_high`, `is_auto_calculate`, `calculation_formula`, `value_type`

**API Changes:**
- `POST /api/lab/orders/:id/results/bulk` — after saving all manual results, evaluate formulas for auto-calculate components
- Formula parser: extract `{component_id}` placeholders, substitute values, evaluate with `new Function()` or safe-eval
- Save computed result with `entered_by = null` and `machine_id = null` (flag as auto-computed)

**Frontend:**
- LabTestOrderForm / LaboratoryDashboard: auto-calculated fields show as "readonly" with calculated value
- Visual indicator (calculator icon) showing this is auto-computed

---

### 1.2 Gender/Age-Specific Reference Ranges
**Problem:** `normal_range` is a single TEXT column. Pediatric ranges not supported.
**Solution:** Structured reference ranges with gender + age bands.

**DB Changes:**
- Add `lab_reference_ranges` table:
  - `id`, `lab_test_id`, `gender` ('male','female','both'), `age_min_months`, `age_max_months`, `range_low`, `range_high`, `range_text`, `is_active`, `tenant_id`
- Keep `normal_range` for backward compatibility but deprecate

**API Changes:**
- `GET /api/lab/reference-ranges/:testId` — list ranges for a test
- `POST/PUT/DELETE /api/lab/reference-ranges` — CRUD
- `PUT /api/lab/items/:itemId/result` — determine abnormal flag by:
  1. Get patient gender + age
  2. Find matching reference range (gender + age band)
  3. Compare result_numeric against range_low/range_high
  4. Set abnormal_flag: 'normal' | 'high' | 'low' | 'critical'

**Frontend:**
- LabSettingsPage: add Reference Ranges tab
- Test catalog form: show reference range builder (gender + age + range)
- LabReportPrint: show appropriate reference range based on patient demographics

---

### 1.3 Delta Check (Previous Result Comparison)
**Problem:** `previous_value` and `delta_flag` columns exist in migration 0144 but NEVER populated.
**Solution:** Auto-populate on every result save.

**DB Changes:** NONE (columns already exist)

**API Changes:**
- In `PUT /api/lab/items/:itemId/result` and bulk result entry:
  1. After saving new result, query `lab_results` for same `lab_test_id` + same patient (via lab_order → patient_id)
  2. Find most recent previous result (excluding current)
  3. Set `previous_value = previous.result_text`
  4. Calculate `delta_flag`:
     - If new > prev + 20% → 'increased'
     - If new < prev - 20% → 'decreased'
     - Else → 'stable'
  5. If no previous → 'new'

**Frontend:**
- LaboratoryDashboard: show delta arrow (↑ ↓ →) next to results
- LabReportPrint: show "Previous: X (↑/↓/→)" for repeated tests
- Tooltip showing percentage change

---

## PHASE 2: Communication & Notifications
**Priority: HIGH | Est. Time: 2-3 days**

### 2.1 SMS Notification for Lab Results
**Problem:** `delivered_via` column exists but no SMS sending logic.
**Solution:** Integrate SMS gateway for result notifications.

**DB Changes:** NONE (existing columns sufficient)

**API Changes:**
- `POST /api/lab/orders/:id/notify` — send SMS/Email notification
- Body: `{ method: 'sms'|'email'|'both', template?: string }`
- Logic:
  1. Fetch patient phone/email from `patients` table
  2. Generate short report summary
  3. Call SMS provider (Bangladesh: Twilio, BulkSMSBD, or custom gateway)
  4. Update `lab_reports.delivered_via` and `delivered_at`
  5. Log in `lab_operation_logs` as `print_made` (or new `notification_sent`)
- Add `POST /api/lab/orders/:id/notify/sms-template` — configure SMS text template

**Config:**
- Add `SMS_PROVIDER` env var (already exists as 'stub')
- Add `SMS_API_KEY`, `SMS_SENDER_ID` secrets

**Frontend:**
- LabReportPrint: "Send SMS" button
- LaboratoryDashboard: bulk SMS selection (select multiple orders → Send SMS)
- Settings: SMS template configuration

---

### 2.2 Email Report Dispatch
**Problem:** No email sending for lab reports.
**Solution:** Use existing Resend integration.

**API Changes:**
- Extend `POST /api/lab/orders/:id/notify` with `method: 'email'`
- Generate HTML email using report template
- Attach PDF if available (or generate on-the-fly)
- Use existing `RESEND_FROM_EMAIL` config

**Frontend:**
- LabReportPrint: "Email to Patient" button
- Settings: email template for lab reports

---

### 2.3 Barcode Generation & Sticker Printing
**Problem:** `barcode` field exists on `lab_order_items` but no generation API.
**Solution:** Generate barcode labels for sample tubes.

**DB Changes:** NONE

**API Changes:**
- `POST /api/lab/orders/:id/generate-barcodes` — generate barcodes for all items
- Barcode format: `{tenant_code}-{order_no}-{item_sequence}` e.g., "OZ-LO-0001-01"
- `GET /api/lab/orders/:id/barcode-sticker` — return HTML for thermal sticker printing
  - Sticker size: 50mm x 25mm (standard tube label)
  - Content: Barcode (Code128), Patient name, Test name, Collection date
- `POST /api/lab/barcode/scan` already exists — just ensure it matches generated format

**Frontend:**
- LabTestOrderForm: "Generate Barcodes" button after order creation
- LaboratoryDashboard: "Print Sticker" button on each item
- Thermal printer optimized HTML (no margins, small fonts)

---

## PHASE 3: LIS Machine Integration (Bidirectional)
**Priority: MEDIUM-HIGH | Est. Time: 3-4 days**

### 3.1 Bidirectional Order Sending
**Problem:** `is_bidirectional` flag exists on `lab_machines` but no outbound order API.
**Solution:** Send work orders TO machines.

**DB Changes:**
- Add `lab_machine_orders` table:
  - `id`, `machine_id`, `lab_order_id`, `lab_order_item_id`, `machine_test_code`, `status` ('pending','sent','acknowledged','completed'), `sent_at`, `acknowledged_at`, `raw_request`, `raw_response`, `tenant_id`

**API Changes:**
- `POST /api/lab-machines/:id/send-orders` — send pending orders to machine
- Protocol support:
  - **HL7:** Generate ORM^O01 message (Order message)
  - **ASTM:** Generate ENQ + Order frame
  - **TCP:** Open socket, send message, wait for ACK
  - **File drop:** Write to shared directory
- `GET /api/lab-machines/:id/pending-orders` — list orders waiting to be sent
- `POST /api/lab-machines/:id/acknowledge` — machine acknowledges receipt

**Frontend:**
- LabMachineSettings: "Send Orders" button
- Show pending orders queue per machine
- ACK status indicator

---

### 3.2 Machine Downtime Tracking
**Problem:** `machine_downtime_mins` on `lab_daily_summaries` always 0.
**Solution:** Track when machines go down.

**DB Changes:**
- Add `lab_machine_downtime` table:
  - `id`, `machine_id`, `downtime_start`, `downtime_end`, `reason`, `resolved_by`, `tenant_id`

**API Changes:**
- `POST /api/lab-machines/:id/downtime` — mark machine down
- `PUT /api/lab-machines/:id/downtime/:id/resolve` — mark resolved
- Update daily summary cron to calculate downtime from this table

**Frontend:**
- LabMachineSettings: "Mark Down" / "Resolve" buttons
- Show uptime % on machine card

---

## PHASE 4: Quality Control (QC)
**Priority: HIGH | Est. Time: 3-4 days**

### 4.1 QC Control Material Master
**Problem:** No QC support at all for lab accreditation.
**Solution:** Full QC module.

**DB Changes:**
- `lab_qc_controls`:
  - `id`, `control_name`, `control_code`, `control_lot`, `manufacturer`, `expiry_date`, `is_active`, `tenant_id`
- `lab_qc_ranges`:
  - `id`, `control_id`, `lab_test_id`, `mean`, `sd`, `range_low`, `range_high`, `level` (1,2,3), `is_active`, `tenant_id`
- `lab_qc_results`:
  - `id`, `control_id`, `lab_test_id`, `qc_range_id`, `result_value`, `run_date`, `run_number`, `machine_id`, `technician_id`, `is_out_of_range`, `action_taken`, `tenant_id`

**API Changes:**
- `GET/POST/PUT/DELETE /api/lab-monitoring/qc/controls`
- `GET/POST/PUT/DELETE /api/lab-monitoring/qc/ranges`
- `GET/POST /api/lab-monitoring/qc/results`
- `GET /api/lab-monitoring/qc/levy-jennings/:testId/:controlId` — data for chart
- Westgard rule evaluation:
  - 1-2s: 1 point > 2SD
  - 1-3s: 1 point > 3SD
  - 2-2s: 2 consecutive points > 2SD same side
  - R-4s: Range > 4SD between consecutive
  - 4-1s: 4 consecutive points > 1SD same side
  - 10-x: 10 consecutive points on one side

**Frontend:**
- LabMonitoringDashboard: new "QC" tab
- Control material entry form
- Levey-Jennings chart (using recharts or chart.js)
- Westgard rule violation alerts (red/yellow indicators)

---

### 4.2 Calibration Tracking
**Problem:** Only log entry exists, no schedule or results.
**Solution:** Dedicated calibration module.

**DB Changes:**
- `lab_calibrations`:
  - `id`, `machine_id`, `calibration_type`, `scheduled_date`, `performed_date`, `performed_by`, `result_status` ('pass','fail','pending'), `calibration_values`, `certificate_no`, `next_due_date`, `is_active`, `tenant_id`

**API Changes:**
- `GET/POST/PUT/DELETE /api/lab-monitoring/calibrations`
- `GET /api/lab-monitoring/calibrations/upcoming` — due in next 7/30 days
- `GET /api/lab-monitoring/calibrations/overdue` — past due

**Frontend:**
- LabMachineSettings: Calibration schedule per machine
- Calendar view of upcoming calibrations
- Overdue alert banner

---

## PHASE 5: Validation & Workflow
**Priority: MEDIUM | Est. Time: 2-3 days**

### 5.1 Sample Rejection Workflow
**Problem:** `rejected` status exists but no reason catalog or UI.
**Solution:** Full rejection workflow.

**DB Changes:**
- `lab_rejection_reasons`:
  - `id`, `reason_code`, `reason_text`, `category` ('hemolysis','clotted','insufficient','wrong_container','others'), `is_active`, `tenant_id`
- Add `rejection_reason_id` to `lab_order_items`
- Add `rejected_by`, `rejected_at`, `rejection_notes` to `lab_order_items`

**API Changes:**
- `GET/POST/PUT/DELETE /api/lab-settings/rejection-reasons`
- `PATCH /api/lab/items/:itemId/reject` — reject with reason
- `PATCH /api/lab/items/:itemId/recollect` — mark for recollection

**Frontend:**
- LaboratoryDashboard: "Reject Sample" button with reason dropdown
- Rejection report (how many samples rejected by reason, by day)
- Recollection queue

---

### 5.2 Test Validation Rules Engine
**Problem:** No validation beyond basic Zod schemas.
**Solution:** Configurable validation rules per test.

**DB Changes:**
- `lab_validation_rules`:
  - `id`, `lab_test_id`, `rule_type` ('range','mandatory','dependency','delta'), `rule_config` (JSON), `error_message`, `is_blocking`, `is_active`, `tenant_id`

**Rule Types:**
- `range`: result must be between X and Y
- `mandatory`: field cannot be empty
- `dependency`: if Test A is positive, Test B must be done
- `delta`: result cannot change more than X% from previous

**API Changes:**
- Validate in `PUT /api/lab/items/:itemId/result` before saving
- If `is_blocking = 1`, reject save with error
- If `is_blocking = 0`, warn but allow save

**Frontend:**
- LabSettingsPage: Validation Rules tab
- Result entry: show inline validation errors/warnings

---

## PHASE 6: Government Reporting
**Priority: HIGH (Bangladesh context) | Est. Time: 2-3 days**

### 6.1 Government Report Items Mapping
**Problem:** No DHIS2/HMIS mapping for national health reporting.
**Solution:** Map tests to government report codes.

**DB Changes:**
- `lab_gov_report_items`:
  - `id`, `serial_number`, `item_code`, `item_name`, `item_name_bn`, `group_name`, `category`, `reporting_frequency`, `is_active`, `tenant_id`
- `lab_gov_report_mappings`:
  - `id`, `gov_item_id`, `lab_test_id`, `is_component_based`, `component_id`, `count_method` ('all','positive','negative'), `is_active`, `tenant_id`

**API Changes:**
- `GET/POST/PUT/DELETE /api/lab-monitoring/gov-report-items`
- `GET/POST/PUT/DELETE /api/lab-monitoring/gov-report-mappings`
- `GET /api/lab-monitoring/gov-reports/generate?from=&to=` — generate report
  - Aggregate counts by mapped gov items
  - Support positive/negative counting for serology

**Frontend:**
- LabSettingsPage: "Government Reporting" tab
- Report generator with date range
- Export to Excel/PDF

---

## PHASE 7: Enhanced Frontend
**Priority: MEDIUM | Est. Time: 3-4 days**

### 7.1 Laboratory Dashboard Redesign
**Current:** Simple list view with basic filters
**New:**
- Sample collection queue (with barcode scanning)
- Result entry queue (by department/test type)
- Verification queue (pending pathologist review)
- Critical alerts panel
- TAT monitoring (which tests are delayed)
- QC reminder panel

### 7.2 Result Entry Grid
**Current:** One-by-one modal
**New:**
- Excel-like grid for batch result entry
- Auto-calculate formulas in real-time
- Delta check highlighting (red if changed >20%)
- Reference range tooltip
- Critical value popup warning

### 7.3 Patient-Facing Portal
- View lab results online
- Download PDF reports
- SMS notification preferences

---

## IMPLEMENTATION ORDER (Recommended)

### Week 1: Core Calculations & Ranges
1. Auto-calculation formula engine
2. Gender/age reference ranges
3. Delta check activation

### Week 2: Communication
4. SMS notification
5. Email dispatch
6. Barcode generation + sticker printing

### Week 3: LIS & QC
7. Bidirectional LIS order sending
8. QC control material + Levey-Jennings
9. Calibration tracking

### Week 4: Workflow & Reporting
10. Sample rejection workflow
11. Validation rules engine
12. Government reporting mapping

### Week 5: Frontend Polish
13. Laboratory Dashboard redesign
14. Result entry grid
15. Full testing & bug fixes

---

## FILES TO CREATE/MODIFY

### New Files:
- `src/routes/tenant/labComponents.ts` — component hierarchy APIs
- `src/routes/tenant/labReferenceRanges.ts` — reference range APIs
- `src/routes/tenant/labQc.ts` — QC APIs
- `src/routes/tenant/labCalibrations.ts` — calibration APIs
- `src/routes/tenant/labGovReporting.ts` — gov reporting APIs
- `src/routes/tenant/labNotifications.ts` — SMS/email APIs
- `src/routes/tenant/labBarcode.ts` — barcode generation APIs
- `src/lib/lab-formula-evaluator.ts` — safe formula parser
- `src/lib/lab-westgard-rules.ts` — QC rule engine
- `src/lib/lab-barcode-generator.ts` — barcode generation
- `web/src/pages/LabQcDashboard.tsx` — QC frontend
- `web/src/pages/LabCalibrationPage.tsx` — calibration frontend
- `web/src/pages/LabGovReportingPage.tsx` — gov reporting frontend

### Modified Files:
- `src/routes/tenant/lab.ts` — add formula eval, delta check, reference range lookup
- `src/routes/tenant/labMachines.ts` — add bidirectional send, downtime
- `src/routes/tenant/labMonitoring.ts` — extend with QC, calibration
- `src/index.ts` — register new routes
- `web/src/pages/LaboratoryDashboard.tsx` — major redesign
- `web/src/pages/LabReportPrint.tsx` — add delta, reference ranges
- `web/src/pages/LabSettingsPage.tsx` — add new tabs
- `web/src/App.tsx` — add new routes
- `web/src/components/dashboard/Sidebar.tsx` — add new menu items

---

## DEPENDENCIES
- No new npm packages needed (formula eval can use `new Function()` safely)
- For SMS: configure existing SMS provider
- For charts: already have charting libraries
- For barcodes: can use SVG-based Code128 generation (no heavy library)

---

## TESTING CHECKLIST
- [ ] Auto-calculate: MCHC = Hb / PCV * 100 works correctly
- [ ] Reference range: Male 13.5-17.5, Female 12.0-15.5 applied correctly
- [ ] Delta check: 2nd CBC shows ↑/↓ arrow vs previous
- [ ] SMS: Patient receives result notification
- [ ] Barcode: Generate + scan works end-to-end
- [ ] Bidirectional: Machine receives ORM^O01 message
- [ ] QC: 1-3s rule fires when value > 3SD
- [ ] Calibration: Overdue machine shows red alert
- [ ] Rejection: Rejected sample moves to recollection queue
- [ ] Gov report: Monthly report aggregates correctly
