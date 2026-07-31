# Reception Bank Deposit Custody Design

## Goal

Add an auditable two-step flow for moving physical cash from an active reception
counter into a hospital bank account:

1. Reception removes cash from the drawer and submits it to finance custody.
2. An accountant or hospital administrator confirms the physical bank deposit.

The workflow must keep counter cash, finance custody, the bank book, and the
accounting ledger consistent without treating a handwritten `Cash Out` reason as
a real bank deposit.

## Scope

This design includes:

- reception deposit requests from an active billing-counter session;
- finance approval and rejection;
- custody reconciliation for rejected requests;
- bank-book transactions;
- accounting posting events;
- audit history;
- reception and finance user interfaces;
- cloud and fresh local-server schema support.

This design does not add:

- arbitrary supplier cheque issuance;
- online banking API integration;
- bank-statement import;
- attachment upload for deposit-slip images;
- local-to-cloud synchronization of finance custody records.

The existing patient payment methods (`bank`, `bank_transfer`, `cheque`, card,
and mobile banking) remain unchanged.

## Roles

### Reception and Receptionist

- Create a bank-deposit request from their own active counter session.
- View requests created from their counter sessions.
- Cannot approve, reject, or reconcile requests.

### Accountant

- View all deposit requests for the tenant.
- Confirm a pending or rejected deposit after physical bank verification.
- Reject a pending request with a required reason.
- Reconcile rejected custody by returning it to an active counter or recording
  an approved manual adjustment.

### Hospital Admin, MD, and Director

- Have the same finance controls as an accountant.
- Can inspect the complete custody and audit history.

Managers may read the Bank Book but cannot change deposit-request status.

## Source Of Truth

The new `bank_deposit_requests` table is the workflow source of truth.

- `cash_drawer_movements` remains the source of truth for drawer cash.
- `bank_transactions` remains the source of truth for Bank Book movements.
- `accounting_posting_events` and generated vouchers remain the accounting
  source of truth.

A Bank Book deposit must never be inferred only from a `cash_drop` movement.

## Data Model

### `bank_deposit_requests`

Add a numbered migration and the equivalent fresh-install table definition to
`tenant-schema.sql`.

Fields:

| Field | Purpose |
| --- | --- |
| `id` | Primary key |
| `tenant_id` | Tenant boundary |
| `request_no` | Human-readable tenant-scoped reference |
| `counter_session_id` | Source billing-counter session |
| `counter_id` | Source counter |
| `requested_by` | Reception user |
| `requested_amount` | Cash placed into finance custody |
| `proposed_bank_name` | Optional reception-entered destination |
| `request_note` | Optional operational note |
| `status` | `pending`, `approved`, `rejected`, or `resolved` |
| `idempotency_key` | Duplicate-request protection |
| `cash_movement_id` | Linked drawer `cash_drop` row |
| `bank_transaction_id` | Linked Bank Book row after deposit |
| `confirmed_bank_name` | Finance-confirmed bank |
| `confirmed_reference_no` | Deposit slip/reference number |
| `confirmed_date` | Actual bank deposit date |
| `confirmed_by` | Finance user |
| `confirmed_at` | Confirmation timestamp |
| `rejection_reason` | Required rejection reason |
| `rejected_by` | Finance user |
| `rejected_at` | Rejection timestamp |
| `resolution_type` | `deposited`, `returned_to_counter`, or `manual_adjustment` |
| `resolution_note` | Required reconciliation explanation |
| `resolved_by` | Finance user |
| `resolved_at` | Resolution timestamp |
| `created_at`, `updated_at` | Audit timestamps |

Constraints and indexes:

- unique `(tenant_id, request_no)`;
- unique `(tenant_id, idempotency_key)`;
- indexes for tenant/status/date, counter session, and requester;
- positive `requested_amount`;
- state and resolution type checks.

### `bank_transactions`

Add:

- `bank_deposit_request_id`, nullable FK to `bank_deposit_requests`;
- a unique partial index for non-null `(tenant_id, bank_deposit_request_id)`.

This prevents the same custody request from creating two Bank Book deposits.

### Accounting event types

Add two posting event types:

- `bank_deposit_custody`: debit `admin_cash`, credit `cash`;
- `bank_deposit_confirmed`: debit `bank`, credit `admin_cash`.

Returning rejected custody to a counter uses a manual journal event that debits
`cash` and credits `admin_cash`. Manual adjustment resolution also uses a
finance-authored balanced manual journal.

Accounting event keys are deterministic and unique per request and transition.
Posting failure must leave an immutable pending/failed accounting event that can
be retried by the existing posting engine.

## Workflow

### 1. Reception creates request

Endpoint:

`POST /api/billing-counter/sessions/:id/bank-deposit-requests`

Payload:

```json
{
  "amount": 25000,
  "proposedBankName": "DBBL",
  "note": "Morning collection",
  "idempotencyKey": "uuid"
}
```

Validation:

- caller owns the active session on the current workstation;
- amount is positive and no greater than expected drawer cash;
- idempotency key is valid;
- note and bank label have bounded lengths.

One database batch:

1. Insert the request as `pending`.
2. Insert a linked `cash_drop` movement.
3. Increase the session `cash_drop_total`.
4. Insert the deterministic `bank_deposit_custody` posting event.

The response returns request number, amount, and remaining drawer cash.

The request removes the cash from the drawer immediately. Counter closing remains
allowed because the cash is already represented in finance custody.

### 2. Finance confirms deposit

Endpoint:

`POST /api/bank-book/deposit-requests/:id/confirm`

Payload:

```json
{
  "bankName": "DBBL Gulshan Branch",
  "referenceNo": "SLIP-2026-00125",
  "depositDate": "2026-06-11",
  "confirmedAmount": 25000
}
```

Rules:

- only finance roles may confirm;
- status must be `pending` or `rejected`;
- confirmed amount must exactly equal requested amount;
- bank, reference, and date are required;
- a request may be confirmed only once.

One database batch:

1. Insert one `bank_transactions` row with type `deposit`.
2. Update the request to `approved`, link the Bank Book row, and store confirmation
   metadata.
3. Insert the deterministic `bank_deposit_confirmed` posting event.

If a uniqueness or state guard fails, the entire batch fails.

### 3. Finance rejects request

Endpoint:

`POST /api/bank-book/deposit-requests/:id/reject`

Payload:

```json
{
  "reason": "Deposit slip amount does not match custody amount"
}
```

Rules:

- only a `pending` request can be rejected;
- reason is required;
- no drawer movement, Bank Book row, or reversing accounting event is created.

The cash remains in `admin_cash` finance custody.

### 4. Rejected custody reconciliation

#### Deposit after correction

The normal confirm endpoint accepts a `rejected` request. Confirmation moves the
full custody amount from `admin_cash` to `bank` and records resolution type
`deposited`.

#### Return to an active counter

Endpoint:

`POST /api/bank-book/deposit-requests/:id/return-to-counter`

Payload:

```json
{
  "targetCounterSessionId": 44,
  "note": "Bank closed; returned to evening counter"
}
```

Rules:

- request must be `rejected`;
- target session must be active;
- target session must belong to the same tenant;
- note is required.

One batch adds a linked `cash_in` movement to the target drawer, marks the request
`resolved` with `returned_to_counter`, and inserts a balanced manual accounting
event from `admin_cash` to `cash`.

#### Manual adjustment

Endpoint:

`POST /api/bank-book/deposit-requests/:id/manual-adjustment`

Payload contains a required note and balanced debit/credit lines using existing
tenant account IDs. Only hospital admin, MD, director, or accountant roles may
perform this action. The request is marked `resolved` with
`manual_adjustment`, and the existing manual-journal posting engine is used.

## Read APIs

### Reception

`GET /api/billing-counter/bank-deposit-requests?mine=true`

Returns the caller's recent requests with status, amount, bank, reference,
rejection reason, and timestamps.

### Finance

`GET /api/bank-book/deposit-requests?status=pending|rejected|approved|resolved`

Supports date range and status filters. Each row includes source counter,
cashier, amount, age, bank information, and reconciliation state.

The existing Bank Book summary and transactions endpoints continue to report
only confirmed `bank_transactions`. Pending or rejected custody is displayed
separately and does not inflate bank balance.

## User Interface

### Reception billing counter

Add a `Bank Deposit Request` control beside existing counter cash controls.

The compact form contains:

- amount;
- proposed bank;
- note;
- submit action.

The form displays expected drawer cash and prevents a larger amount. A recent
request list shows `Pending`, `Deposited`, `Rejected`, or `Resolved`.

This stays inside the existing billing-counter workflow rather than adding a
separate reception page.

### Finance Cash & Bank Book

Wire the existing `CashBankBook` page into application routes and finance/admin
navigation.

Add a `Deposit Requests` section to the Bank Book tab:

- pending queue with confirm and reject actions;
- rejected custody queue with confirm, return-to-counter, and manual-adjustment
  actions;
- approved and resolved history.

Reception does not receive direct access to the finance Bank Book API.

## Audit And Security

- Every create, confirm, reject, and resolve transition creates an audit log.
- Audit values include IDs, amount, status, bank label, and reference number.
- Notes are bounded and no patient data is stored.
- Tenant filters are mandatory on every read and write.
- Finance mutations use explicit route-level role guards.
- Secrets and bank credentials are never stored; this workflow stores operational
  bank labels and deposit references only.

## Local Server Behavior

The migration and `tenant-schema.sql` create the tables and columns for fresh and
upgraded local installations.

No sensitive payload is added to `local_sync_outbox` in this release. Deposit
custody remains authoritative in the database where it was performed until an
audited finance synchronization mapper is designed. Cloud and local deployments
therefore each support the workflow independently.

## Error Handling

- Duplicate idempotency key returns the original request.
- Insufficient drawer cash returns `400`.
- Missing active session or wrong workstation returns `404`.
- Invalid state transition returns `409`.
- Duplicate bank confirmation returns `409`.
- Missing accounting mapping leaves the posting event failed/pending and exposes
  the failure to finance monitoring; it must not duplicate the operational bank
  transaction on retry.

## Testing

Backend integration tests cover:

- reception can create a request from its own active counter;
- request and cash drop are written together;
- insufficient cash is rejected;
- idempotent retry does not double-drop cash;
- non-finance users cannot confirm/reject/reconcile;
- confirmation creates one Bank Book deposit and two-step accounting events;
- repeated confirmation is rejected;
- rejection leaves custody untouched;
- rejected custody can be returned only to an active same-tenant counter;
- rejected custody can later be deposited;
- Bank Book totals exclude pending and rejected requests.

Frontend tests cover:

- reception request form validation and successful status refresh;
- finance pending queue rendering;
- confirmation metadata requirements;
- rejection reason requirement;
- reconciliation actions;
- route and navigation wiring.

Verification includes:

```bash
pnpm vitest run test/integration/routes/billing-counter.test.ts test/integration/routes/cash-book.test.ts
pnpm --dir web exec vitest run src/pages/BillingCounterPage.test.tsx src/pages/__tests__/CashBankBook.test.tsx
pnpm --dir web exec tsc --noEmit --pretty false
pnpm build
git diff --check
```

## Deployment

1. Apply the numbered migration to production D1.
2. Build and deploy with:

```bash
pnpm build && wrangler deploy --env production
```

3. For the hospital local server, copy the committed revision to `/opt/hms`,
   apply versioned migrations, rebuild the Docker stack, and verify local status.

Deployment is performed only when explicitly requested after implementation.
