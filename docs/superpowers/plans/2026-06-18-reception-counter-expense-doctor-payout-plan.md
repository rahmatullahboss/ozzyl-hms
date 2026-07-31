# Reception Counter Expense, Doctor Payout, and Ultrasound Doctor Fee Plan

**Date:** 2026-06-18
**Status:** Implementation plan

## Current system findings

The current system already has a strong counter-cash foundation:

- `billing_counter_sessions` tracks active/closed counter sessions, opening cash, expected cash, closing cash, variance, and handover state.
- `cash_drawer_movements` tracks physical drawer movements including opening, cash in, cash out, handover, closing adjustment, and cash drop.
- The active counter summary calculates expected cash from opening cash, bill collections, refunds, manual cash in/out, and cash drops.
- Reception cash expenses are already supported by `POST /api/expenses`; for reception users the route requires an active counter, checks drawer cash, inserts an expense, and records a `cash_drawer_movements.cash_out` row.
- Doctor payable infrastructure already exists through `doctor_commission_rules`, `doctor_commission_accruals`, and `doctor_commission_settlements`.
- Lab/ultrasound-style doctor fees can be represented with `doctor_commission_rules.service_type = 'lab_test'` and `incentive_type = 'performer'` or `prescriber`.

## Product decision

The shift handover modal must not become a free-form expense ledger. It should stay a reconciliation and handover screen. Cash leaving reception must be one of four controlled flows:

1. Patient refund or return.
2. Counter operational expense.
3. Doctor payout / commission settlement.
4. Cash handover, cash drop, or bank custody transfer.

## Phase 1: Use existing expense support

No new backend table is needed for ordinary reception expenses. The current `POST /api/expenses` flow is the source of truth.

Required UX rules:

- Show expense amount, category, paid-to, and note.
- Require an active counter.
- Require category and either paid-to or note.
- Block when amount exceeds drawer cash.
- Submit to `POST /api/expenses`.
- Refresh counter summary after success.

## Phase 2: Reception doctor payout from drawer cash

Add a first-class doctor payout flow tied to the existing commission ledger.

### Backend endpoints

Add to `src/routes/tenant/billingCounter.ts`:

#### `GET /api/billing-counter/doctor-payables`

Returns grouped payable doctor commissions that are eligible for cash payout from reception.

Rules:

- Only include `doctor_commission_accruals.status IN ('accrued', 'approved')`.
- Only include accruals whose linked bill is fully paid.
- Group by doctor.
- Return each doctor with total payable amount, outstanding count, and item-level accrual ids.
- Include source type labels, such as consultation fee, lab/USG performer fee, referral, IPD round when added later.

#### `POST /api/billing-counter/sessions/:id/doctor-payouts`

Pays selected accruals from the active reception drawer.

Payload:

```json
{
  "doctorId": 12,
  "accrualIds": [101, 102, 103],
  "notes": "Paid in envelope",
  "referenceNo": "optional manual voucher/ref"
}
```

Rules:

- Requires active counter session on the current workstation.
- Requires selected accruals to belong to the same tenant and doctor.
- Requires each selected bill to be fully paid.
- Allows `accrued` and `approved` statuses; if still `accrued`, the payout route approves and pays in the same atomic flow because reception payout is a physical payment action.
- Blocks if total payout exceeds expected drawer cash.
- Creates one `doctor_commission_settlements` row.
- Marks selected accruals as `paid` with the new settlement id.
- Inserts one `cash_drawer_movements` row:
  - `movement_type = 'cash_out'`
  - `reference_type = 'doctor_commission_settlement'`
  - `reference_id = settlement id or payout number`
  - `description = Doctor payout - Dr. Name`
- Records accounting event `commission_settled` using the existing accounting posting flow.
- Creates audit log.

This automatically reduces counter expected cash because the current summary already subtracts `cash_drawer_movements.cash_out`.

## Phase 3: UI in Reception shift modal

Add a separate section after Expense Payment:

### Doctor Payout / Envelope

Fields and actions:

- Doctor-wise payable list.
- Show payable amount and number of items.
- Expand to show source items: consultation, lab/USG, referral, etc.
- Optional payout note.
- Pay from drawer button.
- Disable when no active counter, no payable items, or payable amount exceeds drawer cash.

Do not mix this with ordinary Expense Payment.

## Phase 4: Ultrasound doctor fee setup

Use existing doctor commission rules:

- For ultrasound reporting doctor: `service_type = 'lab_test'`, `incentive_type = 'performer'`, `lab_test_id = <USG test id>` or category `USG/Radiology`, `rate_type = 'flat'`, `rate_value = fee amount`.
- For referring/prescribing doctor: `service_type = 'lab_test'`, `incentive_type = 'prescriber'` if needed.
- Accrual should happen when the ultrasound report is verified/completed by the performer doctor, not merely when reception bills the patient.

This keeps ultrasound doctor fee separate from consultation fee and from generic expenses.

## Admin monitoring

Add or reuse reports for:

- Today counter expenses.
- Today doctor payouts.
- Pending doctor payables.
- Doctor-wise paid/pending ledger.
- Cash variance after payouts and expenses.
- Payouts made by each reception user.

## Acceptance criteria

1. Ordinary reception expenses reduce drawer cash through `POST /api/expenses` and are not entered as handover notes.
2. Doctor payouts are linked to `doctor_commission_accruals` and `doctor_commission_settlements`, not generic expenses.
3. A reception payout creates a cash drawer `cash_out` movement and therefore reduces expected handover cash.
4. Ultrasound doctor fee is configured through doctor commission rules and accrues to the selected/performing doctor.
5. Handover screen shows correct expected cash after expenses, payouts, cash drops, refunds, and collections.
6. Admin can audit who paid whom, when, why, from which counter session, and against which source bills/items.
