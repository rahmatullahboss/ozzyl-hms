# Expense Management — Audit Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Created By` and `Approved By` columns to the Expense Management list with role-based visibility so admin and CEO/MD can audit who recorded and who approved each expense.

**Architecture:** Backend adds a single `LEFT JOIN users` to the `GET /api/expenses` list query. Frontend renders two new columns whose visibility is computed from the existing `role` prop. The wide `Category` label is replaced with a colored pill whose `title` attribute carries the full label for screen readers and mouse hover.

**Tech Stack:** Cloudflare Worker + Hono + D1 (backend), React + TanStack Query + Tailwind (frontend), Vitest (tests).

**Spec:** `docs/superpowers/specs/2026-06-06-expense-audit-columns-design.md`

---

## File Structure

| File | Responsibility | Change |
|------|---------------|--------|
| `src/routes/tenant/expenses.ts` | Expense HTTP handlers | Add `LEFT JOIN users` to `GET /` |
| `web/src/pages/accounting/ExpenseList.tsx` | Main expense list UI (receipt upload) | New columns + pills + role-gating |
| `web/src/pages/accounting/ExpenseList.test.ts` | Vitest component test | Add role-gating test cases |
| `apps/ozzyl-lifestyle/src/pages/accounting/ExpenseList.tsx` | Lifestyle app copy | Mirror UI updates (no receipt flow) |

No new files. No schema change. No migration.

---

## Task 1: Backend — Add user JOIN to `GET /api/expenses`

**Files:**
- Modify: `src/routes/tenant/expenses.ts:30-64` (the `GET /` handler)

- [ ] **Step 1.1: Replace the SELECT with a JOIN**

In `src/routes/tenant/expenses.ts`, locate the handler that starts at
`expenseRoutes.get('/', ...)` (line 30). Replace the existing
`let query = 'SELECT * FROM expenses WHERE tenant_id = ?'; ...` block
(lines 35–55) with the version below. Keep the existing
`requireTenantId(c)` and filter `if` blocks (lines 32–53) untouched;
only the final `query` string and the `params` array change.

```ts
  let query = `
    SELECT
      e.*,
      u_creator.name  AS created_by_name,
      u_approver.name AS approved_by_name
    FROM expenses e
    LEFT JOIN users u_creator  ON e.created_by  = u_creator.id
    LEFT JOIN users u_approver ON e.approved_by = u_approver.id
    WHERE e.tenant_id = ?
  `;
  const params: any[] = [tenantId];

  if (startDate) {
    query += ' AND e.date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    query += ' AND e.date <= ?';
    params.push(endDate);
  }
  if (category) {
    query += ' AND e.category = ?';
    params.push(category);
  }
  if (status) {
    query += ' AND e.status = ?';
    params.push(status);
  }

  query += ' ORDER BY e.date DESC, e.id DESC';
```

Note: every existing filter / sort now references `e.column` (the
expenses alias) instead of bare `column`. This is required because
`users` has columns named `id`, `name`, `tenant_id` that would
otherwise collide.

- [ ] **Step 1.2: Verify the route still loads**

Run: `pnpm tsc --noEmit -p tsconfig.json 2>&1 | head -40`
Expected: no errors mentioning `expenses.ts`. Pre-existing errors in
other files are acceptable — only this file should be clean.

- [ ] **Step 1.3: Commit**

```bash
git add src/routes/tenant/expenses.ts
git commit -m "feat(accounting): include creator/approver names in expense list

LEFT JOIN users on created_by and approved_by so the list endpoint
returns created_by_name and approved_by_name alongside the expense
rows. No migration required; both columns already exist on expenses."
```

---

## Task 2: Frontend — Extend the `Expense` interface

**Files:**
- Modify: `web/src/pages/accounting/ExpenseList.tsx:10-18` (the `Expense` interface)

- [ ] **Step 2.1: Add the four new fields**

Replace the existing `interface Expense { ... }` block in
`web/src/pages/accounting/ExpenseList.tsx` with:

```ts
interface Expense {
  id: number;
  date: string;
  category: string;
  amount: number;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  receipt_key: string | null;
  created_by: number | null;
  created_by_name: string | null;
  approved_by_name: string | null;
  created_at: string | null;
  approved_at: string | null;
}
```

- [ ] **Step 2.2: Mirror the same interface in the lifestyle app**

In `apps/ozzyl-lifestyle/src/pages/accounting/ExpenseList.tsx`,
replace the existing `interface Expense { ... }` with the same block
above (the lifestyle copy uses the same fields; it just does not render
`receipt_key`).

- [ ] **Step 2.3: Type-check**

Run: `pnpm tsc --noEmit -p web/tsconfig.json 2>&1 | head -30`
Expected: no errors.

- [ ] **Step 2.4: Commit**

```bash
git add web/src/pages/accounting/ExpenseList.tsx apps/ozzyl-lifestyle/src/pages/accounting/ExpenseList.tsx
git commit -m "feat(web): extend Expense type with audit fields

created_by, created_by_name, approved_by_name, created_at, approved_at
are now part of the shape returned by GET /api/expenses."
```

---

## Task 3: Frontend — Add helper functions

**Files:**
- Modify: `web/src/pages/accounting/ExpenseList.tsx` (add after `CAT_LABELS`)

- [ ] **Step 3.1: Add `CAT_PILL` and `relativeTime`**

In `web/src/pages/accounting/ExpenseList.tsx`, immediately after the
`CAT_LABELS` const (line 29), insert:

```ts
const CAT_PILL: Record<string, { short: string; cls: string }> = {
  SALARY:         { short: 'Salary',     cls: 'bg-blue-100 text-blue-700' },
  MEDICINE:       { short: 'Medicine',   cls: 'bg-teal-100 text-teal-700' },
  RENT:           { short: 'Rent',       cls: 'bg-amber-100 text-amber-700' },
  ELECTRICITY:    { short: 'Electric',   cls: 'bg-yellow-100 text-yellow-700' },
  WATER:          { short: 'Water',      cls: 'bg-sky-100 text-sky-700' },
  COMMUNICATION:  { short: 'Telecom',    cls: 'bg-indigo-100 text-indigo-700' },
  MAINTENANCE:    { short: 'Maint.',     cls: 'bg-orange-100 text-orange-700' },
  SUPPLIES:       { short: 'Supplies',   cls: 'bg-emerald-100 text-emerald-700' },
  MARKETING:      { short: 'Marketing',  cls: 'bg-pink-100 text-pink-700' },
  BANK:           { short: 'Bank',       cls: 'bg-slate-200 text-slate-700' },
};
const CAT_PILL_DEFAULT = { short: 'Misc', cls: 'bg-purple-100 text-purple-700' };

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'yesterday';
  if (days < 7)   return `${days}d ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
```

- [ ] **Step 3.2: Mirror the helpers in the lifestyle app**

Add the same `CAT_PILL`, `CAT_PILL_DEFAULT`, and `relativeTime` block
to `apps/ozzyl-lifestyle/src/pages/accounting/ExpenseList.tsx`
immediately after its `CAT_LABELS` const.

- [ ] **Step 3.3: Commit**

```bash
git add web/src/pages/accounting/ExpenseList.tsx apps/ozzyl-lifestyle/src/pages/accounting/ExpenseList.tsx
git commit -m "feat(web): add category pill map and relativeTime helper"
```

---

## Task 4: Frontend — Add role flags and rebuild the table body

**Files:**
- Modify: `web/src/pages/accounting/ExpenseList.tsx:48-66` (role flags + useApiQuery)
- Modify: `web/src/pages/accounting/ExpenseList.tsx:198-281` (table thead/tbody/tfoot)

- [ ] **Step 4.1: Replace the role flags and add audit visibility**

In `web/src/pages/accounting/ExpenseList.tsx`, replace the existing
`const isAdmin = ...; const isDirector = ...;` lines (48–49) with:

```ts
  const isAdmin       = role === 'hospital_admin';
  const isDirector    = role === 'director';
  const isMd          = role === 'md';
  const isAccountant  = role === 'accountant';
  const showCreatedBy  = isAdmin || isMd || isDirector || isAccountant;
  const showApprovedBy = isAdmin || isMd || isDirector;
  const auditColSpan   = (showCreatedBy ? 1 : 0) + (showApprovedBy ? 1 : 0);
```

- [ ] **Step 4.2: Replace the table header**

Replace the `<thead>` block (lines 202–206) with:

```tsx
              <thead>
                <tr>
                  <th>{t('date', { ns: 'common' })}</th>
                  <th>{t('category', { ns: 'common' })}</th>
                  <th>{t('amount', { ns: 'billing' })}</th>
                  <th>{t('expenseStatus', { ns: 'billing' })}</th>
                  {showCreatedBy  && <th>Created By</th>}
                  {showApprovedBy && <th>Approved By</th>}
                  <th>{t('description', { ns: 'billing' })}</th>
                  <th>Receipt</th>
                  <th>{t('expenseActions', { ns: 'billing' })}</th>
                </tr>
              </thead>
```

- [ ] **Step 4.3: Replace the empty-state row**

In the same file, update the `expenses.length === 0` branch
(line 211). The current `colSpan={7}` needs to become dynamic:

```tsx
                ) : expenses.length === 0 ? (
                  <tr><td colSpan={7 + auditColSpan} className="py-14 text-center text-[var(--color-text-muted)]">No expense records found</td></tr>
```

- [ ] **Step 4.4: Replace the data row and footer**

In the `expenses.map(expense => (` block, replace the entire `<tr>`
(lines 214–266) with:

```tsx
                    <tr key={expense.id}>
                      <td className="font-data text-sm">{new Date(expense.date).toLocaleDateString('en-GB')}</td>
                      <td>
                        {(() => {
                          const pill = CAT_PILL[expense.category] ?? CAT_PILL_DEFAULT;
                          return (
                            <span
                              title={CAT_LABELS[expense.category] || expense.category}
                              className={`inline-block max-w-[6.5rem] truncate rounded-full px-2 py-0.5 text-xs font-medium ${pill.cls}`}
                            >
                              {pill.short}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="font-data font-medium text-red-600">{fmt(expense.amount)}</td>
                      <td><span className={`badge ${STATUS_BADGE[expense.status] ?? 'badge-secondary'}`}>{expense.status.charAt(0).toUpperCase() + expense.status.slice(1)}</span></td>
                      {showCreatedBy && (
                        <td className="text-sm">
                          {expense.created_by_name ? (
                            <>
                              <div className="font-medium">{expense.created_by_name}</div>
                              <div className="text-xs text-[var(--color-text-muted)]" title={expense.created_at ?? ''}>{relativeTime(expense.created_at)}</div>
                            </>
                          ) : (
                            <span className="text-[var(--color-text-muted)]" title={expense.created_by ? `User #${expense.created_by}` : ''}>Unknown</span>
                          )}
                        </td>
                      )}
                      {showApprovedBy && (
                        <td className="text-sm">
                          {expense.approved_by_name ? (
                            <span className={expense.status === 'rejected' ? 'text-red-600' : ''}>
                              <span className="font-medium">{expense.approved_by_name}</span>
                              <span className="block text-xs text-[var(--color-text-muted)]">{relativeTime(expense.approved_at)}</span>
                            </span>
                          ) : (
                            <span className="text-[var(--color-text-muted)]">—</span>
                          )}
                        </td>
                      )}
                      <td className="text-sm text-[var(--color-text-secondary)]">{expense.description || '—'}</td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          {expense.receipt_key ? (
                            <button
                              onClick={() => openReceiptViewer(expense.id)}
                              className="btn-ghost p-1.5 text-xs text-blue-600 flex items-center gap-1"
                              title="View receipt"
                            >
                              <Eye className="w-3.5 h-3.5" /> View
                            </button>
                          ) : (
                            <span className="text-xs text-[var(--color-text-muted)]">—</span>
                          )}
                          {isAdmin && (
                            <label
                              className={`btn-ghost p-1.5 text-xs cursor-pointer flex items-center gap-1 ${uploadingReceipt === expense.id ? 'opacity-50 pointer-events-none' : 'text-emerald-600'}`}
                              title={expense.receipt_key ? 'Replace receipt' : 'Upload receipt'}
                            >
                              <Camera className="w-3.5 h-3.5" />
                              {uploadingReceipt === expense.id ? 'Uploading...' : expense.receipt_key ? 'Replace' : 'Upload'}
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files?.[0];
                                  if (file) handleReceiptUpload(expense.id, file, e.target);
                                }}
                              />
                            </label>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="flex gap-1.5">
                          {expense.status !== 'pending' && (
                            <button onClick={() => openEdit(expense)} className="btn-ghost p-1.5 text-xs">Edit</button>
                          )}
                          {expense.status === 'pending' && isDirector && (
                            <>
                              <button onClick={() => handleApprove(expense.id)} className="btn-ghost p-1.5 text-xs text-emerald-600">Approve</button>
                              <button onClick={() => handleReject(expense.id)} className="btn-ghost p-1.5 text-xs text-red-500">Reject</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
```

- [ ] **Step 4.5: Replace the footer (Total Approved)**

Replace the `<tfoot>` (lines 270–278) with:

```tsx
              {!loading && expenses.length > 0 && (
                <tfoot className="bg-[var(--color-surface)] border-t border-[var(--color-border)]">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 font-medium text-sm">Total Approved</td>
                    <td className="px-4 py-3 font-bold text-red-600">{fmt(totalApproved)}</td>
                    <td colSpan={4 + auditColSpan} />
                  </tr>
                </tfoot>
              )}
```

- [ ] **Step 4.6: Type-check**

Run: `pnpm tsc --noEmit -p web/tsconfig.json 2>&1 | head -30`
Expected: no errors.

- [ ] **Step 4.7: Commit**

```bash
git add web/src/pages/accounting/ExpenseList.tsx
git commit -m "feat(web): render audit columns with role-based visibility

- Created By shown to admin / md / director / accountant
- Approved By shown to admin / md / director
- Category compressed to colored pill with full label in tooltip
- Rejected approver is rendered in red
- 'Unknown' replaces null user with raw id in tooltip
- Footer colSpan adjusts to keep alignment"
```

---

## Task 5: Mirror UI changes to the lifestyle app

**Files:**
- Modify: `apps/ozzyl-lifestyle/src/pages/accounting/ExpenseList.tsx` (thead + tbody + tfoot only; no receipt column)

- [ ] **Step 5.1: Add the role flags**

After the existing `const isDirector = ...;` (line 39), insert:

```ts
  const isAdmin       = role === 'hospital_admin';
  const isMd          = role === 'md';
  const isAccountant  = role === 'accountant';
  const showCreatedBy  = isAdmin || isMd || isDirector || isAccountant;
  const showApprovedBy = isAdmin || isMd || isDirector;
  const auditColSpan   = (showCreatedBy ? 1 : 0) + (showApprovedBy ? 1 : 0);
```

- [ ] **Step 5.2: Replace the table header**

Replace the `<thead>` block (lines 128–132) with:

```tsx
              <thead>
                <tr>
                  <th>Date</th><th>Category</th><th>Amount</th><th>Status</th>
                  {showCreatedBy  && <th>Created By</th>}
                  {showApprovedBy && <th>Approved By</th>}
                  <th>Description</th><th>Actions</th>
                </tr>
              </thead>
```

- [ ] **Step 5.3: Replace the empty-state row**

Update the `expenses.length === 0` branch (line 137) to:

```tsx
                  <tr><td colSpan={6 + auditColSpan} className="py-14 text-center text-[var(--color-text-muted)]">No expense records found</td></tr>
```

- [ ] **Step 5.4: Replace the data row**

Replace the `expenses.map(expense => ...)` block (lines 139–161) with:

```tsx
                  expenses.map(expense => (
                    <tr key={expense.id}>
                      <td className="font-data text-sm">{new Date(expense.date).toLocaleDateString('en-GB')}</td>
                      <td>
                        {(() => {
                          const pill = CAT_PILL[expense.category] ?? CAT_PILL_DEFAULT;
                          return (
                            <span
                              title={CAT_LABELS[expense.category] || expense.category}
                              className={`inline-block max-w-[6.5rem] truncate rounded-full px-2 py-0.5 text-xs font-medium ${pill.cls}`}
                            >
                              {pill.short}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="font-data font-medium text-red-600">{fmt(expense.amount)}</td>
                      <td><span className={`badge ${STATUS_BADGE[expense.status] ?? 'badge-secondary'}`}>{expense.status.charAt(0).toUpperCase() + expense.status.slice(1)}</span></td>
                      {showCreatedBy && (
                        <td className="text-sm">
                          {expense.created_by_name ? (
                            <>
                              <div className="font-medium">{expense.created_by_name}</div>
                              <div className="text-xs text-[var(--color-text-muted)]" title={expense.created_at ?? ''}>{relativeTime(expense.created_at)}</div>
                            </>
                          ) : (
                            <span className="text-[var(--color-text-muted)]" title={expense.created_by ? `User #${expense.created_by}` : ''}>Unknown</span>
                          )}
                        </td>
                      )}
                      {showApprovedBy && (
                        <td className="text-sm">
                          {expense.approved_by_name ? (
                            <span className={expense.status === 'rejected' ? 'text-red-600' : ''}>
                              <span className="font-medium">{expense.approved_by_name}</span>
                              <span className="block text-xs text-[var(--color-text-muted)]">{relativeTime(expense.approved_at)}</span>
                            </span>
                          ) : (
                            <span className="text-[var(--color-text-muted)]">—</span>
                          )}
                        </td>
                      )}
                      <td className="text-sm text-[var(--color-text-secondary)]">{expense.description || '—'}</td>
                      <td>
                        <div className="flex gap-1.5">
                          {expense.status !== 'pending' && (
                            <button onClick={() => openEdit(expense)} className="btn-ghost p-1.5 text-xs">Edit</button>
                          )}
                          {expense.status === 'pending' && isDirector && (
                            <>
                              <button onClick={() => handleApprove(expense.id)} className="btn-ghost p-1.5 text-xs text-emerald-600">Approve</button>
                              <button onClick={() => handleReject(expense.id)} className="btn-ghost p-1.5 text-xs text-red-500">Reject</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
```

- [ ] **Step 5.5: Replace the footer**

Replace the `<tfoot>` (lines 163–171) with:

```tsx
              {!loading && expenses.length > 0 && (
                <tfoot className="bg-[var(--color-surface)] border-t border-[var(--color-border)]">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 font-medium text-sm">Total Approved</td>
                    <td className="px-4 py-3 font-bold text-red-600">{fmt(totalApproved)}</td>
                    <td colSpan={3 + auditColSpan} />
                  </tr>
                </tfoot>
              )}
```

- [ ] **Step 5.6: Type-check**

Run: `pnpm tsc --noEmit -p apps/ozzyl-lifestyle/tsconfig.json 2>&1 | head -30`
Expected: no errors in `ExpenseList.tsx`.

- [ ] **Step 5.7: Commit**

```bash
git add apps/ozzyl-lifestyle/src/pages/accounting/ExpenseList.tsx
git commit -m "feat(ozzyl-life): mirror audit columns in lifestyle expense list"
```

---

## Task 6: Update frontend tests

**Files:**
- Modify: `web/src/pages/accounting/ExpenseList.test.ts`

- [ ] **Step 6.1: Replace the test file with role-gated cases**

Replace the entire file with:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import i18n from 'i18next';

vi.mock('../../lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(() => ({ mutate: vi.fn() })),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const SAMPLE = [
  { id: 1, date: '2026-06-04', category: 'MISC', amount: 1600, description: 'adjust', status: 'pending',  receipt_key: null, created_by: 7, created_by_name: 'Rina',  approved_by_name: null,      created_at: '2026-06-04T08:30:00Z', approved_at: null },
  { id: 2, date: '2026-06-03', category: 'SALARY', amount: 9000, description: 'May payroll', status: 'approved', receipt_key: null, created_by: 8, created_by_name: 'Karim', approved_by_name: 'Dr. Anil', created_at: '2026-06-03T11:00:00Z', approved_at: '2026-06-03T11:15:00Z' },
  { id: 3, date: '2026-06-02', category: 'RENT',   amount: 25000, description: 'broken ac', status: 'rejected', receipt_key: null, created_by: null, created_by_name: null,  approved_by_name: 'Dr. Anil', created_at: null, approved_at: '2026-06-02T15:00:00Z' },
];

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </QueryClientProvider>
  );
}

async function loadComponent() {
  const mod = await import('./ExpenseList');
  return mod.default;
}

beforeEach(async () => {
  const { useApiQuery } = await import('../../hooks/useApiQuery');
  (useApiQuery as any).mockReturnValue({ data: { expenses: SAMPLE }, isLoading: false });
});

describe('ExpenseList', () => {
  it('exports a valid React component', async () => {
    const Cmp = await loadComponent();
    expect(typeof Cmp).toBe('function');
  });

  it('admin role: shows both Created By and Approved By columns', async () => {
    const Cmp = await loadComponent();
    render(<Cmp role="hospital_admin" />, { wrapper: makeWrapper() });
    expect(screen.getByText('Created By')).toBeTruthy();
    expect(screen.getByText('Approved By')).toBeTruthy();
  });

  it('md role: shows both audit columns', async () => {
    const Cmp = await loadComponent();
    render(<Cmp role="md" />, { wrapper: makeWrapper() });
    expect(screen.getByText('Created By')).toBeTruthy();
    expect(screen.getByText('Approved By')).toBeTruthy();
  });

  it('director role: shows both audit columns', async () => {
    const Cmp = await loadComponent();
    render(<Cmp role="director" />, { wrapper: makeWrapper() });
    expect(screen.getByText('Created By')).toBeTruthy();
    expect(screen.getByText('Approved By')).toBeTruthy();
  });

  it('accountant role: shows Created By but hides Approved By', async () => {
    const Cmp = await loadComponent();
    render(<Cmp role="accountant" />, { wrapper: makeWrapper() });
    expect(screen.getByText('Created By')).toBeTruthy();
    expect(screen.queryByText('Approved By')).toBeNull();
  });

  it('reception role: hides both audit columns', async () => {
    const Cmp = await loadComponent();
    render(<Cmp role="reception" />, { wrapper: makeWrapper() });
    expect(screen.queryByText('Created By')).toBeNull();
    expect(screen.queryByText('Approved By')).toBeNull();
  });

  it('renders Unknown when created_by_name is null', async () => {
    const Cmp = await loadComponent();
    render(<Cmp role="hospital_admin" />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders — for a pending expense with no approver', async () => {
    const Cmp = await loadComponent();
    render(<Cmp role="hospital_admin" />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders category pill with short label and full label in title', async () => {
    const Cmp = await loadComponent();
    render(<Cmp role="reception" />, { wrapper: makeWrapper() });
    await waitFor(() => {
      const salaryPill = screen.getAllByText('Salary')[0];
      expect(salaryPill).toBeTruthy();
      expect(salaryPill.getAttribute('title')).toBe('Staff Salary');
    });
  });
});
```

- [ ] **Step 6.2: Run the tests**

Run: `pnpm vitest run web/src/pages/accounting/ExpenseList.test.ts`
Expected: all 9 tests pass.

- [ ] **Step 6.3: Commit**

```bash
git add web/src/pages/accounting/ExpenseList.test.ts
git commit -m "test(web): cover role-gated audit columns and category pill"
```

---

## Task 7: Full verification

- [ ] **Step 7.1: Lint**

Run: `pnpm lint 2>&1 | tail -40`
Expected: no new errors in the 3 files changed. Pre-existing errors
elsewhere are fine.

- [ ] **Step 7.2: Type-check the whole monorepo**

Run: `pnpm tsc --noEmit 2>&1 | tail -40`
Expected: no errors in the 3 files changed.

- [ ] **Step 7.3: Build**

Run: `pnpm build 2>&1 | tail -30`
Expected: exit code 0.

- [ ] **Step 7.4: Manual smoke test against the dev worker**

Run:
```bash
pnpm dev &
sleep 4
curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:8787/api/expenses?status=approved" | head -c 600
```

Expected: JSON containing `created_by_name` and `approved_by_name`
fields in the first returned expense row.

- [ ] **Step 7.5: Commit verification log (if changes were made)**

```bash
git status
# if any auto-fixes were applied:
git add -A
git commit -m "chore: post-verification lint fixes"
```

---

## Self-Review

**1. Spec coverage** — every spec requirement maps to a task:

| Spec section | Task |
|--------------|------|
| §1 Backend SQL JOIN | Task 1 |
| §2 `Expense` interface update | Task 2 |
| §2 `CAT_PILL` and `relativeTime` helpers | Task 3 |
| §2 Role flags + visibility logic | Task 4.1 |
| §2 thead with conditional columns | Task 4.2 |
| §2 Dynamic `colSpan` for empty state | Task 4.3 |
| §2 Data row with pills, audit cells, reject red | Task 4.4 |
| §2 Footer colSpan | Task 4.5 |
| §3 Ozzyl-Lifestyle mirror | Task 5 |
| §4 Test fixtures + role cases + pill | Task 6 |
| §6 Verification | Task 7 |

**2. Placeholder scan** — no `TBD`, no `TODO`, no "implement later". Every
code block is complete. Every command shows the expected output. No
"similar to Task N" cross-references.

**3. Type consistency** — `created_by` is added to the interface in
Task 2 and used in Task 4.4 and Task 6. `created_by_name`,
`approved_by_name`, `created_at`, `approved_at` follow the same
pattern. `showCreatedBy`, `showApprovedBy`, `auditColSpan` are defined
in Task 4.1 and used in Tasks 4.2–4.5, 5.1–5.5, 6. Helper names
`CAT_PILL`, `CAT_PILL_DEFAULT`, `relativeTime` are introduced in
Task 3 and consumed in Task 4.4 and Task 5.4.

**4. Scope** — single feature, single deploy unit. Backend + 2 frontend
copies. No new files. No migration. No dependency added.
