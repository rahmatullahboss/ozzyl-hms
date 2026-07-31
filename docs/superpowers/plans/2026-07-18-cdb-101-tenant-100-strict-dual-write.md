# CDB-101 Tenant-100 Strict Financial Dual-Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Backfill and reconcile tenant-100 historical financial facts, then make supported Demo Hospital financial requests commit legacy and canonical state atomically while every other tenant remains legacy-only.

**Architecture:** Reuse the applied canonical schema, existing backfill functions, canonical domain commands, and guarded production wrappers. Add an exact tenant-100 strict-policy resolver, extend canonical batches to accept authoritative legacy statements, route supported UI mutations through a small strict coordinator, and fail unsupported tenant-100 financial boundaries before legacy mutation. Build and import a deterministic financial-only baseline bundle, require exact reconciliation, then activate a separate `canonical_financial_dual_write_v1` shadow-mode flag whose JSON policy is `strict`.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, Cloudflare D1 atomic batches, SQLite/`node:sqlite`, Vitest, Wrangler, Zod-compatible validation, existing CDB-101 protected evidence wrappers.

---

## File Map

### New runtime files

- `src/lib/canonical/strict-financial-policy.ts` — tenant-100-only flag parsing, strict/disabled decisions, and safe strict error types.
- `src/lib/canonical/strict-financial-mutation.ts` — executes ordinary legacy batches or invokes a canonical command with the same authoritative legacy statements.
- `src/lib/canonical/live-financial-projection.ts` — deterministic invoice/payment/deposit/credit/refund canonical input builders for supported live routes.
- `src/lib/canonical/strict-financial-boundaries.ts` — stable supported/blocked boundary IDs and fail-before-write guard for financial writers not yet projected.

### Existing runtime files

- `src/lib/canonical/command-batch.ts` — add authoritative legacy statements to the existing atomic batch contract.
- `src/lib/canonical/commands/issue-invoice.ts`
- `src/lib/canonical/commands/collect-payment.ts`
- `src/lib/canonical/commands/apply-deposit.ts`
- `src/lib/canonical/commands/issue-credit-note.ts`
- `src/lib/canonical/commands/reverse-payment.ts` — accept shared execution options and pass authoritative statements to `runCanonicalBatch`.
- `src/routes/tenant/billing.ts` — strict `/api/billing` create and `/api/billing/pay` collection.
- `src/routes/tenant/billingCounter.ts` — strict `/api/billing-counter/invoices` create path.
- `src/routes/tenant/deposits.ts` — strict collect/refund/adjust paths.
- `src/routes/tenant/creditNotes.ts` — strict credit-note approval/refund path.
- Secondary writers listed in Task 7 — fail before legacy mutation for tenant-100 strict mode until they receive an atomic projection.

### New protected tooling

- `scripts/canonical/tenant-financial-import-contract.ts` — exact financial table allowlist, tenant/currency/run constants, manifest validation, and aggregate receipt types.
- `scripts/canonical/prepare-tenant-financial-backfill.ts` — runs existing backfills on a protected clone and builds a deterministic financial-only DML bundle.
- `scripts/canonical/tenant-financial-reconciliation.ts` — creates exact baseline and post-import aggregate parity evidence.
- `scripts/canonical/set-production-financial-dual-write-flag.ts` — guarded tenant-100 strict flag write/disable wrapper.
- `docs/database/migration-runs/production/CDB-101-tenant-100-strict-financial-activation.md` — operator sequence, evidence, smoke, rollback, and observation contract.

### New tests

- `test/canonical/strict-financial-policy.test.ts`
- `test/canonical/strict-financial-command-batch.test.ts`
- `test/canonical/live-financial-projection.test.ts`
- `test/canonical/strict-financial-mutation.test.ts`
- `test/canonical/tenant-financial-backfill.test.ts`
- `test/canonical/tenant-financial-reconciliation.test.ts`
- `test/canonical/tenant-financial-flag.test.ts`
- `test/canonical/strict-financial-boundary-governance.test.ts`
- `test/integration/routes/tenant-100-strict-financial.test.ts`

## Task 1: Add the Exact Tenant-100 Strict Policy Resolver

**Files:**
- Create: `src/lib/canonical/strict-financial-policy.ts`
- Create: `test/canonical/strict-financial-policy.test.ts`

- [ ] **Step 1: Write the failing policy tests**

```ts
it('bypasses the canonical flag table for every tenant except 100', async () => {
  const db = recordingDb();
  await expect(resolveStrictFinancialPolicy(db, '99')).resolves.toEqual({ enabled: false });
  expect(db.queries).toEqual([]);
});

it('accepts only the exact tenant-100 strict shadow configuration', async () => {
  const db = flagDb({
    tenant_id: '100', flag_key: 'canonical_financial_dual_write_v1',
    domain: 'financial', mode: 'shadow', is_enabled: 1,
    config_json: JSON.stringify({ writePolicy: 'strict', tenantScope: ['100'] }),
  });
  await expect(resolveStrictFinancialPolicy(db, '100')).resolves.toEqual({ enabled: true });
});

it.each([
  { mode: 'canonical' },
  { domain: 'reporting' },
  { config_json: '{"writePolicy":"async","tenantScope":["100"]}' },
  { config_json: '{"writePolicy":"strict","tenantScope":["100","101"]}' },
])('fails closed for malformed enabled policy %#', async (patch) => {
  await expect(resolveStrictFinancialPolicy(flagDb(enabledFlag(patch)), '100'))
    .rejects.toMatchObject({ code: 'CANONICAL_STRICT_POLICY_INVALID' });
});
```

- [ ] **Step 2: Run the policy tests and verify RED**

Run: `pnpm exec vitest run test/canonical/strict-financial-policy.test.ts`

Expected: FAIL because `strict-financial-policy.ts` does not exist.

- [ ] **Step 3: Implement the resolver and stable errors**

```ts
export const STRICT_FINANCIAL_FLAG_KEY = 'canonical_financial_dual_write_v1';
export const STRICT_FINANCIAL_TENANT_ID = '100';

export class CanonicalStrictFinancialError extends Error {
  readonly status = 409;

  constructor(
    readonly code: 'CANONICAL_STRICT_POLICY_INVALID' | 'CANONICAL_STRICT_WRITE_FAILED' | 'CANONICAL_STRICT_BOUNDARY_UNSUPPORTED',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CanonicalStrictFinancialError';
  }
}

interface StrictFinancialFlagRow {
  tenant_id: string;
  flag_key: string;
  domain: string;
  mode: string;
  is_enabled: number;
  config_json: string | null;
}

function parseStrictFinancialConfig(value: string | null): {
  writePolicy: string;
  tenantScope: string[];
} {
  let parsed: unknown;
  try { parsed = JSON.parse(value ?? 'null'); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CanonicalStrictFinancialError(
      'CANONICAL_STRICT_POLICY_INVALID',
      'Tenant-100 strict financial config is invalid',
    );
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'tenantScope,writePolicy'
      || typeof record.writePolicy !== 'string'
      || !Array.isArray(record.tenantScope)
      || record.tenantScope.some((item) => typeof item !== 'string')) {
    throw new CanonicalStrictFinancialError(
      'CANONICAL_STRICT_POLICY_INVALID',
      'Tenant-100 strict financial config is invalid',
    );
  }
  return { writePolicy: record.writePolicy, tenantScope: record.tenantScope as string[] };
}

export async function resolveStrictFinancialPolicy(
  db: CanonicalBatchDatabase,
  tenantId: string,
): Promise<{ enabled: boolean }> {
  if (tenantId !== STRICT_FINANCIAL_TENANT_ID) return { enabled: false };
  const row = await db.prepare(`
    SELECT tenant_id,flag_key,domain,mode,is_enabled,config_json
    FROM canonical_feature_flags
    WHERE tenant_id=? AND flag_key=?
      AND (effective_at_utc IS NULL OR effective_at_utc <= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      AND (expires_at_utc IS NULL OR expires_at_utc >= strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ORDER BY version DESC,id DESC LIMIT 1
  `).bind(tenantId, STRICT_FINANCIAL_FLAG_KEY).first<StrictFinancialFlagRow>();
  if (!row || row.is_enabled !== 1 || row.mode === 'disabled') return { enabled: false };
  const config = parseStrictFinancialConfig(row.config_json);
  if (row.domain !== 'financial' || row.mode !== 'shadow'
      || config.writePolicy !== 'strict'
      || JSON.stringify(config.tenantScope) !== '["100"]') {
    throw new CanonicalStrictFinancialError(
      'CANONICAL_STRICT_POLICY_INVALID',
      'Tenant-100 strict financial policy is invalid',
    );
  }
  return { enabled: true };
}
```

- [ ] **Step 4: Run the policy tests and verify GREEN**

Run: `pnpm exec vitest run test/canonical/strict-financial-policy.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the policy slice**

```bash
git add src/lib/canonical/strict-financial-policy.ts test/canonical/strict-financial-policy.test.ts
git commit -m "feat: add tenant-100 strict financial policy"
```

## Task 2: Extend Canonical Batches with Authoritative Legacy Statements

**Files:**
- Modify: `src/lib/canonical/command-batch.ts`
- Create: `test/canonical/strict-financial-command-batch.test.ts`

- [ ] **Step 1: Write failing atomicity tests**

```ts
it('commits authoritative legacy and canonical statements in one transaction', async () => {
  const { db, sqlite } = harness();
  await runCanonicalBatch(db, {
    ...canonicalCommand(db),
    authoritativeStatements: [
      db.prepare('INSERT INTO legacy_financial (tenant_id,source_id) VALUES (?,?)')
        .bind('100', 'bill-1'),
    ],
  });
  expect(count(sqlite, 'legacy_financial')).toBe(1);
  expect(count(sqlite, 'canonical_test_entities')).toBe(1);
});

it('rolls back the authoritative legacy statement when canonical state fails', async () => {
  const { db, sqlite } = harness();
  await expect(runCanonicalBatch(db, {
    ...canonicalCommand(db, { duplicateCanonical: true }),
    authoritativeStatements: [
      db.prepare('INSERT INTO legacy_financial (tenant_id,source_id) VALUES (?,?)')
        .bind('100', 'bill-rollback'),
    ],
  })).rejects.toThrow(/UNIQUE constraint failed/);
  expect(count(sqlite, 'legacy_financial')).toBe(0);
  expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
});
```

- [ ] **Step 2: Run the atomicity test and verify RED**

Run: `pnpm exec vitest run test/canonical/strict-financial-command-batch.test.ts`

Expected: FAIL because `CanonicalBatch` has no `authoritativeStatements` field.

- [ ] **Step 3: Add the authoritative statement contract**

```ts
export interface CanonicalBatch<T> {
  tenantId: string;
  commandName: string;
  idempotencyKey: string;
  request: unknown;
  authoritativeStatements?: readonly CanonicalPreparedStatement[];
  statements: readonly CanonicalPreparedStatement[];
  reconciliationStatements?: readonly CanonicalPreparedStatement[];
  result: T;
  event: CanonicalOutboxEvent;
}

const statements = [
  claimAndOutbox,
  ...(command.authoritativeStatements ?? []),
  ...command.statements,
  ...(command.reconciliationStatements ?? []),
];
```

Keep the outbox/idempotency claim first so a raced replay cannot execute authoritative statements twice. Preserve the existing post-rollback replay check.

- [ ] **Step 4: Run atomicity and existing command tests**

Run: `pnpm exec vitest run test/canonical/strict-financial-command-batch.test.ts test/canonical/command-batch.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the atomic batch slice**

```bash
git add src/lib/canonical/command-batch.ts test/canonical/strict-financial-command-batch.test.ts
git commit -m "feat: atomically include legacy financial statements"
```

## Task 3: Let Existing Financial Commands Carry Authoritative Statements

**Files:**
- Modify: `src/lib/canonical/command-batch.ts`
- Modify: `src/lib/canonical/commands/issue-invoice.ts`
- Modify: `src/lib/canonical/commands/collect-payment.ts`
- Modify: `src/lib/canonical/commands/apply-deposit.ts`
- Modify: `src/lib/canonical/commands/issue-credit-note.ts`
- Modify: `src/lib/canonical/commands/reverse-payment.ts`
- Modify: `test/canonical/issue-invoice.test.ts`
- Modify: `test/canonical/collect-payment.test.ts`
- Modify: `test/canonical/adjustment-lifecycle.test.ts`

- [ ] **Step 1: Add failing command-level rollback tests**

For invoice, payment, deposit, credit, and reversal commands, add one test that passes a legacy insert and injects a canonical constraint failure. Use this exact option type:

```ts
export interface CanonicalCommandExecutionOptions {
  authoritativeStatements?: readonly CanonicalPreparedStatement[];
}
```

Example assertion:

```ts
await expect(issueInvoice(db, invalidCanonicalInput(), {
  authoritativeStatements: [
    db.prepare('INSERT INTO legacy_financial (tenant_id,source_id) VALUES (?,?)')
      .bind('100', 'invoice-command-rollback'),
  ],
})).rejects.toThrow();
expect(count(sqlite, 'legacy_financial')).toBe(0);
```

- [ ] **Step 2: Run the command tests and verify RED**

Run: `pnpm exec vitest run test/canonical/issue-invoice.test.ts test/canonical/collect-payment.test.ts test/canonical/adjustment-lifecycle.test.ts`

Expected: FAIL because the commands accept only two arguments.

- [ ] **Step 3: Thread execution options into every selected command**

```ts
export async function issueInvoice(
  db: CanonicalBatchDatabase,
  input: IssueInvoiceInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<IssueInvoiceResult>> {
  // existing validation and result preparation stay unchanged
  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.invoice.issue',
    idempotencyKey: input.idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements,
    reconciliationStatements,
    result,
    event,
  });
}
```

Apply the same third-argument contract to `collectPayment`, `recordDeposit`, `applyDeposit`, `refundDeposit`, `issueCreditNote`, and `reversePayment`. Do not alter existing two-argument behavior.

- [ ] **Step 4: Run the focused lifecycle tests**

Run: `pnpm exec vitest run test/canonical/issue-invoice.test.ts test/canonical/collect-payment.test.ts test/canonical/adjustment-lifecycle.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the command execution slice**

```bash
git add src/lib/canonical/command-batch.ts src/lib/canonical/commands/issue-invoice.ts src/lib/canonical/commands/collect-payment.ts src/lib/canonical/commands/apply-deposit.ts src/lib/canonical/commands/issue-credit-note.ts src/lib/canonical/commands/reverse-payment.ts test/canonical/issue-invoice.test.ts test/canonical/collect-payment.test.ts test/canonical/adjustment-lifecycle.test.ts
git commit -m "feat: attach legacy writes to canonical financial commands"
```

## Task 4: Build Deterministic Live Financial Projection Inputs

**Files:**
- Create: `src/lib/canonical/live-financial-projection.ts`
- Create: `test/canonical/live-financial-projection.test.ts`

- [ ] **Step 1: Write failing deterministic mapping tests**

```ts
it('maps one legacy bill to stable canonical invoice and line inputs', async () => {
  const first = await buildLiveInvoiceProjection(invoiceFixture());
  const second = await buildLiveInvoiceProjection(invoiceFixture());
  expect(second).toEqual(first);
  expect(first.tenantId).toBe('100');
  expect(first.invoicePublicId).toMatch(/^inv_/);
  expect(first.lines).toHaveLength(2);
  expect(first.lines.reduce((sum, row) => sum + row.quantity * row.unitAmountMinor, 0))
    .toBe(50000);
});

it('maps payment totals exactly to tenders plus allocations', async () => {
  const input = await buildLivePaymentProjection(paymentFixture());
  expect(input.tenders.reduce((sum, row) => sum + row.amountMinor, 0))
    .toBe(input.allocations.reduce((sum, row) => sum + row.amountMinor, 0) + input.unallocatedMinor);
});

it('rejects unsafe, cross-tenant, floating, or unsupported source facts', async () => {
  await expect(buildLiveInvoiceProjection(invoiceFixture({ tenantId: '101' }))).rejects.toThrow(/tenant 100/i);
  await expect(buildLivePaymentProjection(paymentFixture({ amount: 10.001 }))).rejects.toThrow(/minor units/i);
});
```

- [ ] **Step 2: Run the projection tests and verify RED**

Run: `pnpm exec vitest run test/canonical/live-financial-projection.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the five input builders**

Export these exact functions and source types:

```ts
export async function buildLiveInvoiceProjection(source: LiveLegacyInvoice): Promise<IssueInvoiceInput>;
export async function buildLivePaymentProjection(source: LiveLegacyPayment): Promise<CollectPaymentInput>;
export async function buildLiveDepositProjection(source: LiveLegacyDeposit): Promise<RecordDepositInput>;
export async function buildLiveDepositApplicationProjection(source: LiveLegacyDepositApplication): Promise<ApplyDepositInput>;
export async function buildLiveDepositRefundProjection(source: LiveLegacyDepositRefund): Promise<RefundDepositInput>;
export async function buildLiveCreditProjection(source: LiveLegacyCredit): Promise<IssueCreditNoteInput>;
export async function buildLivePaymentReversalProjection(source: LiveLegacyPaymentReversal): Promise<ReversePaymentInput>;
```

Use `createDeterministicSourceId`, `createSourceEvidenceSha256`, `toMinorUnits`, `toUtcIso`, and `deriveBusinessDate`. Live source identity is the stable legacy receipt/invoice/credit number, not an uncommitted autoincrement ID. Use source types `legacy_live_bill`, `legacy_live_payment`, `legacy_live_deposit`, `legacy_live_credit_note`, and `legacy_live_refund`.

- [ ] **Step 4: Run the projection tests and existing money/id tests**

Run: `pnpm exec vitest run test/canonical/live-financial-projection.test.ts test/canonical/ids-time-money.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the projection slice**

```bash
git add src/lib/canonical/live-financial-projection.ts test/canonical/live-financial-projection.test.ts
git commit -m "feat: map live legacy finance to canonical commands"
```

## Task 5: Add the Strict Mutation Coordinator and Unsupported-Boundary Guard

**Files:**
- Create: `src/lib/canonical/strict-financial-mutation.ts`
- Create: `src/lib/canonical/strict-financial-boundaries.ts`
- Modify: `src/index.ts`
- Create: `test/canonical/strict-financial-mutation.test.ts`

- [ ] **Step 1: Write failing coordinator tests**

```ts
it('runs the ordinary legacy batch for non-tenant-100 without reading the flag', async () => {
  const result = await executeStrictFinancialMutation({
    db, tenantId: '101', boundary: 'billing.create', legacyStatements,
    canonical: async () => { throw new Error('must not run'); },
  });
  expect(result.mode).toBe('legacy');
  expect(flagReads(db)).toBe(0);
});

it('passes the same legacy statements into the canonical command for enabled tenant 100', async () => {
  await executeStrictFinancialMutation({
    db: enabledDb, tenantId: '100', boundary: 'billing.create', legacyStatements,
    canonical: async (execution) => issueInvoice(enabledDb, invoiceInput, execution),
  });
  expect(count(sqlite, 'bills')).toBe(1);
  expect(count(sqlite, 'canonical_invoices')).toBe(1);
});

it('converts canonical failure into a safe strict error after atomic rollback', async () => {
  await expect(executeStrictFinancialMutation(failingInput))
    .rejects.toMatchObject({ code: 'CANONICAL_STRICT_WRITE_FAILED' });
  expect(count(sqlite, 'bills')).toBe(0);
});
```

- [ ] **Step 2: Run the coordinator test and verify RED**

Run: `pnpm exec vitest run test/canonical/strict-financial-mutation.test.ts`

Expected: FAIL because the coordinator modules do not exist.

- [ ] **Step 3: Implement the coordinator and stable boundary registry**

```ts
export type StrictFinancialBoundary =
  | 'billing.create'
  | 'billing-counter.invoice.create'
  | 'billing.payment.collect'
  | 'deposit.collect'
  | 'deposit.refund'
  | 'deposit.apply'
  | 'credit-note.approve';

export async function executeStrictFinancialMutation<T>(input: {
  db: CanonicalBatchDatabase;
  tenantId: string;
  boundary: StrictFinancialBoundary;
  legacyStatements: readonly CanonicalPreparedStatement[];
  canonical: (execution: CanonicalCommandExecutionOptions) => Promise<T>;
}): Promise<{ mode: 'legacy' | 'strict'; result: T | unknown[] }> {
  const policy = await resolveStrictFinancialPolicy(input.db, input.tenantId);
  if (!policy.enabled) {
    return { mode: 'legacy', result: await input.db.batch([...input.legacyStatements]) };
  }
  try {
    return {
      mode: 'strict',
      result: await input.canonical({ authoritativeStatements: input.legacyStatements }),
    };
  } catch (cause) {
    throw new CanonicalStrictFinancialError(
      'CANONICAL_STRICT_WRITE_FAILED',
      'Canonical strict financial write failed',
      { cause },
    );
  }
}
```

Also export `assertStrictFinancialBoundaryDisabledOrSupported(db, tenantId, boundary)`; for tenant-100 enabled policy it throws `CANONICAL_STRICT_BOUNDARY_UNSUPPORTED` before any legacy write when the boundary is not one of the seven supported IDs.

In the global error handler, preserve the safe stable code without returning the internal cause:

```ts
if (err instanceof CanonicalStrictFinancialError) {
  return c.json({
    error: err.code,
    code: err.code,
    message: err.code === 'CANONICAL_STRICT_BOUNDARY_UNSUPPORTED'
      ? 'This Demo Hospital financial operation is blocked during strict canonical verification.'
      : 'This Demo Hospital financial operation failed canonical verification.',
  }, 409);
}
```

- [ ] **Step 4: Run coordinator tests**

Run: `pnpm exec vitest run test/canonical/strict-financial-policy.test.ts test/canonical/strict-financial-mutation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the coordinator slice**

```bash
git add src/lib/canonical/strict-financial-mutation.ts src/lib/canonical/strict-financial-boundaries.ts src/index.ts test/canonical/strict-financial-mutation.test.ts
git commit -m "feat: coordinate tenant-100 strict financial mutations"
```

## Task 6: Integrate the Active Demo-Hospital Financial UI Boundaries

**Files:**
- Modify: `src/routes/tenant/billing.ts`
- Modify: `src/routes/tenant/billingCounter.ts`
- Modify: `src/routes/tenant/deposits.ts`
- Modify: `src/routes/tenant/creditNotes.ts`
- Create: `test/integration/routes/tenant-100-strict-financial.test.ts`
- Modify: `test/integration/routes/billing-counter.test.ts`
- Modify: `test/integration/routes/deposits.test.ts`
- Modify: `test/integration/routes/credit-notes.test.ts`

- [ ] **Step 1: Write failing route tests for isolation and rollback**

Cover these exact requests:

```ts
const supportedRequests = [
  ['POST', '/billing'],
  ['POST', '/billing/pay'],
  ['POST', '/billing-counter/invoices'],
  ['POST', '/deposits'],
  ['POST', '/deposits/refund'],
  ['POST', '/deposits/adjust'],
  ['POST', '/credit-notes/:id/approve'],
] as const;
```

For tenant `100`, seed the exact strict flag and assert legacy plus canonical SQL share one recorded `batch` call. Inject a failing canonical statement and assert the response contains `CANONICAL_STRICT_WRITE_FAILED` while no legacy row remains. Repeat invoice/payment requests as tenant `101` and assert no canonical flag read or canonical SQL.

- [ ] **Step 2: Run route tests and verify RED**

Run: `pnpm exec vitest run test/integration/routes/tenant-100-strict-financial.test.ts test/integration/routes/billing-counter.test.ts test/integration/routes/deposits.test.ts test/integration/routes/credit-notes.test.ts`

Expected: FAIL because current routes execute legacy batches directly.

- [ ] **Step 3: Route invoice creation through the strict coordinator**

In `billing.ts` and `billingCounter.ts`, preserve all validation and sequence generation, build the existing `creationBatch`, then replace direct batch execution with:

```ts
const canonicalInput = await buildLiveInvoiceProjection({
  tenantId: String(tenantId), patientId, visitId, invoiceNo,
  currencyCode: 'BDT', issuedAtUtc: new Date().toISOString(),
  discount, taxTotal, items: resolvedItems,
});
const execution = await executeStrictFinancialMutation({
  db: c.env.DB, tenantId: String(tenantId),
  boundary: routeBoundary,
  legacyStatements: creationBatch,
  canonical: (options) => issueInvoice(c.env.DB, canonicalInput, options),
});
```

Read the committed bill by tenant/invoice number after the transaction before existing finalization side effects. Do not add canonical reads to the frontend response.

- [ ] **Step 4: Route payment collection through the strict coordinator**

In `/api/billing/pay`, keep accounting-period, counter-session, bill-balance, and idempotency checks. Pass the existing `paymentBatch` to `collectPayment`:

```ts
await executeStrictFinancialMutation({
  db: c.env.DB, tenantId: String(tenantId), boundary: 'billing.payment.collect',
  legacyStatements: paymentBatch,
  canonical: (options) => collectPayment(
    c.env.DB,
    await buildLivePaymentProjection(paymentSource),
    options,
  ),
});
```

Map `CanonicalStrictFinancialError` to the existing JSON error envelope with its stable code; do not log the request body.

- [ ] **Step 5: Route deposits and approved credits through canonical commands**

Use:

```ts
recordDeposit(db, await buildLiveDepositProjection(source), options);
applyDeposit(db, await buildLiveDepositApplicationProjection(source), options);
refundDeposit(db, await buildLiveDepositRefundProjection(source), options);
issueCreditNote(db, await buildLiveCreditProjection(source), options);
```

Every call receives the route's complete existing legacy statement array through the coordinator. Move current post-batch audit/accounting statements into that array when they are part of the same financial mutation; leave genuinely asynchronous posting consumption after commit.

- [ ] **Step 6: Run supported route tests and focused canonical tests**

Run: `pnpm exec vitest run test/integration/routes/tenant-100-strict-financial.test.ts test/integration/routes/billing-counter.test.ts test/integration/routes/deposits.test.ts test/integration/routes/credit-notes.test.ts test/canonical/issue-invoice.test.ts test/canonical/collect-payment.test.ts test/canonical/adjustment-lifecycle.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit the active-route slice**

```bash
git add src/routes/tenant/billing.ts src/routes/tenant/billingCounter.ts src/routes/tenant/deposits.ts src/routes/tenant/creditNotes.ts test/integration/routes/tenant-100-strict-financial.test.ts test/integration/routes/billing-counter.test.ts test/integration/routes/deposits.test.ts test/integration/routes/credit-notes.test.ts
git commit -m "feat: dual write demo hospital financial routes"
```

## Task 7: Fail Closed at Every Remaining Legacy Financial Writer

**Files:**
- Create: `test/canonical/strict-financial-boundary-governance.test.ts`
- Modify: `src/routes/tenant/appointments.ts`
- Modify: `src/routes/tenant/approvals.ts`
- Modify: `src/routes/tenant/billingCancellation.ts`
- Modify: `src/routes/tenant/billingProvisional.ts`
- Modify: `src/routes/tenant/ipBilling.ts`
- Modify: `src/routes/tenant/lab.ts`
- Modify: `src/routes/tenant/patients.ts`
- Modify: `src/routes/tenant/payments.ts`
- Modify: `src/routes/tenant/pharmacy/advanced.ts`
- Modify: `src/routes/tenant/radiology/orders.ts`
- Modify: `src/routes/tenant/reception.ts`
- Modify: `src/routes/tenant/settlements.ts`
- Modify: `src/lib/billing-refund-cash-hold.ts`
- Modify: `src/lib/lab-cancellation-operation.ts`

- [ ] **Step 1: Write the source-governance test**

```ts
const LEGACY_FINANCIAL_WRITERS = [
  'src/lib/billing-create-batch.ts',
  'src/lib/billing-refund-cash-hold.ts',
  'src/lib/lab-cancellation-operation.ts',
  'src/routes/tenant/appointments.ts',
  'src/routes/tenant/approvals.ts',
  'src/routes/tenant/billing.ts',
  'src/routes/tenant/billingCancellation.ts',
  'src/routes/tenant/billingCounter.ts',
  'src/routes/tenant/billingProvisional.ts',
  'src/routes/tenant/creditNotes.ts',
  'src/routes/tenant/deposits.ts',
  'src/routes/tenant/ipBilling.ts',
  'src/routes/tenant/lab.ts',
  'src/routes/tenant/patients.ts',
  'src/routes/tenant/payments.ts',
  'src/routes/tenant/pharmacy/advanced.ts',
  'src/routes/tenant/radiology/orders.ts',
  'src/routes/tenant/reception.ts',
  'src/routes/tenant/settlements.ts',
];

it('requires every discovered legacy financial writer to integrate or guard strict mode', () => {
  for (const path of LEGACY_FINANCIAL_WRITERS) {
    const source = readFileSync(path, 'utf8');
    expect(source, path).toMatch(/executeStrictFinancialMutation|assertStrictFinancialBoundaryDisabledOrSupported|buildBillCreationBatch/);
  }
});
```

Also scan `src/routes/tenant` and `src/lib` for `INSERT/UPDATE` against `bills`, `payments`, `billing_deposits`, `billing_credit_notes`, and `billing_refund_cash_holds`; fail when a newly discovered writer is absent from the registry.

- [ ] **Step 2: Run governance and verify RED**

Run: `pnpm exec vitest run test/canonical/strict-financial-boundary-governance.test.ts`

Expected: FAIL with the unguarded writer paths.

- [ ] **Step 3: Add fail-before-write guards to unsupported boundaries**

At the start of every unsupported financial mutation, after tenant/auth resolution but before sequence reservation, idempotency reservation, or D1 mutation, call:

```ts
await assertStrictFinancialBoundaryDisabledOrSupported(
  c.env.DB,
  String(tenantId),
  'fully-qualified-existing-route-name',
);
```

For library-level mutations, accept `tenantId` and `db` if not already present and perform the same guard before preparing/executing writes. Non-tenant-100 and disabled-flag behavior remains unchanged. Enabled tenant-100 behavior returns `CANONICAL_STRICT_BOUNDARY_UNSUPPORTED` without a legacy mutation.

- [ ] **Step 4: Run governance and route regressions**

Run: `pnpm exec vitest run test/canonical/strict-financial-boundary-governance.test.ts test/integration/routes/appointment-billing-handoff.test.ts test/integration/routes/ip-billing.test.ts test/integration/routes/billing-cancellation.test.ts test/integration/routes/refund-approval-cash-holds.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the governance slice**

```bash
git add test/canonical/strict-financial-boundary-governance.test.ts src/routes/tenant/appointments.ts src/routes/tenant/approvals.ts src/routes/tenant/billingCancellation.ts src/routes/tenant/billingProvisional.ts src/routes/tenant/ipBilling.ts src/routes/tenant/lab.ts src/routes/tenant/patients.ts src/routes/tenant/payments.ts src/routes/tenant/pharmacy/advanced.ts src/routes/tenant/radiology/orders.ts src/routes/tenant/reception.ts src/routes/tenant/settlements.ts src/lib/billing-refund-cash-hold.ts src/lib/lab-cancellation-operation.ts
git commit -m "fix: fail closed at unprojected tenant-100 writers"
```

## Task 8: Build the Incremental Tenant-100 Financial Baseline Bundle

**Files:**
- Create: `scripts/canonical/tenant-financial-import-contract.ts`
- Create: `scripts/canonical/prepare-tenant-financial-backfill.ts`
- Create: `test/canonical/tenant-financial-backfill.test.ts`
- Modify: `scripts/canonical/build-production-canonical-bundle.ts`
- Modify: `scripts/canonical/import-production-canonical-bundle.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing bundle and contract tests**

```ts
expect(CDB101_FINANCIAL_IMPORT_TABLES).toEqual([
  'canonical_migration_runs',
  'canonical_backfill_checkpoints',
  'canonical_invoices',
  'canonical_invoice_lines',
  'canonical_payment_receipts',
  'canonical_payment_tenders',
  'canonical_payment_allocations',
  'canonical_deposits',
  'canonical_deposit_applications',
  'canonical_credit_notes',
  'canonical_credit_note_lines',
  'canonical_refunds',
  'canonical_payment_reversals',
  'canonical_compensation_rules',
  'canonical_compensation_accruals',
  'canonical_compensation_settlements',
  'canonical_compensation_settlement_allocations',
  'canonical_compensation_adjustments',
  'canonical_source_mappings',
  'canonical_processing_issues',
]);

it('backfills only tenant 100 finance and produces a zero-write second pass', async () => {
  const receipt = await prepareTenantFinancialBackfill(protectedFixture());
  expect(receipt.tenantId).toBe('100');
  expect(receipt.secondPassNewRows).toBe(0);
  expect(receipt.bundleReady).toBe(true);
  expect(receipt.legacyRowsMutated).toBe(0);
  expect(receipt.allowedTables).toEqual(CDB101_FINANCIAL_IMPORT_TABLES);
});
```

- [ ] **Step 2: Run the financial backfill test and verify RED**

Run: `pnpm exec vitest run test/canonical/tenant-financial-backfill.test.ts`

Expected: FAIL because the financial contract and wrapper do not exist.

- [ ] **Step 3: Implement the protected clone wrapper**

Open the protected clone read-write, capture hashes/counts for all legacy financial tables, then run in order:

```ts
await backfillInvoices(db, { tenantId: '100', runPublicId: `${runId}-invoices`, currencyCode: 'BDT', nowUtc });
await backfillPayments(db, { tenantId: '100', runPublicId: `${runId}-payments`, currencyCode: 'BDT', nowUtc });
await backfillAdjustments(db, { tenantId: '100', runPublicId: `${runId}-adjustments`, currencyCode: 'BDT', nowUtc });
await backfillCompensation(db, { tenantId: '100', runPublicId: `${runId}-compensation`, currencyCode: 'BDT', nowUtc });
```

Run the same four calls with distinct second-pass run IDs against the already-backfilled clone and require the sum of created financial rows to be zero. Then call `buildProductionCanonicalBundle` with `allowedTables: CDB101_FINANCIAL_IMPORT_TABLES`. Refuse repository paths, cross-tenant rows, PHI fields in receipts, mutable legacy counts, unexpected tables, and any `UPDATE/DELETE` in the output bundle.

- [ ] **Step 4: Add exact package commands**

```json
"canonical:prepare-tenant-financial-backfill": "tsx scripts/canonical/prepare-tenant-financial-backfill.ts",
"canonical:reconcile-tenant-financial": "tsx scripts/canonical/tenant-financial-reconciliation.ts",
"canonical:set-production-financial-flag": "tsx scripts/canonical/set-production-financial-dual-write-flag.ts"
```

- [ ] **Step 5: Run bundle, existing backfill, and importer tests**

Run: `pnpm exec vitest run test/canonical/tenant-financial-backfill.test.ts test/canonical/invoice-backfill.test.ts test/canonical/payment-allocation-backfill.test.ts test/canonical/adjustment-backfill.test.ts test/canonical/compensation-backfill.test.ts test/canonical/production-canonical-bundle-builder.test.ts test/canonical/production-import-second-pass.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the baseline tooling slice**

```bash
git add scripts/canonical/tenant-financial-import-contract.ts scripts/canonical/prepare-tenant-financial-backfill.ts scripts/canonical/build-production-canonical-bundle.ts scripts/canonical/import-production-canonical-bundle.ts test/canonical/tenant-financial-backfill.test.ts package.json
git commit -m "feat: prepare tenant-100 financial baseline bundle"
```

## Task 9: Add Exact Financial Reconciliation Evidence

**Files:**
- Create: `scripts/canonical/tenant-financial-reconciliation.ts`
- Create: `test/canonical/tenant-financial-reconciliation.test.ts`

- [ ] **Step 1: Write failing parity and redaction tests**

```ts
it('requires exact count and minor-unit parity at the same cutoff', async () => {
  const receipt = await reconcileTenantFinancial(cleanFixture());
  expect(receipt).toMatchObject({ evidenceReady: true, activationReady: true, tenantId: '100' });
  expect(receipt.variance).toEqual({ count: 0, amountMinor: 0, allocationMinor: 0 });
});

it('blocks one-minor-unit variance without exposing PHI', async () => {
  const receipt = await reconcileTenantFinancial(fixtureWithCanonicalVariance(1));
  expect(receipt.activationReady).toBe(false);
  expect(receipt.variance.amountMinor).toBe(1);
  expect(JSON.stringify(receipt)).not.toMatch(/patient_name|mobile|address|diagnosis/i);
});
```

- [ ] **Step 2: Run reconciliation tests and verify RED**

Run: `pnpm exec vitest run test/canonical/tenant-financial-reconciliation.test.ts`

Expected: FAIL because the reconciler does not exist.

- [ ] **Step 3: Implement exact aggregate queries and readiness rules**

Compute legacy and canonical values at one cutoff for:

```ts
export const FINANCIAL_RECONCILIATION_CHECKS = [
  'invoice_count_by_status', 'invoice_gross_minor', 'invoice_discount_minor',
  'invoice_net_minor', 'invoice_paid_minor', 'invoice_due_minor',
  'receipt_count_by_status', 'receipt_total_minor', 'allocation_total_minor',
  'deposit_received_minor', 'deposit_applied_minor', 'deposit_refunded_minor',
  'credit_note_minor', 'refund_minor', 'reversal_minor',
  'source_mapping_duplicates', 'tenant_isolation',
  'unresolved_critical_issues', 'blocked_outbox', 'blocked_accounting',
] as const;
```

`activationReady` is true only when every count/amount variance is zero, second-pass new rows are zero, duplicate/cross-tenant counts are zero, and critical/blocked counts are zero. Use integer minor units and aggregate-only evidence.

- [ ] **Step 4: Run reconciliation and reporting parity tests**

Run: `pnpm exec vitest run test/canonical/tenant-financial-reconciliation.test.ts test/canonical/reporting-parity.test.ts test/canonical/accounting-reconciliation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the reconciliation slice**

```bash
git add scripts/canonical/tenant-financial-reconciliation.ts test/canonical/tenant-financial-reconciliation.test.ts
git commit -m "feat: reconcile tenant-100 legacy and canonical finance"
```

## Task 10: Add the Guarded Strict-Flag Wrapper

**Files:**
- Create: `scripts/canonical/set-production-financial-dual-write-flag.ts`
- Create: `test/canonical/tenant-financial-flag.test.ts`
- Modify: `scripts/canonical/production-cutover-contract.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing flag wrapper tests**

```ts
it('writes only the exact tenant-100 strict shadow policy', () => {
  expect(buildFinancialStrictFlagSql(authorization)).toContain("tenant_id = '100'");
  expect(buildFinancialStrictFlagSql(authorization)).toContain("'canonical_financial_dual_write_v1'");
  expect(buildFinancialStrictFlagSql(authorization)).toContain("'financial'");
  expect(buildFinancialStrictFlagSql(authorization)).toContain("'shadow'");
  expect(buildFinancialStrictFlagSql(authorization)).toContain('"writePolicy":"strict"');
  expect(buildFinancialStrictFlagSql(authorization)).not.toMatch(/tenant_id\s*!=|canonical_reporting_v1/);
});

it.each(['missing reconciliation', 'non-zero variance', 'wrong tenant', 'expired authorization'])
('starts zero child processes for %s', async (fault) => {
  const result = await invokeWrapper(fixture(fault));
  expect(result.externalCommandCount).toBe(0);
  expect(result.productionMutationPerformed).toBe(false);
});
```

- [ ] **Step 2: Run flag tests and verify RED**

Run: `pnpm exec vitest run test/canonical/tenant-financial-flag.test.ts`

Expected: FAIL because the wrapper does not exist.

- [ ] **Step 3: Implement guarded enable and disable operations**

The enable SQL must use the existing valid database mode and strict JSON policy:

```sql
INSERT INTO canonical_feature_flags (
  tenant_id,flag_key,domain,mode,is_enabled,version,config_json,
  effective_at_utc,expires_at_utc,updated_by_public_id
) VALUES (
  '100','canonical_financial_dual_write_v1','financial','shadow',1,1,
  '{"tenantScope":["100"],"writePolicy":"strict"}',?,?,?
)
ON CONFLICT(tenant_id,flag_key) DO UPDATE SET
  domain='financial',mode='shadow',is_enabled=1,
  version=canonical_feature_flags.version+1,
  config_json='{"tenantScope":["100"],"writePolicy":"strict"}',
  effective_at_utc=excluded.effective_at_utc,
  expires_at_utc=excluded.expires_at_utc,
  updated_by_public_id=excluded.updated_by_public_id,
  updated_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ','now');
```

Disable uses an exact tenant/key/version guard and sets `mode='disabled', is_enabled=0`. Before any Wrangler child process, require protected authorization, current Worker evidence, baseline bundle/import evidence, `activationReady=true` reconciliation, route smoke evidence, and rollback evidence. Read before/write/read after; require one logical row change and exact after-state.

- [ ] **Step 4: Run flag and existing cutover wrapper tests**

Run: `pnpm exec vitest run test/canonical/tenant-financial-flag.test.ts test/canonical/production-cutover-contract.test.ts test/canonical/reporting-processing-evidence.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the flag wrapper slice**

```bash
git add scripts/canonical/set-production-financial-dual-write-flag.ts scripts/canonical/production-cutover-contract.ts test/canonical/tenant-financial-flag.test.ts package.json
git commit -m "feat: guard tenant-100 strict financial activation"
```

## Task 11: Document, Verify, Integrate, and Prepare Production Candidate

**Files:**
- Create: `docs/database/migration-runs/production/CDB-101-tenant-100-strict-financial-activation.md`
- Modify intentionally if still active: `.ai-bridge/current-plan.md`
- Modify intentionally if still active: `.ai-bridge/agent-status.md`
- Modify intentionally if still active: `.ai-bridge/decisions.md`

- [ ] **Step 1: Write the operator document**

Document this exact stage order:

```text
read-only production drift check
-> fresh protected tenant-100 export and Time Travel bookmark
-> protected clone financial backfill
-> deterministic bundle/manifest validation
-> guarded production financial import
-> required zero-write second import pass
-> exact post-import reconciliation
-> focused/full tests and production build
-> clean candidate deploy at 0% traffic
-> authenticated legacy and strict-candidate smoke
-> tenant-100 strict financial flag enable
-> immediate DB parity/queue/latency observation
-> GO or guarded flag disable
```

State explicitly that frontend/user-facing reporting remains legacy, other tenants remain legacy-only, unsupported tenant-100 financial boundaries fail before mutation, and the morning migrations/import/FK work is not repeated.

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm exec vitest run \
  test/canonical/strict-financial-policy.test.ts \
  test/canonical/strict-financial-command-batch.test.ts \
  test/canonical/live-financial-projection.test.ts \
  test/canonical/strict-financial-mutation.test.ts \
  test/canonical/tenant-financial-backfill.test.ts \
  test/canonical/tenant-financial-reconciliation.test.ts \
  test/canonical/tenant-financial-flag.test.ts \
  test/canonical/strict-financial-boundary-governance.test.ts \
  test/integration/routes/tenant-100-strict-financial.test.ts
```

Expected: all listed tests PASS.

- [ ] **Step 3: Run canonical regression**

Run: `pnpm exec vitest run test/canonical`

Expected: all canonical tests PASS.

- [ ] **Step 4: Run relevant backend regressions**

Run: `pnpm exec vitest run test/integration/routes/billing-counter.test.ts test/integration/routes/deposits.test.ts test/integration/routes/credit-notes.test.ts test/integration/routes/ip-billing.test.ts test/integration/routes/billing-cancellation.test.ts test/integration/routes/refund-approval-cash-holds.test.ts`

Expected: all selected integration tests PASS.

- [ ] **Step 5: Run typecheck and production build**

Run: `pnpm exec tsc --noEmit`

Expected: exit `0`.

Run: `pnpm build`

Expected: production build succeeds.

- [ ] **Step 6: Review and commit documentation/handoff changes**

```bash
git diff --check
git add docs/database/migration-runs/production/CDB-101-tenant-100-strict-financial-activation.md
git commit -m "docs: add tenant-100 strict financial runbook"
```

Stage `.ai-bridge` files only when they were intentionally updated for this slice, and commit them separately from source/docs.

- [ ] **Step 7: Cherry-pick focused commits into the clean integration worktree**

List and cherry-pick the focused commits after the design commit in order. Preserve unrelated `.ai-bridge` changes already present in the integration worktree. Resolve no conflict by deleting user changes.

```bash
export CDB101_INTEGRATION_WORKTREE=/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-p01-integration-20260713
for cdb101_commit in $(git rev-list --reverse da0b7edf..HEAD); do
  git -C "$CDB101_INTEGRATION_WORKTREE" cherry-pick "$cdb101_commit"
done
```

- [ ] **Step 8: Build and upload the production candidate without traffic**

Run: `pnpm build && npx wrangler deploy --env production --dry-run --outdir /private/tmp/cdb101-strict-financial-build`

Expected: build candidate artifacts succeed without production traffic change.

Use the existing guarded zero-traffic version upload procedure. Verify with:

```bash
pnpm exec wrangler deployments list --env production --name hms-saas-production --json
pnpm exec wrangler versions list --env production --name hms-saas-production --json
```

Expected: current legacy version remains `100%`; the new candidate is `0%`.

## Task 12: Execute the Protected Tenant-100 Production Stage

**Files:**
- No repository source changes expected; protected evidence stays outside the repository.

- [ ] **Step 1: Recheck live production identity and steady state read-only**

Verify database UUID, migrations `0505`–`0515`, tenant-100 current financial counts, strict flag absent/disabled, reporting flag state, Worker traffic, FK count/disposition, and zero unexpected canonical queue blockers. Every query must report `changed_db=false` and `rows_written=0`.

- [ ] **Step 2: Create a fresh protected export/bookmark and clone**

Use a direct mode-`700` directory outside the repository and mode-`600` regular files. Do not print credentials, patient rows, raw export SQL, or secret values.

- [ ] **Step 3: Prepare and validate the incremental financial bundle**

Run:

```bash
pnpm canonical:prepare-tenant-financial-backfill -- \
  --source-database "$CDB101_FINANCIAL_CLONE" \
  --source-export "$CDB101_SOURCE_EXPORT" \
  --output-directory "$CDB101_FINANCIAL_OUTPUT_DIR" \
  --authorization "$CDB101_FINANCIAL_AUTHORIZATION" \
  --deterministic-run-id "$CDB101_FINANCIAL_RUN_ID" \
  --cutoff-utc "$CDB101_FINANCIAL_CUTOFF_UTC"
```

Set those six task-specific variables from the exact protected authorization and fresh export receipt before running the command; do not reuse `$HOME` or a repository directory.

Expected: `bundleReady=true`, tenant `100`, exact financial allowlist, legacy rows mutated `0`, second-pass new rows `0`.

- [ ] **Step 4: Import once, verify counts, and run the mandatory second pass**

Use the guarded production importer bound to the financial manifest and authorization. Require exact table counts after pass one. Pass two must report zero logical new rows and unchanged counts.

- [ ] **Step 5: Capture exact post-import reconciliation**

Run the protected reconciliation collector at cutoff `T0`. Require `evidenceReady=true`, `activationReady=true`, every amount/count variance `0`, tenant-isolation `0`, unresolved critical issues `0`, blocked outbox `0`, and blocked accounting `0`.

- [ ] **Step 6: Smoke the candidate with tenant-100 authentication**

Exercise invoice create with rollback fixture, payment, deposit, deposit application/refund, and credit-note approval against the candidate path without changing public Worker traffic. Confirm other-tenant smoke remains legacy-only.

- [ ] **Step 7: Enable the strict financial flag**

Run the guarded `canonical:set-production-financial-flag` command with the protected authorization, import receipt, reconciliation evidence, Worker evidence, route smoke evidence, and rollback evidence. Require exact after-state:

```json
{
  "tenant_id": "100",
  "flag_key": "canonical_financial_dual_write_v1",
  "domain": "financial",
  "mode": "shadow",
  "is_enabled": 1,
  "config_json": { "tenantScope": ["100"], "writePolicy": "strict" }
}
```

- [ ] **Step 8: Observe and decide**

Compare legacy/canonical DB aggregates from `T0`, strict error codes, queue/accounting state, tenant isolation, request latency, and legacy user-facing reports. Any unexplained variance, partial state, tenant leak, or repeated strict failure is `NO_GO`; immediately run the guarded disable command and verify legacy-only steady state.

- [ ] **Step 9: Record the final aggregate evidence**

Record only counts, integer amounts, hashes, timestamps, version IDs, traffic percentages, flag state, and GO/NO_GO decision. Do not commit protected evidence or PHI. Do not push or merge unless the owner separately requests it.
