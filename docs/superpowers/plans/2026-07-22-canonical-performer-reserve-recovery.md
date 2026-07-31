# Canonical Performer Reserve Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make live performer-reserve shadow writes recover missing canonical invoice lines and billing-service mappings using deterministic, fail-closed canonical identities.

**Architecture:** Extract the already-proven legacy bill line recovery from doctor compensation into a shared canonical resolver, then use the resolver from both doctor compensation and performer reserve. Add a focused live billing-service catalog recovery that creates only the canonical catalog item and source mapping required by compensation, while leaving price migration to the existing backfill program.

**Tech Stack:** TypeScript, Cloudflare D1-compatible prepared statements, SQLite test harness, Vitest, canonical deterministic source IDs and evidence hashes.

## Global Constraints

- Do not deploy, change production flags, resolve production issues, or execute production mutations.
- Preserve legacy authority and shadow-mode success semantics.
- Fail closed on conflicting canonical mappings.
- Use TDD: every production-code change must be preceded by a test that fails for the expected reason.
- Keep the branch isolated from the user's pending unmerged update.

---

### Task 1: Shared Legacy Invoice-Line Authority Resolver

**Files:**
- Create: `src/lib/canonical/legacy-live-invoice-line-authority.ts`
- Modify: `src/lib/canonical/live-doctor-compensation.ts`
- Test: `test/canonical/live-doctor-compensation.test.ts`

**Interfaces:**
- Produces: `resolveLegacyLiveInvoiceLineAuthority(db, input): Promise<LegacyLiveInvoiceLineAuthority>`
- `LegacyLiveInvoiceLineAuthority` contains `invoicePublicId`, `invoiceLinePublicId`, `lineAmountMinor`, `invoiceStatus`, and `authority: 'live_gross' | 'legacy_recovered_net'`.

- [ ] **Step 1: Add a regression test proving doctor compensation still recovers a missing canonical invoice through the shared resolver contract**

Add a focused assertion to the existing missing-invoice test that verifies the returned canonical result uses the expected invoice and line public IDs and that only one canonical invoice exists.

- [ ] **Step 2: Run the focused test before implementation**

Run: `pnpm vitest run test/canonical/live-doctor-compensation.test.ts`
Expected: FAIL because the shared resolver export/module does not exist after the test imports it or asserts its new contract.

- [ ] **Step 3: Implement the shared resolver**

The resolver must:

```ts
export interface LegacyLiveInvoiceLineAuthorityInput {
  tenantId: string;
  billId: number;
  invoiceNo: string;
  invoiceSourceLineId: string;
}

export interface LegacyLiveInvoiceLineAuthority {
  invoicePublicId: string;
  invoiceLinePublicId: string;
  lineAmountMinor: number;
  invoiceStatus: string;
  authority: 'live_gross' | 'legacy_recovered_net';
}
```

It must read the direct live line, call `ensureCanonicalInvoiceForLegacyBill` if absent, retry, then resolve the invoice-item-backed line by source-line ordinal. It must throw `Canonical invoice line not found for financial projection` only after all deterministic recovery paths fail.

- [ ] **Step 4: Refactor doctor compensation to use the shared resolver**

Remove the private duplicate line-reading and recovered-line functions. Preserve the existing gross/discount behavior exactly:

```ts
const grossMinor = authority.authority === 'legacy_recovered_net'
  ? authority.lineAmountMinor
  : legacyGrossMinor;
const discountMinor = authority.authority === 'legacy_recovered_net'
  ? 0
  : legacyDiscountMinor;
```

- [ ] **Step 5: Run doctor compensation tests**

Run: `pnpm vitest run test/canonical/live-doctor-compensation.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/lib/canonical/legacy-live-invoice-line-authority.ts src/lib/canonical/live-doctor-compensation.ts test/canonical/live-doctor-compensation.test.ts
git commit -m "refactor(canonical): share legacy invoice line recovery"
```

### Task 2: Performer Reserve Invoice Recovery

**Files:**
- Modify: `src/lib/canonical/live-performer-reserve.ts`
- Modify: `src/lib/diagnostic-performer-reserve.ts`
- Test: `test/canonical/live-performer-reserve.test.ts`

**Interfaces:**
- Consumes: `resolveLegacyLiveInvoiceLineAuthority` from Task 1.
- Adds to `LivePerformerReserveAccrualInput`: `lineNetAmount: DecimalAmount`.

- [ ] **Step 1: Write a failing test for a missing canonical invoice**

Create legacy `bills` and `invoice_items` fixture tables in the performer harness. Execute a reserve against a bill with no canonical invoice and assert shadow canonical success plus one recovered invoice and one canonical reserve accrual.

- [ ] **Step 2: Run the missing-invoice test**

Run: `pnpm vitest run test/canonical/live-performer-reserve.test.ts`
Expected: FAIL with `Canonical invoice line not found for performer reserve`.

- [ ] **Step 3: Write a failing test for legacy recovered net-line authority**

Seed an existing canonical invoice line with `invoice_item:<id>` identity and net line amount. Use gross 1000, discount 100, net 900 and assert canonical reserve links to the recovered line without treating 900 as gross.

- [ ] **Step 4: Run the recovered-net test**

Run: `pnpm vitest run test/canonical/live-performer-reserve.test.ts`
Expected: FAIL with `Canonical invoice line gross does not match performer reserve authority`.

- [ ] **Step 5: Implement performer authority handling**

Use the shared resolver. Validate:

```ts
if (authority.authority === 'live_gross') {
  if (authority.lineAmountMinor !== lineGrossMinor) throw new Error(...);
} else {
  const lineNetMinor = Number(toMinorUnits(input.lineNetAmount));
  if (authority.lineAmountMinor !== lineNetMinor) throw new Error(...);
}
```

Pass `lineNetAmount` from `createBillDiagnosticPerformerReserves` as the full diagnostic line net service amount, not the unit net amount.

- [ ] **Step 6: Run performer reserve tests**

Run: `pnpm vitest run test/canonical/live-performer-reserve.test.ts`
Expected: PASS for missing invoice, recovered net line, and existing multi-unit behavior.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/lib/canonical/live-performer-reserve.ts src/lib/diagnostic-performer-reserve.ts test/canonical/live-performer-reserve.test.ts
git commit -m "fix(canonical): recover performer reserve invoice authority"
```

### Task 3: Live Billing-Service Mapping Recovery

**Files:**
- Create: `src/lib/canonical/live-service-catalog-recovery.ts`
- Modify: `src/lib/canonical/live-performer-reserve.ts`
- Test: `test/canonical/live-performer-reserve.test.ts`

**Interfaces:**
- Produces: `ensureCanonicalBillingServiceMapping(db, { tenantId, billingServiceItemId }): Promise<string>`.

- [ ] **Step 1: Write a failing test for a missing billing-service mapping**

Seed `billing_service_departments` and `billing_service_items`, but no canonical service or source mapping. Execute a performer reserve and assert the deterministic service catalog item and mapped source row are created.

- [ ] **Step 2: Run the missing-mapping test**

Run: `pnpm vitest run test/canonical/live-performer-reserve.test.ts`
Expected: FAIL with `Canonical service mapping not found for performer reserve`.

- [ ] **Step 3: Implement deterministic live service recovery**

Read the source row and department. Use the same normalized code, department classification, deterministic public ID, and evidence fields as `scripts/canonical/backfill-service-catalog.ts`. Insert the catalog item and mapping idempotently, then re-read the mapping and require `mapped` status with the deterministic public ID.

Do not create a canonical price row.

- [ ] **Step 4: Write a conflicting-mapping test**

Seed a mapping for the same source to a different canonical public ID. Assert shadow mode commits the legacy reserve, reports canonical failure, and does not overwrite the conflicting mapping.

- [ ] **Step 5: Run performer reserve tests**

Run: `pnpm vitest run test/canonical/live-performer-reserve.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/lib/canonical/live-service-catalog-recovery.ts src/lib/canonical/live-performer-reserve.ts test/canonical/live-performer-reserve.test.ts
git commit -m "fix(canonical): recover performer service mappings"
```

### Task 4: Verification and Review

**Files:**
- Review all changed files.
- Update the design document only if implementation materially differs.

- [ ] **Step 1: Run focused canonical tests**

Run: `pnpm vitest run test/canonical/live-doctor-compensation.test.ts test/canonical/live-performer-reserve.test.ts test/canonical/financial-shadow-issue-recording.test.ts test/canonical/strict-financial-mutation.test.ts`
Expected: all files and tests pass.

- [ ] **Step 2: Run the broader canonical suite used for current financial verification**

Run the repository's canonical focused test command or the same canonical file set previously used for the 98-test verification.
Expected: zero failures.

- [ ] **Step 3: Run TypeScript**

Run: `pnpm exec tsc --project tsconfig.json --noEmit`
Expected: exit 0.

- [ ] **Step 4: Review the diff**

Confirm no production mutation scripts, feature flags, deployment configuration, or unrelated files changed.

- [ ] **Step 5: Commit any final test-only or documentation adjustment**

Use a focused commit message; do not merge or push.
