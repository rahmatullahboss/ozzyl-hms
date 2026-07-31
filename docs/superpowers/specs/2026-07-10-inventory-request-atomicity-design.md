# Inventory Request Atomicity and Idempotency Design

Date: 2026-07-10
Branch: `fix/inventory-request-saga-hardening`

## Context

The existing inventory integrity hardening makes each stock allocation atomic. However, `createInventoryIssue()` still creates the request header first and commits allocations one at a time. If allocation 1 succeeds and allocation 2 encounters a concurrent stock change, the request can remain partially committed. Provisional billing and header finalization also occur after each allocation and are not part of one request-level transaction.

The lab reagent policy is a separate concern. `soft` mode already existed as the default policy. It means reagent consumption is attempted and exceptions are recorded, but missing mapping or stock does not block billing/result completion. This design does not change that policy.

## Goals

1. Make the canonical inventory issue core all-or-nothing at request level.
2. Prevent duplicate issues when clients or internal automations retry.
3. Return the original response for a completed retry.
4. Detect reuse of an idempotency key with a different payload.
5. Preserve existing inventory issue API behavior for callers that do not provide an idempotency key.
6. Keep accounting posting and intelligence recompute repairable and outside the critical transaction.
7. Provide operational visibility for pending, completed, failed and recovered requests.

## Considered approaches

### Per-allocation resumable saga

Each allocation commits independently and a journal resumes missing allocations. This is compatible with the current implementation but still exposes temporary partial requests and requires compensation rules for stock, billing and reports.

### Request-level atomic D1 batch — selected

Validate the full request first, then execute header, every allocation, stock ledger, audit and provisional billing in one D1 batch transaction. A guard statement with a database `CHECK` constraint converts any conditional stock update that affects zero rows into a transaction error. D1 rolls back the full batch.

This is simpler and stronger than compensation for newly created requests.

### Durable Object serialization

A Durable Object could serialize writes per store. It would reduce conflicts but add coordination latency and would not by itself make billing/header/ledger atomic. It is unnecessary for current traffic after guarded D1 transactions are implemented.

## Architecture

### 1. Operation journal

Add `inventory_issue_operation`:

- `operation_id`
- `tenant_id`
- `idempotency_key`
- `request_hash`
- `status`: `pending`, `processing`, `completed`, `failed`, `recovered`
- `consumption_id`
- `issue_no`
- `response_json`
- `last_error`
- `attempt_no`
- `created_by`
- timestamps

Unique key: `(tenant_id, idempotency_key)`.

The journal is reserved before the core transaction. A failed core transaction leaves only a failed journal row; no stock/header/billing records remain.

### 2. Canonical request identity

Add to `InventoryConsumption`:

- `OperationKey TEXT`
- `OperationStatus TEXT NOT NULL DEFAULT 'completed'`

Create unique index `(tenant_id, OperationKey)` for non-null operation keys.

Add to `InventoryConsumptionItem`:

- `OperationAllocationKey TEXT`

Create unique index `(ConsumptionId, OperationAllocationKey)` for non-null allocation keys.

These keys let every statement reference generated integer IDs through deterministic subqueries without relying on application-visible `last_insert_rowid()` across the whole request.

### 3. Transaction guard

Add `inventory_issue_batch_guard` with:

- operation key
- step key
- `assertion_value INTEGER CHECK(assertion_value = 1)`

After each guarded stock update, the batch inserts `changes()` into the guard table. If a concurrent change causes the update to affect zero rows, the check constraint fails and D1 rolls back every statement in the request batch.

Guard rows are deleted at the end of the successful batch.

### 4. Atomic request batch

The critical batch contains:

1. Insert `InventoryConsumption` header with operation key and `processing` status.
2. For every validated FEFO allocation:
   - guarded `InventoryStock` deduction;
   - assertion guard;
   - `InventoryConsumptionItem` insert;
   - `InventoryStockTransaction` insert;
   - `InventoryAuditLog` insert;
   - optional `billing_provisional_items` insert;
   - link provisional billing ID back to the consumption item;
   - idempotent inventory demand source event insert.
3. Rebuild affected daily demand totals using source events.
4. Finalize header totals, billing status and `completed` operation status.
5. Delete guard rows.

If any statement errors, D1 rolls back the full batch.

### 5. Idempotency behavior

The API accepts `Idempotency-Key` header or optional body `IdempotencyKey`.

- Same key + same request + completed operation: return original/reconstructed result without new writes.
- Same key + different request: HTTP 409.
- Same key + active processing operation: HTTP 409.
- Same key + failed operation: increment attempt and retry.
- No key: generate a server operation key and return it. This preserves compatibility but clients only receive replay protection after retaining the returned key.

Internal lab reagent consumption supplies a deterministic key based on tenant, lab order item, inventory item and requested quantity.

### 6. Post-commit projections

Accounting posting event creation and inventory intelligence recompute remain after the core transaction because they are repairable projections/outbox work. Accounting event creation must be idempotent by source type/source ID. Failure is logged without invalidating committed stock.

### 7. Legacy recovery

New requests cannot partially commit. Existing historical partial headers may remain. Add a manager-only diagnostics endpoint/report that classifies:

- header without lines;
- header total mismatch;
- line without stock transaction;
- chargeable line without provisional billing;
- processing operation older than the stale threshold.

Recovery is conservative: it repairs missing projections when source-of-truth stock deduction and consumption line are already present. It does not automatically reverse historical stock without explicit manager action.

## Error handling

- Validation failure occurs before journal reservation where possible.
- Concurrent stock change causes full core rollback and operation status `failed`.
- Journal completion failure after a successful core batch is repaired by looking up `InventoryConsumption.OperationKey` and reconstructing the response.
- Accounting or intelligence projection failure is logged and retried independently.

## Limits

A request is limited to 50 input items and 75 resolved allocations. This keeps the worst-case request-level batch and its validation/journal queries safely below Cloudflare D1's per-invocation query ceiling, while preserving margin for accounting and framework queries. Larger workflows must split into multiple explicitly keyed requests.

## Testing

1. Same idempotency key returns the same result and deducts stock once.
2. Different payload with the same key returns 409.
3. Second allocation concurrency failure rolls back the first allocation, header, ledger, audit and billing.
4. Billing insert failure rolls back stock and all lines.
5. Completed core batch with journal completion failure is replayed and repaired.
6. Failed operation can retry with the same payload.
7. Server-generated operation key is returned when no key is supplied.
8. Deterministic lab key prevents duplicate canonical reagent deduction.
9. Tenant isolation is enforced on every operation query.
10. Existing soft/strict reagent policy tests remain unchanged.

## Rollout

1. Apply additive migration.
2. Deploy code with soft reagent mode unchanged.
3. Monitor failed and stale inventory operations.
4. Run legacy consistency diagnostics.
5. Keep strict reagent mode disabled until tenant readiness and reconciliation are clean.
