# Enterprise Cash Custody Ledger Architecture Plan

Date: 2026-06-20  
Scope: Ozzyl HMS cash drawer, reception cash operations, admin cash monitoring, shift handover, cash/bank book, audit trail  
Status: Planning / architecture review  
Priority: P0 before scaling to high-volume hospitals

> Superseded for full A-to-Z cash implementation: use `docs/plans/2026-06-20-enterprise-cash-finance-ledger-architecture.md` as the broader source of truth. This file remains useful for custody-specific details, but implementation must follow the full cash + custody + double-entry plan.

---

## 1. Purpose

Cash handling is one of the highest-risk parts of a hospital management system. In a real hospital, one wrong balance, hidden pending transfer, duplicate handover, or unclear custody trail can create direct financial loss.

The current HMS already records cash movements, but the records are split across multiple tables and multiple admin pages read different sources. This creates the visible problem where one page shows cash moved, another page shows zero, and admin cannot confidently answer: **Where is the cash now?**

This document maps the current system, identifies the design gaps, and defines the best-practice target architecture for an enterprise-grade cash custody ledger.

---

## 2. Best-practice principles for cash handling

The cash module must follow these principles:

1. **Single source of truth for cash position**  
   Every cash amount must resolve to one current location/state: drawer, in transit, admin custody, counter custody, bank pending, banked, expense paid, refunded, disputed, or reversed.

2. **Segregation of duties**  
   The person who collects cash should not be the only person who approves, receives, reconciles, and audits it. System roles must separate collection/custody, authorization/approval, recording/posting, and reconciliation/audit.

3. **Receiver confirmation**  
   A transfer is not complete when the sender clicks transfer. It is complete only when the receiver counts and accepts the cash. Until then it is `PENDING_RECEIVE` / `IN_TRANSIT`.

4. **Immutable ledger**  
   Cash movement rows should not be edited silently. Corrections should be reversal/adjustment entries with reason, user, timestamp, and approval.

5. **Audit trail must reconstruct the full event**  
   For every cash movement, audit must show: who initiated it, from where, to where, amount, status, receiver, received amount, variance, timestamp, device/workstation, and source document.

6. **Reconciliation and exception reporting**  
   Admin must see unmatched/pending/disputed cash immediately. Daily reconciliation should explain all cash by location, not only drawer totals.

7. **Idempotency and duplicate protection**  
   Any cash mutation must be protected from double submit/network retry duplicate rows.

8. **Accounting posting linkage**  
   Operational cash custody and accounting voucher are related but not the same. A cash event should have a link to accounting posting status/voucher when applicable.

References reviewed while preparing this plan:
- COSO/Internal control concepts: control environment, risk assessment, information/communication, control activities, monitoring.
- Segregation of duties: separation of authorization, custody, record keeping, and reconciliation.
- Cash handling control concepts: documented receipts/deposits, supervisory review, audit trails, reconciliation, and exception reports.

---

## 3. Current system mapping

### 3.1 Current key tables

| Table | Current purpose | Cash meaning | Risk / gap |
|---|---|---|---|
| `emp_cash_transactions` | Patient bill/due collection and refund cash transactions | Cash in/out from patient billing | Good for patient cash, but not full custody location |
| `cash_drawer_movements` | Drawer movement ledger: opening, manual cash in/out, cash drop, handover, accepted transfer | Operational drawer movement | Important table, but reference types are mixed and not enough for full transfer lifecycle |
| `billing_counter_sessions` | Counter open/close sessions, opening cash, expected cash, variance | Drawer/session cash context | Active sessions are good, closed session review is weaker |
| `billing_handovers` | Old counter/shift handover table | Shift/counter handover | Legacy source; many admin pages still depend on it |
| `billing_counter_cash_transfers` | New drawer custody transfer table | Running transfer from drawer to admin/counter | Correct for custody transfer but not connected everywhere |
| `expenses` | Expense requests/approved expenses | Cash out when paid in cash | Needs consistent drawer/cash ledger linkage |
| `doctor_commission_accruals` / payout routes | Doctor payout payable and settlement | Cash out when doctor paid | Needs consistent cash ledger linkage |
| `accounting_posting_events` | Accounting posting queue/status | Voucher posting status | Must link back to cash source event |
| `audit_logs` | System audit trail | Who changed what | New custody table must be included in cash audit group |

---

## 4. Current write flows

### 4.1 Patient cash collection

```text
Patient pays cash
  ↓
emp_cash_transactions
  ↓
Counter expected cash increases
```

Current source:
- `emp_cash_transactions.payment_method = 'cash'`
- transaction types: `CashSales`, `CollectionFromReceivable`, `CashDiscountReceived`

### 4.2 Refund / return

```text
Patient refund / return cash
  ↓
emp_cash_transactions
  ↓
Counter expected cash decreases
```

Current source:
- transaction types: `SalesReturn`, `ReturnDeposit`, `CashDiscountGiven`

### 4.3 Manual cash movement / expense / doctor payout

```text
Cashier pays cash out or adds cash
  ↓
cash_drawer_movements
  ↓
Counter expected cash changes
```

Current source:
- `movement_type = cash_in | cash_out | cash_drop | handover | opening`
- `reference_type` indicates reason where available.

### 4.4 Running cash custody transfer

Example: Safaoat transfers drawer cash to Dr. Nazmus Sakib.

```text
Reception drawer
  ↓ sender creates transfer
billing_counter_cash_transfers.status = pending
  ↓ linked drawer movement
cash_drawer_movements.movement_type = cash_drop
cash_drawer_movements.reference_type = cash_custody_transfer
  ↓ receiver accepts
billing_counter_cash_transfers.status = received/disputed
  ↓ if destination is another counter
cash_drawer_movements.movement_type = cash_in
reference_type = accepted_cash_transfer
```

Current source:
- `billing_counter_cash_transfers`
- `cash_drawer_movements`

This is the correct operational model, but admin pages did not consistently read this table.

### 4.5 Shift/counter handover

```text
Cashier closes shift/counter
  ↓
billing_counter_sessions closed
  ↓
billing_handovers created
  ↓
receiver/admin accepts
  ↓
cash_drawer_movements handover/cash_in may be inserted
```

Current source:
- `billing_handovers`
- `billing_counter_sessions`
- `cash_drawer_movements`

---

## 5. Current page/API mapping

### 5.1 Reception Cash Operations

Route:

```text
/h/:slug/reception/cash-operations
```

Frontend:

```text
web/src/pages/reception/CashOperationsPage.tsx
web/src/components/reception/cash-operations/*
```

Backend:

```text
GET  /api/cash-operations/overview
GET  /api/cash-operations/activity
GET  /api/payment-methods/drawer-custody/recipients
GET  /api/payment-methods/drawer-custody/pending
GET  /api/payment-methods/drawer-custody/transfers
POST /api/payment-methods/drawer-custody/sessions/:id/transfers
POST /api/payment-methods/drawer-custody/transfers/:id/receive
```

Main data sources:
- `emp_cash_transactions`
- `cash_drawer_movements`
- `billing_counter_cash_transfers`
- `billing_counter_sessions`

Known issues:
- Monitoring session/counter query should use `billing_counters.counter_name`, not a wrong/ambiguous column.
- Activity API now sends transfer details, but UI display still needs clearer status/receiver/due labels.

### 5.2 Admin Cash Control Ledger

Route:

```text
/h/:slug/cash/drawers
```

Backend:

```text
GET /api/dashboard/cash-control
GET /api/dashboard/active-counters
GET /api/dashboard/fraud-alerts
```

Current purpose:
- active drawer status
- pending handover
- cash movement timeline
- handover chain
- expense evidence
- risk alerts

Known issues:
- Page mixes date-based timeline with live active drawer state. This can confuse admin when a transfer happened yesterday but drawer is still active today.
- `Cash already handed over` and some cards may not fully represent `billing_counter_cash_transfers` as admin custody.

### 5.3 Admin Shift Handover

Route:

```text
/h/:slug/cash/handover
```

Frontend:

```text
web/src/pages/BillingHandoverPage.tsx
```

Backend:

```text
GET  /api/billing-handover
GET  /api/billing-counter/admin/pending-handovers
GET  /api/billing-counter/admin/collection-summary
POST /api/billing-counter/admin/collect/:handoverId
POST /api/billing-counter/admin/partial-collect/:handoverId
```

Known issues:
- The page is not fully unified. Some sections show legacy handovers only, some now show custody transfers.
- `partial-collect` may not support custody transfer synthetic IDs yet.
- Top KPI can still show zero even if custody transfer exists unless fully migrated.

### 5.4 Cash Bank Book / Cash Reconciliation

Route:

```text
/h/:slug/cash-bank-book
```

Backend:

```text
GET  /api/cash-book
GET  /api/cash-book/transactions
POST /api/cash-book/reconcile
```

Known issues:
- It summarizes cash in/out but does not clearly classify custody states: in drawer, pending transfer, admin custody, bank pending, banked, disputed.
- A cash drop may reduce drawer cash, but the page may not explain where the cash currently is.

### 5.5 Admin Drawer Detail

Route:

```text
/h/:slug/cash/drawers/:drawerId
```

Known issue:
- Currently active-session centric. Closed sessions are not first-class detail records.
- For audit, closed sessions must remain reviewable by session id/date.

### 5.6 Audit Explorer

Known issue:
- `billing_counter_cash_transfers` must be included in cash audit grouping.
- Audit should show transfer lifecycle, not only row update.

---

## 6. Why the current problem happened

The original table `billing_handovers` was designed for shift/counter handover. Later, running drawer custody transfer needed extra fields and behavior:

- transfer number
- destination type: admin custody vs counter session
- destination counter session
- accepted cash movement id
- idempotency key
- custody label
- cancellation/dispute fields
- receiver confirmation flow

Instead of extending the old table, a new table `billing_counter_cash_transfers` was created. That is not automatically wrong, because the business process is different. The mistake is that reporting/admin monitoring was not redesigned around a unified cash custody source.

So the current issue is not simply “two tables exist.” The real issue is:

```text
Write side understands the new transfer,
but read/reporting side still reads the old handover source in many places.
```

---

## 7. Ideal enterprise-grade target design

### 7.1 If we could design from scratch

The best design would not be “one table for every business object.” Invoices, expenses, deposits, and doctor payouts can keep their own domain tables. But **all physical cash movement and custody state** should flow through one canonical table.

Recommended canonical table:

```text
cash_ledger_entries
```

This table should be append-only. It should represent every cash movement and every custody state change.

### 7.2 Proposed canonical table fields

```sql
cash_ledger_entries
-------------------
id                          INTEGER PRIMARY KEY
ledger_no                   TEXT UNIQUE NOT NULL
tenant_id                   TEXT NOT NULL

-- Event classification
event_type                  TEXT NOT NULL
-- PATIENT_CASH_COLLECTION
-- PATIENT_REFUND
-- DRAWER_OPENING
-- MANUAL_CASH_IN
-- MANUAL_CASH_OUT
-- EXPENSE_PAYMENT
-- DOCTOR_PAYOUT
-- CASH_TRANSFER_CREATED
-- CASH_TRANSFER_RECEIVED
-- CASH_TRANSFER_DISPUTED
-- SHIFT_HANDOVER_CREATED
-- SHIFT_HANDOVER_RECEIVED
-- BANK_DEPOSIT_CREATED
-- BANK_DEPOSIT_CONFIRMED
-- REVERSAL

movement_direction           TEXT NOT NULL
-- IN, OUT, TRANSFER, NEUTRAL

cash_status                  TEXT NOT NULL
-- IN_DRAWER
-- PENDING_RECEIVE
-- IN_TRANSIT
-- ADMIN_CUSTODY
-- COUNTER_CUSTODY
-- BANK_DEPOSIT_PENDING
-- BANKED
-- EXPENSE_PAID
-- REFUNDED
-- DISPUTED
-- CANCELLED
-- REVERSED

amount                       NUMERIC NOT NULL
expected_amount              NUMERIC
received_amount              NUMERIC
variance_amount              NUMERIC DEFAULT 0
currency                     TEXT DEFAULT 'BDT'
payment_method               TEXT DEFAULT 'cash'

-- Location/custody model
from_location_type           TEXT
from_location_id             TEXT
from_counter_session_id      INTEGER
from_counter_id              INTEGER
from_user_id                 INTEGER

to_location_type             TEXT
to_location_id               TEXT
to_counter_session_id        INTEGER
to_counter_id                INTEGER
to_user_id                   INTEGER

current_location_type        TEXT NOT NULL
current_location_id          TEXT
current_custodian_user_id    INTEGER

-- Workflow / grouping
group_id                     TEXT
parent_entry_id              INTEGER
transfer_no                  TEXT
source_type                  TEXT NOT NULL
source_id                    TEXT NOT NULL
reference_no                 TEXT

-- Approval / receive / audit
authorization_status         TEXT DEFAULT 'posted'
receive_status               TEXT
created_by                   INTEGER NOT NULL
approved_by                  INTEGER
received_by                  INTEGER
created_at                   TEXT NOT NULL
approved_at                  TEXT
received_at                  TEXT
posted_at                    TEXT

-- Idempotency and safety
idempotency_key              TEXT
reversed_entry_id            INTEGER
is_reversal                  INTEGER DEFAULT 0
correction_reason            TEXT
workstation_id               TEXT
device_info                  TEXT
ip_address                   TEXT

-- Accounting linkage
accounting_event_id          INTEGER
accounting_voucher_id        INTEGER
accounting_posting_status    TEXT

-- Notes/evidence
note                         TEXT
receiver_note                TEXT
evidence_key                 TEXT
metadata_json                TEXT

created_at_system            TEXT DEFAULT current_timestamp
updated_at_system            TEXT
```

### 7.3 Why this is better

Every admin page can answer:

```text
How much cash is in drawer?
How much is pending receive?
Who currently holds the cash?
How much is in admin custody?
How much went to bank?
How much is disputed?
Which user initiated it?
Which user accepted it?
Which voucher posted it?
```

Without manually joining different legacy tables every time.

---

## 8. Practical target for current production system

Because production data already exists, we should **not delete or force merge old tables immediately**.

The safe enterprise migration is:

```text
Phase 1: Build unified read model over existing tables.
Phase 2: Move all pages to that unified read model.
Phase 3: Standardize future writes into canonical cash ledger.
Phase 4: Backfill old data into canonical ledger.
Phase 5: Stop using old tables directly for admin reports.
```

---

## 9. Recommended immediate architecture: Cash Custody Service

Create a backend service layer:

```text
src/lib/cash-custody-ledger.ts
```

It will expose functions like:

```ts
loadCashCustodyEvents(params)
loadCashCustodyBalances(params)
loadCashTransferTrail(params)
loadCashExceptions(params)
calculateCashPosition(params)
```

This service will read from:

```text
emp_cash_transactions
cash_drawer_movements
billing_handovers
billing_counter_cash_transfers
billing_counter_sessions
expenses
accounting_posting_events
```

and return one normalized shape:

```ts
type CashCustodyEvent = {
  id: string;
  sourceType: 'emp_cash_transaction' | 'drawer_movement' | 'counter_handover' | 'cash_custody_transfer' | 'expense' | 'bank_deposit';
  sourceId: string;
  eventType: string;
  status: string;
  amount: number;
  expectedAmount?: number;
  receivedAmount?: number;
  dueAmount?: number;
  varianceAmount?: number;
  fromUserId?: number;
  fromUserName?: string;
  toUserId?: number;
  toUserName?: string;
  counterSessionId?: number;
  counterName?: string;
  destinationType?: string;
  currentLocationType: 'drawer' | 'in_transit' | 'admin_custody' | 'counter_custody' | 'bank' | 'expense' | 'refund' | 'disputed' | 'unknown';
  currentLocationLabel: string;
  createdAt: string;
  receivedAt?: string;
  referenceNo?: string;
  note?: string;
};
```

---

## 10. Required unified endpoints

Add endpoints:

```text
GET /api/cash-custody/overview
GET /api/cash-custody/events
GET /api/cash-custody/transfers
GET /api/cash-custody/balances
GET /api/cash-custody/exceptions
GET /api/cash-custody/sessions/:sessionId/trail
POST /api/cash-custody/transfers/:id/receive
POST /api/cash-custody/transfers/:id/partial-receive
POST /api/cash-custody/transfers/:id/cancel
POST /api/cash-custody/reconcile
```

### 10.1 Overview response should include

```ts
type CashCustodyOverview = {
  activeDrawerCash: number;
  pendingTransferCash: number;
  adminCustodyCash: number;
  counterCustodyCash: number;
  bankDepositPendingCash: number;
  bankedCash: number;
  disputedCash: number;
  refundedCash: number;
  expensePaidCash: number;
  unclassifiedCashOut: number;
  totalCashAccountedFor: number;
};
```

---

## 11. Required page remapping

### 11.1 Admin Cash Control Ledger

Current route:

```text
/h/:slug/cash/drawers
```

Target source:

```text
/api/cash-custody/overview
/api/cash-custody/events
/api/cash-custody/balances
/api/cash-custody/exceptions
```

Target cards:

```text
Active drawer cash
Pending / in transit cash
Admin custody cash
Counter custody cash
Bank deposit pending
Disputed / short cash
Unclassified cash out
```

Target sections:

```text
Live Drawer Status
Custody Position
Cash Movement Timeline
Pending Receiver Confirmation
Disputed / Short Cash
Bank Deposit Trail
Expense Evidence
Audit Exceptions
```

### 11.2 Admin Shift Handover

Current route:

```text
/h/:slug/cash/handover
```

Target source:

```text
/api/cash-custody/transfers?types=shift_handover,cash_custody_transfer
/api/cash-custody/overview
```

Target tabs:

```text
All
Pending Receive
Received
Partial / Disputed
Shift Close Handovers
Running Cash Transfers
```

Important rule:
- Top KPI must not read only `billing_handovers`.
- Admin Cash Collection must not use synthetic ID hacks long term.
- Both old handover and new custody transfer must be normalized by the backend service.

### 11.3 Reception Cash Operations

Current route:

```text
/h/:slug/reception/cash-operations
```

Target source:

```text
/api/cash-custody/session/:sessionId/overview
/api/cash-custody/session/:sessionId/events
/api/cash-custody/transfers
```

Reception should show:

```text
Drawer opening cash
Patient cash in
Refund cash out
Doctor payout
Expense payment
Transfer out pending
Transfer in accepted
Bank deposit/drop
Current expected drawer cash
```

Transfer panel should display:

```text
Pending transfers I sent
Pending transfers I need to receive
Received/disputed transfer history
```

### 11.4 Cash Bank Book

Current route:

```text
/h/:slug/cash-bank-book
```

Target source:

```text
/api/cash-custody/balances
/api/cash-custody/events
/api/cash-custody/reconciliation
```

Cash Book must explain:

```text
Opening cash
Cash in
Cash out
Drawer cash
Pending transfer
Admin custody
Bank pending
Banked
Disputed
Closing accounted cash
```

### 11.5 Audit Explorer

Add `billing_counter_cash_transfers` and future `cash_ledger_entries` to cash audit group.

Audit filters should support:

```text
Cash source type
Counter session
Transfer no
User
Receiver
Status
Amount range
Date range
```

---

## 12. State machine for cash custody

### 12.1 Running transfer state machine

```text
CREATED / PENDING_RECEIVE
  ↓ receiver accepts full amount
RECEIVED

CREATED / PENDING_RECEIVE
  ↓ receiver accepts less amount
DISPUTED

DISPUTED
  ↓ admin resolves by adjustment/reversal/approval
RESOLVED

PENDING_RECEIVE
  ↓ sender/admin cancels before receive
CANCELLED

Any posted movement
  ↓ correction
REVERSED + replacement movement
```

### 12.2 Shift handover state machine

```text
ACTIVE_SESSION
  ↓ cashier closes shift
CLOSED_SESSION + HANDOVER_PENDING
  ↓ admin/cashier receives
HANDOVER_RECEIVED
  ↓ variance found
HANDOVER_DISPUTED
  ↓ admin resolves
RESOLVED
```

### 12.3 Bank deposit state machine

```text
ADMIN_CUSTODY / DRAWER
  ↓ deposit request created
BANK_DEPOSIT_PENDING
  ↓ bank slip confirmed
BANKED
  ↓ mismatch
BANK_DEPOSIT_DISPUTED
```

---

## 13. Enterprise controls that must be enforced

### 13.1 Database-level safety

- Positive amount checks.
- Tenant isolation on every query.
- Unique idempotency key per cash mutation.
- No self-transfer unless explicitly allowed for adjustment with admin approval.
- No negative drawer cash unless override policy exists.
- Every mutation writes audit log.
- Every mutation has source document/reference.
- Posted amount cannot be edited; use reversal.

### 13.2 Role controls

| Action | Allowed roles | Control |
|---|---|---|
| Collect patient cash | reception/receptionist | active counter required |
| Transfer drawer cash | reception/receptionist/admin/accountant | active session required for drawer source |
| Receive admin custody cash | hospital_admin/md/director/accountant | receiver confirmation required |
| Receive counter transfer | reception/receptionist | active destination counter required |
| Approve dispute | hospital_admin/md/director/accountant | reason required |
| Reconcile cash | accountant/admin/md/director | independent from cashier where possible |
| Reverse posted cash movement | admin/accountant with reason | audit + approval required |

### 13.3 UI safety

- Never show zero silently when hidden source has pending cash.
- Every card should have a drill-down list.
- Pending cash should remain visible regardless of selected date until resolved.
- Date filter should apply to events, not hide unresolved balances.
- Use labels: `Pending receive`, `In admin custody`, `Received`, `Disputed`, `Banked`.
- Large cash transfer should trigger attention alert.

---

## 14. Migration plan

### Phase 0 — Freeze and document

- Do not add more independent cash tables without this architecture.
- Document all current cash sources.
- Keep production data untouched.

### Phase 1 — Unified read model

Implement:

```text
src/lib/cash-custody-ledger.ts
```

Return normalized events from old and new tables.

Acceptance test:

```text
Safaoat transfer should appear as:
currentLocation = in_transit
status = pending
from = Safaoat Ullah
to = Dr. Nazmus Sakib
amount = 18450
sourceType = cash_custody_transfer
```

### Phase 2 — Unified endpoints

Implement:

```text
/api/cash-custody/overview
/api/cash-custody/events
/api/cash-custody/transfers
/api/cash-custody/balances
/api/cash-custody/exceptions
```

### Phase 3 — Remap admin pages

Move these pages to unified endpoints:

```text
/cash/drawers
/cash/handover
/cash-bank-book
/cash/drawers/:drawerId
```

Do not let any card directly query only `billing_handovers` for cash position.

### Phase 4 — Standardize write paths

Current writes may still insert into existing tables, but also create canonical ledger entries if `cash_ledger_entries` is introduced.

New rule:

```text
Every cash mutation writes one canonical cash ledger event.
Legacy/domain tables may remain as source documents.
```

### Phase 5 — Backfill historical data

Backfill from:

```text
emp_cash_transactions
cash_drawer_movements
billing_handovers
billing_counter_cash_transfers
expenses
```

into:

```text
cash_ledger_entries
```

Use source keys:

```text
source_type + source_id + event_type
```

to avoid duplicates.

### Phase 6 — Reconciliation and audit hardening

- Add daily automated cash custody reconciliation job.
- Add mismatch dashboard.
- Add audit group support.
- Add printable cash custody report.
- Add export for accountant/owner.

---

## 15. Testing scenarios before production rollout

### Scenario 1: Patient cash collection

Expected:

```text
emp_cash_transactions row exists
cash custody ledger shows IN_DRAWER
active drawer cash increases
cash book cash in increases
```

### Scenario 2: Cashier transfers cash to admin

Expected:

```text
billing_counter_cash_transfers.status = pending
cash_drawer_movements.cash_drop exists
sender drawer cash decreases
pending transfer cash increases
admin custody cash does not increase until receive
```

### Scenario 3: Admin receives full cash

Expected:

```text
transfer.status = received
received_amount = amount
due_amount = 0
pending transfer cash decreases
admin custody cash increases
```

### Scenario 4: Admin receives less cash

Expected:

```text
transfer.status = disputed
received_amount < amount
due_amount > 0
disputed cash increases
attention alert appears
```

### Scenario 5: Counter-to-counter transfer

Expected:

```text
sender drawer cash decreases
transfer pending until receiver accepts
receiver must have active counter session
receiver drawer cash increases only after receive
```

### Scenario 6: Shift close handover

Expected:

```text
billing_counter_sessions closed
billing_handovers pending/received
unified cash custody page shows handover as same custody flow
```

### Scenario 7: Cash book reconciliation

Expected:

```text
closing accounted cash = drawer + pending + admin custody + bank pending + banked + disputes - expenses/refunds as applicable
```

---

## 16. Immediate P0 tasks

1. Build `src/lib/cash-custody-ledger.ts` normalized read service.
2. Add `/api/cash-custody/*` endpoints.
3. Update `/cash/drawers` to use unified overview/cards.
4. Update `/cash/handover` top KPI and history to use unified transfer source.
5. Implement custody transfer partial receive/collect properly; remove synthetic ID coupling.
6. Update `/cash-bank-book` to show cash by location/status.
7. Add `billing_counter_cash_transfers` to cash audit group.
8. Fix `cashOperations.ts` counter name column issue.
9. Make unresolved pending/disputed cash visible regardless of date filter.
10. Add integration tests for the Safaoat-style transfer flow.

---

## 17. Long-term recommended schema decision

### Keep existing domain tables

Do not delete these immediately:

```text
emp_cash_transactions
cash_drawer_movements
billing_handovers
billing_counter_cash_transfers
```

They contain production history and existing business behavior.

### Add canonical ledger table later

Recommended future table:

```text
cash_ledger_entries
```

This should become the single source for all cash movement reporting.

### Deprecation rule

After migration:

```text
Admin reports must not directly calculate cash position from legacy tables.
They must use cash custody ledger service/table only.
```

---

## 18. Final architecture rule

For enterprise-grade hospital cash handling, the system must always answer these questions instantly:

```text
1. টাকা কে নিয়েছে?
2. কোন drawer/counter থেকে বের হয়েছে?
3. কার কাছে গেছে?
4. সে receive করেছে কি না?
5. receive করলে কত receive করেছে?
6. কম হলে due/short কত?
7. এখন টাকা কোথায় আছে?
8. audit/voucher/proof কোথায়?
9. কোন report/card এই টাকা দেখাচ্ছে?
10. reconciliation-এ এই টাকা কীভাবে counted হচ্ছে?
```

Until the system can answer all 10 questions consistently from one read model, the cash module should not be considered enterprise-grade.
