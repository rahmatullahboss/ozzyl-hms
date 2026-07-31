# Inventory Consumption Automation — Design Blueprint

Last updated: 2026-07-01

## 1. Purpose

This document defines the A-to-Z design for automated and controlled stock deduction across hospital inventory workflows: lab, OT, procedure room, ward, emergency, pharmacy, patient-chargeable consumption, and high-value items.

The goal is to reduce fraud, missed entries, and late manual deduction while preserving real-world flexibility where actual usage differs from the standard kit.

## 2. Important non-duplication rule

Do **not** build a second stock ledger or a second stock deduction engine.

The current HMS already has these foundations:

- Canonical inventory master/stock pages under `web/src/pages/inventory/*`.
- Canonical backend routes under `src/routes/tenant/inventory/*`.
- Canonical issue engine: `src/lib/inventory-issue-service.ts`.
- Issue route wrapper: `src/routes/tenant/inventory/issues.ts`.
- Existing workflow adapters: `src/routes/tenant/inventory/workflowAdapters.ts`.
- Existing issue types: `department_issue`, `patient_issue`, `ot_consumption`, `lab_consumption`, `pharmacy_sale`, `emergency_issue`, `asset_issue`.
- Existing lab reagent mapping engine: `src/lib/lab-consumables.ts` and lab monitoring pages.
- Existing OT blueprint in `docs/ot-blueptint.md` includes OT pack/inventory consumption concepts.

New work must **extend** these components and reuse `recordInventoryIssue`. The consumption automation layer should create expected/confirmed consumption records and finally call the canonical issue engine to deduct stock.

## 3. Best-practice principles

1. **Perpetual inventory as source of truth**: stock movements should be recorded as close to the point of use as possible.
2. **Point-of-use capture**: OT, procedure, ward, and lab consumption should be linked to patient/service/procedure references, not just a generic store issue.
3. **Standard kit / preference-card model**: predictable procedures should have default expected items.
4. **Suggested + confirm for variable workflows**: OT and emergency should show expected items but let nurses confirm actual usage.
5. **Auto-deduct only for predictable and low-risk items**: lab reagents, strips, tubes, small procedure consumables, standard dressing items.
6. **Scan/approval for high-risk or expensive items**: implant, stent, plate/screw, controlled drugs, blood bag, high-cost kit.
7. **Expected vs actual monitoring**: owner/admin should monitor variances, not only raw stock balance.
8. **ABC/VED-style control tiers**: A/high-value and vital items need tighter review and frequent counts; C/low-value items can use lighter controls.
9. **Cycle counting**: high-value/high-usage items should be counted more frequently than low-risk items.
10. **Audit and reversals**: every automated deduction must be idempotent, reversible on bill/procedure cancellation, and visible in ledger/audit.

## 4. Core concepts

### 4.1 Trigger

A trigger is the hospital event that creates an expected consumption event.

Supported trigger types:

- `billing_item` — service item billed at reception/billing counter.
- `lab_test` — lab test bill/result workflow.
- `ot_procedure` — OT case/procedure selected.
- `procedure` — non-OT procedure, e.g., dressing, nebulization, ECG consumable.
- `nursing_task` — ward nursing task completion.
- `emergency_service` — emergency treatment/procedure.
- `pharmacy_sale` — pharmacy sale/dispense.
- `package` — package/bundle/operation package.
- `manual_reference` — fallback for manually referenced consumption.

### 4.2 Consumption rule

A rule maps one trigger to expected inventory items.

Example: Dressing Small

- Trigger: billing item/service = Dressing Small
- Mode: suggest + confirm
- Store: Procedure Store
- Items:
  - Gauze 2 pcs
  - Bandage 1 roll
  - Antiseptic 20 ml
  - Gloves 1 pair

### 4.3 Deduction mode

Rules must not all behave the same way.

| Mode | Use case | Behavior |
| --- | --- | --- |
| `auto` | Predictable low-risk item | Immediately calls inventory issue service when trigger finalizes. |
| `suggest_confirm` | OT/procedure/ward | Creates pending expected list; staff confirms actual qty before deduction. |
| `scan_required` | Implant/high-value/controlled item | Staff must scan stock/lot/serial before deduction. |
| `approval_required` | Exceptional high-cost/high-variance use | Creates pending approval before issue. |
| `manual_only` | Rare or unpredictable item | No auto deduction; staff records manually with required reference. |

### 4.4 Consumption event

A consumption event is a concrete instance created from a rule and linked to a patient/procedure/bill/order.

States:

```text
expected
→ pending_confirmation
→ confirmed
→ posted
→ reversed / cancelled
```

Exception states:

```text
blocked_missing_rule
blocked_stock_shortage
blocked_scan_required
blocked_approval_required
variance_review
```

### 4.5 Expected vs actual

For every event item:

- Expected item and quantity from rule.
- Actual item and quantity confirmed/scanned by staff.
- Variance quantity.
- Variance reason.
- Confirmed by.
- Approved by, if needed.

## 5. Data model design

### 5.1 `InventoryConsumptionRule`

Purpose: rule header.

Suggested columns:

- `RuleId`
- `tenant_id`
- `RuleName`
- `RuleCode`
- `TriggerType`
- `TriggerId` nullable
- `TriggerCode` nullable
- `Department`
- `DefaultStoreId`
- `DeductionMode` enum: `auto`, `suggest_confirm`, `scan_required`, `approval_required`, `manual_only`
- `ChargePolicy` enum: `none`, `patient`, `department`, `included_in_package`
- `IsActive`
- `EffectiveFrom`
- `EffectiveTo`
- `CreatedBy`, `CreatedOn`, `ModifiedBy`, `ModifiedOn`

### 5.2 `InventoryConsumptionRuleItem`

Purpose: expected item list for a rule.

Suggested columns:

- `RuleItemId`
- `RuleId`
- `tenant_id`
- `ItemId`
- `DefaultStockId` nullable
- `Quantity`
- `Unit`
- `IsMandatory`
- `RequiresScan`
- `RequiresApproval`
- `HighValueFlag`
- `AllowSubstitution`
- `VarianceToleranceQty`
- `VarianceTolerancePercent`
- `Notes`

### 5.3 `InventoryConsumptionEvent`

Purpose: concrete consumption instance.

Suggested columns:

- `EventId`
- `tenant_id`
- `RuleId` nullable
- `EventNo`
- `TriggerType`
- `TriggerId`
- `PatientId` nullable
- `VisitId` nullable
- `AdmissionId` nullable
- `BillId` nullable
- `InvoiceItemId` nullable
- `LabOrderId` nullable
- `LabOrderItemId` nullable
- `OTCaseId` nullable
- `ProcedureId` nullable
- `Department`
- `StoreId`
- `Status`
- `ExpectedAt`
- `ConfirmedBy`, `ConfirmedAt`
- `PostedConsumptionId` nullable — link to canonical `InventoryConsumption`/issue record
- `ReversalConsumptionId` nullable
- `Remarks`

### 5.4 `InventoryConsumptionEventItem`

Purpose: expected/actual line item.

Suggested columns:

- `EventItemId`
- `EventId`
- `tenant_id`
- `RuleItemId` nullable
- `ItemId`
- `StockId` nullable
- `BatchNo` nullable
- `ExpectedQuantity`
- `ActualQuantity`
- `Chargeable`
- `ChargeAmount`
- `Status`
- `VarianceQty`
- `VarianceReason`
- `ScanCode` nullable
- `ConfirmedBy`, `ConfirmedAt`

### 5.5 `InventoryConsumptionException`

Purpose: owner/admin exception queue.

Suggested columns:

- `ExceptionId`
- `tenant_id`
- `EventId`
- `EventItemId` nullable
- `Reason` enum: `missing_rule`, `stock_shortage`, `scan_missing`, `approval_required`, `variance_high`, `duplicate_event`, `reference_missing`, `reversal_failed`
- `Severity` enum: `info`, `warning`, `critical`
- `Status` enum: `open`, `reviewed`, `resolved`, `ignored`
- `Message`
- `ReviewedBy`, `ReviewedAt`
- `ResolutionNote`

### 5.6 `InventoryConsumptionPolicy`

Purpose: tenant-level control.

Suggested columns:

- `tenant_id`
- `DefaultDeductionMode`
- `AutoDeductLowRiskItems`
- `RequireReferenceForManualIssue`
- `RequireScanForHighValue`
- `RequireApprovalForHighVariance`
- `BlockDischargeOnUnconfirmedConsumption`
- `SoftModeAllowStockShortage`
- `UpdatedBy`, `UpdatedAt`

## 6. Architecture

### 6.1 Do not replace existing issue service

The final stock deduction must call:

```text
recordInventoryIssue(...)
```

This preserves:

- stock deduction logic
- ledger movements
- inventory accounting integration
- existing permissions
- existing reports

### 6.2 New service layer

Create:

```text
src/lib/inventory-consumption-rules.ts
src/lib/inventory-consumption-events.ts
src/lib/inventory-consumption-posting.ts
```

Responsibilities:

- find matching rules for a trigger
- create expected event
- confirm actual quantities
- validate scan/approval requirements
- call `recordInventoryIssue`
- create exception if blocked
- reverse on cancellation
- provide reconciliation/variance summaries

### 6.3 API routes

Add under existing inventory route tree:

```text
src/routes/tenant/inventory/consumptionRules.ts
src/routes/tenant/inventory/consumptionEvents.ts
src/routes/tenant/inventory/consumptionExceptions.ts
src/routes/tenant/inventory/consumptionReports.ts
```

Suggested endpoints:

```text
GET    /api/inventory/consumption-rules
POST   /api/inventory/consumption-rules
GET    /api/inventory/consumption-rules/:id
PUT    /api/inventory/consumption-rules/:id
DELETE /api/inventory/consumption-rules/:id
POST   /api/inventory/consumption-rules/:id/items
PUT    /api/inventory/consumption-rules/:id/items/:itemId
DELETE /api/inventory/consumption-rules/:id/items/:itemId

POST   /api/inventory/consumption-events/from-trigger
GET    /api/inventory/consumption-events
GET    /api/inventory/consumption-events/:id
POST   /api/inventory/consumption-events/:id/confirm
POST   /api/inventory/consumption-events/:id/post
POST   /api/inventory/consumption-events/:id/reverse

GET    /api/inventory/consumption-exceptions
POST   /api/inventory/consumption-exceptions/:id/review
POST   /api/inventory/consumption-exceptions/:id/retry

GET    /api/inventory/consumption-reconciliation
GET    /api/inventory/consumption-variance
```

### 6.4 Workflow adapters

Do not duplicate adapter logic. Extend `src/routes/tenant/inventory/workflowAdapters.ts` to support rule-driven adapters:

```text
POST /api/inventory/workflow/trigger-consumption
```

Inputs:

- `TriggerType`
- `TriggerId`
- `PatientId`, `VisitId`, `AdmissionId`
- `BillId`, `InvoiceItemId`
- `OTCaseId`, `ProcedureId`
- `StoreId`
- optional actual items for immediate confirmation

### 6.5 UI pages

Add/extend pages under `web/src/pages/inventory`:

- `ConsumptionRulesPage.tsx`
- `ConsumptionRuleForm.tsx`
- `ConsumptionQueuePage.tsx`
- `ConsumptionExceptionsPage.tsx`
- `ConsumptionReconciliationPage.tsx`
- dashboard widgets inside `InventoryDashboard.tsx`

### 6.6 Module integration points

| Module | Trigger | Recommended mode |
| --- | --- | --- |
| Lab reagent | `lab_test` | Existing mapping remains; later bridge to unified rule engine. |
| OT | `ot_procedure` / `ot_case_closed` | `suggest_confirm` or `scan_required`. |
| Dressing/procedure | `billing_item` / `procedure` | `auto` for simple, `suggest_confirm` for variable. |
| Emergency | `emergency_service` | `suggest_confirm`, with emergency override. |
| Ward | `nursing_task` / `department_issue` | `suggest_confirm`. |
| Pharmacy sale | `pharmacy_sale` | Existing pharmacy flow; bridge if needed. |
| Implant/high-value | `ot_procedure` | `scan_required` + `approval_required`. |

## 7. UI/UX design

### 7.1 Inventory setup checklist

Add a normal inventory setup checklist similar to reagent setup:

1. Create stores/locations.
2. Create item categories.
3. Create vendors.
4. Create item master.
5. Set reorder level and ABC/control class.
6. Load starter consumption rules.
7. Setup approval/scan policy.
8. Run first stock count.
9. Reconcile first 7 days of consumption.

### 7.2 Consumption Rules page

Sections:

- Rule filter: department, trigger type, mode, active/inactive.
- Rule cards/table.
- Create/edit rule drawer.
- Items grid: item, qty, mandatory, scan required, approval required, tolerance.
- Copy from existing rule.
- Import starter template.

### 7.3 Point-of-use consumption queue

For OT/procedure/ward:

- Pending events.
- Patient/procedure/bill reference.
- Expected item list.
- Actual quantity input.
- Scan batch/lot.
- Variance reason.
- Confirm and post.

### 7.4 Owner dashboard

Widgets:

- Unconfirmed consumption.
- Auto-deducted today.
- Manual issue without reference.
- High variance events.
- Stock shortage exceptions.
- High-value scan missing.
- Write-off pending approval.
- Top consumed items.
- Department-wise consumption.
- Staff-wise issue activity.

## 8. Starter rule catalog

A starter catalog should be seeded but always editable per hospital.

Examples:

### Dressing Small

- Trigger: `billing_item` or `procedure`
- Mode: `suggest_confirm`
- Items: gauze, bandage, antiseptic, gloves

### Nebulization

- Trigger: `billing_item`
- Mode: `auto` or `suggest_confirm`
- Items: nebulizer mask, nebule, syringe if used

### IV Cannulation

- Trigger: `procedure`
- Mode: `suggest_confirm`
- Items: cannula, dressing, syringe, gloves

### Normal Delivery Pack

- Trigger: `procedure`
- Mode: `suggest_confirm`
- Items: gloves, drape, suture, gauze, blade, cord clamp

### C-Section Standard Pack

- Trigger: `ot_procedure`
- Mode: `suggest_confirm`
- Items: gloves, gown, drape, blade, suture, gauze, suction tube, catheter

### Appendectomy Standard Pack

- Trigger: `ot_procedure`
- Mode: `suggest_confirm`
- Items: gloves, blade, suture, gauze, drape, gown

### Implant/Stent

- Trigger: `ot_procedure`
- Mode: `scan_required` + `approval_required`
- Items: each implant/stent must be scanned and linked to patient/procedure

## 9. Admin controls

### 9.1 Policy controls

- Soft mode vs strict mode.
- Require reference for manual issue.
- Require scan for A-class/high-value items.
- Require approval for stock adjustment/write-off/variance.
- Auto-post allowed for low-risk items only.
- Block case closure/discharge if critical consumption unconfirmed.

### 9.2 Variance controls

Variance types:

- expected but not consumed
- consumed but not expected
- actual qty higher than expected
- actual qty lower than expected
- manual issue without bill/procedure reference
- stock deducted after cancellation without reversal

## 10. Reporting

Reports required:

- Expected vs actual consumption report.
- Department consumption report.
- OT consumption report by procedure/surgeon.
- Staff issue activity report.
- Manual issue without reference report.
- High-value scanned item report.
- Stock shortage exception report.
- Reversal/cancellation report.
- ABC/VED cycle count report.

## 11. Testing strategy

Required backend tests:

- Rule creation/update/delete.
- Duplicate rule validation.
- Event creation from trigger.
- Auto mode posts exactly once.
- Suggest mode creates pending queue and does not deduct until confirmed.
- Scan-required item blocks without stock/lot scan.
- Approval-required item creates exception.
- Stock shortage creates exception in soft mode.
- Strict mode blocks posting.
- Cancellation reverses posted consumption.
- Manual issue without reference is flagged.
- High variance creates exception.

Required frontend tests:

- Rules page renders trigger/mode fields.
- Rule item grid validates qty and item.
- Queue page shows expected items.
- Confirm action sends actual qty.
- High-value item requires scan UI.
- Dashboard shows exception counts.

## 12. Open decisions

1. Should starter rules be global defaults loaded by tenant action, similar to reagent catalog?
2. Which existing billing/service catalog table should be the primary trigger source?
3. Should OT case closure be blocked by unconfirmed consumption in first release, or only warn?
4. What amount threshold defines high-value item?
5. Should implant/device scan use internal QR or GS1/UDI barcode parser first?

## 13. Research anchors

This design follows common patterns from healthcare and ERP inventory practice: barcode/UDI traceability, ABC-based control, cycle counting, point-of-use consumption capture, and operating-room preference cards/standard kits. The implementation should preserve this HMS's canonical inventory ledger rather than creating duplicate stock books.
