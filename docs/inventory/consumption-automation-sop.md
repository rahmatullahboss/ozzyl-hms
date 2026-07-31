# Inventory Consumption Automation — SOP and Operating Manual

Last updated: 2026-07-01

## 1. Objective

This SOP explains how hospital staff, managers, and owners should use the inventory consumption automation system once implemented.

It covers:

- manual issue
- automatic deduction
- suggested consumption confirmation
- OT/procedure kits
- high-value scan/approval
- exception review
- owner monitoring
- stock counting and reconciliation

## 2. Roles

| Role | Responsibilities |
| --- | --- |
| Owner / MD | Monitor variance, losses, write-off, high-value usage, department consumption. |
| Hospital Admin | Configure policy, approve exceptions, supervise inventory setup. |
| Inventory Manager | Manage item master, stores, stock-in, rules, reorder, reports. |
| Storekeeper | Receive stock, issue stock, scan lots, maintain store balance. |
| OT In-charge | Confirm OT packs, approve OT consumption, review OT variance. |
| OT Nurse | Confirm actual OT item usage, scan high-value items, report wastage. |
| Ward Nurse / In-charge | Request/receive ward stock and record patient/room consumption. |
| Lab Manager | Manage reagent mapping, reagent exceptions, reconciliation. |
| Accountant | Review inventory cost/accounting entries and supplier/payment impact. |

## 3. Setup SOP

### Step 1 — Create stores and locations

Examples:

- Main Store
- Pharmacy Store
- Lab Store
- OT Store
- Emergency Store
- Ward Store
- Fridge / Cold Chain
- Expired/Damaged quarantine location

### Step 2 — Create item master

For each item:

- Item code
- Item name
- Category
- Unit
- Pack size
- Reorder level
- Preferred vendor
- High-value flag
- Requires batch/expiry
- Requires scan
- ABC/VED/control class

### Step 3 — Stock-in current balance

Use GRN or opening balance stock-in. Record:

- quantity
- batch/lot
- expiry
- purchase price
- store/location
- vendor if available

### Step 4 — Load starter consumption rules

Load starter rules only as editable templates. The hospital must validate quantities.

### Step 5 — Validate top workflows

Start with high-volume/high-cost areas:

- Lab top tests
- Top 20 billed procedures
- OT common procedures
- Emergency common services
- Ward frequent consumables

### Step 6 — Soft rollout

Start with:

```text
low-risk auto deduction = on
OT/procedure suggest-confirm = on
high-value scan = warning
manual issue reference = warning
strict blocking = off
```

### Step 7 — Review first week

Daily review:

- expected vs actual
- manual issue without reference
- stock shortage exceptions
- high variance
- cancelled bill/procedure reversal

### Step 8 — Tighten controls

After staff training and clean data:

- make reference mandatory for manual issue
- require scan for high-value items
- require approval for high variance
- block OT case close if critical consumption pending

## 4. Day-to-day SOP

## 4.1 Purchase and stock-in

```text
Purchase Request
→ Approval
→ PO
→ Goods Receipt / GRN
→ QC / expiry check
→ Stock available
```

Controls:

- GRN cannot be edited without audit.
- Expired stock cannot be issued.
- Near-expiry stock should be visible.
- High-value item should have batch/serial/scan code.

## 4.2 Department manual issue

Use for non-billed or unpredictable requests.

```text
Department request
→ Store issue
→ Receiver confirmation
→ Ledger updated
```

Rules:

- Reference is required where possible.
- Manual issue without patient/procedure/department reference is flagged.
- High-value manual issue requires approval/scan.

## 4.3 Auto deduction for low-risk services

Example: dressing, nebulization, simple injection consumables.

```text
Service billed/finalized
→ matching rule found
→ stock deducted automatically
→ ledger updated
```

If stock is short:

- soft mode: create exception, allow workflow
- strict mode: block posting until resolved

## 4.4 Suggested confirmation for OT/procedure

```text
Procedure selected / OT scheduled
→ expected consumption event created
→ staff confirms actual usage
→ system deducts stock
→ variance recorded
```

Rules:

- OT nurse must confirm actual items.
- Variance reason required if outside tolerance.
- High-value items must be scanned.
- OT in-charge reviews high variance.

## 4.5 High-value item SOP

Examples:

- implant
- stent
- orthopedic plate/screw
- expensive kit
- controlled item

Process:

```text
Expected item appears in consumption event
→ scan stock/lot/serial
→ link to patient/procedure
→ approval if required
→ deduct stock
```

Controls:

- Cannot post without scan if policy requires scan.
- Patient/procedure reference mandatory.
- Owner/admin sees high-value usage report.

## 4.6 Wastage/write-off SOP

```text
Staff reports damaged/expired/wasted item
→ reason + photo/remarks if available
→ approval
→ stock deducted as write-off
→ visible in report
```

Controls:

- Frequent write-off by same staff/store is flagged.
- Write-off soon after GRN is flagged.

## 4.7 Return SOP

```text
Unused item returned
→ verify condition
→ return to store/stock
→ ledger updated
```

Do not return opened/contaminated/expired items to usable stock.

## 4.8 Cancellation/reversal SOP

If a bill/procedure/event is cancelled after stock deduction:

```text
Cancel trigger
→ find posted consumption event
→ create reversal
→ restore stock or mark non-returnable exception
```

If item cannot be returned physically:

- create exception
- admin reviews
- decide: keep consumed / write-off / reverse only bill cost

## 5. Owner/admin monitoring SOP

Daily dashboard checks:

1. Open consumption exceptions.
2. Manual issue without reference.
3. High variance OT/procedure events.
4. High-value item usage.
5. Stock shortage on billed services.
6. Write-off requests.
7. Low stock and near-expiry.
8. Staff issue activity.

Weekly checks:

1. Top consumed items.
2. Department-wise consumption.
3. Procedure-wise variance.
4. Reorder suggestions.
5. Cycle count schedule.

Monthly checks:

1. Stock count approval.
2. Inventory valuation.
3. Wastage percentage.
4. Purchase vs consumption trend.
5. Supplier price changes.

## 6. Exception handling SOP

| Exception | Action |
| --- | --- |
| Missing rule | Create/edit rule, retry if needed. |
| Stock shortage | Stock-in, transfer stock, or approve soft exception. |
| Scan missing | Scan actual lot/serial or approve emergency override. |
| Approval required | Manager/admin approves or rejects. |
| High variance | Staff must enter reason; admin reviews. |
| Duplicate event | System should block duplicate posting; admin reviews. |
| Reversal failed | Resolve stock/physical return manually with approval. |

## 7. Cycle count SOP

Recommended count frequency:

| Item type | Count frequency |
| --- | --- |
| High-value / A class | Weekly or biweekly |
| Vital / V class | Weekly |
| Medium / B class | Monthly |
| Low-value / C class | Quarterly |
| Expiry-sensitive | Monthly or near-expiry review |

Process:

```text
Create count session
→ physical count by trained staff
→ submit variance
→ manager approves
→ stock adjustment posted
```

## 8. Go-live SOP

For a new hospital:

1. Do not enable strict mode on day 1.
2. Load starter rules but validate with department heads.
3. Start with soft mode + owner monitoring.
4. Train staff on scan/confirmation flows.
5. Review variances daily for first 7 days.
6. Enable strict/high-value controls after data is stable.

## 9. Staff training script

Tell staff:

- Stock must leave the store only through system issue, confirmed consumption, or approved write-off.
- If system shows expected items, confirm actual quantity before posting.
- If actual quantity differs, enter reason.
- High-value items must be scanned and linked to patient/procedure.
- Manual issue without reference will be visible to admin.

## 10. Owner explanation

The owner should not rely only on closing stock. The owner should watch:

```text
Expected stock use vs actual stock use
Manual issue without patient/procedure reference
High-value item scan trail
Write-off and adjustment approvals
Department-wise consumption trend
Staff-wise issue behavior
```

This is how the system reduces stock leakage and detects operational abuse.
