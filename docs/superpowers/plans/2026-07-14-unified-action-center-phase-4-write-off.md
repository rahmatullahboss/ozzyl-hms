# Unified Action Center Phase 4: Canonical-Ready Controlled Receivable Write-Off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a collector to request a partial or full receivable write-off while requiring a separate authorised approver and executing the approved adjustment through the active legacy or canonical adjustment authority without creating a second financial engine.

**Architecture:** Add `receivable_write_off` to the existing approval engine. Collection workflow stores the request state; financial execution is delegated to `ReceivableAdjustmentAuthority`. Legacy mode reuses the current audited credit-note/accounting flow. Canonical mode creates `canonical_credit_notes` and updates canonical invoice projections using the CDB-061 command contract. Shadow mode executes the active legacy command and records canonical reconciliation evidence without allowing a shadow mismatch to change the served balance. Request and execution payloads use stable invoice references, integer minor units, explicit currency, and idempotency keys.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, existing approval engine, legacy billing credit notes/accounting, canonical invoices/credit notes, React, Vitest.

## Canonical Contracts Reviewed

- `canonical_invoices.invoice_public_id`, `currency_code`, `due_minor`, `credited_minor`, `net_due_minor`
- `canonical_credit_notes` and `canonical_credit_note_lines` from CDB-061
- `canonical_feature_flags` mode resolution
- `canonical_source_mappings` for legacy bill → canonical invoice evidence
- Legacy `bills`, `billing_credit_notes`, and accounting posting remain transitional authorities until cutover

## Global Constraints

- Migration number: `0526_receivable_write_off_approval.sql`.
- The original reserved `0502` slot is no longer safe: current migration `0516_two_person_approval_policy.sql` adds approval columns, so a lower-order rebuild could run before `0516` on fresh databases but after it on filename-tracked upgraded databases. Use `0526` to preserve one deterministic schema order.
- Do not use isolated canonical migration numbers `0423–0433`.
- Requester and final approver must be different users.
- Requested money is `amountMinor: number` and `currencyCode: string`; it must be a positive safe integer and match live source currency.
- Requested amount must not exceed live due at request or execution time.
- Never trust client-supplied due, authority mode, mapping, or invoice status.
- Only one pending `receivable_write_off` request may exist per collection case/source.
- Approval execution must use the existing conditional execution lock and a deterministic idempotency key.
- No code may directly decrement a balance without producing the authority's credit-note, accounting/outbox, and audit evidence.
- In canonical mode, execution requires deployed/reconciled canonical invoice/payment/adjustment schema. Misconfiguration returns a financial-service error; no fallback is allowed.
- In shadow mode, legacy remains authoritative and canonical comparison is evidence only.
- Rejection must not close a collection case and must append approval plus collection events.
- Backend service tests belong under `test/action-center/collections/` or `test/billing/`, not source-adjacent paths excluded by root Vitest.

---

### Task 1: Expand approval type constraint safely

**Files:**
- Create: `migrations/0526_receivable_write_off_approval.sql`
- Create: `test/migrations/receivable-write-off-approval.test.ts`
- Modify: `src/schemas/approval.ts`
- Modify: approval type constants in `src/routes/tenant/approvals.ts`

**Interfaces:**

- Adds approval type `receivable_write_off`.
- Preserves every current `approval_requests` column, row, index, execution-lock field, and information-request field.

- [ ] **Step 1: Write failing migration tests**

Assert the rebuilt CHECK constraint contains every supported type plus `receivable_write_off`; verify existing rows, indexes, and post-0380 columns survive.

- [ ] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run test/migrations/receivable-write-off-approval.test.ts
```

- [ ] **Step 3: Implement safe table rebuild**

Derive the full current table from migration history and SQLite schema tests. Do not copy migration `0380` blindly.

- [ ] **Step 4: Add schema and UI type support**

Map `receivable_write_off` to deterministic labels and filtering without changing other approval types.

- [ ] **Step 5: Run gates**

```bash
pnpm exec vitest run test/migrations/receivable-write-off-approval.test.ts
pnpm build:migrations
pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add migrations/0526_receivable_write_off_approval.sql test/migrations/receivable-write-off-approval.test.ts src/schemas/approval.ts src/routes/tenant/approvals.ts docs/database/legacy-table-disposition.yaml

git commit -m "feat(approvals): add canonical-ready write-off type"
```

---

### Task 2: Build receivable adjustment authority adapters

**Files:**
- Create: `src/services/billing/receivableAdjustment/types.ts`
- Create: `src/services/billing/receivableAdjustment/authority.ts`
- Create: `src/services/billing/receivableAdjustment/legacyCreditNote.ts`
- Create: `src/services/billing/receivableAdjustment/canonicalCreditNote.ts`
- Create: `test/billing/receivable-adjustment-authority.test.ts`
- Create: `test/billing/legacy-credit-note.test.ts`
- Create: `test/billing/canonical-credit-note.test.ts`
- Review only: `src/routes/tenant/creditNotes.ts` — keep its item-return and cash-refund workflow unchanged; the new zero-cash receivable adapter is consumed by controlled approval execution in Task 4.

**Interfaces:**

```ts
export interface ReceivableAdjustmentInput {
  db: D1Database;
  tenantId: string;
  source: ReceivableSourceRef;
  amountMinor: number;
  currencyCode: string;
  reasonCode: string;
  note?: string;
  actorId: number;
  sourceType: 'credit_note' | 'receivable_write_off';
  sourceRequestId: number;
  idempotencyKey: string;
}

export interface ReceivableAdjustmentResult {
  authorityMode: 'legacy' | 'shadow' | 'canonical';
  adjustmentPublicId: string;
  legacyCreditNoteId?: number;
  canonicalCreditNotePublicId?: string;
  previousDueMinor: number;
  newDueMinor: number;
  appliedAmountMinor: number;
  currencyCode: string;
}

export async function applyReceivableAdjustment(
  input: ReceivableAdjustmentInput,
): Promise<ReceivableAdjustmentResult>;
```

Authority rules:

- Reuse Phase 3 `resolveReceivableAuthority`.
- Legacy adapter wraps the current route-local credit-note/accounting behaviour and converts minor units only at the adapter boundary.
- Canonical adapter creates `canonical_credit_notes` and line evidence, conditionally updates `credited_minor`/`net_due_minor`, and emits canonical outbox/accounting evidence defined by the canonical program.
- Shadow adapter executes legacy and writes comparison/outbox evidence only when canonical schema is available; it never changes the response balance to a shadow value.
- Duplicate idempotency keys return the original successful result.

- [x] **Step 1: Write failing authority tests**

Cover legacy, shadow, canonical, missing canonical schema, source mapping, and currency mismatch.

- [x] **Step 2: Write failing legacy adapter tests**

Cover partial/full credit, over-due rejection, terminal bill rejection, accounting/audit preservation, idempotency, tenant isolation, and major/minor conversion.

- [x] **Step 3: Write failing canonical adapter tests**

Cover canonical credit-note header/line, integer projection guards, posted/reversed invoice rejection, same-batch conditional update, outbox evidence, idempotency, and tenant isolation.

- [x] **Step 4: Run and verify RED**

```bash
pnpm exec vitest run test/billing/receivable-adjustment-authority.test.ts test/billing/legacy-credit-note.test.ts test/billing/canonical-credit-note.test.ts
```

- [x] **Step 5: Implement adapters and preserve the existing credit-note route boundary**

The shared adapter implements zero-cash receivable adjustment for controlled approval execution. The existing item-return/cash-refund credit-note route remains unchanged and retains its existing response and accounting contracts. Canonical mode is never enabled by code default; feature flags and deployed schema control it.

- [x] **Step 6: Run focused tests**

Run the same tests plus existing credit-note/approval integration suites.

- [x] **Step 7: Commit**

```bash
git add src/services/billing/receivableAdjustment test/billing docs/superpowers

git commit -m "refactor(billing): add receivable adjustment authority"
```

---

### Task 3: Create controlled write-off request service

**Files:**
- Create: `src/services/actionCenter/collections/writeOff.ts`
- Create: `test/action-center/collections/write-off.test.ts`

**Interfaces:**

```ts
export interface WriteOffRequestInput {
  db: D1Database;
  tenantId: string;
  source: ReceivableSourceRef;
  requesterId: number;
  amountMinor: number;
  currencyCode: string;
  reasonCode: 'uncollectible' | 'financial_hardship' | 'billing_dispute' | 'deceased' | 'administrative_adjustment' | 'other';
  note: string;
  evidenceUrls?: string[];
}

export async function createReceivableWriteOffRequest(
  input: WriteOffRequestInput,
): Promise<{ approvalId: number; collectionCaseId: number }>;
```

`request_data` must include structured source references, `amountMinor`, `currencyCode`, live due at request, resolved authority mode, reason, evidence, previous collection status, and source evidence identifiers. It must not store a client-provided due as truth.

- [x] **Step 1: Write failing tests**

Cover safe-integer validation, live due/currency lookup, duplicate pending request, source mapping, lazy collection case creation, tenant isolation, and one batch containing approval creation, collection transition, approval event, and collection event.

- [x] **Step 2: Run and verify RED**

```bash
pnpm exec vitest run test/action-center/collections/write-off.test.ts
```

- [x] **Step 3: Implement request creation**

Use the Phase 3 authority adapter for live source evidence. Persist the resolved mode for audit, but resolve it again at execution time. Legacy-only stable references are mapped to canonical invoice identity when canonical authority is active.

- [x] **Step 4: Run and verify GREEN**

Run the same command.

- [x] **Step 5: Commit**

```bash
git add src/services/actionCenter/collections/writeOff.ts src/services/actionCenter/collections/liveSource.ts test/action-center/collections/write-off.test.ts test/billing/receivable-adjustment-authority.test.ts docs/superpowers

git commit -m "feat(collections): create controlled write-off requests"
```

---

### Task 4: Execute approval and rejection outcomes

**Files:**
- Modify: `src/routes/tenant/approvals.ts`
- Create: `src/services/actionCenter/collections/writeOffExecution.ts`
- Create: `test/action-center/collections/write-off-execution.test.ts`
- Modify: `test/integration/routes/approvals.test.ts`

**Interfaces:**

```ts
export async function executeReceivableWriteOffApproval(input: {
  db: D1Database;
  tenantId: string;
  approvalId: number;
  approverId: number;
  reviewNotes: string;
}): Promise<{
  adjustmentPublicId: string;
  newDueMinor: number;
  currencyCode: string;
  collectionStatus: string;
}>;

export async function rejectReceivableWriteOffApproval(input: {
  db: D1Database;
  tenantId: string;
  approvalId: number;
  approverId: number;
  reviewNotes: string;
}): Promise<{ collectionStatus: string }>;
```

- [x] **Step 1: Write failing approval tests**

Prove requester cannot approve; live mode, due, currency, and mapping are revalidated; amount is never silently reduced; execution lock prevents duplicates; full write-off closes; partial write-off returns to actionable status; and events link approval, adjustment, invoice, and collection case.

- [x] **Step 2: Write failing rejection tests**

Prove mandatory notes, restoration of previous state, source-terminal reconciliation, collection event, and no financial mutation.

- [x] **Step 3: Run and verify RED**

```bash
pnpm exec vitest run test/action-center/collections/write-off-execution.test.ts
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/approvals.test.ts
```

- [x] **Step 4: Implement execution handlers**

Lock approval execution conditionally, then call `applyReceivableAdjustment` with `receivable-write-off:${approvalId}`. Failed financial execution marks the attempt failed/retryable without creating duplicate adjustments; successful route retries replay the stored result.

- [x] **Step 5: Implement rejection restoration**

Update approval and collection events atomically. Reconcile paid/cancelled/reversed sources instead of restoring a stale open state.

- [x] **Step 6: Run and verify GREEN**

Run both commands again.

- [x] **Step 7: Commit**

```bash
git add src/routes/tenant/approvals.ts src/services/actionCenter/collections/writeOffExecution.ts test/action-center/collections/write-off-execution.test.ts test/integration/routes/approvals.test.ts

git commit -m "feat(approvals): execute authority-aware write-offs"
```

---

### Task 5: Add write-off API and user experience

**Files:**
- Modify: `packages/shared/src/authz.ts`
- Modify: `src/routes/tenant/actionCenterCollections.ts`
- Modify: `src/routes/tenant/approvals.ts`
- Modify: `test/authz.test.ts`
- Modify: `test/integration/routes/action-center-collections.test.ts`
- Modify: `test/integration/routes/approvals.test.ts`
- Modify: `web/src/components/action-center/CollectionDetailDrawer.tsx`
- Modify: `web/src/components/action-center/CollectionDetailDrawer.test.tsx`
- Modify: `web/src/pages/admin/PendingApprovals.tsx`
- Modify: `web/src/pages/admin/PendingApprovals.test.tsx`
- Modify: `web/src/components/admin/ApprovalDetailDrawer.tsx`
- Modify: `web/src/components/admin/ApprovalDetailDrawer.test.tsx`
- Modify: admin receivable/approval locale files

**Interfaces:**

- `POST /api/action-center/collections/invoice/:sourceKey/write-off-request`

```ts
const writeOffRequestSchema = z.object({
  amountMinor: z.number().int().safe().positive(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  reasonCode: z.enum(['uncollectible','financial_hardship','billing_dispute','deceased','administrative_adjustment','other']),
  note: z.string().trim().min(10).max(2000),
  evidenceUrls: z.array(z.string().url()).max(10).optional(),
});
```

- [x] **Step 1: Write failing API tests**

Cover permission, source key, minor amount/currency validation, duplicate conflict, tenant isolation, success, live source mismatch, and linked approval detail.

- [x] **Step 2: Write failing UI tests**

Cover amount default from live `dueMinor`, API currency, reason/note/evidence, financial warning, loading state, duplicate conflict, retained values after error, approval evidence, requester/approver separation, and execution failure recovery.

- [x] **Step 3: Run and verify RED**

```bash
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/action-center-collections.test.ts
pnpm --filter web exec vitest run src/components/action-center/CollectionDetailDrawer.test.tsx src/pages/admin/PendingApprovals.test.tsx src/components/admin/ApprovalDetailDrawer.test.tsx
```

- [x] **Step 4: Implement endpoint and dialogs**

Use structured dialogs, visible labels, inline validation, one primary submit action, and no browser prompts. UI must display API-provided currency and authority evidence; it must not choose the authority.

- [x] **Step 5: Run and verify GREEN**

Run both commands again.

- [x] **Step 6: Commit**

```bash
git add src/routes/tenant/actionCenterCollections.ts test/integration/routes/action-center-collections.test.ts web/src/components/action-center/CollectionDetailDrawer.tsx web/src/components/action-center/CollectionDetailDrawer.test.tsx web/src/pages/admin/PendingApprovals.tsx web/src/pages/admin/PendingApprovals.test.tsx web/src/components/admin/ApprovalDetailDrawer.tsx web/src/components/admin/ApprovalDetailDrawer.test.tsx web/public/locales

git commit -m "feat(write-off): add authority-aware maker-checker workflow"
```

---

### Task 6: Phase 4 verification and canonical financial gate

- [x] **Step 1: Run migration/service tests**

```bash
pnpm exec vitest run test/migrations/receivable-write-off-approval.test.ts test/billing/receivable-adjustment-authority.test.ts test/billing/legacy-credit-note.test.ts test/billing/canonical-credit-note.test.ts test/action-center/collections/write-off.test.ts test/action-center/collections/write-off-execution.test.ts
```

- [x] **Step 2: Run integration/frontend tests**

```bash
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/approvals.test.ts test/integration/routes/action-center-collections.test.ts
pnpm --filter web exec vitest run src/components/action-center/CollectionDetailDrawer.test.tsx src/pages/admin/PendingApprovals.test.tsx src/components/admin/ApprovalDetailDrawer.test.tsx
```

- [x] **Step 3: Run full gates**

```bash
pnpm build:migrations
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

- [x] **Step 4: Adversarial financial review**

Review concurrent payment vs approval, authority-mode changes between request/execution, mapping changes, duplicate request/execution, minor-unit precision, mixed currency, accounting/outbox balance, terminal invoice states, requester/approver separation, rejection restoration, tenant isolation, and audit linkage.

- [x] **Step 5: Record release boundary**

Legacy-mode release may proceed after current credit-note/accounting candidate checks. Canonical or shadow execution must remain disabled until the canonical foundation, invoice, payment, adjustment, outbox/accounting commands, backfills, and reconciliations are integrated and production-verified.

- [x] **Step 6: Commit review fixes**

```bash
git add migrations src web test docs/superpowers

git commit -m "feat(action-center): complete canonical-ready write-off phase"
```
