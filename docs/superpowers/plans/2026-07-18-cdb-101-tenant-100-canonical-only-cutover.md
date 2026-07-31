# CDB-101 Tenant-100 Canonical-Only Cutover Implementation Plan

> **SUPERSEDED — DO NOT EXECUTE.** The owner withdrew canonical-only activation and restored the original strict dual-write migration plan on 2026-07-18. Current authority: `docs/database/migration-runs/production/CDB-101-strict-dual-write-recovery-20260718.md`. This plan is retained only as historical context.

> **Historical worker instruction:** This section and every task below are inactive.

**Goal:** Activate canonical-only financial mutations for Demo Hospital tenant `100`, fail closed at unsupported financial boundaries, and keep every other tenant on the existing legacy path.

**Architecture:** Extend the exact tenant-scoped financial policy with a `canonical-only` mode. The mutation coordinator skips legacy statements entirely in that mode, supported routes invoke canonical commands, and one centralized request guard blocks every other tenant-100 legacy financial mutation before its route handler runs. Existing legacy reads remain unchanged by design, so missing legacy IDs and UI visibility are explicit diagnostic outcomes.

**Tech Stack:** TypeScript, Hono, Cloudflare Workers, D1 atomic batches, Vitest, Wrangler, existing CDB-101 canonical commands and guarded production wrappers.

---

## File Map

### Runtime policy and execution

- Modify `src/lib/canonical/strict-financial-policy.ts` — resolve exact `strict` and `canonical-only` policies without cross-tenant fallback.
- Modify `src/lib/canonical/strict-financial-mutation.ts` — skip legacy statements for canonical-only mode.
- Modify `src/lib/canonical/strict-financial-boundaries.ts` — stable supported and blocked boundary IDs.
- Create `src/middleware/canonical-only-financial-guard.ts` — block unsupported tenant-100 financial mutations before route execution.
- Modify `src/index.ts` — mount the guard after tenant/auth context is available and preserve safe canonical-only error responses.

### Supported canonical-only routes

- Rework current uncommitted changes in `src/routes/tenant/billing.ts` — canonical-only bill creation and mapped payment collection.
- Rework current uncommitted changes in `src/routes/tenant/billingCounter.ts` — canonical-only credit invoice creation; embedded payment/deposit modes fail closed.
- Keep and complete current uncommitted support in `src/lib/canonical/commands/apply-deposit.ts` and `src/lib/canonical/live-financial-projection.ts` only where needed for atomic live receipt authority.
- Do not wire legacy deposit/credit routes in this cutover; the centralized guard blocks them with stable errors.

### Production activation

- Create `scripts/canonical/set-production-canonical-only-financial-flag.ts` — exact tenant-100 enable/disable wrapper.
- Modify `package.json` — add the guarded command.
- Create `docs/database/migration-runs/production/CDB-101-tenant-100-canonical-only-activation.md` — operator and rollback sequence.

### Tests

- Modify `test/canonical/strict-financial-policy.test.ts`.
- Modify `test/canonical/strict-financial-mutation.test.ts`.
- Create `test/canonical/canonical-only-financial-guard.test.ts`.
- Rework current uncommitted `test/integration/routes/tenant-100-strict-financial.test.ts` as canonical-only route/governance coverage.
- Create `test/canonical/tenant-canonical-only-flag.test.ts`.

## Task 1: Resolve the Exact Canonical-Only Tenant Policy

**Files:**
- Modify: `src/lib/canonical/strict-financial-policy.ts`
- Modify: `test/canonical/strict-financial-policy.test.ts`

- [ ] **Step 1: Write the failing canonical-only policy tests**

Add exact cases:

```ts
it('accepts only the exact tenant-100 canonical-only configuration', async () => {
  const db = flagDb(enabledFlag({
    mode: 'canonical',
    config_json: '{"writePolicy":"canonical-only","tenantScope":["100"]}',
  }));
  await expect(resolveStrictFinancialPolicy(db, '100')).resolves.toEqual({
    enabled: true,
    writePolicy: 'canonical-only',
  });
});

it('keeps every non-100 tenant legacy-only without a flag read', async () => {
  const db = recordingDb();
  await expect(resolveStrictFinancialPolicy(db.db, '101')).resolves.toEqual({
    enabled: false,
    writePolicy: 'legacy',
  });
  expect(db.queries).toEqual([]);
});

it.each([
  { mode: 'shadow', config_json: '{"writePolicy":"canonical-only","tenantScope":["100"]}' },
  { mode: 'canonical', config_json: '{"writePolicy":"canonical-only","tenantScope":["101"]}' },
  { mode: 'canonical', config_json: '{"writePolicy":"canonical-only","tenantScope":["100"],"fallback":"legacy"}' },
])('fails closed for malformed canonical-only policy %#', async (patch) => {
  await expect(resolveStrictFinancialPolicy(flagDb(enabledFlag(patch)), '100'))
    .rejects.toMatchObject({ code: 'CANONICAL_STRICT_POLICY_INVALID' });
});
```

- [ ] **Step 2: Run the policy test and verify RED**

Run: `pnpm exec vitest run test/canonical/strict-financial-policy.test.ts`

Expected: FAIL because the resolver currently returns only `{ enabled }` and accepts only strict shadow mode.

- [ ] **Step 3: Implement the exact policy union**

Use:

```ts
export type FinancialWritePolicy = 'legacy' | 'strict' | 'canonical-only';

export type ResolvedFinancialPolicy = {
  enabled: boolean;
  writePolicy: FinancialWritePolicy;
};
```

Return `{ enabled: false, writePolicy: 'legacy' }` for non-100, absent, or disabled rows. Accept exactly:

```ts
const strict = row.mode === 'shadow' && config.writePolicy === 'strict';
const canonicalOnly = row.mode === 'canonical' && config.writePolicy === 'canonical-only';
if (!strict && !canonicalOnly) throw invalidPolicy();
return { enabled: true, writePolicy: config.writePolicy };
```

Do not accept unknown config keys or any tenant scope other than `['100']`.

- [ ] **Step 4: Run policy regressions**

Run: `pnpm exec vitest run test/canonical/strict-financial-policy.test.ts test/canonical/strict-financial-mutation.test.ts`

Expected: policy tests PASS; coordinator tests may remain RED until Task 2 only for changed return shape.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canonical/strict-financial-policy.ts test/canonical/strict-financial-policy.test.ts
git commit -m "feat: resolve tenant-100 canonical-only policy"
```

## Task 2: Execute Canonical-Only Without Legacy Statements

**Files:**
- Modify: `src/lib/canonical/strict-financial-mutation.ts`
- Modify: `src/lib/canonical/strict-financial-policy.ts`
- Modify: `src/index.ts`
- Modify: `test/canonical/strict-financial-mutation.test.ts`

- [ ] **Step 1: Write the failing coordinator tests**

```ts
it('executes canonical-only without passing or running legacy statements', async () => {
  const { db, state } = harness({ writePolicy: 'canonical-only' });
  const legacyStatements = [db.prepare('INSERT INTO legacy_financial VALUES (1)')];
  const result = await executeStrictFinancialMutation({
    db, tenantId: '100', boundary: 'billing.create', legacyStatements,
    canonical: async (execution) => {
      expect(execution.authoritativeStatements).toEqual([]);
      state.canonicalRows += 1;
      return { canonicalId: 'inv_1' };
    },
  });
  expect(result.mode).toBe('canonical-only');
  expect(state.legacyRows).toBe(0);
  expect(state.canonicalRows).toBe(1);
});

it('returns a safe canonical-only code without exposing the cause', async () => {
  await expect(executeStrictFinancialMutation(failingCanonicalOnlyInput()))
    .rejects.toMatchObject({ code: 'CANONICAL_ONLY_WRITE_FAILED', status: 409 });
});
```

- [ ] **Step 2: Run the coordinator test and verify RED**

Run: `pnpm exec vitest run test/canonical/strict-financial-mutation.test.ts`

Expected: FAIL because the coordinator currently always passes legacy statements when enabled.

- [ ] **Step 3: Add stable canonical-only errors and execution mode**

Extend the safe error union:

```ts
| 'CANONICAL_ONLY_PREREQUISITE_MISSING'
| 'CANONICAL_ONLY_WRITE_FAILED'
| 'CANONICAL_ONLY_BOUNDARY_UNSUPPORTED'
| 'CANONICAL_ONLY_LEGACY_ID_UNAVAILABLE'
```

In the coordinator:

```ts
if (policy.writePolicy === 'canonical-only') {
  try {
    return {
      mode: 'canonical-only' as const,
      result: await input.canonical({ authoritativeStatements: [] }),
    };
  } catch (cause) {
    throw new CanonicalStrictFinancialError(
      'CANONICAL_ONLY_WRITE_FAILED',
      'Canonical-only financial write failed',
      { cause },
    );
  }
}
```

Keep the existing legacy path for non-100 and the existing strict path available but disabled unless its exact policy is present.

Update the global error handler to return stable code/message only, before internal error logging.

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```bash
pnpm exec vitest run test/canonical/strict-financial-policy.test.ts test/canonical/strict-financial-mutation.test.ts test/canonical/strict-financial-command-batch.test.ts
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canonical/strict-financial-mutation.ts src/lib/canonical/strict-financial-policy.ts src/index.ts test/canonical/strict-financial-mutation.test.ts
git commit -m "feat: execute tenant-100 canonical-only mutations"
```

## Task 3: Complete Canonical-Only Billing Boundaries

**Files:**
- Modify: `src/routes/tenant/billing.ts`
- Modify: `src/routes/tenant/billingCounter.ts`
- Modify: `src/lib/canonical/live-financial-projection.ts`
- Modify: `src/lib/canonical/commands/apply-deposit.ts`
- Modify: `test/canonical/adjustment-lifecycle.test.ts`
- Modify: `test/integration/routes/tenant-100-strict-financial.test.ts`

- [ ] **Step 1: Rework the current uncommitted route test to canonical-only assertions**

Require the source and route harnesses to prove:

```ts
expect(tenant100Billing.legacyFinancialBatchCalls).toBe(0);
expect(tenant100Billing.canonicalBatchCalls).toBe(1);
expect(tenant101Billing.legacyFinancialBatchCalls).toBe(1);
expect(tenant101Billing.canonicalBatchCalls).toBe(0);
```

For payment without a mapped canonical invoice, require `CANONICAL_ONLY_WRITE_FAILED` and zero legacy writes. For billing-counter payment/deposit modes, require `CANONICAL_ONLY_BOUNDARY_UNSUPPORTED`.

- [ ] **Step 2: Run the route test and verify RED**

Run: `pnpm exec vitest run test/integration/routes/tenant-100-strict-financial.test.ts`

Expected: FAIL because current uncommitted route wiring still assumes strict dual-write behavior.

- [ ] **Step 3: Finish billing create and payment behavior**

In `billing.ts`, keep the existing validation and legacy statement construction for non-100 tenants, but pass those statements only to the coordinator. The coordinator discards them in canonical-only mode.

For bill creation, build deterministic canonical lines and call:

```ts
const execution = await executeStrictFinancialMutation({
  db: c.env.DB,
  tenantId: String(tenantId),
  boundary: 'billing.create',
  legacyStatements: creationBatch,
  canonical: (options) => issueInvoice(c.env.DB, canonicalInput, options),
});
```

When `execution.mode === 'canonical-only'`, return a diagnostic response containing `canonicalInvoiceId`, `invoiceNo`, `mode: 'canonical-only'`, and no fabricated numeric `billId`.

For payment, require an existing canonical invoice mapping. Missing mapping throws `CANONICAL_ONLY_PREREQUISITE_MISSING` before a legacy statement executes.

- [ ] **Step 4: Finish billing-counter credit-only behavior**

Allow only invoice creation with `payment.paid === 0` and `payment.depositDeducted === 0` in canonical-only mode. Return the canonical invoice ID. Embedded payment/deposit modes throw `CANONICAL_ONLY_BOUNDARY_UNSUPPORTED`.

The provisional branch calls the unsupported-boundary guard before its legacy batch.

- [ ] **Step 5: Keep atomic live deposit receipt authority tested but do not expose legacy deposit routes**

Complete the current `RecordDepositInput.receiptAuthority` and `buildLiveDepositProjection` changes. These are canonical command capabilities only; tenant-100 legacy deposit route requests remain blocked by Task 4 until their response contract is intentionally adapted.

- [ ] **Step 6: Run route, command, and type regressions**

Run:

```bash
pnpm exec vitest run test/integration/routes/tenant-100-strict-financial.test.ts test/integration/routes/billing-counter.test.ts test/canonical/issue-invoice.test.ts test/canonical/collect-payment.test.ts test/canonical/adjustment-lifecycle.test.ts
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/routes/tenant/billing.ts src/routes/tenant/billingCounter.ts src/lib/canonical/live-financial-projection.ts src/lib/canonical/commands/apply-deposit.ts test/canonical/adjustment-lifecycle.test.ts test/integration/routes/tenant-100-strict-financial.test.ts
git commit -m "feat: route demo billing to canonical only"
```

## Task 4: Fail Closed Before Unsupported Tenant-100 Financial Routes

**Files:**
- Create: `src/middleware/canonical-only-financial-guard.ts`
- Modify: `src/index.ts`
- Create: `test/canonical/canonical-only-financial-guard.test.ts`
- Modify: `src/lib/canonical/strict-financial-boundaries.ts`

- [ ] **Step 1: Write the failing centralized guard tests**

```ts
it.each([
  ['POST', '/api/deposits'],
  ['POST', '/api/deposits/refund'],
  ['POST', '/api/deposits/adjust'],
  ['POST', '/api/credit-notes/1/approve'],
  ['POST', '/api/billing-cancellation/1/cancel'],
  ['POST', '/api/ip-billing/items'],
  ['POST', '/api/settlements'],
])('blocks tenant-100 legacy financial mutation %s %s', async (method, path) => {
  const result = await evaluateCanonicalOnlyFinancialRequest({ tenantId: '100', method, path, policy: canonicalOnly });
  expect(result).toEqual({ allowed: false, code: 'CANONICAL_ONLY_BOUNDARY_UNSUPPORTED' });
});

it('allows the two adapted tenant-100 boundaries', async () => {
  await expect(evaluateCanonicalOnlyFinancialRequest({ tenantId: '100', method: 'POST', path: '/api/billing', policy: canonicalOnly }))
    .resolves.toEqual({ allowed: true });
  await expect(evaluateCanonicalOnlyFinancialRequest({ tenantId: '100', method: 'POST', path: '/api/billing/pay', policy: canonicalOnly }))
    .resolves.toEqual({ allowed: true });
});

it('does not inspect or block non-100 tenants', async () => {
  await expect(evaluateCanonicalOnlyFinancialRequest({ tenantId: '101', method: 'POST', path: '/api/deposits', policy: legacy }))
    .resolves.toEqual({ allowed: true });
});
```

- [ ] **Step 2: Run the guard test and verify RED**

Run: `pnpm exec vitest run test/canonical/canonical-only-financial-guard.test.ts`

Expected: FAIL because the middleware does not exist.

- [ ] **Step 3: Implement the explicit mutation route registry**

Export immutable path matchers for all known legacy financial writer families:

```ts
const BLOCKED_FINANCIAL_PREFIXES = [
  '/api/deposits', '/api/credit-notes', '/api/billing-cancellation',
  '/api/billing-provisional', '/api/ip-billing', '/api/payments',
  '/api/settlements', '/api/approvals', '/api/reception',
] as const;

const ADAPTED = new Set(['POST /api/billing', 'POST /api/billing/pay']);
```

Add exact patterns for billing-counter invoice creation and the known appointment/lab/pharmacy/radiology financial mutation endpoints discovered by the existing writer scan. Read methods remain allowed. Any tenant-100 canonical-only mutation matching a blocked prefix but not `ADAPTED` throws `CANONICAL_ONLY_BOUNDARY_UNSUPPORTED` before `next()`.

- [ ] **Step 4: Mount after tenant context and before route dispatch**

In `src/index.ts`, mount the middleware after tenant/auth middleware has populated `tenantId`, and before `app.route(...)` registrations execute.

- [ ] **Step 5: Run guard and route regressions**

Run:

```bash
pnpm exec vitest run test/canonical/canonical-only-financial-guard.test.ts test/integration/routes/appointment-billing-handoff.test.ts test/integration/routes/ip-billing.test.ts test/integration/routes/billing-cancellation.test.ts test/integration/routes/refund-approval-cash-holds.test.ts
pnpm exec tsc --noEmit --pretty false
```

Expected: PASS; non-100 fixtures remain unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/middleware/canonical-only-financial-guard.ts src/lib/canonical/strict-financial-boundaries.ts src/index.ts test/canonical/canonical-only-financial-guard.test.ts
git commit -m "fix: block unsupported demo financial mutations"
```

## Task 5: Add the Guarded Canonical-Only Flag Wrapper

**Files:**
- Create: `scripts/canonical/set-production-canonical-only-financial-flag.ts`
- Create: `test/canonical/tenant-canonical-only-flag.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write failing exact-SQL and zero-process tests**

```ts
it('builds only the exact tenant-100 canonical-only flag SQL', () => {
  const sql = buildCanonicalOnlyFlagSql(validAuthorization());
  expect(sql).toContain("'100','canonical_financial_dual_write_v1','financial','canonical',1");
  expect(sql).toContain('{"tenantScope":["100"],"writePolicy":"canonical-only"}');
  expect(sql).not.toMatch(/tenant_id\s*!=|canonical_reporting_v1/);
});

it.each(['wrong tenant', 'expired authorization', 'missing candidate evidence', 'missing rollback rehearsal'])
('starts zero child processes for %s', async (fault) => {
  const result = await invokeWrapper(fixture(fault));
  expect(result.externalCommandCount).toBe(0);
  expect(result.productionMutationPerformed).toBe(false);
});
```

- [ ] **Step 2: Run the wrapper test and verify RED**

Run: `pnpm exec vitest run test/canonical/tenant-canonical-only-flag.test.ts`

Expected: FAIL because the wrapper does not exist.

- [ ] **Step 3: Implement guarded enable/disable**

Enable writes exactly one tenant/key row with mode `canonical` and canonical-only JSON. Disable uses exact tenant/key/version guard and sets `mode='disabled', is_enabled=0`.

Before any Wrangler child process, require candidate version evidence, tenant-101 legacy smoke, tenant-100 zero-legacy-write smoke, safe error evidence, and rollback rehearsal. Read before/write/read after and require exactly one logical row change.

- [ ] **Step 4: Add the package command and run tests**

Add:

```json
"canonical:set-production-canonical-only-flag": "tsx scripts/canonical/set-production-canonical-only-financial-flag.ts"
```

Run: `pnpm exec vitest run test/canonical/tenant-canonical-only-flag.test.ts test/canonical/production-cutover-contract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/canonical/set-production-canonical-only-financial-flag.ts test/canonical/tenant-canonical-only-flag.test.ts package.json
git commit -m "feat: guard tenant-100 canonical-only activation"
```

## Task 6: Verify, Deploy Candidate, and Activate Tenant 100

**Files:**
- Create: `docs/database/migration-runs/production/CDB-101-tenant-100-canonical-only-activation.md`
- No protected evidence is committed.

- [ ] **Step 1: Write and commit the operator runbook**

Document:

```text
read-only live identity and flag check
-> focused/full tests and production build
-> zero-traffic candidate upload
-> tenant-101 legacy-only smoke
-> tenant-100 canonical-only zero-legacy-write smoke
-> guarded flag enable
-> immediate error/tenant-isolation observation
-> GO or guarded disable
```

Run `git diff --check`, stage only the runbook, and commit with `docs: add tenant-100 canonical-only runbook`.

- [ ] **Step 2: Run focused and canonical verification**

```bash
pnpm exec vitest run test/canonical/strict-financial-policy.test.ts test/canonical/strict-financial-mutation.test.ts test/canonical/canonical-only-financial-guard.test.ts test/canonical/tenant-canonical-only-flag.test.ts test/integration/routes/tenant-100-strict-financial.test.ts
pnpm exec vitest run test/canonical
pnpm exec tsc --noEmit --pretty false
pnpm build
```

Expected: every command exits `0`.

- [ ] **Step 3: Verify Cloudflare authentication and live steady state**

Run:

```bash
npx wrangler whoami
pnpm exec wrangler deployments list --env production --name hms-saas-production --json
pnpm exec wrangler versions list --env production --name hms-saas-production --json
```

Verify legacy remains at `100%`, current tenant-100 financial flag is absent/disabled, and no other tenant has the flag.

- [ ] **Step 4: Build and upload a zero-traffic candidate**

Run `pnpm build && npx wrangler deploy --env production --dry-run --outdir /private/tmp/cdb101-canonical-only-build`, then use the existing version-upload procedure without changing public traffic. Confirm the new candidate is `0%` and the current version remains `100%`.

- [ ] **Step 5: Smoke tenant isolation and rollback**

Use authenticated candidate requests and aggregate-only DB evidence:

- Tenant `101` adapted and blocked-prefix routes remain legacy-only.
- Tenant `100` adapted routes produce canonical facts and zero legacy financial row changes.
- Tenant `100` unsupported routes return `CANONICAL_ONLY_BOUNDARY_UNSUPPORTED` and zero row changes.
- Guarded disable rehearsal restores legacy mode.

- [ ] **Step 6: Enable the exact tenant-100 flag**

Run `pnpm canonical:set-production-canonical-only-flag -- --operation enable ...` with protected candidate, smoke, authorization, and rollback evidence. Verify exact after-state and confirm no other tenant row changed.

- [ ] **Step 7: Observe and decide**

For the initial observation window, record only stable error codes, boundary IDs, counts, latency, Worker version, and flag state. Cross-tenant effects, tenant-100 legacy financial writes, partial canonical batches, or sensitive log output are immediate `NO_GO`; execute the guarded disable operation and verify tenant-100 legacy mode.
