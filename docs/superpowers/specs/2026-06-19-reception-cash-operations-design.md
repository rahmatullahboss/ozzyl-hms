# Reception Cash Operations and Doctor Payout Design

## Goal

Give a reception cashier one clear, auditable workspace for cash leaving an
active drawer while keeping administration and finance monitoring separate from
physical cash execution.

The design replaces the large reception-dashboard outflow panel with a
dedicated page at `/reception/cash-operations`. The counter-status dropdown
opens this page through a `Cash Operations` action. The existing handover modal
returns to a narrow close-and-accept responsibility.

## Decisions

- Reception cashiers may pay eligible doctor commission accruals directly from
  their own active counter.
- Hospital admin, MD, director, and accountant users monitor, review, approve,
  receive, reverse, or resolve exceptions. Monitoring mode never creates a
  drawer movement.
- `doctor_commission_accruals` is the item-level doctor payable truth.
- `doctor_commission_settlements` is the payout header and receipt truth.
- `cash_drawer_movements` remains the canonical generic drawer ledger. A second
  generic cash ledger will not be introduced.
- Domain tables retain workflow state for payouts, expenses, transfers, bank
  deposits, and handovers. Drawer movements link to those domain records by
  `reference_type` and `reference_id`.
- Doctor-earned consultation, test, USG, procedure, referral, and IPD-round
  amounts are payouts, not expenses.
- Shift handover is final shift reconciliation. Mid-shift custody transfer is a
  separate workflow.

## Page Structure

The Cash Operations page follows the existing dashboard design system, spacing,
cards, tables, status badges, buttons, typography, dark mode, and Bengali/English
localization patterns.

The page contains:

1. Today's Cash Overview
2. Doctor Payout
3. Expense / Petty Cash Payment
4. Cash Transfer
5. Bank Deposit
6. Close Shift / Handover
7. Recent Cash Activity

Desktop uses summary cards, a filter row, a main table, and a sticky selected
action summary. Mobile stacks the same content and uses a bottom sticky action
bar. Forms use inline panels or focused confirmation dialogs; the page does not
become one large modal.

### Today's Cash Overview

The overview is calculated for the caller's active counter session and shows:

- opening cash;
- patient cash collection;
- refunds;
- doctor payouts;
- expense cash-out;
- transfer out;
- accepted transfer in;
- bank-deposit custody;
- current drawer balance;
- pending handover; and
- pending transfer or bank-deposit custody.

Every amount is derived from existing billing/payment records,
`cash_drawer_movements`, and the relevant domain workflow table. UI state is not
used as a financial source of truth.

## Doctor Payout

### Eligibility and Filtering

The cashier can filter by:

- doctor;
- start and end date;
- source: consultation, lab/test/USG, IPD round, procedure, or referral;
- pending or paid state; and
- invoice, patient, service, or test search.

Only accruals linked to fully paid bills and still in an eligible unpaid state
may be selected. The API, not the browser, enforces this rule.

### Doctor and Item Presentation

Each doctor group shows:

- eligible item count;
- gross billed amount;
- consultation commission;
- test/USG commission;
- other commission;
- previously paid amount; and
- currently payable amount.

Expandable items show service date, invoice, patient identifier/name, service or
test, source, gross amount, commission rule/rate, commission amount, and status.
Selection supports individual items, all filtered items for one date, all items
in a visible group, or a bounded date range. Selection never crosses doctors in
one settlement.

The sticky summary shows selected count, date range, source breakdown, gross
amount, commission amount, adjustments, and final payable amount.

### Receiver, Adjustment, and Receipt

Before confirmation, the cashier records:

- receiver type: doctor, assistant, or representative;
- receiver name and optional bounded contact/reference;
- payment method;
- previous advance deduction;
- other signed adjustment;
- rounding adjustment;
- mandatory reason for any non-zero adjustment;
- optional note; and
- optional signed-slip image attachment.

Cash payout requires the cashier's current active counter and creates a linked
drawer cash-out. Bank or mobile-banking payout requires a finance-owned source
account and finance verification; it must never reduce a reception cash drawer.
The initial reception execution path defaults to cash.

A successful payout produces a tenant-scoped settlement number such as
`DPS-2026-000123` and a printable bilingual receipt. The receipt lists the
selected accruals, source totals, adjustments, net paid amount, receiver,
cashier, counter, date, and settlement reference.

### Payout Data Model

Extend `doctor_commission_settlements` additively with:

- `settlement_no`;
- `gross_commission_amount`;
- `advance_deduction`;
- `other_adjustment`;
- `rounding_adjustment`;
- `net_paid_amount`;
- `receiver_type`;
- `receiver_name`;
- `receiver_reference`;
- `counter_session_id` and `counter_id` for cash execution;
- `cash_movement_id`;
- `attachment_key`;
- `idempotency_key`; and
- reversal metadata where the existing accounting reversal pattern requires it.

Add `doctor_commission_settlement_items` with tenant, settlement, accrual,
source, gross amount, commission amount, and created timestamp. A unique
constraint on `(tenant_id, accrual_id)` prevents the same accrual from appearing
in two completed settlements. A unique tenant settlement number and a unique
non-null idempotency key prevent duplicate headers.

The existing `doctor_commission_accruals.settlement_id` remains for compatibility
and direct lookup. The settlement-item table is the immutable payout snapshot.

### Payout Atomicity

One D1 `batch()` owns the operational transition. Cloudflare documents D1
batches as SQL transactions that execute sequentially and roll back the sequence
when a statement fails.

The batch uses a pre-generated unique settlement number/idempotency key so later
statements can reference the inserted settlement through a deterministic
subquery. It includes:

1. guarded settlement creation;
2. immutable settlement-item inserts;
3. guarded accrual updates that require the eligible unpaid state;
4. one linked `cash_drawer_movements` cash-out for the net cash amount; and
5. the deterministic accounting posting event and immutable transition audit
   record.

Guards inside the batch must make an item-count mismatch, duplicate settlement
item, stale accrual state, wrong active session, or insufficient drawer balance
fail the sequence. A database cash-out guard (or equivalent guarded insert that
aborts the batch) prevents the drawer from going negative. Preflight reads
improve error messages but are not the only concurrency protection.

Receipt rendering uses the committed settlement. Voucher posting may complete
after the operational batch through the existing posting engine, but the
durable event is created with the payout. Posting-event retry remains idempotent
and cannot duplicate the operational payout.

## Expense / Petty Cash Payment

The existing `expenses` table remains the domain source of truth. Expense entry
requires category, amount, payee, and reason. Categories use the tenant's
configured accounting categories rather than free-form lookalikes.

The approval threshold is tenant-configurable, with the current `1000` behavior
used as the migration/default value:

- at or below the threshold, an authorized cashier may create and pay the
  expense immediately from their active drawer;
- above the threshold, creation makes a pending request and no drawer movement;
- admin/MD/director/accountant approval authorizes the request but still creates
  no drawer movement; and
- an active cashier executes the approved request, at which point the linked
  cash-out and accounting posting event are created atomically.

This approve-then-execute model prevents monitoring users from moving drawer
cash. It also replaces the current behavior where a pending expense can reduce
cash before approval.

Add or normalize fields for payee, approval state, payment state, approval
metadata, counter session, drawer movement, execution idempotency, and execution
metadata. Existing approved historical expenses are migrated/backfilled without
creating new movements.

Receipt policy is amount-configurable: optional below the threshold and required
above the configured receipt threshold. Existing R2 receipt upload and
verification controls are reused.

## Cash Transfer

`billing_counter_cash_transfers` remains the transfer source of truth and is
extended only where destination metadata is missing.

Supported destinations are:

- admin/MD/director/accountant custody;
- another active counter;
- vault/main cash;
- bank-deposit officer; and
- other configured custody location.

Initiation from the sender's active drawer creates the pending transfer and one
linked `cash_drop`/transfer-out movement in an atomic batch. The sender's drawer
therefore no longer owns that cash.

The receiver must accept, partially accept with a discrepancy, reject, or cancel
according to role and state rules. For a target counter, transfer-in is created
only when that counter's authorized receiver accepts it. Custody destinations
record receiver acceptance without pretending the cash entered another drawer.

Statuses remain explicit: `pending`, `partial`/`disputed`, `received`,
`rejected`, and `cancelled` as supported by the finalized schema. Every
transition records actor, time, amount, due amount, reason, and audit entry.
Rejected or cancelled custody must follow a linked return-to-counter or approved
resolution flow; it is never silently restored.

## Bank Deposit

The existing `bank_deposit_requests` workflow is reused:

- cashier moves cash from an active drawer into pending finance custody;
- finance confirms the actual bank transaction or rejects the request;
- rejected custody is deposited after correction, returned to an active
  counter, or resolved through an approved adjustment; and
- pending custody never inflates Bank Book balance.

Cash Operations shows the cashier's current and recent requests. Finance/admin
monitoring retains confirmation and resolution actions in Cash & Bank Book.

## Shift Close / Handover

Shift close remains final reconciliation:

- system expected cash;
- physical counted cash;
- variance and mandatory reason when non-zero;
- receiver;
- close submission; and
- receiver acceptance.

The existing high-variance approval lifecycle is preserved. A close requiring
approval creates no final handover or drawer movement until approved. A closed
handover remains pending acceptance until the receiver accepts it.

Mid-shift partial cash movement is performed through Cash Transfer, not by
overloading shift close. The compact handover dialog contains reconciliation
only; doctor payout, expense, and bank-deposit forms are removed from it.

## Monitoring and Permissions

### Reception / Receptionist

- View their own active counter and shift.
- Execute permitted cash payouts.
- Create and, when within limits, pay expenses.
- Initiate transfers and bank-deposit custody.
- Submit shift close and accept a handover addressed to them.

### Accountant

- Monitor all counters and payout settlements.
- Review doctor payout details and receipts.
- Approve configured expense requests.
- Verify bank deposits and accounting vouchers.
- Accept custody addressed to them.

### Hospital Admin / MD / Director

- View hospital-wide summaries and audit timelines.
- Approve, reverse through the accounting reversal workflow, and resolve
  exceptions.
- Configure permissions and expense/receipt limits.
- Accept custody addressed to them.

Monitoring APIs and pages are read/review/approve surfaces. A user creates a
drawer movement only when acting as the owner of a specific active counter or as
the named receiver accepting cash into a specific active counter.

## Unified Read Model

All doctor payout surfaces read `doctor_commission_accruals`, settlement items,
and `doctor_commission_settlements`:

- Reception Cash Operations;
- Commission Management;
- admin/MD monitoring;
- settlement receipt/detail;
- doctor payable summaries; and
- accounting/audit drill-down.

The legacy admin doctor-payout endpoint must be migrated away from its separate
`doctor_commissions` read path. Paid, pending, bill eligibility, source totals,
and settlement totals therefore agree everywhere.

The API returns explicit pending, paid, cancelled, ineligible-unpaid-bill, and
reversed states. UI query invalidation covers commission, payout, counter,
cash-book, accounting, and monitoring keys after a successful transition.

## Recent Cash Activity

Recent Activity is a joined audit timeline over `cash_drawer_movements` and its
domain references. Each entry shows time, operation type, amount, direction,
counter, cashier, human reference, workflow status, approver/receiver, and
view/print action.

Patient details are minimized. A user sees patient-linked payout detail only
when their role already permits that commission/billing record.

## Error Handling

- Missing or wrong-workstation active counter returns a clear action message.
- Insufficient drawer cash returns the current available amount without writing
  partial state.
- Stale selection or duplicate payout returns `409` and refreshes the payable
  list.
- Closed accounting periods block the operation before finalization.
- Duplicate idempotency keys return the completed result or a bounded in-flight
  conflict.
- Invalid receiver, destination, amount, or state transition returns `400` or
  `409` without a ledger write.
- Failed accounting posting remains observable and retryable under its existing
  deterministic event key; retries never duplicate cash operations.
- Attachment failure cannot leave an unreferenced sensitive upload. Attachment
  keys are stored only after validation and tenant-scoped authorization.

## Local Server and Migration Rules

Every schema change uses a numbered D1/SQLite-compatible migration and updates
`tenant-schema.sql` for fresh local installations. No new patient payload is
added to sync ledgers. If cash-operation records later participate in local to
cloud sync, immutable outbox metadata and an audited mapper are required before
enabling it.

## Testing

Backend integration tests cover:

1. payout filters and source/date breakdowns;
2. cashier-only active-counter payout execution;
3. one atomic settlement, item snapshot, accrual update, drawer movement, and
   accounting event;
4. duplicate click, stale accrual, insufficient cash, and closed-period rollback;
5. settlement-item uniqueness;
6. payout adjustments and net amount validation;
7. monitoring roles cannot create drawer movements;
8. small expense immediate execution;
9. large expense request, approval without movement, and cashier execution;
10. transfer initiation, partial/disputed receipt, acceptance, rejection, and
    return/resolution;
11. bank-deposit custody and resolution reuse;
12. handover close, variance approval, and receiver acceptance; and
13. unified paid/pending totals across reception, Commission Management, admin,
    cash book, accounting, and audit reads.

Frontend tests cover route/navigation changes, dashboard-panel removal, filters,
group and item selection, sticky payout summary, confirmation, receipt printing,
role-based action visibility, responsive behavior, translated labels, recent
activity, and query refresh after each mutation.

Verification includes focused route and page tests, migration/schema validation,
web typecheck/build, worker build, `git diff --check`, and a production migration
status check before deployment.

## Delivery Boundaries

Implementation includes the page, payout hardening, unified monitoring reads,
expense approval/execution correction, transfer/acceptance presentation, recent
activity, migrations, fresh-local schema, tests, and dashboard/handover cleanup.

Implementation does not add online banking integration, automatic image OCR,
cash denomination counting, or unrestricted manual ledger adjustment.

Production deployment and hospital local-server rollout are separate explicit
steps after implementation and verification.
