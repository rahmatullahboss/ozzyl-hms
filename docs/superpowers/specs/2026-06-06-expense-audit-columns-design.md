# Expense Management — Audit Columns Design

> Add audit-trail columns (Created By, Approved By) to the Expense Management
> list with role-based visibility, so admins and CEO/MD can quickly answer
> "who recorded this expense, when, and who approved it" without opening
> a detail page.

## Problem

The current `Expense Management` page (`/h/patient-care-hospital/expenses`)
shows only `Date | Category | Amount | Status | Description | Receipt | Action`.
The backend already stores `created_by`, `created_at`, `approved_by`, and
`approved_at`, but the list endpoint (`GET /api/expenses`) does not JOIN
with `users`, and the React component never reads those fields.

Consequences reported by the user:
- Cannot tell who recorded a pending or historical expense
- Cannot tell who approved it
- Cannot reconstruct the audit trail for an audit review
- The wide `Category` label ("Medicine Purchase", "Staff Salary") consumes
  table real estate that audit columns need

User-confirmed access requirement: **admin and CEO/MD need full audit
detail; other roles need less.**

## Design Decisions

| Aspect | Decision |
|--------|----------|
| **Approach** | Add 2 new table columns (Created By, Approved By) + compress Category into a pill |
| **Access tiers** | admin/md/director → both columns; accountant → Created By only; reception/receptionist → neither |
| **Backend** | Add `LEFT JOIN users` to `GET /api/expenses` (no schema change needed) |
| **Category UI** | Colored pill with short label, full label on hover (tooltip) |
| **Empty fields** | `created_by_name` null → "Unknown" (with raw user id in tooltip); pending/unapproved → "—" |
| **Files affected** | `src/routes/tenant/expenses.ts`, `web/src/pages/accounting/ExpenseList.tsx`, `apps/ozzyl-lifestyle/src/pages/accounting/ExpenseList.tsx`, `web/src/pages/accounting/ExpenseList.test.ts` |
| **Out of scope** | Edit history / rejection reason modal, sorting by new columns, PDF export |

---

## Section 1: Backend — Single Endpoint Change

### `src/routes/tenant/expenses.ts` — `GET /` (line 30)

Replace the `SELECT * FROM expenses WHERE ...` with a JOIN that returns
the human-readable names alongside every row. No migration needed — every
column we need (`created_by`, `created_at`, `approved_by`, `approved_at`)
already exists in the `expenses` table.

```sql
SELECT
  e.*,
  u_creator.name  AS created_by_name,
  u_approver.name AS approved_by_name
FROM expenses e
LEFT JOIN users u_creator  ON e.created_by  = u_creator.id
LEFT JOIN users u_approver ON e.approved_by = u_approver.id
WHERE e.tenant_id = ?    -- + existing date/category/status filters
ORDER BY e.date DESC, e.id DESC
```

The `LEFT JOIN` (not INNER) is required because:
- Older expense rows may have `created_by` pointing to a deleted user
- Rejected expenses may have `approved_by IS NULL` (rejector is stored
  in `approved_by` per the existing code, but we still need the row
  to come back)

No new types or schemas to add — the `Expense` interface in the React
component just gains two optional string fields.

---

## Section 2: Frontend — Table Layout

### Column order (left → right)

| # | Column | Width | Visibility | Content |
|---|--------|-------|------------|---------|
| 1 | Date | `w-24` | all | `04/06/2026` (existing `font-data`) |
| 2 | Category | `w-28` | all | colored pill with short label; tooltip = full label |
| 3 | Amount | `w-28` | all | `BDT 1,600` (existing red text) |
| 4 | Status | `w-24` | all | existing badge |
| 5 | **Created By** | `w-36` | admin / md / director / accountant | name (line 1) + relative time "2h ago" (line 2, `text-xs text-muted`); hover = full ISO timestamp |
| 6 | **Approved By** | `w-36` | admin / md / director | name + short date "12 Jun" (line 2); for `rejected` status, show in red; for `pending`, show "—" |
| 7 | Description | flex | all | now wider because Category is compressed |
| 8 | Receipt | `w-32` | all | unchanged (View / Upload) |
| 9 | Actions | `w-32` | role-conditional | unchanged (Edit / Approve / Reject) |

### Category pills

| Category code | Pill label | Tailwind class |
|---------------|-----------|----------------|
| `SALARY` | Salary | `bg-blue-100 text-blue-700` |
| `MEDICINE` | Medicine | `bg-teal-100 text-teal-700` |
| `RENT` | Rent | `bg-amber-100 text-amber-700` |
| `ELECTRICITY` | Electricity | `bg-yellow-100 text-yellow-700` |
| `WATER` | Water | `bg-sky-100 text-sky-700` |
| `COMMUNICATION` | Telecom | `bg-indigo-100 text-indigo-700` |
| `MAINTENANCE` | Maint. | `bg-orange-100 text-orange-700` |
| `SUPPLIES` | Supplies | `bg-emerald-100 text-emerald-700` |
| `MARKETING` | Marketing | `bg-pink-100 text-pink-700` |
| `BANK` | Bank | `bg-slate-200 text-slate-700` |
| `MISC` (default) | Misc | `bg-purple-100 text-purple-700` |

Render as `<span title={CAT_LABELS[cat]}>` so the full label appears
on hover for screen readers and mouse users.

### Audit-cell rendering

```tsx
{showCreatedBy && (
  <td className="text-sm">
    {expense.created_by_name ? (
      <>
        <div className="font-medium">{expense.created_by_name}</div>
        <div className="text-xs text-[var(--color-text-muted)]" title={expense.created_at}>
          {relativeTime(expense.created_at)}
        </div>
      </>
    ) : (
      <span className="text-[var(--color-text-muted)]" title={expense.created_by ? `User #${expense.created_by}` : ''}>Unknown</span>
    )}
  </td>
)}
```

`relativeTime` is a small pure helper: `2h ago`, `yesterday`, `3d ago`,
`12 Jun`. No new dependency — implement in-file. Falls back to `—` for
null timestamps. `Unknown` is used for both cases (no `created_by`
recorded, and `created_by` pointing to a deleted user — we cannot
distinguish these after a `LEFT JOIN` and we do not pretend to).

### Role flags (existing, just extend)

The component already has `isAdmin = role === 'hospital_admin'` and
`isDirector = role === 'director'`. Add:

```ts
const isMd        = role === 'md';
const isAccountant = role === 'accountant';
const showCreatedBy  = isAdmin || isMd || isDirector || isAccountant;
const showApprovedBy = isAdmin || isMd || isDirector;
```

`colSpan` on the empty-state row and footer adjusts based on
`showCreatedBy + showApprovedBy` to keep alignment correct.

### `Expense` interface update

```ts
interface Expense {
  id: number;
  date: string;
  category: string;
  amount: number;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  receipt_key: string | null;
  created_by: number | null;        // ← new (used for tooltip when name is null)
  created_by_name: string | null;   // ← new
  approved_by_name: string | null;  // ← new
  created_at: string | null;        // ← new
  approved_at: string | null;       // ← new
}
```

The single-endpoint `GET /api/expenses/:id` already returns
`created_by_name` and `approved_by_name`, so the same field names keep
both code paths consistent.

---

## Section 3: Ozzyl-Lifestyle Mirror

`apps/ozzyl-lifestyle/src/pages/accounting/ExpenseList.tsx` is a
simpler, axios-based copy of the same page. Apply the **same** column
layout and pills to keep both apps visually consistent. It does not
currently render `receipt_key` and has no image-upload flow, so that
column is dropped there (6 visible columns instead of 7 in the
non-audit-gated case).

---

## Section 4: Testing

`web/src/pages/accounting/ExpenseList.test.ts` already exists. Update
test fixtures to include the new fields and add cases for:

1. admin role renders `Created By` and `Approved By` columns
2. accountant role renders `Created By` only
3. reception role renders neither audit column
4. expense with `created_by_name = null` shows "Unknown"
5. pending expense with `approved_by_name = null` shows "—" in
   the `Approved By` cell
6. rejected expense shows the approver in red text

No backend test changes — the SQL change is a single JOIN against
existing tables; the integration suite already exercises the endpoint
through `bootstrap.sql`.

---

## Section 5: Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Long category pill labels still wrap on narrow screens | Hard cap pill width with `truncate`; tooltip = full label |
| Older expenses have `created_by` pointing to deleted users | `LEFT JOIN` keeps row visible; renders as "Unknown" (hover shows raw user id) |
| Adding 2 columns breaks mobile layout | Container already has `overflow-x-auto`; verified in current build |
| `relativeTime` produces different strings in different locales | Use English-only short strings (`2h ago`, `yesterday`, `3d ago`); matches existing i18n setup |
| Stale TanStack cache returns old shape after deploy | Cache key (`queryKeys.accounting.expenses`) unchanged; new fields are additive optional so old cached rows render `—` gracefully |

---

## Section 6: Verification

1. `pnpm lint` and `pnpm test --filter web` pass
2. `pnpm build` succeeds
3. Manual: log in as admin → see Created By + Approved By columns;
   hover over the pill tooltip = full category name
4. Manual: log in as receptionist → audit columns hidden, columns
   still align in the footer
5. `git diff` shows only the 4 expected files

---

## Out of Scope (intentionally deferred)

- Full audit-trail modal (Approach C in the brainstorm) — separate spec
- Sorting by Created By / Approved By — add later if requested
- Rejection-reason capture & display — needs a schema change first
- Export to PDF / CSV with the new columns
- Filtering by `created_by` (would need a new query param)
