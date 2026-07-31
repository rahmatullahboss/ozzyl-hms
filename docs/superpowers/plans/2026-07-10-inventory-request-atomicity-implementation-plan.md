# Inventory Request Atomicity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every canonical inventory issue request all-or-nothing, idempotent and replayable while preserving the existing reagent soft-mode policy.

**Architecture:** Reserve an inventory operation journal row, validate the full request, and commit header, all stock allocations, consumption lines, ledger, audit, provisional billing and demand events in one D1 batch. A database check constraint turns any zero-row guarded stock update into a batch error so D1 rolls back the whole request. Completed operations replay their original result; failed operations can retry with the same request hash.

**Tech Stack:** TypeScript, Hono, Zod, Cloudflare Workers, D1/SQLite, Vitest.

## Global Constraints

- Keep `InventoryStock` as the authoritative stock ledger.
- Preserve `lab_inventory_mode = soft`; this change must not make reagent shortages block result or billing workflows.
- Every new query must include tenant scope.
- No unrelated refactors.
- Maximum request size: 50 input items and 75 resolved allocations, preserving margin below Cloudflare D1's per-invocation query ceiling.
- Accounting posting and inventory intelligence recompute remain post-commit repairable projections.
- Use additive migration `0401`; do not modify migration `0400` already applied in production.

---

### Task 1: Add request identity, operation journal and transaction guard schema

**Files:**
- Create: `migrations/0401_inventory_issue_request_atomicity.sql`
- Create: `test/inventory-issue-request-atomicity-migration.test.ts`
- Modify: `tenant-schema.sql`

**Interfaces:**
- Produces table `inventory_issue_operation` with unique `(tenant_id, idempotency_key)`.
- Produces table `inventory_issue_batch_guard` with `CHECK(assertion_value = 1)`.
- Produces columns `InventoryConsumption.OperationKey`, `InventoryConsumption.OperationStatus`, and `InventoryConsumptionItem.OperationAllocationKey`.

- [ ] **Step 1: Write the failing migration contract test**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('migrations/0401_inventory_issue_request_atomicity.sql', 'utf8');

describe('inventory issue request atomicity migration', () => {
  it('adds operation journal, deterministic request keys and a rollback guard', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS inventory_issue_operation');
    expect(sql).toContain('UNIQUE (tenant_id, idempotency_key)');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS inventory_issue_batch_guard');
    expect(sql).toContain('CHECK(assertion_value = 1)');
    expect(sql).toContain('ALTER TABLE InventoryConsumption ADD COLUMN OperationKey TEXT');
    expect(sql).toContain("ALTER TABLE InventoryConsumption ADD COLUMN OperationStatus TEXT NOT NULL DEFAULT 'completed'");
    expect(sql).toContain('ALTER TABLE InventoryConsumptionItem ADD COLUMN OperationAllocationKey TEXT');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm exec vitest run test/inventory-issue-request-atomicity-migration.test.ts`
Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Write migration 0401**

```sql
CREATE TABLE IF NOT EXISTS inventory_issue_operation (
  operation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','processing','completed','failed','recovered')),
  consumption_id INTEGER,
  issue_no TEXT,
  response_json TEXT,
  last_error TEXT,
  attempt_no INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_inventory_issue_operation_status
  ON inventory_issue_operation(tenant_id, status, updated_at);

CREATE TABLE IF NOT EXISTS inventory_issue_batch_guard (
  tenant_id TEXT NOT NULL,
  operation_key TEXT NOT NULL,
  step_key TEXT NOT NULL,
  assertion_value INTEGER NOT NULL CHECK(assertion_value = 1),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, operation_key, step_key)
);

ALTER TABLE InventoryConsumption ADD COLUMN OperationKey TEXT;
ALTER TABLE InventoryConsumption ADD COLUMN OperationStatus TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE InventoryConsumptionItem ADD COLUMN OperationAllocationKey TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_consumption_operation_key
  ON InventoryConsumption(tenant_id, OperationKey)
  WHERE OperationKey IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_consumption_item_allocation_key
  ON InventoryConsumptionItem(ConsumptionId, OperationAllocationKey)
  WHERE OperationAllocationKey IS NOT NULL;
```

Mirror the same table/column/index definitions in `tenant-schema.sql` for fresh local installations.

- [ ] **Step 4: Run migration and inventory coverage tests**

Run: `pnpm exec vitest run test/inventory-issue-request-atomicity-migration.test.ts test/inventory-coverage-matrix.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add migrations/0401_inventory_issue_request_atomicity.sql tenant-schema.sql test/inventory-issue-request-atomicity-migration.test.ts
git commit -m "feat: add inventory issue operation schema"
```

### Task 2: Implement operation journal and replay service

**Files:**
- Create: `src/lib/inventory-issue-operation.ts`
- Create: `test/inventory-issue-operation.test.ts`

**Interfaces:**
- Produces `reserveInventoryIssueOperation(db, input): Promise<InventoryIssueOperationReservation>`.
- Produces `completeInventoryIssueOperation(db, input): Promise<void>`.
- Produces `failInventoryIssueOperation(db, input): Promise<void>`.
- Produces `loadInventoryIssueReplay(db, input): Promise<InventoryIssueReplay | null>`.

- [ ] **Step 1: Write failing journal tests**

Tests must assert:

```ts
await expect(reserveInventoryIssueOperation(db, {
  tenantId: 'tenant-a', idempotencyKey: 'issue-key-0001', requestHash: 'hash-a', createdBy: '7'
})).resolves.toEqual({ state: 'reserved', attemptNo: 1 });
```

```ts
await expect(reserveInventoryIssueOperation(db, {
  tenantId: 'tenant-a', idempotencyKey: 'issue-key-0001', requestHash: 'hash-b', createdBy: '7'
})).rejects.toMatchObject({ status: 409 });
```

```ts
await expect(loadInventoryIssueReplay(db, {
  tenantId: 'tenant-a', idempotencyKey: 'issue-key-0001', requestHash: 'hash-a'
})).resolves.toEqual({ responseBody: expectedResponse });
```

Also test failed-row retry increments `attempt_no`, resets `last_error`, and never reads another tenant's operation.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm exec vitest run test/inventory-issue-operation.test.ts`
Expected: FAIL because module/functions do not exist.

- [ ] **Step 3: Implement journal service**

Use exact public types:

```ts
export type InventoryIssueOperationReservation =
  | { state: 'reserved'; attemptNo: number }
  | { state: 'replay'; responseBody: Record<string, unknown> };

export async function reserveInventoryIssueOperation(
  db: D1Database,
  input: { tenantId: string; idempotencyKey: string; requestHash: string; createdBy: string },
): Promise<InventoryIssueOperationReservation>;
```

Behavior:

- `INSERT OR IGNORE` pending row.
- If inserted, return `reserved`.
- Existing request hash mismatch throws HTTP 409.
- Existing completed row with `response_json` returns replay.
- Existing completed row without response looks up `InventoryConsumption` by operation key and reconstructs response.
- Existing failed row is updated to `pending`, increments attempt and returns reserved.
- Existing pending/processing row throws HTTP 409.

- [ ] **Step 4: Run journal tests**

Run: `pnpm exec vitest run test/inventory-issue-operation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/inventory-issue-operation.ts test/inventory-issue-operation.test.ts
git commit -m "feat: add inventory issue operation journal"
```

### Task 3: Build and execute one atomic request batch

**Files:**
- Create: `src/lib/inventory-issue-atomic.ts`
- Create: `test/inventory-issue-atomic.test.ts`
- Modify: `test/integration/helpers/mock-db.ts`

**Interfaces:**
- Consumes validated issue header and allocations.
- Produces `commitAtomicInventoryIssue(input): Promise<AtomicInventoryIssueCommit>`.

```ts
export type AtomicInventoryIssueAllocation = {
  allocationKey: string;
  itemId: number;
  itemName: string;
  itemCategory: string;
  itemUnit: string | null;
  stock: InventoryIssueStockSnapshot;
  quantity: number;
  costPrice: number;
  unitCharge: number;
  lineCharge: number;
  isChargeable: boolean;
  remarks: string | null;
};

export type AtomicInventoryIssueCommit = {
  consumptionId: number;
  issueNo: string;
  totalCost: number;
  totalCharge: number;
  billedLines: number;
};
```

- [ ] **Step 1: Write failing statement-builder tests**

Verify the generated batch contains, in order:

1. header insert with `OperationKey`;
2. conditional stock update;
3. guard insert using `changes()`;
4. consumption item insert with `OperationAllocationKey`;
5. stock transaction;
6. audit log;
7. optional provisional billing and item link;
8. demand source event;
9. daily demand aggregate rebuild;
10. header finalization;
11. guard cleanup.

The test must assert every SQL statement contains `tenant_id = ?` or a tenant-scoped insert value where applicable.

- [ ] **Step 2: Write failing real-SQLite rollback tests**

Create a minimal in-memory SQLite schema and a D1-compatible batch adapter. Seed two stock rows. Configure the second guarded update to affect zero rows. Assert after rejection:

```ts
expect(stock1.AvailableQuantity).toBe(10);
expect(stock2.AvailableQuantity).toBe(10);
expect(consumptionCount).toBe(0);
expect(consumptionItemCount).toBe(0);
expect(transactionCount).toBe(0);
expect(auditCount).toBe(0);
expect(provisionalCount).toBe(0);
```

Add another test where provisional billing insert violates a constraint and assert the same full rollback.

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm exec vitest run test/inventory-issue-atomic.test.ts`
Expected: FAIL because atomic batch module does not exist.

- [ ] **Step 4: Implement atomic batch builder and executor**

Use `db.batch(statements)` once for the full core request. Insert this guard after every stock update:

```sql
INSERT INTO inventory_issue_batch_guard
  (tenant_id, operation_key, step_key, assertion_value)
VALUES (?, ?, ?, changes())
```

Because `assertion_value` must equal 1, a stale stock snapshot aborts and rolls back the entire D1 batch.

Use deterministic subqueries:

```sql
SELECT ConsumptionId
FROM InventoryConsumption
WHERE tenant_id = ? AND OperationKey = ?
```

and

```sql
SELECT ICI.ConsumptionItemId
FROM InventoryConsumptionItem ICI
JOIN InventoryConsumption IC ON IC.ConsumptionId = ICI.ConsumptionId
WHERE IC.tenant_id = ?
  AND IC.OperationKey = ?
  AND ICI.OperationAllocationKey = ?
```

- [ ] **Step 5: Run atomic tests**

Run: `pnpm exec vitest run test/inventory-issue-atomic.test.ts`
Expected: PASS, including full rollback assertions.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inventory-issue-atomic.ts test/inventory-issue-atomic.test.ts test/integration/helpers/mock-db.ts
git commit -m "feat: commit inventory issues atomically"
```

### Task 4: Integrate atomic commit and API idempotency

**Files:**
- Modify: `src/lib/inventory-issue-service.ts`
- Modify: `src/routes/tenant/inventory/issues.ts`
- Modify: `test/integration/routes/inventory/inventory-issues-edge-cases.test.ts`
- Create: `test/integration/routes/inventory/inventory-issue-idempotency.test.ts`

**Interfaces:**
- Extend `CreateInventoryIssuePayload` with `IdempotencyKey?: string`.
- Extend `InventoryIssueResult` with `OperationKey: string` and `replayed?: boolean`.
- Extend `CreateInventoryIssueContext` with optional `idempotencyKey?: string`.

- [ ] **Step 1: Write failing route tests**

Test:

```ts
const first = await app.request('/inventory/issues', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'issue-request-0001' },
  body: JSON.stringify(payload),
});
const second = await app.request('/inventory/issues', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'issue-request-0001' },
  body: JSON.stringify(payload),
});
expect(second.status).toBe(200);
expect(await second.json()).toMatchObject({ OperationKey: 'issue-request-0001', replayed: true });
```

Also assert same key with changed quantity returns 409 and no second stock batch is executed.

- [ ] **Step 2: Run route tests and verify failure**

Run: `pnpm exec vitest run test/integration/routes/inventory/inventory-issue-idempotency.test.ts`
Expected: FAIL because the route does not accept idempotency keys.

- [ ] **Step 3: Replace per-allocation writes in `createInventoryIssue()`**

Implementation flow:

1. Validate max 50 items.
2. Resolve all FEFO allocations and reject above 75 allocations.
3. Resolve item categories before journal reservation.
4. Select operation key from route header/body or `crypto.randomUUID()`.
5. Compute request hash with `createIdempotencyRequestHash({ tenantId, body: { ...body, IdempotencyKey: undefined } })`.
6. Reserve/replay operation.
7. Mark operation processing.
8. Call `commitAtomicInventoryIssue()` once.
9. Complete journal with response.
10. On error, mark journal failed and rethrow.
11. Record/post accounting event and schedule intelligence recompute after core commit.

Remove calls to `commitInventoryIssueAllocation()` from the request service. Keep the allocation-level service for other callers/tests until no remaining usage exists.

- [ ] **Step 4: Update route schema and header handling**

```ts
IdempotencyKey: z.string().trim().min(8).max(128).optional(),
```

```ts
const idempotencyKey = c.req.header('Idempotency-Key') ?? body.IdempotencyKey;
```

Return HTTP 201 for a new operation and HTTP 200 for replay.

- [ ] **Step 5: Run integration tests**

Run: `pnpm exec vitest run test/integration/routes/inventory/inventory-issues-edge-cases.test.ts test/integration/routes/inventory/inventory-issue-idempotency.test.ts test/inventory-audit-logging.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inventory-issue-service.ts src/routes/tenant/inventory/issues.ts test/integration/routes/inventory/inventory-issues-edge-cases.test.ts test/integration/routes/inventory/inventory-issue-idempotency.test.ts
git commit -m "feat: add idempotent atomic inventory issue API"
```

### Task 5: Add deterministic lab reagent operation keys

**Files:**
- Modify: `src/lib/lab-consumables.ts`
- Regenerate: `src/lib/lab-consumables.js`
- Modify: `test/lab-consumables-hardening.test.ts`
- Modify: `test/lab-consumable-stock-lifecycle-db.test.ts`

**Interfaces:**
- Internal canonical reagent issue calls pass stable `IdempotencyKey`.

- [ ] **Step 1: Write failing deterministic-key test**

Assert `createInventoryIssue()` receives:

```ts
IdempotencyKey: `lab-reagent:${tenantId}:${labOrderItemId}:${inventoryItemId}:${stockId}:${quantity}`
```

Normalize quantity to a stable decimal string before concatenation.

- [ ] **Step 2: Run test and verify failure**

Run: `pnpm exec vitest run test/lab-consumables-hardening.test.ts`
Expected: FAIL because no idempotency key is passed.

- [ ] **Step 3: Implement deterministic key**

Add:

```ts
function canonicalQuantityKey(value: number): string {
  return Number(value.toFixed(6)).toString();
}
```

Pass the key in the canonical inventory issue payload. Keep mapping-progress reconciliation as a second safety layer.

- [ ] **Step 4: Regenerate checked-in JS sibling**

Run:

```bash
pnpm exec esbuild src/lib/lab-consumables.ts --format=esm --platform=neutral --target=es2022 --outfile=src/lib/lab-consumables.js
```

- [ ] **Step 5: Run reagent tests**

Run: `pnpm exec vitest run test/lab-consumables-hardening.test.ts test/lab-consumable-stock-lifecycle-db.test.ts test/lab-reagent-reconciliation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/lab-consumables.ts src/lib/lab-consumables.js test/lab-consumables-hardening.test.ts test/lab-consumable-stock-lifecycle-db.test.ts
git commit -m "fix: make canonical reagent issues replay safe"
```

### Task 6: Add manager-only operation diagnostics and legacy consistency report

**Files:**
- Create: `src/lib/inventory-issue-diagnostics.ts`
- Create: `src/routes/tenant/inventory/issueOperations.ts`
- Modify: `src/routes/tenant/inventory/index.ts`
- Create: `test/integration/routes/inventory/inventory-issue-operations.test.ts`
- Modify: `test/inventory-coverage-matrix.test.ts`

**Interfaces:**
- `GET /inventory/issue-operations?status=failed&limit=100`
- `GET /inventory/issue-operations/diagnostics?limit=100`

- [ ] **Step 1: Write failing permission and classification tests**

Tests must verify:

- `hospital_admin` and `director` receive 200.
- `receptionist` receives 403.
- Diagnostics classify `header_without_lines`, `header_total_mismatch`, `missing_stock_transaction`, `missing_provisional_billing`, and `stale_processing_operation`.
- All queries include tenant ID.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm exec vitest run test/integration/routes/inventory/inventory-issue-operations.test.ts`
Expected: FAIL because route/module does not exist.

- [ ] **Step 3: Implement diagnostics library and route**

Use read-only SQL. Do not mutate or reverse historical data automatically. Return:

```ts
{
  data: Array<{
    issueCode: string;
    operationId: number | null;
    consumptionId: number | null;
    issueNo: string | null;
    detail: string;
    detectedAt: string;
  }>;
  summary: Record<string, number>;
}
```

- [ ] **Step 4: Register route and coverage mapping**

Mount `issueOperations` under `/issue-operations` in inventory index and add the route file to coverage guard mappings.

- [ ] **Step 5: Run route/coverage tests**

Run: `pnpm exec vitest run test/integration/routes/inventory/inventory-issue-operations.test.ts test/inventory-coverage-matrix.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/inventory-issue-diagnostics.ts src/routes/tenant/inventory/issueOperations.ts src/routes/tenant/inventory/index.ts test/integration/routes/inventory/inventory-issue-operations.test.ts test/inventory-coverage-matrix.test.ts
git commit -m "feat: add inventory operation diagnostics"
```

### Task 7: Full regression, documentation and rollout gate

**Files:**
- Modify: `package.json`
- Modify: `docs/qa/inventory-test-coverage.md`
- Create: `docs/reports/2026-07-10-inventory-request-atomicity-hardening.md`

**Interfaces:**
- `pnpm test:inventory` includes new operation, migration, atomicity and route suites.

- [ ] **Step 1: Add new suites to `test:inventory`**

Include:

```text
test/inventory-issue-operation.test.ts
test/inventory-issue-atomic.test.ts
test/inventory-issue-request-atomicity-migration.test.ts
test/integration/routes/inventory/inventory-issue-idempotency.test.ts
test/integration/routes/inventory/inventory-issue-operations.test.ts
```

- [ ] **Step 2: Build migration manifest**

Run: `pnpm build:migrations`
Expected: exit code 0 and migration 0401 included.

- [ ] **Step 3: Run TypeScript verification**

Run: `pnpm exec tsc --noEmit`
Expected: exit code 0.

- [ ] **Step 4: Run full inventory/reagent suite**

Run: `pnpm test:inventory`
Expected: all backend and frontend tests pass with zero failures.

- [ ] **Step 5: Run production web build**

Run: `pnpm --filter web build`
Expected: exit code 0.

- [ ] **Step 6: Write final report**

Document:

- request-level atomic behavior;
- idempotency/replay behavior;
- soft mode unchanged;
- migration and deployment order;
- operation diagnostics endpoint;
- exact verification counts;
- remaining limitations, including post-commit accounting/intelligence projections.

- [ ] **Step 7: Commit**

```bash
git add package.json docs/qa/inventory-test-coverage.md docs/reports/2026-07-10-inventory-request-atomicity-hardening.md
git commit -m "docs: verify inventory request atomicity hardening"
```

## Execution decision

The user explicitly requested implementation to continue, so execute this plan inline in the current isolated worktree with review checkpoints after schema, atomic core and final regression tasks.
