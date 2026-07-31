# Reception Integrity & D1 Performance Review

**Date:** 2026-07-11
**Branch:** `codex/reception-integrity-review`
**Scope:** Reception, appointment, direct billing, billing counter, payment gateway, patient deposits/advance, due collection, billing reports, and D1 read/write hot paths.

## Executive summary

The review found several high-risk transaction-boundary and retry problems, plus significant D1 read amplification from polling and N+1 query patterns. The implemented changes make the principal reception financial mutations replay-safe, move related financial rows into atomic D1 batches, reduce sequential database round-trips, and add composite indexes matching the hot queries.

The largest D1 read multiplier was not a single reception query. It was multiple dashboard widgets polling multiple endpoints every 30 seconds in each open tab. A page polling 4–8 endpoints every 30 seconds produces approximately **11,520–23,040 API requests per day per open tab**, before counting the SQL statements and rows scanned inside each request.

No production D1 Query Insights or billing metrics were available in the local workspace, so this document does not claim an observed production read reduction. The estimates below are based on the polling/query structure in the code. Production verification should compare D1 `rows_read`, `rows_written`, query latency, and top query signatures before and after deployment.

## Critical and high findings fixed

### 1. Reception quick-admit accepted an idempotency key but did not use it

**Risk:** Network retries or double-clicks could create duplicate emergency patients and visits.

**Fix:** Added request hashing, replay detection, reservation, completion, and failed-state handling in `src/routes/tenant/reception.ts`.

### 2. Service, bulk service, lab, and procedure mutations were not retry-safe

**Risk:** A client retry could duplicate pending charges, lab orders, or procedure orders.

**Fixes:**

- Added optional idempotency keys to these mutation schemas.
- Added replay/reserve/complete/fail handling.
- Rejected duplicate service/lab identifiers.
- Rejected discounts greater than the line gross amount.
- Changed multi-row writes to D1 batches.
- Missing catalog items now fail explicitly instead of being silently skipped.

### 3. Concurrent visit bill generation could leave orphan bills/invoice items

**Previous flow:** Create bill first, then try to claim pending visit services. A losing concurrent request could return `409` after its bill already existed.

**Fix:** Pending services are temporarily claimed and the bill, invoice items, service links, lab links, and discount allocations are finalized in one D1 batch. A request that cannot claim every selected service creates no bill.

### 4. Bill-level and line-level discounts could exceed the gross/subtotal

**Risk:** Negative economic value, inconsistent due totals, and invalid discount allocation.

**Fix:** Added cent-safe proportional allocation in `src/lib/reception-billing-integrity.ts`, exact remainder handling, and hard rejection when discount exceeds gross/subtotal.

### 5. Direct bill payment had a partial-write boundary

**Previous flow:** Bill paid/due was updated first; payment receipt, income, and employee cash were inserted in a later batch.

**Risk:** If the second step failed, the bill could show paid money without a receipt/payment row.

**Fix:** `src/routes/tenant/billing.ts` now performs the guarded payment insert, bill balance update, income allocation, and cashier cash transaction in one D1 batch. Accounting posting, audit, and diagnostic-paid propagation run after the core commit and no longer block the response.

### 6. Appointment creation could leave an appointment without its provisional charge

**Risk:** Appointment insert succeeded but provisional consultation setup failed, leaving an orphan appointment and an inconsistent billing handoff.

**Fix:** Appointment creation now supports idempotency and compensates by deleting the newly inserted appointment if provisional billing setup fails.

### 7. Appointment Pay Now could leave an orphan bill and was slow

**Previous flow:** Bill header was inserted separately; invoice items, payment, cash, provisional finalization, and appointment status were written later. Accounting, commission, scheme usage, shadow cash, queue, and audit were awaited before response.

**Fix:** Bill, invoice items, payment, employee cash, provisional item finalization, appointment billing status, and discount allocation now share one core D1 batch. Accounting/commission/scheme/shadow/audit work is isolated as post-commit work. Doctor queue creation failure no longer makes a successful payment look failed.

### 8. Deposit collection/refund could be duplicated after a post-commit failure

**Previous flow:** Deposit/refund committed, then shadow/audit work ran, and only afterwards was the idempotency record completed. A shadow failure caused the key to be marked failed and a retry could create another transaction.

**Fix:** Core commit is tracked; the key is completed before best-effort shadow work, and a committed mutation is never changed to failed.

### 9. Deposit adjustment did not verify patient–bill ownership and was split across writes

**Risk:** One patient's advance could be applied to another patient's bill. Concurrent adjustments could also split the advance deduction and bill update.

**Fix:** The bill patient must match the deposit patient. Advance availability, current bill due, adjustment insert, bill update, accounting event, and audit row are handled in one D1 batch.

### 10. Payment gateway `verifying` status violated the database CHECK constraint

**Risk:** The verification lock update could fail in real SQLite/D1 because the original table allowed only `pending`, `success`, `failed`, and `cancelled`.

**Fix:** Migration `0414_payment_gateway_verifying_status.sql` rebuilds the table with `verifying` allowed. A failed financial posting batch releases the verification lock back to `pending` for safe retry.

### 11. Billing-counter invoice could be duplicated after post-commit failure

**Previous flow:** The invoice committed, then lab/reagent/accounting/commission/shadow work ran. A later failure marked the reserved idempotency key failed.

**Fixes:**

- Added an explicit core-committed boundary.
- A committed invoice is never marked failed.
- Discount allocations are part of the core invoice batch.
- Lab/reagent follow-up errors become review warnings instead of converting a committed invoice into an API failure.
- Idempotency completion happens before heavy post-commit accounting/commission/shadow work.

## D1 read/write optimization implemented

### N+1 catalog reads removed

- Reception bulk services now load all selected service items using one `IN (...)` query.
- Reception lab tests now use `resolveLabTestBillingRows()` to resolve all selected tests with one query instead of one joined query per test.

For 10 selected items, this changes the catalog lookup from approximately 10 database round-trips to 1.

### Sequential lab writes reduced

Billing-counter lab order creation previously inserted the order, inserted every test item one at a time, and then updated the order. It now batches the order, all test items, and order billing status in one transaction, followed by one order lookup and one item-list query.

### Financial write batches consolidated

The following are now atomic core batches:

- Reception visit-service bill generation.
- Direct payment receipt + bill balance + income + cashier cash.
- Appointment Pay Now bill + items + payment + cash + appointment/provisional states.
- Deposit adjustment + bill update + accounting event + audit.
- Billing-counter invoice financial rows and discount allocations.

This reduces both latency and partial-write recovery work.

### Polling/read amplification reduced

- Global `useApiQuery` minimum polling interval changed from 30 seconds to 60 seconds. This halves requests from queries configured at 30 seconds.
- Current-user workspace/access polling changed from 30 seconds to 5 minutes and now has a 60-second stale window.
  - 30-second polling: about **2,880 requests/day/tab**.
  - 5-minute polling: about **288 requests/day/tab**.
  - Estimated request reduction for this endpoint: **90%**.
- `Header.tsx` no longer performs a duplicate direct workspace fetch; it reuses the React Query cache.
- Background-tab query polling remains disabled.

### Composite hot-path indexes added

Migration `0415_reception_billing_performance_indexes.sql` adds indexes for:

- Payment bill/receipt lookup and daily receiver reports.
- Patient advance balance and bill-specific adjustments.
- Pending/recent bills.
- Appointment billing queues by date/status.
- Appointment provisional billing items.
- Visit pending/billed services.
- Lab order item retrieval.

## Report consistency fixes

Reception daily bill breakdowns now use the Bangladesh-local report date expression rather than raw `date(created_at)`, preventing UTC/day-boundary mismatch between summary cards and breakdowns.

## Expected operational effect

The changes should reduce click-to-payment latency by removing several sequential round-trips from the response path and should materially reduce D1 requests caused by polling. Exact production improvement depends on tenant activity, number of open dashboard tabs, row counts, and D1 query plans.

After deployment, compare these metrics for at least 24–72 hours:

1. D1 total `rows_read` and `rows_written` per database.
2. Top queries by `rows_read` and execution count.
3. p50/p95 latency for:
   - `POST /api/billing/pay`
   - `POST /api/billing-counter/invoices`
   - `POST /api/appointments/:id/pay-now`
   - reception lab/bulk service endpoints.
4. Number of `pending` or `failed` idempotency records older than 10 minutes.
5. Number of post-commit warning/error logs for accounting, lab order, reagent, shadow ledger, and commission work.

## Remaining medium-risk improvements

These are not blockers for this branch but should be planned:

- Consolidate multi-widget admin/control-room polling into one snapshot endpoint or server-pushed updates. The global 60-second floor reduces traffic but does not eliminate endpoint fan-out.
- Convert date-function report filters into explicit `[start, end)` timestamp ranges where possible; applying functions to timestamp columns can prevent index use.
- Put every required accounting/commission outbox event directly in the financial core batch. Current post-commit helpers are idempotent/best-effort, but a durable outbox written in the same transaction provides stronger guaranteed delivery.
- Add real D1/SQLite concurrency tests in addition to the current route mocks.
- Add a scheduled reconciliation job for committed bills missing lab orders, accounting events, cash shadow entries, or commission accruals.
- Review high-volume list endpoints for `SELECT *`, unbounded joins, and large count queries using production Query Insights rather than guessing from source alone.

## Migration/deployment order

1. Apply `0414_payment_gateway_verifying_status.sql`.
2. Apply `0415_reception_billing_performance_indexes.sql`.
3. Deploy backend and web changes together.
4. Monitor D1 Query Insights and post-commit error logs.
5. Run reconciliation reports before and after deployment.

## Verification completed

- Migration manifest generation: passed (`424` migrations generated).
- TypeScript: `pnpm exec tsc --noEmit` passed.
- Web production build: `pnpm --filter web build` passed.
- Final focused release suite: **14 test files, 290 tests passed**.
- Migration safety, payment gateway, deposit, reception, appointment, billing-counter, discount, and concurrency coverage passed.
- `git diff --check` passed.

The final commit should be treated as one reception/billing integrity and D1 hot-path hardening release, with the two migrations applied before traffic reaches the new code.
