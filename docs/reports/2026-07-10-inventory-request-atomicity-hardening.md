# Inventory Request Atomicity Hardening Report

Date: 2026-07-10
Branch: `fix/inventory-request-saga-hardening`

## Executive result

The canonical inventory issue workflow has been hardened from per-allocation atomicity to request-level atomicity.

A single issue request now commits its header, every stock deduction, issue line, stock ledger entry, audit entry, provisional billing line and inventory demand event in one D1 batch transaction. If any stock snapshot is stale or any later write fails, the entire request rolls back.

The implementation also adds operation-level idempotency, replay recovery, deterministic keys for automated workflows and administrator diagnostics for historical partial records.

The existing lab reagent `soft` mode was not redesigned or re-enabled by this work. It already existed as the default policy. Soft mode continues to attempt reagent usage and record exceptions without blocking billing or result completion when stock or mapping is missing.

## Review findings addressed

### Previous structural risk

Migration 0400 made each stock allocation internally atomic, but a request containing multiple allocations could still commit early allocations before a later allocation conflict. The consumption header and provisional billing lines were also outside one all-or-nothing request transaction.

### Selected solution

The final design uses one request-level D1 `batch()` transaction rather than a compensation-first saga for new requests.

A guarded stock update is immediately followed by an insert into `inventory_issue_batch_guard` using SQLite `changes()`. The guard table has `CHECK(assertion_value = 1)`. A zero-row stock update therefore raises a database error, and D1 rolls back every statement in the request batch.

This gives stronger guarantees than allowing a partial request and compensating later.

## Implemented changes

### 1. Additive migration 0401

Added:

`migrations/0401_inventory_issue_request_atomicity.sql`

It creates:

- `inventory_issue_operation` for idempotency, status, replay data and retry attempts;
- `inventory_issue_batch_guard` for transaction assertions;
- `InventoryConsumption.OperationKey`;
- `InventoryConsumption.OperationStatus`;
- `InventoryConsumptionItem.OperationAllocationKey`;
- tenant/request and allocation uniqueness indexes.

The migration is tested both as a source contract and by applying the SQL to a real in-memory SQLite schema. The guard constraint is also verified to reject assertion value zero.

### 2. Request-level atomic commit

Created:

`src/lib/inventory-issue-atomic.ts`

The request batch contains:

1. Inventory consumption header in `processing` state.
2. Conditional stock update for every resolved lot.
3. Rollback assertion after each stock update.
4. Consumption item with deterministic allocation key.
5. Stock transaction ledger row.
6. Inventory audit row.
7. Optional provisional patient billing row and line linkage.
8. Idempotent demand source event.
9. Daily demand aggregate rebuild.
10. Header totals, billing status and completed operation state.
11. Guard cleanup.

Real SQLite transaction tests prove that:

- a successful multi-item request writes every expected record;
- a stale second stock allocation rolls back the first allocation and the complete request;
- a provisional billing constraint failure rolls back stock, header, lines, ledger and audit.

### 3. Operation journal and replay recovery

Created:

`src/lib/inventory-issue-operation.ts`

Supported lifecycle:

- `pending`;
- `processing`;
- `completed`;
- `failed`;
- `recovered`.

Behavior:

- same key and same payload returns the original response;
- same key with a different payload returns HTTP 409;
- failed operation can retry with the same payload;
- active duplicate request returns HTTP 409;
- if the core request committed but journal completion failed, a later retry reconstructs the response from `InventoryConsumption.OperationKey` and marks the operation recovered.

Every journal query is tenant scoped.

### 4. Inventory issue API idempotency

`POST /api/inventory/issues` now accepts:

- `Idempotency-Key` request header; or
- `IdempotencyKey` in the JSON body.

A new request returns HTTP 201. A replay returns HTTP 200 with `replayed: true`.

The response includes:

- `OperationKey`;
- `ConsumptionId`;
- `IssueNo`;
- totals;
- billing line count;
- replay status.

When no key is supplied, the server creates a UUID for backward compatibility.

### 5. Existing Inventory Issue UI retry safety

The Inventory Issue page now generates an operation key before submit.

- Retrying an unchanged form reuses the same key.
- Changing the form payload generates a new key.
- A successful request clears the stored submission identity.
- A failed/network-interrupted request retains the key so the next submit replays or resumes safely.

This closes the gap where backend idempotency existed but the normal UI did not provide a reusable key.

### 6. Lab, OT and automated workflow replay safety

Canonical reagent deductions use deterministic keys containing:

- tenant;
- lab order item;
- inventory item;
- stock lot;
- normalized quantity.

Manual Lab and OT adapter endpoints propagate caller-provided `Idempotency-Key` or body `IdempotencyKey`.

Automated consumption-event posting uses:

`consumption-event:<tenant>:<event-id>`

This covers the canonical issue entry points currently present in the system.

### 7. Operational diagnostics

Added manager-only endpoints:

- `GET /api/inventory/issue-operations`
- `GET /api/inventory/issue-operations/diagnostics`

Allowed roles:

- `hospital_admin`;
- `director`.

Receptionists are denied.

Diagnostics classify:

- `header_without_lines`;
- `header_total_mismatch`;
- `missing_stock_transaction`;
- `missing_provisional_billing`;
- `stale_processing_operation`.

The diagnostics are read-only. Historical stock is not automatically reversed or modified.

### 8. Request capacity safety

The final limits are:

- 50 input items;
- 75 resolved stock allocations.

The worst-case atomic batch remains below the D1 query ceiling with margin for validation, journal, accounting and framework queries. Larger workflows must be split into separately keyed requests.

### 9. Post-commit projections

Accounting posting and inventory intelligence recompute remain outside the core transaction because they are repairable projections.

A failure in these projections is logged but does not report the already committed stock request as failed. Accounting event creation remains source-ID based and can be retried.

## Soft mode clarification

Soft mode predates this hardening.

Current meaning:

- reagent consumption is attempted at the configured timing;
- shortages and missing mappings produce exceptions/reconciliation records;
- billing or lab result completion is not blocked;
- `allow_result_without_stock = true`;
- `require_test_mapping_for_completion = false`.

This hardening changes stock transaction consistency and retry behavior. It does not make soft mode strict and does not change tenant policy values.

## Verification evidence

### Migration manifest

Command:

```bash
pnpm build:migrations
```

Result:

- exit code 0;
- 413 migrations written to the generated manifest.

### TypeScript

Command:

```bash
pnpm exec tsc --noEmit
```

Result: exit code 0, no TypeScript errors.

### Inventory and reagent regression

Command:

```bash
pnpm test:inventory
```

Result:

- backend inventory/reagent: 74 files, 523 tests passed;
- frontend inventory: 31 files, 142 tests passed;
- total: 105 files, 665 tests passed;
- failures: 0.

### Production web build

Command:

```bash
pnpm --filter web build
```

Result: exit code 0; TypeScript, Vite and PWA generation passed.

## Deployment order

1. Merge and push the reviewed branch.
2. Take a production D1 backup.
3. Apply migration `0401_inventory_issue_request_atomicity.sql`.
4. Verify journal/guard tables and new columns/indexes.
5. Verify all active tenants remain in soft reagent mode.
6. Deploy API and web code together.
7. Monitor failed/stale issue operations and run the diagnostics endpoint.

## Remaining limitations

- Server-generated keys protect a completed response only when the caller retains the returned key. The main UI and automated internal entry points now provide reusable keys, but any future external client should also send its own idempotency key.
- Accounting and intelligence are post-commit projections, not part of the stock transaction. They are designed to be retried rather than rolling back committed stock.
- Historical partial requests are detected but not automatically repaired or reversed. Any destructive recovery should require explicit administrator review.
- The legacy per-allocation movement service remains available for compatibility, but the canonical issue request path no longer uses it.

## Go-live assessment

This hardening removes the previously identified whole-request partial-commit risk for canonical inventory issues. It is suitable for soft-mode hospital rollout after migration 0401 and code deployment. Strict reagent mode should still be enabled tenant-by-tenant only after reagent readiness and reconciliation are clean.
