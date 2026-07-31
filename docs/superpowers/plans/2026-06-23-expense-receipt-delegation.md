# Expense Receipt Delegation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add delegated expense receipt upload access and browser-side WebP receipt uploads.

**Architecture:** Backend authorization moves receipt upload from broad expense-write roles to the fine-grained `expenses.receipts.upload` permission. A limited receipt queue endpoint serves upload-only staff. Frontend upload code uses a receipt-specific WebP helper before sending `FormData`.

**Tech Stack:** Hono, D1, R2, shared authz package, React, Vitest, React Testing Library.

---

### Task 1: Pin backend receipt delegation behavior

**Files:**
- Modify: `test/integration/routes/expense-receipt-verification.test.ts`

- [ ] Add RED tests for delegated manager upload, default reception denial, and limited receipt queue.
- [ ] Run `pnpm vitest run test/integration/routes/expense-receipt-verification.test.ts` and confirm the new tests fail.

### Task 2: Implement backend permission and queue

**Files:**
- Modify: `packages/shared/src/authz.ts`
- Modify: `src/routes/tenant/expenses.ts`
- Modify tests as needed only for compile compatibility.

- [ ] Add `expenses.receipts.upload` to shared permission catalog and accountant/management defaults.
- [ ] Change receipt upload route to `requirePermission("expenses.receipts.upload")`.
- [ ] Add `GET /api/expenses/receipt-queue` before `/:id` routes.
- [ ] Run the backend receipt tests and commit.

### Task 3: Pin frontend WebP and limited uploader UI behavior

**Files:**
- Modify: `web/src/lib/compressImage.test.ts`
- Modify: `web/src/pages/accounting/ExpenseList.test.tsx`

- [ ] Add RED test for `compressImageToWebpFile` returning a WebP `File`.
- [ ] Add RED test that a manager with `expenses.receipts.upload` uses the limited queue and can upload without approval controls.
- [ ] Run `pnpm --filter web test -- src/lib/compressImage.test.ts src/pages/accounting/ExpenseList.test.tsx` and confirm the new tests fail.

### Task 4: Implement frontend WebP helper and UI access

**Files:**
- Modify: `web/src/lib/compressImage.ts`
- Modify: `web/src/lib/queryKeys.ts`
- Modify: `web/src/pages/accounting/ExpenseList.tsx`

- [ ] Add `compressImageToWebpFile` helper.
- [ ] Use the helper in receipt upload.
- [ ] Use auth permissions to select the limited receipt queue for receipt-upload-only staff.
- [ ] Run frontend tests and commit.

### Task 5: Final validation and integration

- [ ] Run backend receipt tests.
- [ ] Run frontend receipt/compression tests.
- [ ] Run practical type/build checks if possible.
- [ ] Merge branch to main integration worktree if tests pass.
