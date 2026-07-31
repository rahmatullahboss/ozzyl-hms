# Multi-Tenant Canonical Shadow Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable supported canonical financial shadow projection for every exactly flagged tenant without changing legacy authority or broadening strict mode.

**Architecture:** Keep rollout authorization in the tenant-scoped feature-policy resolver. Make the live projection builder tenant-generic by validating a positive decimal tenant ID, then use the existing command and source-mapping layers unchanged so every canonical row remains tenant-scoped.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers, D1/SQLite, Wrangler.

## Global Constraints

- Legacy writes remain authoritative and commit before canonical shadow writes.
- Canonical failure must not block user-facing transactions in shadow mode.
- Strict mode remains tenant-100-only.
- No global wildcard tenant flag.
- No fake production billing transaction.

---

### Task 1: Reproduce and Fix Tenant Projection Restriction

**Files:**
- Modify: `test/canonical/live-financial-projection.test.ts`
- Modify: `src/lib/canonical/live-financial-projection.ts`

**Interfaces:**
- Consumes: existing `buildLiveInvoiceProjection`, `buildLivePaymentProjection`, and tenant-scoped policy behavior.
- Produces: projection builders accepting any positive decimal tenant ID while preserving the same return types.

- [ ] **Step 1: Write the failing tenant-example regression test**

Add a test that builds an invoice and payment projection with `tenantId: '102'` and asserts the returned projection and source identity retain tenant `102`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run test/canonical/live-financial-projection.test.ts`

Expected: FAIL with `Live canonical financial projection is restricted to tenant 100`.

- [ ] **Step 3: Implement the minimal generic tenant validator**

Replace the tenant-100-only guard with a validator that requires:

```ts
const normalized = tenantId.trim();
if (normalized !== tenantId || !/^[1-9]\d*$/.test(normalized)) throw new RangeError(...);
const numericTenantId = Number(normalized);
if (!Number.isSafeInteger(numericTenantId) || numericTenantId <= 0) throw new RangeError(...);
return normalized;
```

Use this validator wherever the current `tenant100()` helper is called. Do not change strict-policy restrictions.

- [ ] **Step 4: Add invalid tenant identifier coverage**

Assert rejection for empty, whitespace-padded, zero, negative, decimal, and unsafe-integer tenant IDs.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm vitest run test/canonical/live-financial-projection.test.ts test/canonical/billing-counter-settlement.test.ts test/canonical/strict-financial-policy.test.ts`

Expected: all tests pass.

### Task 2: Full Verification and Release

**Files:**
- Modify only if verification exposes a directly related defect.

**Interfaces:**
- Consumes: Task 1 implementation.
- Produces: immutable production Worker version with tenant-generic canonical shadow projection.

- [ ] **Step 1: Run canonical regression suite**

Run: `pnpm vitest run test/canonical`

Expected: all canonical tests pass.

- [ ] **Step 2: Run canonical invariant check**

Run: `pnpm canonical:check`

Expected: zero issues.

- [ ] **Step 3: Run typecheck and build**

Run: `pnpm exec tsc --noEmit`

Run: `pnpm build`

Expected: both succeed.

- [ ] **Step 4: Commit and push the verified change**

Commit message: `fix(canonical): enable tenant-scoped shadow projection`

- [ ] **Step 5: Upload immutable production candidate**

Use the repository's existing version-upload release command, tag it with the source commit, and keep current production traffic unchanged during candidate verification.

- [ ] **Step 6: Verify candidate and promote to 100%**

Run candidate-bound `/api/health` and authenticated production smoke checks. Promote only after exact version verification succeeds.

- [ ] **Step 7: Verify production flags and issues read-only**

Confirm all four current tenants retain exact `shadow` flags, latest Worker serves 100% traffic, and tenant `102` has no new post-deploy shadow failure before a new real transaction. After the next real tenant-example transaction, compare its legacy bill/payment with canonical invoice/receipt/allocation.
