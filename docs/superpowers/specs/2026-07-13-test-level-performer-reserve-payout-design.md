# Test-Level Performer Reserve and Doctor Payout Design

Date: 2026-07-13

## 1. Context

Diagnostic tests such as USG can have a fixed performer fee (for example, BDT 200) that must be separated from the amount used to calculate referrer or prescriber commission. The performer doctor is often unknown when reception creates the bill, so requiring the receptionist to select a performer is unreliable and causes missed or incorrect payouts.

The existing system creates doctor-specific rows in `doctor_commission_accruals` and the Reception Cash Operations workspace pays those accruals through `doctor_commission_settlements`. Because `doctor_commission_accruals.doctor_id` is required, an unnamed performer amount must not be represented as a fake doctor or a nullable doctor accrual.

This change introduces a test-level payout rule and a separate unassigned performer reserve ledger. Billing creates immutable reserve units automatically. Reception Cash Operations later assigns selected reserve units to one doctor and pays them through the existing settlement, cash-drawer, accounting, receipt, idempotency, and audit infrastructure.

## 2. Goals

- Configure a performer reserve rule at the diagnostic test/service-item level.
- Support `flat` and `percent` rule types; flat is the initial operational default.
- Automatically reserve the performer amount when a matching diagnostic item is billed.
- Deduct the performer reserve before calculating prescriber/referrer commission.
- Avoid requiring performer selection during billing.
- Show unassigned reserves in Reception Cash Operations grouped by test.
- Let a cashier select exact reserve quantity, choose one doctor, and pay from the active drawer.
- Prevent duplicate reserve creation, duplicate doctor accrual, duplicate settlement, and duplicate cash movement.
- Preserve immutable rule and amount snapshots even after the test configuration changes.
- Keep cancellation, refund, reversal guards, accounting, and audit records consistent.

## 3. Non-goals

- Automatically deciding which doctor performed a test.
- Paying a reserve before the linked bill is fully paid.
- Replacing the existing assigned-doctor payable workflow.
- Converting all historical performer commissions into reserves.
- Posting an unnamed doctor liability to the general ledger at bill creation in the first release.
- Supporting arbitrary manual payout amounts that differ from the configured reserve snapshot.

## 4. Chosen Architecture

### 4.1 Test rule

Create a versioned `diagnostic_performer_payout_rules` table keyed to the tenant-local `billing_service_items` row. A rule is valid only for an active LAB or RAD service item. Each rule stores:

- tenant;
- billing service item;
- diagnostic kind (`lab` or `radiology`);
- rate type (`flat` or `percent`);
- normalized rate value;
- effective date window;
- active flag;
- notes and audit metadata.

For `flat`, `rate_value` is the configured BDT amount. For `percent`, `rate_value` is basis points from 0 through 10,000. The API accepts a human percentage and normalizes it to basis points.

Updating a rule closes the prior effective version and creates a new version. Existing reserve rows never recalculate from the new rule.

### 4.2 Unit-level reserve ledger

Create `diagnostic_performer_reserves` with one immutable row per billed diagnostic unit. Unit rows make partial quantity payout deterministic and auditable without maintaining mutable aggregate quantities.

Each row stores:

- tenant and rule snapshot;
- bill and invoice item;
- patient and visit references;
- billing service item and diagnostic source identifiers;
- test code/name snapshot;
- unit sequence within the invoice item;
- original unit service amount excluding tax;
- allocated unit discount;
- net unit service amount;
- rule type/value snapshot;
- reserved amount;
- status (`reserved`, `paid`, `cancelled`, `reversed`);
- assigned doctor, accrual, settlement, and lifecycle timestamps when applicable.

A unique constraint on `(tenant_id, invoice_item_id, unit_sequence)` prevents duplicate reserves. A unique non-null index on the doctor accrual's `performer_reserve_id` prevents the same reserve from producing two doctor accruals.

### 4.3 Why unit rows are preferred

Diagnostic invoice quantities are normally small. Unit rows provide:

- exact quantity selection;
- deterministic money rounding;
- direct audit linkage from one billed unit to one paid doctor;
- simple duplicate guards;
- no mutable `remaining_quantity` race;
- straightforward cancellation of unpaid units.

## 5. Money and Calculation Rules

All calculations round to two decimals using the existing `roundMoney` convention. Tax is excluded from the performer reserve and doctor commission base.

### 5.1 Discount allocation

The server is the source of truth.

1. Use item-level `bill_discount_allocations.bill_item_id` amounts when present.
2. Allocate any remaining bill-level discount proportionally across positive service amounts using a largest-remainder algorithm so allocated line discounts exactly equal the bill discount.
3. Split each diagnostic line's net service amount across integer units using the same largest-remainder approach.

### 5.2 Reserve calculation

For each unit:

```text
unit_service_amount = allocated service amount excluding tax
net_unit_service_amount = max(0, unit_service_amount - allocated_unit_discount)

flat reserve = min(configured flat amount, net_unit_service_amount)
percent reserve = round(net_unit_service_amount * percent_bps / 10,000)
```

The final reserved amount is capped at the unit's net service amount.

### 5.3 Referral/prescriber commission base

```text
commission_base_amount = max(0, net_line_service_amount - performer_reserve_total)
```

Prescriber/referrer commission uses `commission_base_amount`, not the original line total. Existing non-reserve items retain current behavior, except tax remains excluded when canonical item tax data is available.

Example:

```text
USG service amount: BDT 1,000
Performer reserve: BDT 200 flat
Referral rate: 20%
Referral base: BDT 800
Referral commission: BDT 160
```

Percentage example retained for future use:

```text
Net unit service amount: BDT 1,000
Performer reserve rule: 15% = 1,500 bps
Reserved amount: BDT 150
Referral base: BDT 850
```

## 6. Billing Lifecycle

### 6.1 Configuration resolution

At bill finalization, the server loads canonical `invoice_items`, their billing service items, diagnostic catalog mappings, and the effective rule for the bill date. The client never supplies a trusted reserve amount.

### 6.2 Reserve creation order

`recordBillFinalizationSideEffects` performs these idempotent steps:

1. Load and validate canonical bill items.
2. Allocate bill discount and tax-excluded service amounts.
3. Resolve active test-level performer rules.
4. Insert missing unit reserve rows with unique guards.
5. Return reserve totals keyed by invoice item.
6. Accrue prescriber/referrer commission using the reduced commission base.
7. Skip normal automatic performer accrual for invoice items covered by a reserve rule.
8. Record the existing bill-created accounting event.

If finalization is retried, unique constraints make reserve creation safe. The commission accrual logic uses deterministic reserve linkage and existing duplicate checks.

### 6.3 Billing UI

For LAB/RAD items with an active rule, Billing Counter shows a read-only badge such as:

`Performer BDT 200 auto-reserved per unit`

The performer doctor selector is hidden or disabled for those items. Prescriber/referrer selection remains available.

## 7. Test Configuration UX

Billing Master > Service Items integrates a `Performer Payout Rule` section for LAB/RAD items:

- Enable reserve;
- Rule type: Fixed amount or Percentage;
- Fixed amount in BDT;
- Percentage from 0 to 100;
- Effective from;
- Note;
- Calculation preview based on the current test price.

The backend rejects rules for non-LAB/RAD items, global service items that have not been copied into the tenant, overlapping active effective windows, negative flat amounts, and percentage values outside 0–100.

Disabling creates a closed/disabled version; it does not delete history.

## 8. Cash Operations UX

The existing Doctor Payout panel keeps `Assigned Doctor Payables` and adds `Unassigned Test Performer Reserves`.

### 8.1 Group summary

Groups show:

- test name and code;
- diagnostic kind;
- payable quantity from fully paid bills;
- waiting-for-payment quantity;
- amount per unit or mixed-rate indicator;
- currently payable amount.

Expanding a group shows exact reserve units with service date, patient, invoice, net service amount, reserve amount, bill payment eligibility, and status.

### 8.2 Selection

The cashier may:

- enter/select a quantity in a test group;
- allow the UI to select the oldest eligible reserve IDs first;
- expand and select exact reserve rows;
- select one active doctor for the whole settlement;
- enter receiver and optional note/reference;
- confirm a cash payout from the current active counter.

A single settlement may include multiple test types but only one assigned doctor.

## 9. Payout API and Atomicity

### 9.1 Read endpoint

`GET /api/payment-methods/doctor-payouts/unassigned-performer-reserves`

Filters:

- `from`;
- `to`;
- `serviceItemId`;
- optional `includeWaitingPayment`.

The response separates eligible and waiting-payment rows. Only `reserved` rows are returned.

### 9.2 Mutation endpoint

`POST /api/payment-methods/doctor-payouts/sessions/:id/pay-reserves`

Payload:

```json
{
  "doctorId": 42,
  "reserveIds": [501, 502],
  "receiverType": "doctor",
  "receiverName": "Dr. Example",
  "receiverReference": null,
  "paymentMethod": "cash",
  "adjustments": {
    "advanceDeduction": 0,
    "otherAdjustment": 0,
    "roundingAdjustment": 0
  },
  "note": "USG performer envelope",
  "idempotencyKey": "uuid-v4"
}
```

The server reloads every reserve and validates tenant, status, fully paid bill, active doctor, active current-workstation counter, sufficient drawer cash, and open accounting period.

### 9.3 D1 batch

One D1 `batch()` owns the financial transition:

1. Insert a guarded settlement header.
2. Insert one named performer accrual per selected reserve.
3. Insert settlement-item snapshots.
4. Update reserves from `reserved` to `paid` with assigned doctor/accrual/settlement links.
5. Insert one cash drawer cash-out.
6. Record the deterministic accounting posting event and transition audit.
7. Execute a transition guard that fails the batch if row counts or totals differ from the request.

D1 batches are SQL transactions; a failed statement aborts or rolls back the sequence. The request idempotency layer stores a request hash and rejects reuse with a different payload.

## 10. Accounting Treatment

In the first release, bill-time performer reserves are an operational subledger, not an immediate named doctor payable and not a physical cash movement.

At payout:

- a named doctor accrual is created;
- the existing doctor settlement is created;
- the cash drawer decreases once;
- the existing doctor payout accounting event posts once.

Management reporting may show `Unassigned Performer Reserve` separately from named doctor payables. Any future general-ledger liability recognition at test completion/finalization must be a separate accounting policy change reviewed by the hospital accountant.

## 11. Cancellation, Refund, and Reversal

### 11.1 Before payout

When a bill or invoice item is cancelled/refunded, matching `reserved` rows become `cancelled`. They can no longer be paid. Existing referrer/prescriber commission cancellation uses the reduced base snapshot.

### 11.2 After payout

A paid reserve cannot be silently cancelled or refunded. Standard cancellation/refund routes return `409` with a message requiring doctor payout reversal first.

The first release reuses or adds an authorized settlement reversal workflow that:

- reverses the cash/accounting transaction through existing reversal controls;
- marks the named accrual cancelled/reversed as supported by current status rules;
- marks the reserve `reversed`;
- preserves the original settlement and immutable audit trail.

No hard deletion is allowed.

## 12. Security and Audit

- Tenant scope is required on every rule, reserve, accrual, settlement, and doctor lookup.
- Rule management requires Billing Master/finance configuration permission.
- Cash payout requires the existing doctor-payout permission and the cashier's active current-workstation counter.
- Doctor IDs must resolve to active same-tenant doctors.
- Idempotency keys contain no patient or doctor PII.
- Audit records include actor, tenant, workstation/counter, old/new rule values, bill/invoice item, reserve IDs, doctor, quantity, amount, settlement, cash movement, result, and reason.
- Patient details remain minimized in broad monitoring responses.

## 13. Reporting and Reconciliation

Add server-derived totals for:

- unassigned reserved quantity/amount;
- waiting-for-payment quantity/amount;
- paid performer reserve quantity/amount;
- cancelled/reversed quantity/amount;
- totals by test and date range.

Doctor settlement receipts include the selected reserve IDs indirectly through immutable settlement items and show test, quantity, service date range, invoice references, and amount.

Daily collection remains cash-basis: unpaid reserves do not count as expense/cash-out; completed doctor payouts do.

## 14. Migration and Compatibility

- Use migration `0422_diagnostic_performer_reserve_payout.sql` because main already contains `0421_*` migrations.
- Update `tenant-schema.sql`, Drizzle declarations, and generated migration manifest together.
- Existing rule-disabled tests and existing assigned doctor payables remain unchanged.
- No historical backfill is performed automatically.
- Existing performer accrual paths must check for a linked reserve to prevent duplicate performer earnings.

## 15. Acceptance Criteria

- A tenant can configure flat or percentage performer reserve rules on LAB/RAD service items.
- Billing automatically creates one immutable reserve row per diagnostic unit.
- The same invoice item unit cannot receive two reserves.
- Referral/prescriber commission is calculated after subtracting the performer reserve.
- Billing does not require performer doctor selection for reserve-enabled tests.
- Cash Operations displays exact unassigned reserve quantity and amount.
- A cashier can select quantity/reserve rows, choose one doctor, and pay from the active drawer.
- Only fully paid bills are eligible.
- Duplicate retries cannot create duplicate accruals, settlements, or cash movements.
- Cancellation/refund cancels unpaid reserves and blocks silently cancelling paid reserves.
- Rule changes never alter historical reserve amounts.
- Commission, settlement, cash, accounting, and reporting totals reconcile.

## 16. Authoritative References

- Cloudflare D1 `batch()` transactional behavior: https://developers.cloudflare.com/d1/worker-api/d1-database/
- Stripe idempotent request semantics used as a retry-safety reference: https://docs.stripe.com/api/idempotent_requests
- OWASP application logging guidance: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
- IAS 37 overview for distinguishing operational estimates from recognized liabilities: https://www.ifrs.org/issued-standards/list-of-standards/ias-37-provisions-contingent-liabilities-and-contingent-assets/
