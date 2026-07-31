# Reception Bank Deposit Custody Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-step reception cash-to-bank workflow where drawer cash first moves into finance custody and reaches the Bank Book only after finance confirmation.

**Architecture:** D1 stores the custody workflow in `bank_deposit_requests`, links each request to one drawer movement and at most one bank transaction, and records deterministic accounting posting events for cash-to-custody and custody-to-bank transitions. Reception controls stay inside `BillingCounterPage`; finance approval and reconciliation live in the existing `CashBankBook` Bank Book tab.

**Tech Stack:** Cloudflare Workers, Hono, D1/SQLite migrations, Zod, React, TanStack Query, Vitest, TypeScript.

---

### Task 1: Schema And Accounting Contracts

**Files:**
- Create: `migrations/0342_bank_deposit_custody.sql`
- Modify: `tenant-schema.sql`
- Modify: `src/db/schema/finance.ts`
- Modify: `src/lib/accounting-posting.ts`
- Test: `test/accounting-posting.test.ts`

- [ ] **Step 1: Write failing accounting tests**

Add tests asserting:

```ts
expect(buildBankDepositCustodyLines({ amount: 25000 }, mappings)).toEqual([
  { accountId: mappings.admin_cash, debit: 25000, credit: 0, memo: 'Cash received into finance custody' },
  { accountId: mappings.cash, debit: 0, credit: 25000, memo: 'Cash removed from counter drawer' },
]);

expect(buildBankDepositConfirmedLines({ amount: 25000 }, mappings)).toEqual([
  { accountId: mappings.bank, debit: 25000, credit: 0, memo: 'Bank deposit confirmed' },
  { accountId: mappings.admin_cash, debit: 0, credit: 25000, memo: 'Finance custody cleared to bank' },
]);
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm vitest run test/accounting-posting.test.ts
```

Expected: failures because the new event types and line builders do not exist.

- [ ] **Step 3: Add migration and schema definitions**

Create `bank_deposit_requests` with tenant-scoped request number and idempotency
uniqueness, state checks, links to counter session/movement/bank transaction,
confirmation/rejection/resolution metadata, and indexes. Add
`bank_deposit_request_id` to `bank_transactions` with a unique partial index.

Rebuild `accounting_posting_events` in the numbered migration so its event-type
check also permits:

```sql
'bank_deposit_custody',
'bank_deposit_confirmed'
```

Mirror fresh-install structures in `tenant-schema.sql` and Drizzle definitions in
`src/db/schema/finance.ts`.

- [ ] **Step 4: Implement accounting event support**

Add:

```ts
bankDepositCustody: 'bank_deposit_custody',
bankDepositConfirmed: 'bank_deposit_confirmed',
```

Implement exported line builders, required mappings, voucher descriptions, and
event dispatch branches using `admin_cash`, `cash`, and `bank`.

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
pnpm vitest run test/accounting-posting.test.ts
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit**

```bash
git add migrations/0342_bank_deposit_custody.sql tenant-schema.sql src/db/schema/finance.ts src/lib/accounting-posting.ts test/accounting-posting.test.ts
git commit -m "feat: add bank deposit custody accounting model"
```

### Task 2: Reception Deposit Request API

**Files:**
- Modify: `src/schemas/billingCounter.ts`
- Modify: `src/routes/tenant/billingCounter.ts`
- Test: `test/integration/routes/billing-counter.test.ts`

- [ ] **Step 1: Write failing request tests**

Cover:

```ts
POST /billing-counter/sessions/17/bank-deposit-requests
```

with an active owned session, `amount`, `proposedBankName`, `note`, and
`idempotencyKey`. Assert one request insert, one linked `cash_drop`, one
`cash_drop_total` update, and one `bank_deposit_custody` event. Add insufficient
cash and idempotent retry cases.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm vitest run test/integration/routes/billing-counter.test.ts
```

Expected: `404` for the missing endpoint.

- [ ] **Step 3: Implement request creation and reception list**

Add strict Zod schemas and:

```ts
POST /sessions/:id/bank-deposit-requests
GET /bank-deposit-requests?mine=true
```

Use `loadActiveBillingCounterSession`, calculate expected cash, resolve an
existing idempotency key before writing, generate the request number with
`getNextSequence`, and execute request/movement/session/event writes in one D1
batch. Return the existing request for a duplicate key.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
pnpm vitest run test/integration/routes/billing-counter.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/schemas/billingCounter.ts src/routes/tenant/billingCounter.ts test/integration/routes/billing-counter.test.ts
git commit -m "feat: add reception bank deposit requests"
```

### Task 3: Finance Confirmation And Rejection API

**Files:**
- Modify: `src/routes/tenant/bank-book.ts`
- Test: `test/integration/routes/cash-book.test.ts`

- [ ] **Step 1: Write failing finance tests**

Add tests for:

```ts
GET  /bank-book/deposit-requests?status=pending
POST /bank-book/deposit-requests/:id/confirm
POST /bank-book/deposit-requests/:id/reject
```

Assert finance-only authorization, exact amount matching, required bank/reference
metadata, one linked bank transaction, deterministic confirmed accounting event,
duplicate-state `409`, and rejection without a bank transaction.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm vitest run test/integration/routes/cash-book.test.ts
```

- [ ] **Step 3: Implement list, confirm, and reject**

Split Bank Book read roles from mutation roles. Confirm only `pending` or
`rejected` requests, require full amount equality, and batch the bank transaction,
request state, and accounting event. Reject only `pending` requests and require a
bounded reason.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
pnpm vitest run test/integration/routes/cash-book.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/bank-book.ts test/integration/routes/cash-book.test.ts
git commit -m "feat: add finance bank deposit approval"
```

### Task 4: Rejected Custody Reconciliation

**Files:**
- Modify: `src/routes/tenant/bank-book.ts`
- Test: `test/integration/routes/cash-book.test.ts`

- [ ] **Step 1: Write failing reconciliation tests**

Test:

```ts
POST /bank-book/deposit-requests/:id/return-to-counter
POST /bank-book/deposit-requests/:id/manual-adjustment
```

Assert rejected-only state, same-tenant active target session, required note,
linked `cash_in`, request resolution metadata, balanced manual accounting event,
and rejection of unbalanced manual lines.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm vitest run test/integration/routes/cash-book.test.ts
```

- [ ] **Step 3: Implement reconciliation endpoints**

Return-to-counter batches `cash_in`, request resolution, and a manual journal from
`admin_cash` to `cash`. Manual adjustment validates active tenant accounts,
positive balanced debit/credit totals, resolves the request, and records the
existing `manual_journal` event.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
pnpm vitest run test/integration/routes/cash-book.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/tenant/bank-book.ts test/integration/routes/cash-book.test.ts
git commit -m "feat: reconcile rejected bank deposit custody"
```

### Task 5: Reception Counter UI

**Files:**
- Modify: `web/src/pages/BillingCounterPage.tsx`
- Modify: `web/public/locales/en/billing.json`
- Modify: `web/public/locales/bn/billing.json`
- Test: `web/src/pages/BillingCounterPage.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Assert reception sees `Bank Deposit Request`, amount cannot exceed expected cash,
submitting calls the new endpoint with an idempotency key, and recent request
status refreshes after success.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --dir web exec vitest run src/pages/BillingCounterPage.test.tsx
```

- [ ] **Step 3: Implement compact counter control**

Add amount, proposed bank, note, submit button, and a recent-request list inside
the active counter card. Invalidate active-session and request queries on success.
Use translation keys for English and Bengali labels/statuses.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
pnpm --dir web exec vitest run src/pages/BillingCounterPage.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/BillingCounterPage.tsx web/public/locales/en/billing.json web/public/locales/bn/billing.json web/src/pages/BillingCounterPage.test.tsx
git commit -m "feat: add reception bank deposit request control"
```

### Task 6: Finance Bank Book UI And Routing

**Files:**
- Modify: `web/src/pages/CashBankBook.tsx`
- Modify: `web/src/pages/__tests__/CashBankBook.test.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/components/dashboard/Sidebar.tsx`
- Modify: `web/src/components/dashboard/adminSidebarConfig.tsx`
- Modify: `web/public/locales/en/sidebar.json`
- Modify: `web/public/locales/bn/sidebar.json`

- [ ] **Step 1: Write failing finance UI tests**

Assert pending and rejected request rows render, confirmation requires bank,
reference, date and exact amount, rejection requires a reason, and reconciliation
actions call their API endpoints. Add route/source assertions for finance/admin
navigation.

- [ ] **Step 2: Run tests and verify RED**

```bash
pnpm --dir web exec vitest run src/pages/__tests__/CashBankBook.test.tsx
```

- [ ] **Step 3: Implement queue and route wiring**

Lazy-load `CashBankBook`, add admin/accountant routes, add sidebar entries, and
extend the Bank Book tab with status filters plus confirm, reject,
return-to-counter, and manual-adjustment dialogs.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
pnpm --dir web exec vitest run src/pages/__tests__/CashBankBook.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/CashBankBook.tsx web/src/pages/__tests__/CashBankBook.test.tsx web/src/App.tsx web/src/components/dashboard/Sidebar.tsx web/src/components/dashboard/adminSidebarConfig.tsx web/public/locales/en/sidebar.json web/public/locales/bn/sidebar.json
git commit -m "feat: add bank deposit finance queue"
```

### Task 7: Final Verification And Integration

**Files:**
- Verify all changed files

- [ ] **Step 1: Run targeted backend tests**

```bash
pnpm vitest run test/accounting-posting.test.ts test/integration/routes/billing-counter.test.ts test/integration/routes/cash-book.test.ts
```

- [ ] **Step 2: Run frontend tests and typecheck**

```bash
pnpm --dir web exec vitest run src/pages/BillingCounterPage.test.tsx src/pages/__tests__/CashBankBook.test.tsx
pnpm --dir web exec tsc --noEmit --pretty false
```

- [ ] **Step 3: Validate migration and build**

```bash
pnpm exec wrangler d1 execute hms-saas-db --local --file=migrations/0342_bank_deposit_custody.sql
pnpm build
git diff --check
```

- [ ] **Step 4: Inspect commit and worktree state**

```bash
git status --short
git log --oneline --decorate -8
git diff main...HEAD --stat
```

- [ ] **Step 5: Merge verified branch into main without overwriting unrelated dirty files**

From the primary workspace:

```bash
git merge --ff-only codex/reception-bank-deposit-custody
```

Verify the primary workspace still contains its pre-existing unrelated changes.
