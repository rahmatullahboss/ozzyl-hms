# Financial System — Full API Contract & Architecture Review

> Auto-generated documentation + review. Last updated: 2026-05-15
> Scope: billing.ts, billingCounter.ts, billingProvisional.ts, billingHandover.ts, deposits.ts, income.ts, settlements.ts, creditNotes.ts

---

## Part 1: Complete API Contract Map

### 1. billing.ts (`/api/billing`)

| Method | Path | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| GET | `/api/billing` | `status?`, `from?`, `to?`, `search?`, `page?`, `limit?` | `{ bills[], meta, summary }` | List bills with pagination + summary stats |
| GET | `/api/billing/due` | `from?`, `to?`, `date?`, `patient_id?`, `search?` | `{ bills[], summary: { totalBills, totalDue } }` | List outstanding/unpaid bills |
| GET | `/api/billing/patient/:patientId/ledger` | URL: `patientId`, `from?`, `to?` | `{ patient, opening, transactions[], closing, summary }` | **Patient receivable ledger** — full debit/credit trail |
| GET | `/api/billing/patient/:patientId` | URL: `patientId` | `{ bills[] }` | All bills for a patient |
| GET | `/api/billing/:id` | URL: `id` | `{ bill, items[], payments[], deposit_adjustments[] }` | Single bill with line items + payment history |
| POST | `/api/billing` | `{ patientId`, `items[]`, `visitId?`, `referringDoctorId?`, `priceCategoryId?`, `discount?` } | `{ message, billId, invoiceNo, total }` | Create itemized bill (requires active counter session) |
| POST | `/api/billing/pay` | `{ billId`, `amount`, `paymentMethod`, `type?`, `idempotencyKey?`, `externalTransactionId?` } | `{ message, receiptNo, paidAmount, outstanding, status, idempotent? }` | Record payment; idempotent; `due` field is source of truth for outstanding |
| PUT | `/api/billing/:id` | `{ items[]`, `discount?` } | `{ message, totalAmount, discount, itemCount }` | Edit bill pre-payment only; post-payment → credit note |

---

### 2. billingCounter.ts (`/api/billing-counter`)

| Method | Path | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| GET | `/api/billing-counter/pending-appointment-charges` | `date?`, `limit?` | `{ data[], date }` | Pending appointment charges for today |
| GET | `/api/billing-counter/pending-bills` | `date?`, `limit?` | `{ data[], date }` | Pending unpaid bills |
| GET | `/api/billing-counter/handover-recipients` | — | `{ recipients[] }` | Users eligible to receive cash handover |
| GET | `/api/billing-counter/handovers/pending` | — | `{ handovers[] }` | Pending counter handovers assigned to current user |
| POST | `/api/billing-counter/handovers/:handoverId/accept` | `{ receivedAmount`, `remarks?`, `disputeReason?` } | `{ message, handoverId, status, receivedAmount, openedSessionId }` | Accept incoming counter handover and start next shift |
| GET | `/api/billing-counter/sessions/active` | — | `{ active, session: { id, counterId, counterName, openingCash, openedAt, ...cashSummary } }` | Current active session with cash summary |
| POST | `/api/billing-counter/sessions/activate` | `{ counterId`, `openingCash?`, `remarks?` } | `{ message, session: { id, sessionNo, counterId, counterName, openingCash } }` | Activate billing counter; creates session + opening cash movement |
| POST | `/api/billing-counter/sessions/:id/close` | `{ closingCash`, `handoverAmount?`, `handoverTo?`, `remarks?` } | `{ message, sessionId, closingCash, expectedCash, variance, handoverAmount, handoverTotal, handoverDueAmount, handoverStatus, handoverCreated }` | Close session; variance check; creates billing_handovers record |
| GET | `/api/billing-counter/service-items` | `search?`, `limit?`, `price_category_id?`, `department_id?` | `{ data[] }` | Service catalog search with price category pricing |
| POST | `/api/billing-counter/invoices` | `{ patientId`, `visitId?`, `items[]`, `referringDoctorId?`, `priceCategoryId?`, `billMode`, `payment`, `createWalkInVisit?`, `idempotencyKey?` } | `{ message, billId, invoiceNo, mode, subtotal, discount, taxTotal, total, paidAmount, depositDeducted, dueAmount, status }` | Create invoice; supports `provisional` billMode (no bill created); idempotent |
| GET | `/api/billing-counter/admin/pending-handovers` | — (admin) | `{ handovers[], totalPending, count }` | Admin view of pending counter handovers |
| GET | `/api/billing-counter/admin/collection-summary` | `date?` | `{ date, todayCollection, pendingCount, pendingAmount, counterBreakdown[] }` | Admin daily cash collection summary |
| POST | `/api/billing-counter/admin/collect/:handoverId` | — | `{ message, handoverId, status }` | Admin full collection of handover |
| POST | `/api/billing-counter/admin/partial-collect/:handoverId` | `{ collectedAmount`, `remarks?` } | `{ message, handoverId, status, collectedAmount, remainingAmount }` | Admin partial collection |
| GET | `/api/billing-counter/sessions/history` | `date?`, `staff_id?`, `status?` | `{ sessions[], date, count }` | Counter sessions history |

---

### 3. billingProvisional.ts (`/api/billing-provisional`)

| Method | Path | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| GET | `/api/billing-provisional` | `patient_id?`, `visit_id?`, `bill_status?`, `search?`, `page?`, `per_page?`, `limit?` | `{ data[], page, per_page, total }` | List provisional items |
| GET | `/api/billing-provisional/summary` | `patient_id?`, `bill_status?` | `{ total_items, total_amount, billed_count, provisional_count, cancelled_count }` | Provisional items summary |
| GET | `/api/billing-provisional/patient/:patientId/summary` | URL: `patientId` | `{ data: { total_items, pending_amount, finalized_amount, cancelled_count } }` | Per-patient provisional summary |
| POST | `/api/billing-provisional` | `{ patient_id`, `visit_id?`, `admission_id?`, `items[]` } | `{ message, count }` | Create provisional items |
| POST | `/api/billing-provisional/batch` | same as POST | same | Batch create (same logic) |
| PATCH | `/api/billing-provisional/:id/cancel` | `{ cancel_reason }` | `{ message }` | Cancel provisional item |
| PUT | `/api/billing-provisional/:id/cancel` | `{ cancel_reason }` | `{ message }` | Cancel (alt method) |
| POST | `/api/billing-provisional/pay` | `{ patient_id`, `provisional_item_ids?`, `discount?`, `payment_method?`, `remarks?` } | `{ message, bill_id, invoice_no, total, paid, due, status, items_count }` | **Atomic conversion** to invoice; requires active counter session; deducts deposit |

---

### 4. billingHandover.ts (`/api/billing-handover`)

| Method | Path | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| GET | `/api/billing-handover` | `status?`, `staff_id?` | `{ handovers[] }` | List handovers (supervisors see all; staff see own) |
| GET | `/api/billing-handover/pending/:staffId` | URL: `staffId` | `{ pending[] }` | Pending handovers for a staff member |
| POST | `/api/billing-handover` | `{ handover_to`, `handover_amount`, `due_amount?`, `handover_type?`, `remarks?` } | `{ id, message, status }` | Create handover; validates not self-handover |
| PUT | `/api/billing-handover/:id/receive` | `{ remarks?` } | `{ message }` | Confirm receipt; creates cash handover accounting event |
| PUT | `/api/billing-handover/:id/verify` | — (admin) | `{ message }` | Admin verify handover |
| GET | `/api/billing-handover/report/daily` | `date`, `staff_id` (required) | `{ date, total_in, total_out, total_collection, total_handover, difference }` | Daily collection vs handover report |

---

### 5. deposits.ts (`/api/deposits`)

| Method | Path | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| GET | `/api/deposits` | `patient_id?`, `type?`, `page?`, `per_page?` | `{ deposits[], total, page, per_page, summary: { total_deposits, total_refunds, total_adjustments, balance } }` | List deposits with summary |
| GET | `/api/deposits/advance-report` | `startDate?`, `endDate?`, `patient_id?`, `include_zero?` | `{ rows[], summary: { patient_count, total_deposits, total_refunds, total_adjustments, balance, advanceLiabilityLedgerTotal, ledgerDifference, hasLedgerMismatch, ledgerStatus } }` | **Patient advance liability report** with subledger vs GL reconciliation |
| GET | `/api/deposits/balance/:patientId` | URL: `patientId` | `{ patient_id, total_deposits, total_refunds, total_adjustments, balance }` | Patient deposit balance |
| POST | `/api/deposits` | `{ patient_id`, `amount`, `payment_method?`, `remarks?`, `idempotencyKey?` } | `{ id, receipt_no, message }` | Collect deposit; idempotent; requires active counter |
| POST | `/api/deposits/refund` | `{ patient_id`, `amount`, `payment_method?`, `remarks?`, `idempotencyKey?` } | `{ id, receipt_no, message }` | Refund deposit; balance check in SQL; idempotent; requires active counter |
| POST | `/api/deposits/adjust` | `{ patient_id`, `amount`, `bill_id`, `remarks?` } | `{ receipt_no, message }` | Adjust deposit against bill; atomic rollback on race condition |

---

### 6. income.ts (`/api/income`)

| Method | Path | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| GET | `/api/income` | `startDate?`, `endDate?`, `source?` | `{ income[] }` | List income records |
| POST | `/api/income` | `{ date`, `source`, `amount`, `description?`, `bill_id?` } | `{ success, id, message }` | Create income; records direct income accounting event |
| GET | `/api/income/:id` | URL: `id` | `{ income }` | Single income record |
| POST | `/api/income/:id/reverse` | `{ date?`, `reason?`, `paymentMethod?` } | `{ success, message, incomeId, amount, reversalDate }` | Queue a reversal manual journal for posted income |
| PUT | `/api/income/:id` | `{ date?`, `source?`, `amount?`, `description?` } | `{ success, message }` | Update income; blocks if already posted |
| DELETE | `/api/income/:id` | — | `{ success, message }` | Delete income; blocks if posted |

---

### 7. settlements.ts (`/api/settlements`)

| Method | Path | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| GET | `/api/settlements` | `patient_id?`, `start_date?`, `end_date?`, `page?`, `per_page?` | `{ settlements[], page, per_page, summary }` | List settlements |
| GET | `/api/settlements/pending` | `patient_id?` | `{ pending_bills[] }` | Credit bills awaiting settlement |
| GET | `/api/settlements/patient/:patientId/info` | URL: `patientId` | `{ patient, pending_bills[], deposit_balance, total_due, net_payable }` | Patient settlement summary |
| POST | `/api/settlements` | `{ patient_id`, `bill_ids[]`, `paid_amount`, `deposit_deducted`, `discount_amount`, `payment_mode?`, `remarks?`, `idempotencyKey?` } | `{ id, receipt_no, message }` | Settle multiple bills atomically; cash + deposit + discount allocation; idempotent |

---

### 8. creditNotes.ts (`/api/credit-notes`)

| Method | Path | Request | Response | Purpose |
|--------|------|---------|----------|---------|
| GET | `/api/credit-notes` | `patient_id?`, `start_date?`, `end_date?`, `page?`, `per_page?` | `{ credit_notes[], page, per_page, summary }` | List credit notes |
| GET | `/api/credit-notes/invoice/:billId` | URL: `billId` | `{ bill, items: [{ ..., available_qty }] }` | Get invoice items with returned quantity tracking |
| POST | `/api/credit-notes` | `{ bill_id`, `patient_id`, `reason`, `payment_mode?`, `remarks?`, `items[]`, `idempotencyKey?` } | `{ id, credit_note_no, refund_amount, message }` | Create credit note; item-level return; updates bill totals; cash refund if overpaid; idempotent |

---

## Part 2: Core Accounting Architecture

### 2.1 Double-Entry Accounting Flow

The system implements a **posting-event-driven double-entry accounting** model:

```
User Action (billing / payment / deposit)
    ↓
accounting_posting_events (staging table)
    ↓
postPendingAccountingEvents() — async queue
    ↓
accounting_vouchers + accounting_journal_lines (double-entry GL)
```

**Key accounting event types** (`ACCOUNTING_EVENT_TYPES`):
- `CashSales` — cash collected at billing counter
- `PaymentReceived` — bill payment received
- `PatientDepositReceived` — patient deposit collected
- `PatientDepositRefunded` — deposit refunded
- `PatientDepositAdjusted` — deposit applied to bill
- `CashHandover` — cash handed over between staff
- `SettlementDiscount` — discount applied during settlement
- `CreditNoteIssued` — credit note / return
- Plus direct income events via `direct-finance-accounting.ts`

### 2.2 Cash Management Flow

```
Counter Session Activate (opening cash)
    ↓
CashSales / CollectionFromReceivable (emp_cash_transactions)
    ↓
Counter Session Close → handover record created
    ↓
billing_handover receive → accounting event posted
    ↓
Admin collect / partial-collect
```

**Tables involved:**
- `billing_counter_sessions` — session lifecycle
- `cash_drawer_movements` — all cash in/out movements
- `emp_cash_transactions` — employee cash tracking (CashSales, ReturnDeposit, CollectionFromReceivable, DepositDeduct)
- `billing_handovers` — handover lifecycle (pending → received → collected)

### 2.3 Bill Payment State Machine

```
Bill created: total=X, paid=0, due=X, status=open
    ↓ (partial payment)
paid+=amount, due-=amount, status=partially_paid
    ↓ (full payment)
paid=total, due=0, status=paid
    ↓ (overpayment blocked via outstanding check)
```

### 2.4 Provisional → Invoice Flow

```
Provisional items created (status=provisional)
    ↓ (POST /billing-provisional/pay)
Atomic batch:
  - bills INSERT
  - invoice_items INSERT
  - billing_provisional_items: bill_status → 'finalized'
  - payments INSERT (if paid)
  - emp_cash_transactions INSERT (if paid)
  - accounting_posting_events INSERT
```

### 2.5 Deposit Lifecycle

```
Deposit collected (transaction_type='deposit')
    ↓ (adjust)
Deposit applied to bill (transaction_type='adjustment')
    ↓ (refund)
Deposit refunded (transaction_type='refund')

Balance = SUM(deposits) - SUM(refunds) - SUM(adjustments)
```

### 2.6 Settlement Flow

Multi-bill settlement with three-component allocation:
1. **Cash** → payments table + emp_cash_transactions
2. **Deposit** → billing_deposits (adjustment) + bill update
3. **Discount** → billing_settlements record

---

## Part 3: Review Findings

### Finding 1: ⚠️ `billing.ts` GET outstanding inconsistency (FIXED)

**File:** `billing.ts:404, 637, 668-670`

The review found multiple outstanding formulas in the same file:

- `GET /api/billing` (line 404): used `b.total - b.paid` — no NULL handling and ignored `due`
- `GET /api/billing/patient/:patientId` (line 637): used `b.total - b.paid` — same issue
- `GET /api/billing/:id` (line 670): `COALESCE(b.due, MAX(0, COALESCE(b.total, 0) - COALESCE(b.paid, 0)))` — proper NULL handling

**Status:** Fixed on 2026-05-15. `GET /api/billing` and `GET /api/billing/patient/:patientId` now use the persisted `bill.due` first, with a safe fallback:
```sql
COALESCE(b.due, MAX(0, COALESCE(b.total, 0) - COALESCE(b.paid, 0))) AS outstanding
```

---

### Finding 2: ✅ `billing.ts` POST /pay response outstanding used wrong field (FIXED)

**File:** `billing.ts:1048`

Response used to return `bill.total - newPaid` instead of the correct `due`-based value:

```typescript
// Old:
outstanding: Math.max(0, bill.total - newPaid),

// Correct:
outstanding: newDue,
```

**Status:** Fixed on 2026-05-15. Replay responses also read `b.due`, so idempotent payment retries return the same outstanding balance as the original payment state.

---

### Finding 3: ⚠️ `billingHandover.ts` daily report — total_collection is net, not gross

**File:** `billingHandover.ts:281-294`

The daily report at `GET /report/daily` calculates `total_collection` using only **cash net** (CashSales + CollectionFromReceivable + CashDiscountReceived minus returns). If the frontend expects this to be the gross cash collected, it will be confused.

Specifically, the report returns `total_in` (gross cash in), `total_out` (gross cash out), `total_collection` (net = in - out), `total_handover`, and `difference` (net - handover).

**No bug — design note for frontend team.** Ensure the dashboard consumes `total_in` for gross collections, not `total_collection`.

---

### Finding 4: ⚠️ `deposits.ts` advance-report ledger reconciliation potential drift

**File:** `deposits.ts:258-270`

The advance report computes `ledgerDifference = subledgerBalance - advanceLiabilityLedgerTotal`. This is a **reconciliation check** between the `billing_deposits` subledger and the `accounting_journal_lines` GL.

If `ledgerDifference != 0`, it means the deposit subledger and the double-entry GL are out of sync — a serious data integrity issue.

**Status:** Fixed on 2026-05-15. The endpoint now returns `hasLedgerMismatch` and `ledgerStatus`, and `DepositsPage` shows a visible warning when `ABS(ledgerDifference) >= 0.01`.

---

### Finding 5: ℹ️ `billingProvisional.ts` PATCH and PUT cancel — redundant

**File:** `billingProvisional.ts:364-428`

Both `PATCH /:id/cancel` and `PUT /:id/cancel` expose the same contract for compatibility.

**Status:** Cleaned up on 2026-05-15. Both methods are still supported, but they now call the same internal cancellation helper.

---

### Finding 6: ⚠️ `income.ts` PUT/DELETE — posted income cannot be edited/deleted

**File:** `income.ts:140-142, 198-200`

Income records that have been posted to the GL via `accounting_posting_events` **cannot be edited or deleted**. The correct workflow is reversal, not mutation of posted data.

**Status:** Fixed on 2026-05-15. `POST /api/income/:id/reverse` now queues a balanced manual journal that debits `other_revenue` and credits the original payment asset account. Duplicate reversals are blocked.

---

### Finding 7: ⚠️ Idempotency key pattern inconsistency across modules

| Module | Idempotency Mechanism |
|--------|---------------------|
| `billing.ts` POST /pay | `idempotencyKey` + `externalTransactionId` on payments table |
| `billingCounter.ts` POST /invoices | `billing_invoice_idempotency_keys` table |
| `deposits.ts` POST /, /refund | shared `billing_mutation_idempotency_keys` helper |
| `settlements.ts` POST | shared `billing_mutation_idempotency_keys` helper |
| `creditNotes.ts` POST | shared `billing_mutation_idempotency_keys` helper |

All modules use idempotency, but through **three different patterns** (payments table with `externalTransactionId`, `billing_invoice_idempotency_keys`, and the shared billing mutation idempotency helper). This creates maintenance overhead.

**No bug — architectural observation.** Consider unifying under one mechanism.

---

### Finding 8: ⚠️ `billingHandover.ts` verify — no-op after status check

**File:** `billingHandover.ts:245-268`

The verify endpoint updates status from `received` to `verified`, but the status transition logic at line 257 checks `existing.status === 'verified'` AFTER already passing the check at line 256 (existing found). However, there's a subtle issue: if status is already `verified`, it throws. But the UPDATE at line 259 also throws if `meta.changes === 0`. These two checks are redundant but not harmful.

**Accounting note:** The earlier recommendation to add a `cashHandover` event at verify was a false positive. Receipt/collection is the cash movement; verify is an audit-only state transition. Adding another GL event at verify would risk double-posting the same handover.

---

### Finding 9: ⚠️ Counter session expected cash calculation dependency

**File:** `billingCounter.ts:509`

`calculateBillingCounterSessionCashSummary` computes expected cash for a closing session. This function's logic must stay in sync with what `emp_cash_transactions` are recorded throughout the session. If any cash transaction type is added or modified, both the recording code and this summary function must be updated together.

---

### Finding 10: ℹ️ Credit note — cash refund vs receivable reduction split

**File:** `creditNotes.ts:223-228`

When a credit note is issued:
- `cashRefund` = `originalPaid - newPaid` (what came back in cash)
- `receivableReduction` = `totalRefund - cashRefund` (reduction of what was owed)

This is correct accounting for returns. The accounting event payload also carries `receivableReduction` and `cashRefund`, and `buildCreditNoteIssuedLines` credits accounts receivable and the payment asset account explicitly. The earlier concern that receivable adjustment was only implicit was a false positive.

---

## Part 4: Key Conventions Summary

| Convention | Value |
|-----------|-------|
| Money rounding | `Math.round(value * 100) / 100` (2 decimal places) |
| Overpayment prevention | Check `amount > outstanding` before payment INSERT |
| Idempotency | Supported on all financial mutation endpoints |
| Counter session requirement | All billing/payment operations require active session |
| Accounting period check | `assertAccountingPeriodOpen` on all financial writes |
| Audit logging | `createAuditLog` on all CREATE/UPDATE/DELETE/PAYMENT operations |
| Soft delete | `is_active = 1` filter on deposits, settlements, credit notes, provisional |
| `due` as source of truth | After deposit/credit note adjustments, `bill.due` overrides `total - paid` |
| Timezone | All timestamps use `datetime('now', '+6 hours')` (BST/GMT+6) |
| Role-based access | Separate read/write/approval roles for all financial modules |

---

## Part 5: Unresolved Questions (needs clarification)

1. **Credit note reversal**: No endpoint to reverse an issued credit note — only create new ones. Is reversal needed or is the workflow "issue new credit note, adjust manually"?

2. **Income direct posting atomicity**: `income.ts` creates the income row first, then queues the direct-income accounting event. If the second write fails after the income insert, manual retry/backfill may be needed.

3. **Diagnostic billing side effects**: `billing.ts:1037-1042` updates `lab_orders` and `radiology_requisitions` bill status when a bill is paid. Is this synchronous and reliable? What happens if it fails?

4. **Provisional pay — all items vs specific items**: `billingProvisional.ts:437-463` converts ALL provisional items for a patient if no `provisional_item_ids` provided. Is this the intended behavior, or should it only convert items from a specific visit/admission?

5. **Counter session variance tolerance**: `billingCounter.ts:517-519` requires remarks if variance != 0. Is there a defined threshold for acceptable variance (e.g., rounding differences)?
