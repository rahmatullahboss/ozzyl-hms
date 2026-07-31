# Enterprise Cash, Custody, and Double-Entry Finance Architecture

Date: 2026-06-20  
System: Ozzyl HMS / hospital finance and cash operations  
Status: Architecture plan before implementation  
Priority: P0 for enterprise-grade hospital deployment

---

## 1. Decision summary

This plan replaces the narrower cash-custody-only thinking with a full A-to-Z cash and accounting architecture.

The correct enterprise design is **not** one table for every hospital financial thing. The correct design is a layered system:

```text
Operational source documents
  ↓
Cash operational ledger / cash custody ledger
  ↓
Double-entry general ledger
  ↓
Reconciliation, reporting, audit, financial statements
```

So, the system should have one **canonical cash ledger layer** for every physical or digital cash movement/status, but it should still keep domain/source tables such as bills, deposits, expenses, payouts, and refunds. The double-entry general ledger remains separate and must post balanced debit/credit vouchers.

Short rule:

```text
Domain tables explain WHY money moved.
Cash ledger explains WHERE money is and HOW it moved.
General ledger explains the accounting debit/credit impact.
```

---

## 2. Why the earlier custody-only plan is not enough

The previous custody-focused plan solved one important problem: cash moved from a drawer to another person/admin/counter was not visible consistently.

But a real hospital cash system includes more than custody transfer:

```text
Patient cash collection
Due collection
Advance/deposit collection
IPD deposit
Lab/test billing cash
OPD consultation cash
Pharmacy cash sale
Refund/return cash out
Expense payment
Doctor payout/commission payout
Salary/petty cash payment
Bank deposit
Counter-to-counter transfer
Shift close handover
Admin/MD/accountant custody
Cash reconciliation
Double-entry accounting posting
Audit and fraud/risk monitoring
```

If we only fix custody transfer, future cash features can again create new isolated tables and hidden balances. Therefore, the architecture must define **all cash-related sources and destinations** now.

---

## 3. Best-practice model

### 3.1 Three-ledger model

Enterprise systems normally separate operational facts from accounting postings.

#### Layer A — Operational source documents

These are the business events:

```text
Bill
Payment
Refund
Deposit
Expense
Doctor payout
Salary payment
Bank deposit request
Shift handover
Cash transfer
```

They contain business details: patient, invoice, doctor, expense category, receipt, note, approval, etc.

#### Layer B — Cash ledger / cash custody ledger

This is the operational cash movement truth.

It answers:

```text
Cash came from where?
Cash went where?
Who currently holds it?
Is it pending receive?
Is it in drawer?
Is it in admin custody?
Is it banked?
Is it disputed?
```

#### Layer C — Double-entry general ledger

This is the accounting truth.

It answers:

```text
Which account was debited?
Which account was credited?
Do total debits equal total credits?
What is the balance sheet / income statement effect?
```

Every posted accounting transaction must remain balanced:

```text
Total Debit = Total Credit
Assets = Liabilities + Equity
```

---

## 4. Current system mapping

### 4.1 Existing operational/cash tables

| Area | Existing table/module | Current role | Problem if used alone |
|---|---|---|---|
| Patient cash collection/refund | `emp_cash_transactions` | Patient cash in/out | Does not show full custody location |
| Drawer movement | `cash_drawer_movements` | Drawer-level movement | Mixed reference types; not enough for full lifecycle |
| Counter session | `billing_counter_sessions` | Opening/closing/expected cash | Session context only, not full finance ledger |
| Old shift handover | `billing_handovers` | Counter close/handover | Legacy source; many admin pages still read only this |
| New custody transfer | `billing_counter_cash_transfers` | Running drawer transfer to admin/counter | Correct flow, but not universally reported |
| Expenses | `expenses` | Expense source document | Needs cash ledger linkage for cash-paid expenses |
| Doctor payout | commission/accrual/settlement tables | Doctor payable and settlement | Needs cash ledger + GL link |
| Bank deposit | `bank_deposit_requests`, `bank_transactions` | Deposit proof and bank transaction | Needs cash custody state transition |
| Accounting event queue | `accounting_posting_events` | Source-to-accounting posting | Operational event queue, not cash custody view |
| General ledger | `accounting_vouchers`, `accounting_journal_lines` | Double-entry accounting | Accounting truth, not enough for physical custody |
| Chart of accounts | `chart_of_accounts` | Account master | Needs standardized cash accounts |
| Audit | `audit_logs` | Change trail | Must include every cash source table |

---

## 5. What should be unified and what should stay separate

### 5.1 Should all cash-related things be in one table?

Not literally.

Bad design:

```text
One giant table that stores bill details, expense details, doctor payout details, deposit details, cash custody, and GL entries together.
```

That becomes messy, hard to validate, and hard to audit.

Good design:

```text
Domain source tables remain separate.
All cash movement/status goes through one cash ledger.
All accounting postings go through one double-entry GL.
```

### 5.2 Recommended table responsibility

| Responsibility | Recommended source |
|---|---|
| Why money was collected/paid | Domain source table |
| Physical/digital cash movement and custody | `cash_ledger_entries` or cash custody service |
| Debit/credit accounting | `accounting_vouchers` + `accounting_journal_lines` |
| Posting workflow | `accounting_posting_events` |
| Audit/change trail | `audit_logs` + immutable ledger links |

---

## 6. Recommended target architecture

### 6.1 New canonical operational cash ledger

Future table:

```text
cash_ledger_entries
```

This is not replacing accounting vouchers. It is a cash sub-ledger / custody ledger.

It must include every cash movement from every source:

```text
PATIENT_COLLECTION
DUE_COLLECTION
IPD_DEPOSIT_COLLECTION
PHARMACY_CASH_SALE
REFUND_PAID
EXPENSE_PAID
DOCTOR_PAYOUT_PAID
SALARY_PAID
DRAWER_OPENING
DRAWER_CASH_IN
DRAWER_CASH_OUT
CASH_TRANSFER_CREATED
CASH_TRANSFER_RECEIVED
CASH_TRANSFER_DISPUTED
SHIFT_HANDOVER_CREATED
SHIFT_HANDOVER_RECEIVED
BANK_DEPOSIT_REQUESTED
BANK_DEPOSIT_CONFIRMED
REVERSAL
ADJUSTMENT
```

### 6.2 Core fields

```sql
cash_ledger_entries
-------------------
id                         INTEGER PRIMARY KEY
ledger_no                  TEXT UNIQUE NOT NULL
tenant_id                  TEXT NOT NULL

source_type                TEXT NOT NULL
source_id                  TEXT NOT NULL
source_no                  TEXT
source_module              TEXT

cash_event_type            TEXT NOT NULL
cash_status                TEXT NOT NULL
movement_direction         TEXT NOT NULL
payment_method             TEXT NOT NULL DEFAULT 'cash'
amount                     NUMERIC NOT NULL
currency                   TEXT DEFAULT 'BDT'

from_location_type         TEXT
from_location_id           TEXT
from_counter_id            INTEGER
from_counter_session_id    INTEGER
from_user_id               INTEGER

to_location_type           TEXT
to_location_id             TEXT
to_counter_id              INTEGER
to_counter_session_id      INTEGER
to_user_id                 INTEGER

current_location_type      TEXT NOT NULL
current_location_id        TEXT
current_custodian_user_id  INTEGER

expected_amount            NUMERIC
received_amount            NUMERIC
variance_amount            NUMERIC DEFAULT 0
due_amount                 NUMERIC DEFAULT 0

workflow_status            TEXT NOT NULL
approval_status            TEXT
receive_status             TEXT
reconciliation_status      TEXT

created_by                 INTEGER NOT NULL
approved_by                INTEGER
received_by                INTEGER
reconciled_by              INTEGER
created_at                 TEXT NOT NULL
approved_at                TEXT
received_at                TEXT
reconciled_at              TEXT

counter_session_id         INTEGER
accounting_event_id        INTEGER
accounting_voucher_id      INTEGER
accounting_posting_status  TEXT

idempotency_key            TEXT
parent_ledger_entry_id     INTEGER
reversal_of_entry_id       INTEGER
is_reversal                INTEGER DEFAULT 0
correction_reason          TEXT

receipt_key                TEXT
evidence_key               TEXT
note                       TEXT
metadata_json              TEXT
```

### 6.3 Cash status values

```text
IN_DRAWER
PENDING_RECEIVE
IN_TRANSIT
ADMIN_CUSTODY
COUNTER_CUSTODY
BANK_DEPOSIT_PENDING
BANKED
EXPENSE_PAID
PAYOUT_PAID
REFUNDED
DISPUTED
RECONCILED
CANCELLED
REVERSED
UNKNOWN_REQUIRES_REVIEW
```

---

## 7. Double-entry GL remains separate

The double-entry ledger must stay in:

```text
accounting_vouchers
accounting_journal_lines
chart_of_accounts
```

Cash ledger and GL must link through:

```text
cash_ledger_entries.accounting_event_id
cash_ledger_entries.accounting_voucher_id
```

### 7.1 Why cash ledger and GL are separate

Cash ledger tracks custody and operational movement. General ledger tracks financial statements.

Example: cash transfer from reception drawer to admin custody.

Operationally important:

```text
From Safaoat drawer → Dr. Nazmus admin custody
Status pending/received
```

Accounting impact may be:

```text
No revenue/expense change.
Only cash location changed.
```

So it may need sub-ledger/custody movement but not necessarily income/expense recognition. If GL has separate cash accounts by location, it can post:

```text
Dr Cash - Admin Custody
Cr Cash - Reception Drawer
```

If GL only has one Cash-in-Hand account, the GL may not change, but cash custody ledger must still change.

---

## 8. Recommended chart of accounts for cash

Minimum accounts:

```text
Cash in Hand - Reception Drawers
Cash in Hand - Admin/MD Custody
Cash in Hand - Petty Cash
Cash in Transit
Cash Short / Over
Bank Account - Main
Patient Receivable
Patient Deposit Liability
Revenue - OPD Consultation
Revenue - Diagnostics
Revenue - IPD
Revenue - Pharmacy
Doctor Commission Payable
Expense Accounts
```

Optional per-counter/per-branch subledger:

```text
Subledger: Counter / Drawer
Subledger: Cash custodian user
Subledger: Bank account
Subledger: Patient
Subledger: Doctor
```

---

## 9. End-to-end event mapping

### 9.1 Patient cash sale / bill payment

Operational source:

```text
bills / payments / emp_cash_transactions
```

Cash ledger:

```text
cash_event_type = PATIENT_COLLECTION
cash_status = IN_DRAWER
current_location_type = drawer
counter_session_id = active session
```

GL example:

```text
Dr Cash in Hand - Reception Drawers
Cr Revenue / Patient Receivable
```

### 9.2 Due collection

Operational source:

```text
emp_cash_transactions.transaction_type = CollectionFromReceivable
```

Cash ledger:

```text
PATIENT_DUE_COLLECTION → IN_DRAWER
```

GL:

```text
Dr Cash in Hand - Reception Drawers
Cr Patient Receivable
```

### 9.3 IPD / patient deposit collection

Operational source:

```text
patient_deposits / deposit module
```

Cash ledger:

```text
PATIENT_DEPOSIT_COLLECTION → IN_DRAWER
```

GL:

```text
Dr Cash in Hand - Reception Drawers
Cr Patient Deposit Liability
```

### 9.4 Refund / return paid in cash

Operational source:

```text
emp_cash_transactions / credit notes / refunds
```

Cash ledger:

```text
PATIENT_REFUND_PAID → REFUNDED
from drawer/admin custody
```

GL:

```text
Dr Refund / Revenue Reversal / Deposit Liability
Cr Cash in Hand
```

### 9.5 Cash expense / petty cash

Operational source:

```text
expenses
```

Cash ledger:

```text
EXPENSE_PAID → EXPENSE_PAID
from drawer/admin custody
receipt status required by policy
```

GL:

```text
Dr Expense Account
Cr Cash in Hand
```

### 9.6 Doctor payout / commission settlement

Operational source:

```text
doctor_commission_accruals / settlements
```

Cash ledger:

```text
DOCTOR_PAYOUT_PAID → PAYOUT_PAID
from drawer/admin custody
```

GL:

```text
Dr Doctor Commission Payable
Cr Cash in Hand
```

### 9.7 Running cash transfer from drawer to admin

Operational source:

```text
billing_counter_cash_transfers
```

Cash ledger at create:

```text
CASH_TRANSFER_CREATED
cash_status = PENDING_RECEIVE / IN_TRANSIT
from drawer
current_location = in_transit
```

GL if location-level cash accounts are used:

```text
Dr Cash in Transit
Cr Cash in Hand - Reception Drawers
```

Cash ledger at receive:

```text
CASH_TRANSFER_RECEIVED
cash_status = ADMIN_CUSTODY
current_location = admin_custody
```

GL:

```text
Dr Cash in Hand - Admin/MD Custody
Cr Cash in Transit
```

### 9.8 Counter-to-counter cash transfer

Create:

```text
sender drawer → in transit
```

Receive:

```text
in transit → receiver drawer
```

GL if separate drawer accounts:

```text
Dr Cash in Transit
Cr Cash in Hand - Sender Drawer

Dr Cash in Hand - Receiver Drawer
Cr Cash in Transit
```

### 9.9 Shift close handover

Operational source:

```text
billing_counter_sessions
billing_handovers
```

Cash ledger:

```text
SHIFT_HANDOVER_CREATED → PENDING_RECEIVE
SHIFT_HANDOVER_RECEIVED → ADMIN_CUSTODY or COUNTER_CUSTODY
```

GL same as transfer if location-level accounts are used.

### 9.10 Bank deposit

Operational source:

```text
bank_deposit_requests
bank_transactions
```

Cash ledger at request:

```text
BANK_DEPOSIT_REQUESTED → BANK_DEPOSIT_PENDING
```

GL:

```text
Dr Cash in Transit / Bank Deposit Pending
Cr Cash in Hand
```

Cash ledger at confirm:

```text
BANK_DEPOSIT_CONFIRMED → BANKED
```

GL:

```text
Dr Bank Account
Cr Cash in Transit / Bank Deposit Pending
```

---

## 10. Page mapping under full architecture

### 10.1 Reception Cash Operations

Should use:

```text
/api/cash-ledger/session/:sessionId/overview
/api/cash-ledger/session/:sessionId/events
/api/cash-ledger/transfers
```

Shows:

```text
Drawer cash
Patient cash collection
Refunds
Expenses
Doctor payouts
Transfer out pending
Transfer in received
Bank deposit/drop
Shift close
```

### 10.2 Admin Cash Control Ledger

Should use:

```text
/api/cash-ledger/overview
/api/cash-ledger/balances
/api/cash-ledger/events
/api/cash-ledger/exceptions
```

Shows:

```text
Active drawer cash
Pending receive / in transit
Admin custody
Counter custody
Bank deposit pending
Banked
Disputed / short
Unclassified cash out
```

### 10.3 Admin Shift Handover

Should not read only `billing_handovers`.

Should use:

```text
/api/cash-ledger/transfers?types=shift_handover,running_transfer
```

Shows:

```text
All handovers/transfers
Pending receive
Received
Partial/disputed
Shift close handovers
Running cash transfers
```

### 10.4 Cash Bank Book

Should use:

```text
/api/cash-ledger/balances
/api/cash-ledger/reconciliation
/api/bank-book
```

Shows both:

```text
Cash custody position
Bank transaction position
```

### 10.5 Accounting reports

Should use verified GL:

```text
accounting_vouchers
accounting_journal_lines
chart_of_accounts
```

But must reconcile with cash ledger.

---

## 11. Required reconciliation layers

### 11.1 Operational cash reconciliation

```text
Opening drawer cash
+ patient cash collection
+ manual cash in
+ received counter transfer
- refunds
- expenses
- doctor payouts
- cash transfers out
- bank deposits
= expected drawer cash
```

### 11.2 Custody reconciliation

```text
Total cash collected
- refunded
- expenses paid
- payouts paid
= drawer cash + pending transfer + admin custody + counter custody + bank pending + banked + disputed
```

### 11.3 GL reconciliation

```text
Cash GL account balances
= cash ledger balances by location/status
```

Differences must appear in exception reports.

---

## 12. Anti-duplication rule for future development

No future cash feature should create a new independent cash table without registering in the cash ledger.

Mandatory rule for every cash source:

```text
1. Write domain source row.
2. Write cash_ledger_entries row or normalized cash ledger event.
3. Queue/post accounting_posting_events if accounting impact exists.
4. Link accounting voucher back to source/cash ledger.
5. Write audit log.
6. Expose in cash monitoring pages.
```

If a feature does not do all six, it is not enterprise-ready.

---

## 12.1 UI date and time display standard

All cash, audit, and finance monitoring pages must use a single display convention for timestamps:

- Date: DD Mon YYYY, for example 20 Jun 2026.
- Time: 12-hour AM/PM, for example 04:23 AM.
- Timezone: Asia/Dhaka for operational and audit display.
- Raw API dates may remain ISO/YYYY-MM-DD for filters and form inputs only.
- Do not render raw created_at, transaction_date, or split timestamp strings in monitoring tables.
- Use shared formatters from web/src/lib/format.ts and web/src/lib/date-utils.ts.

## 13. Implementation plan

### Current implementation status — 2026-06-20

The first production-safe foundation is implemented as a **read-only unified cash ledger layer**. It does not change existing write flows or migrate production data yet.

Implemented backend files:

```text
src/lib/cash-ledger-service.ts
src/routes/tenant/cashLedger.ts
```

Implemented API endpoints:

```text
GET /api/cash-ledger/overview
GET /api/cash-ledger/events
GET /api/cash-ledger/balances
GET /api/cash-ledger/exceptions
GET /api/cash-ledger/transfers
GET /api/cash-ledger/sessions/:id/trail
GET /api/cash-ledger/reconciliation
```

Implemented UI consumption:

```text
/h/:slug/cash/drawers
web/src/pages/AdminTransactionControlCenter.tsx
```

Current TDD coverage:

```text
test/unit/cash-ledger-service.test.ts
pnpm exec vitest run test/unit/cash-ledger-service.test.ts
```

The test simulates the Patient Care/Safaoat scenario:

```text
Patient cash collection = 24,400
Expense cash out = 50
Pending cash custody transfer = 18,450
Active drawer cash = 5,900
```

Locked invariants:

```text
1. Active drawer cash must not be calculated by blindly summing event rows.
2. Active drawer cash is authoritative from active counter sessions + cash transactions + drawer movements.
3. cash_custody_transfer and linked cash_drawer_movements must not be double-counted.
4. Pending transfers remain visible as exceptions until receiver confirmation.
5. Pending custody cash must show as in-transit/pending receive, not admin custody.
```

Current remap target:

```text
/h/:slug/cash/handover
web/src/pages/BillingHandoverPage.tsx
Target API: GET /api/cash-ledger/transfers
Rule: top KPI, pending list, and history must use the same normalized transfer source.
```

Cash handover page implementation rules:

```text
1. Top KPI uses normalized cash-ledger transfers when available.
2. Admin pending cash table uses normalized cash-ledger transfers when available.
3. Legacy billing_handover collect endpoints remain fallback for legacy counter handovers.
4. cash_custody_transfer receive uses POST /api/payment-methods/drawer-custody/transfers/:id/receive.
5. Verify button is hidden for normalized ledger rows because ledger rows already represent lifecycle status.
```

Cash bank book implementation rules:

```text
/h/:slug/cash-bank-book
web/src/pages/CashBankBook.tsx
Target API: GET /api/cash-ledger/balances
Rule: cash book must show custody buckets in addition to cash in/out summary.
Current buckets: active drawer cash, pending/in-transit, admin/bank custody, disputed/short.
TDD guard: test/unit/cash-ledger-service.test.ts asserts these buckets for the Patient Care/Safaoat scenario.
```

Audit visibility implementation rules:

```text
/h/:slug/activity-log
web/src/pages/SystemAuditLog.tsx
web/src/lib/auditGroups.tsx
Target API: GET /api/audit/logs
Rule: cash custody transfer audit rows must be in the cash group and show transfer no, sender, receiver, status, due amount, and destination.
Backend enrichment: src/routes/tenant/audit.ts joins billing_counter_cash_transfers for table_name='billing_counter_cash_transfers'.
TDD guard: test/integration/routes/audit-list.test.ts and web/src/lib/auditGroups.test.ts cover the Patient Care/Safaoat transfer case.
```

Cash reconciliation implementation rules:

- Endpoint: GET /api/cash-ledger/reconciliation.
- Backend: src/lib/cash-ledger-service.ts and src/routes/tenant/cashLedger.ts.
- Rule: reconciliation must return overall status plus machine-readable checks, not only raw overview/balances/exceptions.
- Current checks: active drawer non-negative, total accounted non-negative, no unclassified cash out, no disputed cash, pending cash equals exception trail.
- TDD guard: test/unit/cash-ledger-service.test.ts validates Patient Care/Safaoat scenario returns passing reconciliation checks.

Cash drawer detail implementation rules:

- Route: /h/:slug/cash/drawers/:drawerId.
- UI: web/src/pages/admin/CashDrawerDetail.tsx.
- Target API: GET /api/cash-ledger/sessions/:id/trail.
- Rule: closed or inactive sessions must still show ledger trail instead of a false not-found state.
- Rule: active sessions may still show active counter summary, but timeline should prefer unified cash-ledger session trail when available.
- TDD guard: web/src/pages/admin/CashDrawerDetail.test.tsx covers active session and closed/inactive ledger trail.

Reception cash operations implementation rules:

- Route: /h/:slug/reception/cash-operations.
- UI: web/src/components/reception/cash-operations/RecentCashActivity.tsx.
- API: src/routes/tenant/cashOperations.ts.
- Activity rows must show transfer no, sender, receiver, status, due amount, and destination for cash_custody_transfer movements.
- Monitoring counter lookup must use billing_counters.counter_name, not a non-existent name column.
- Activity timestamps must use DD Mon YYYY and 12-hour AM/PM format from shared formatters.
- TDD guard: test/integration/routes/cash-operations.test.ts and web/src/components/reception/cash-operations/RecentCashActivity.test.tsx.

Expense cash-out shadow-write implementation rules:

- Target flow: expense cash payment / approval that creates cash_drawer_movements.cash_out.
- Source table remains primary: expenses and cash_drawer_movements.
- Shadow table: cash_ledger_entries.
- Required ledger mapping: source_type=expense, event_type=EXPENSE_PAID, movement_direction=out, cash_status=EXPENSE_PAID, current_location_type=expense.
- Shadow mode is non-blocking: expense payment does not fail if canonical ledger write is skipped.
- Implemented route: src/routes/tenant/expenses.ts.
- Covered flows: direct paid reception petty cash expense and approved expense execution from active drawer.
- TDD guard: test/integration/routes/reception-expense-execution.test.ts and test/unit/cash-ledger-writer.test.ts.

Doctor payout shadow-write implementation rules:

- Target flow: reception doctor payout / commission settlement that creates cash_drawer_movements.cash_out.
- Source table remains primary: doctor_commission_settlements, doctor_commission_settlement_items, doctor_commission_accruals, and cash_drawer_movements.
- Shadow table: cash_ledger_entries.
- Required ledger mapping: source_type=doctor_commission_settlement, event_type=DOCTOR_PAYOUT_PAID, movement_direction=out, cash_status=PAYOUT_PAID, current_location_type=payout.
- Shadow mode is non-blocking: doctor payout does not fail if canonical ledger write is skipped.
- Implemented route: src/routes/tenant/receptionDoctorPayouts.ts.
- TDD guard: test/integration/routes/reception-doctor-payouts.test.ts and test/unit/cash-ledger-writer.test.ts.

Appointment payment shadow-write implementation rules:

- Target flow: appointment Pay Now that creates bills, payments, and emp_cash_transactions.CashSales.
- Source table remains primary: appointments, bills, payments, billing_provisional_items, invoice_items, and emp_cash_transactions.
- Shadow table: cash_ledger_entries.
- Required ledger mapping: source_type=appointment_payment, event_type=APPOINTMENT_PAYMENT_RECEIVED, movement_direction=in, cash_status=IN_DRAWER, current_location_type=drawer.
- Shadow mode is non-blocking: appointment payment does not fail if canonical ledger write is skipped.
- Implemented route: src/routes/tenant/appointments.ts.
- TDD guard: test/integration/routes/appointment-billing-handoff.test.ts and test/unit/cash-ledger-writer.test.ts.

Inpatient bill payment shadow-write implementation rules:

- Target flow: discharge bill payment that creates payments and emp_cash_transactions.CashSales.
- Source table remains primary: admissions, bills, invoice_items, payments, emp_cash_transactions, and inpatient ledger rows.
- Shadow table: cash_ledger_entries.
- Required ledger mapping: source_type=ipd_payment, event_type=IPD_PAYMENT_RECEIVED, movement_direction=in, cash_status=IN_DRAWER, current_location_type=drawer.
- Shadow mode is non-blocking: inpatient payment does not fail if canonical ledger write is skipped.
- Implemented route: src/routes/tenant/ipBilling.ts.
- TDD guard: test/integration/routes/ip-billing.test.ts and test/unit/cash-ledger-writer.test.ts.

Bill/payment collection shadow-write implementation rules:

- Target flow: billing counter invoice payment that creates payments and emp_cash_transactions.CashSales.
- Source table remains primary: bills, payments, invoice_items, and emp_cash_transactions.
- Shadow table: cash_ledger_entries.
- Required ledger mapping: source_type=payment, event_type=BILL_PAYMENT_RECEIVED, movement_direction=in, cash_status=IN_DRAWER, current_location_type=drawer.
- Shadow mode is non-blocking: invoice payment does not fail if canonical ledger write is skipped.
- Implemented route: src/routes/tenant/billingCounter.ts.
- TDD guard: test/integration/routes/billing-counter.test.ts and test/unit/cash-ledger-writer.test.ts.

Patient deposit collection/refund shadow-write implementation rules:

- Target flow: patient deposit collection that creates emp_cash_transactions.CashSales and patient deposit refund that creates emp_cash_transactions.ReturnDeposit.
- Source table remains primary: billing_deposits and emp_cash_transactions.
- Shadow table: cash_ledger_entries.
- Deposit receive mapping: source_type=patient_deposit, event_type=PATIENT_DEPOSIT_RECEIVED, movement_direction=in, cash_status=IN_DRAWER, current_location_type=drawer.
- Deposit refund mapping: source_type=patient_deposit_refund, event_type=PATIENT_DEPOSIT_REFUNDED, movement_direction=out, cash_status=REFUNDED, current_location_type=refund.
- Shadow mode is non-blocking: deposit/refund does not fail if canonical ledger write is skipped.
- Implemented route: src/routes/tenant/deposits.ts.
- TDD guard: test/integration/routes/deposits.test.ts and test/unit/cash-ledger-writer.test.ts.

### Phase 0 — Architecture freeze

- Use this file as source of truth.
- Do not add new cash tables until mapping is approved.
- Keep production data safe.

### Phase 1 — Unified read service first

Create:

```text
src/lib/cash-ledger-service.ts
```

Functions:

```ts
loadCashEvents()
loadCashBalances()
loadCashExceptions()
loadSessionCashTrail()
loadCashSourceCoverage()
```

This service reads existing tables first:

```text
emp_cash_transactions
cash_drawer_movements
billing_handovers
billing_counter_cash_transfers
expenses
bank_deposit_requests
bank_transactions
accounting_posting_events
accounting_vouchers
```

### Phase 2 — Unified API endpoints

Add:

```text
GET /api/cash-ledger/overview
GET /api/cash-ledger/events
GET /api/cash-ledger/balances
GET /api/cash-ledger/exceptions
GET /api/cash-ledger/transfers
GET /api/cash-ledger/sessions/:id/trail
GET /api/cash-ledger/reconciliation
```

### Phase 3 — Page remap

Remap these pages:

```text
/cash/drawers
/cash/handover
/cash-bank-book
/cash/drawers/:drawerId
/reception/cash-operations
```

### Phase 4 — Canonical write support

Add `cash_ledger_entries` table and start writing to it from all cash mutations.

### Phase 5 — Backfill

Backfill historical data from existing operational tables into `cash_ledger_entries`.

### Phase 6 — Enforce invariants

Add automated checks:

```text
No unclassified cash movement
No pending transfer hidden from admin
No verified voucher imbalance
No cash ledger event without source
No cash source without audit
Cash GL equals cash ledger by date/location
```

---

## 14. P0 coverage checklist

| Cash source/use case | Must be in cash ledger | Must post GL if financial impact | Must show in admin monitor |
|---|---:|---:|---:|
| OPD cash collection | Yes | Yes | Yes |
| Lab/test cash collection | Yes | Yes | Yes |
| IPD cash/deposit collection | Yes | Yes | Yes |
| Pharmacy cash sale | Yes | Yes | Yes |
| Due collection | Yes | Yes | Yes |
| Refund/return | Yes | Yes | Yes |
| Expense cash payment | Yes | Yes | Yes |
| Doctor payout | Yes | Yes | Yes |
| Salary cash payment | Yes | Yes | Yes |
| Manual cash in/out | Yes | Maybe | Yes |
| Cash transfer to admin | Yes | Maybe/Yes by cash-location policy | Yes |
| Counter-to-counter transfer | Yes | Maybe/Yes by cash-location policy | Yes |
| Shift handover | Yes | Maybe/Yes by cash-location policy | Yes |
| Bank deposit request | Yes | Yes when confirmed/requested by policy | Yes |
| Bank deposit confirmation | Yes | Yes | Yes |
| Variance/short/over | Yes | Yes | Yes |
| Reversal/correction | Yes | Yes if original posted GL | Yes |

---

## 15. Enterprise controls

### 15.1 Role and workflow controls

- Cashier can collect and transfer drawer cash but cannot silently mark own cash as received by admin.
- Receiver must confirm cash count.
- Admin/accountant must approve disputes/shortages.
- Reconciliation should be performed by someone other than the cashier where possible.
- High-value transfers require alert or approval threshold.

### 15.2 Data controls

- Idempotency key for every cash mutation.
- Positive amount checks.
- Tenant isolation.
- Active counter session required for drawer source.
- No direct hard delete of cash ledger events.
- Reversal-only correction.
- Audit log on every cash mutation.

### 15.3 UI controls

- Never show zero if unresolved pending cash exists.
- Unresolved pending/disputed cash must remain visible regardless of date filter.
- Every KPI/card must drill down to exact source rows.
- Cash status labels must be clear: pending, in transit, admin custody, drawer, banked, disputed.

---

## 16. Acceptance test using real Patient Care scenario

Scenario: Safaoat transfers cash to Dr. Nazmus Sakib.

Expected unified result:

```text
sourceType = cash_custody_transfer
sourceTable = billing_counter_cash_transfers
fromUser = Safaoat Ullah
fromLocation = Reception 2 drawer
amount = 18450
toUser = Dr. Nazmus Sakib
cashStatus = PENDING_RECEIVE / IN_TRANSIT until accepted
adminCashCollection page = visible
cashControlLedger = visible
cashBook = included as pending transfer, not lost
GL = posted according to cash-location policy
Audit = visible under cash group
```

---

## 17. Final rule

The enterprise cash system is complete only when any cash amount can be traced across all three layers:

```text
Source document → Cash ledger/custody position → Double-entry GL voucher
```

For every taka, the system must answer:

```text
Why was it collected/paid?
Which drawer/custodian held it?
Where is it now?
Was it received/reconciled?
What accounting voucher posted it?
Who approved/changed it?
Which report shows it?
```

If any answer is missing, the cash system is not enterprise-grade.

### Cash Bank Book reconciliation UI update

- Route: /h/:slug/cash-bank-book.
- UI: web/src/pages/CashBankBook.tsx.
- Rule: cash tab shows reconciliation status/checks from GET /api/cash-ledger/reconciliation.
- The checks panel must show pass/warning/fail for enterprise guardrails such as unclassified cash out, disputed cash, pending exception match, and non-negative drawer/total cash.

### Canonical cash ledger table phase

- Migration: migrations/0369_cash_ledger_entries.sql.
- Table: cash_ledger_entries.
- Purpose: future canonical enterprise cash ledger write table.
- Current status: schema is additive and non-destructive; existing production write flows still write to their source tables.
- Required next phases before enforcing this table:
  - shadow-write helpers for new cash mutations;
  - source-by-source write integration;
  - historical backfill with reconciliation checks;
  - cutover only after old source totals and cash_ledger_entries totals match.
- Required guarantees:
  - unique ledger_entry_no per tenant;
  - idempotency key per tenant;
  - source_type/source_id traceability;
  - counter session and custody location traceability;
  - accounting voucher linkage when available.

### Canonical cash ledger writer helper

- Helper: src/lib/cash-ledger-writer.ts.
- Test: test/unit/cash-ledger-writer.test.ts.
- Purpose: provide a safe idempotent writer for future shadow-write phases.
- Current status: helper exists but is intentionally not wired into production cash mutation flows yet.
- Guarantees covered by tests:
  - inserts canonical cash ledger entry with generated ledger entry number;
  - skips duplicate idempotency key without second insert;
  - rejects invalid negative amount before touching the database.
- Next phase: wire this helper into one low-risk source flow, starting with cash custody transfer creation, after the cash_ledger_entries migration is applied and verified in the target D1 database.
- Shadow-write phase started for cash custody transfer creation via src/routes/tenant/receptionDrawerCustody.ts.
- Shadow mode is non-blocking: canonical ledger write failure logs a warning and does not fail the original transfer source-table write.
- This protects production cash transfer flow while allowing gradual migration toward cash_ledger_entries.


Gateway payment shadow-write status:

- Inspected flow: src/routes/tenant/payments.ts handles payment_gateway_logs and writes emp_cash_transactions without active counter session/counter custody.
- Do not shadow-write gateway payment as drawer cash until gateway custody/bank settlement mapping is finalized.
- Status: blocked pending gateway custody source-of-truth decision.

Patient settlement / due collection shadow-write implementation rules:

- Target flow: settlement collection that creates billing_settlements and emp_cash_transactions.CollectionFromReceivable.
- Source table remains primary: billing_settlements, payments, billing_deposits, billing_credit_bill_status, and emp_cash_transactions.
- Shadow table: cash_ledger_entries.
- Required ledger mapping: source_type=settlement, event_type=RECEIVABLE_COLLECTION_RECEIVED, movement_direction=in, cash_status=IN_DRAWER, current_location_type=drawer.
- Shadow mode is non-blocking: settlement collection does not fail if canonical ledger write is skipped.
- Implemented route: src/routes/tenant/settlements.ts.
- TDD guard: test/integration/routes/settlements.test.ts and test/unit/cash-ledger-writer.test.ts.

Pharmacy payment shadow-write status:

- Inspected flow: src/routes/tenant/prescriptionFulfilment.ts creates pharmacy_sales and stock movements.
- The inspected flow does not create emp_cash_transactions or active drawer cash movement for cash collection.
- Do not shadow-write pharmacy cash as IN_DRAWER until the source flow explicitly writes drawer cash or pharmacy counter custody is designed.
- Status: blocked pending pharmacy cash-drawer source-of-truth decision.

Shadow-write monitoring / reconciliation implementation rules:

- Endpoint: GET /api/cash-ledger/shadow-reconciliation.
- Backend: src/lib/cash-ledger-service.ts and src/routes/tenant/cashLedger.ts.
- Purpose: compare old/source table totals with canonical cash_ledger_entries shadow totals per covered cash flow.
- Report status can be pass, warning, or fail.
- Warning is expected while shadow-write is newly enabled and historical backfill has not been completed.
- Fail means source table or cash_ledger_entries cannot be queried, so cutover must not proceed.
- The report lists blocked flows separately, including pharmacy payment and gateway payment, because their active drawer/custody source-of-truth is not finalized.
- TDD guard: test/unit/cash-ledger-service.test.ts covers source-vs-shadow comparison and blocked-flow listing.
- Cutover rule: do not switch read/reporting source of truth to cash_ledger_entries until this report is clean for the agreed monitoring window and historical backfill has been reconciled.


Shadow reconciliation UI implementation rules:

- Page: /h/:slug/cash-bank-book.
- UI file: web/src/pages/CashBankBook.tsx.
- API consumed: GET /api/cash-ledger/shadow-reconciliation.
- UI shows overall shadow status, per-flow source amount/count, shadow amount/count, difference amount/count, and blocked flows.
- The panel is monitoring-only and does not write or change cash data.
- Warning status is acceptable during the monitoring/backfill window; fail status blocks source-of-truth migration.

Historical cash ledger dry-run implementation rules:

- Endpoint: GET /api/cash-ledger/historical-report.
- Backend: src/lib/cash-ledger-service.ts and src/routes/tenant/cashLedger.ts.
- Purpose: estimate historical source rows/amounts that still need canonical cash_ledger_entries records.
- This is read-only and must not insert, update, delete, or backfill anything.
- The report shows source count/amount, existing shadow count/amount, missing count/amount, and duplicate risk per flow.
- Blocked flows remain pharmacy payment and gateway payment until custody/source-of-truth mapping is approved.
- UI page: /h/:slug/cash-bank-book, panel title Historical ledger dry-run.
- UI must show total source amount, existing ledger amount, missing estimate, per-flow details, duplicate risk, and blocked flows.
- TDD guard: test/unit/cash-ledger-service.test.ts covers missing historical row estimation and blocked-flow listing.

Production D1 canonical cash ledger table status:

- Applied additive migration file: migrations/0369_cash_ledger_entries.sql.
- Target database: hms-super-admin-production-apac, database_id c68a5360-a2c1-44cc-9e71-f21057bea102.
- Applied with wrangler d1 execute --remote --file.
- Result: success, 8 queries processed, 9 rows written, database bookmark 00000b40-00000006-00005090-0ed3dbfafa5ce5eb1c086e41a4266ce4.
- This migration only creates cash_ledger_entries and indexes if missing; it does not backfill, update, or delete business data.

Shadow-write issue log implementation rules:

- Migration: migrations/0370_cash_ledger_shadow_issues.sql.
- Table: cash_ledger_shadow_issues.
- Purpose: store non-blocking shadow-write issues for monitoring while keeping primary cash flows safe.
- Writer: src/lib/cash-ledger-writer.ts records issue rows only after a shadow-write problem is caught.
- Issue logging is best-effort: if the issue-log table is unavailable, the original cash flow still does not fail.
- TDD guard: test/unit/cash-ledger-writer.test.ts verifies shadow issue rows are attempted.
- Read API: GET /api/cash-ledger/shadow-log returns recent issue rows for the selected date/range.
- UI page: /h/:slug/cash-bank-book, panel title Shadow write log.
- UI must show CLEAR when no issue rows exist and an amber OPEN count when issue rows are present.
- TDD guard: test/unit/cash-ledger-service.test.ts verifies shadow issue rows are loaded with parsed payload metadata.

Production D1 shadow issue log table status:

- Applied additive migration file: migrations/0370_cash_ledger_shadow_issues.sql.
- Target database: hms-super-admin-production-apac, database_id c68a5360-a2c1-44cc-9e71-f21057bea102.
- Applied with wrangler d1 execute --remote --file.
- Result: success, 4 queries processed, 5 rows written, database bookmark 00000b41-00000006-00005090-20d3b1a31b782a9ae69f88e745d9a6c0.
- This migration only creates cash_ledger_shadow_issues and indexes if missing; it does not backfill, update, or delete business data.


Cash ledger readiness notes:

- Endpoint: GET /api/cash-ledger/readiness.
- Backend files: src/lib/cash-ledger-service.ts and src/routes/tenant/cashLedger.ts.
- UI page: /h/:slug/cash-bank-book, panel title Cash ledger readiness.
- The panel combines reconciliation, historical dry-run, shadow write log, and pending flow decisions.
- TDD guard: test/unit/cash-ledger-service.test.ts.
