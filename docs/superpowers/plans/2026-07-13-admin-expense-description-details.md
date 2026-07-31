# Admin Expense Description Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show expense reasons in the admin dashboard expense-analysis table, with two descriptions visible by default and a “+ N more” row expansion control.

**Architecture:** Extend the existing executive expense analytics SQL fact set with one normalized detail string per paid operating expense or doctor payout, aggregate those strings into a JSON array per category, and expose the array through the existing response type. Render the array inside the existing `ExpenseAnalysisPanel` with local per-category expansion state; no schema migration or new endpoint is needed.

**Tech Stack:** TypeScript, Hono/D1-compatible SQLite, React, Tailwind CSS, Lucide React, Vitest, Testing Library.

## Global Constraints

- Show the first two descriptions by default.
- Use an accessible “+ N more” button to reveal all remaining descriptions.
- Expanded rows provide a “Show less” control.
- Missing descriptions display “No description provided”.
- Preserve paid-only, rejected-exclusion, tenant isolation, totals, sorting, filtering, and category pagination.
- Do not add a migration or unrelated refactor.

---

### Task 1: Extend the expense-analysis API contract

**Files:**
- Modify: `src/lib/executive-expense-analytics.ts:8-169`
- Modify: `test/integration/routes/dashboard-expense-analysis.test.ts:5-95`
- Modify: `test/integration/executive-dashboard-analytics-sqlite.test.ts:232-242,368-375,395-529`

**Interfaces:**
- Produces: `ExpenseAnalysisRow.details: string[]`
- Produces: SQL column `details_json` containing a JSON array of normalized detail strings.
- Consumes: `expenses.description`, `cash_drawer_movements.description`, and optional payout `reference_id`.

- [ ] **Step 1: Write failing route-contract assertions**

Update the route test response type and mocked rows:

```ts
type ExpenseAnalysisResponse = {
  // existing fields
  rows: Array<{
    category: string;
    transactions: number;
    paidAmount: number;
    paymentMethods: string[];
    statuses: string[];
    details: string[];
  }>;
};
```

Assert the SQL includes both source descriptions and JSON aggregation:

```ts
expect(lower).toContain("nullif(trim(e.description), '')");
expect(lower).toContain("nullif(trim(m.description), '')");
expect(lower).toContain('json_group_array');
```

Return mock database rows with:

```ts
details_json: '["Electricity bill","Generator fuel"]'
```

and expect:

```ts
details: ['Electricity bill', 'Generator fuel']
```

Add a fallback case using:

```ts
details_json: '["No description provided"]'
```

- [ ] **Step 2: Run the route test and verify failure**

Run:

```bash
pnpm exec vitest run test/integration/routes/dashboard-expense-analysis.test.ts
```

Expected: FAIL because `details` is absent from the API row and SQL does not select/aggregate descriptions.

- [ ] **Step 3: Write failing production-shaped SQLite assertions**

Extend the test `expenses` table with a `description TEXT` column and `cash_drawer_movements` with its existing `description TEXT` column in the harness. Seed at least three paid `Utilities` expenses:

```sql
(1, 'tenant-a', 'Utilities', 20, 2, 'paid', 'approved', '2026-07-12', 'Electricity bill'),
(2, 'tenant-a', 'Utilities', 30, 2, 'paid', 'approved', '2026-07-12', 'Generator fuel'),
(3, 'tenant-a', 'Utilities', 10, 2, 'paid', 'approved', '2026-07-12', NULL)
```

Seed the doctor payout movement with a description such as `July doctor settlement`. Assert:

```ts
expect(expense.rows).toEqual(expect.arrayContaining([
  expect.objectContaining({
    category: 'Utilities',
    details: expect.arrayContaining([
      'Electricity bill',
      'Generator fuel',
      'No description provided',
    ]),
  }),
  expect.objectContaining({
    category: 'Doctor payouts',
    details: ['July doctor settlement'],
  }),
]));
```

- [ ] **Step 4: Run the SQLite test and verify failure**

Run:

```bash
pnpm exec vitest run test/integration/executive-dashboard-analytics-sqlite.test.ts
```

Expected: FAIL because the analytics response has no `details` property.

- [ ] **Step 5: Implement JSON detail aggregation and parsing**

Extend the interfaces:

```ts
export interface ExpenseAnalysisRow {
  category: string;
  transactions: number;
  paidAmount: number;
  paymentMethods: string[];
  statuses: string[];
  details: string[];
}

type ExpenseAnalysisDbRow = {
  // existing fields
  details_json?: string | null;
};
```

Add a JSON parser that is safe against malformed legacy/mock values:

```ts
function parseDetails(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
```

Add `detail` to both branches of `expense_facts`:

```sql
COALESCE(NULLIF(TRIM(e.description), ''), 'No description provided') AS detail
```

and:

```sql
COALESCE(
  NULLIF(TRIM(m.description), ''),
  CASE
    WHEN m.reference_id IS NOT NULL AND TRIM(CAST(m.reference_id AS TEXT)) != ''
      THEN 'Doctor payout #' || CAST(m.reference_id AS TEXT)
    ELSE 'Doctor payout'
  END
) AS detail
```

Aggregate in `category_rows`:

```sql
json_group_array(detail) AS details_json
```

Map the response:

```ts
details: parseDetails(row.details_json),
```

- [ ] **Step 6: Run backend tests and verify pass**

Run:

```bash
pnpm exec vitest run test/integration/routes/dashboard-expense-analysis.test.ts test/integration/executive-dashboard-analytics-sqlite.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the backend contract**

```bash
git add src/lib/executive-expense-analytics.ts test/integration/routes/dashboard-expense-analysis.test.ts test/integration/executive-dashboard-analytics-sqlite.test.ts
git commit -m "feat: include descriptions in expense analysis"
```

---

### Task 2: Render compact expandable details in the dashboard table

**Files:**
- Modify: `web/src/types/executiveDashboard.ts:172-188`
- Modify: `web/src/components/dashboard/ExpenseAnalysisPanel.tsx:1-92`
- Modify: `web/src/components/dashboard/ExpenseAnalysisPanel.test.tsx:1-44`

**Interfaces:**
- Consumes: `ExpenseAnalysisRow.details: string[]` from Task 1.
- Produces: a Details table column with two-item preview and per-category expansion state.

- [ ] **Step 1: Write the failing component interaction test**

Update fixtures with details:

```ts
{
  category: 'Utilities',
  transactions: 3,
  paidAmount: 6500,
  paymentMethods: ['cash', 'bank'],
  statuses: ['paid'],
  details: ['Electricity bill', 'Generator fuel', 'Internet bill'],
}
```

Add assertions:

```ts
expect(screen.getByRole('columnheader', { name: 'Details' })).toBeInTheDocument();
expect(screen.getByText('Electricity bill')).toBeInTheDocument();
expect(screen.getByText('Generator fuel')).toBeInTheDocument();
expect(screen.queryByText('Internet bill')).not.toBeInTheDocument();

const expand = screen.getByRole('button', { name: 'Show 1 more detail for Utilities' });
expect(expand).toHaveAttribute('aria-expanded', 'false');
fireEvent.click(expand);
expect(screen.getByText('Internet bill')).toBeInTheDocument();
expect(screen.getByRole('button', { name: 'Show fewer details for Utilities' })).toHaveAttribute('aria-expanded', 'true');

fireEvent.click(screen.getByRole('button', { name: 'Show fewer details for Utilities' }));
expect(screen.queryByText('Internet bill')).not.toBeInTheDocument();
```

Add a fixture/assertion for `details: []` rendering `No description provided` defensively.

- [ ] **Step 2: Run the component test and verify failure**

Run:

```bash
pnpm --filter web exec vitest run src/components/dashboard/ExpenseAnalysisPanel.test.tsx
```

Expected: FAIL because the Details column and expansion button do not exist.

- [ ] **Step 3: Extend the frontend response type**

Update:

```ts
export interface ExpenseAnalysisRow {
  category: string;
  transactions: number;
  paidAmount: number;
  paymentMethods: string[];
  statuses: string[];
  details: string[];
}
```

- [ ] **Step 4: Implement the expandable Details cell**

Import React state and the plus icon:

```ts
import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react';
```

Maintain expanded categories:

```ts
const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set());

useEffect(() => {
  const visible = new Set(rows.map((row) => row.category));
  setExpandedCategories((current) => new Set([...current].filter((category) => visible.has(category))));
}, [rows]);
```

For each row:

```ts
const details = row.details.length ? row.details : ['No description provided'];
const expanded = expandedCategories.has(row.category);
const visibleDetails = expanded ? details : details.slice(0, 2);
const hiddenCount = Math.max(0, details.length - 2);
```

Render a new `<th>Details</th>` after Category and a compact list cell:

```tsx
<td className="min-w-64 px-3 py-3 align-top text-[var(--color-text-secondary)]">
  <ul className="space-y-1">
    {visibleDetails.map((detail, index) => (
      <li key={`${row.category}-${index}`} className="break-words leading-5">{detail}</li>
    ))}
  </ul>
  {hiddenCount > 0 ? (
    <button
      type="button"
      className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-primary)] hover:underline"
      aria-expanded={expanded}
      aria-label={expanded
        ? `Show fewer details for ${row.category}`
        : `Show ${hiddenCount} more detail${hiddenCount === 1 ? '' : 's'} for ${row.category}`}
      onClick={() => setExpandedCategories((current) => {
        const next = new Set(current);
        if (next.has(row.category)) next.delete(row.category);
        else next.add(row.category);
        return next;
      })}
    >
      {!expanded ? <Plus className="h-3.5 w-3.5" aria-hidden="true" /> : null}
      {expanded ? 'Show less' : `+ ${hiddenCount} more`}
    </button>
  ) : null}
</td>
```

Increase the table minimum width enough for the added column, for example `min-w-[1040px]`.

- [ ] **Step 5: Run the component test and verify pass**

Run:

```bash
pnpm --filter web exec vitest run src/components/dashboard/ExpenseAnalysisPanel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Run type/build-focused verification**

Run:

```bash
pnpm --filter web build
```

Expected: successful Vite/TypeScript build.

- [ ] **Step 7: Commit the frontend interaction**

```bash
git add web/src/types/executiveDashboard.ts web/src/components/dashboard/ExpenseAnalysisPanel.tsx web/src/components/dashboard/ExpenseAnalysisPanel.test.tsx
git commit -m "feat: expand expense descriptions in dashboard"
```

---

### Task 3: Final verification and integration

**Files:**
- Verify all changed files from Tasks 1-2.

**Interfaces:**
- Consumes: completed backend and frontend commits.
- Produces: verified feature branch ready to merge into `main`.

- [ ] **Step 1: Run the complete targeted test set**

```bash
pnpm exec vitest run test/integration/routes/dashboard-expense-analysis.test.ts test/integration/executive-dashboard-analytics-sqlite.test.ts
pnpm --filter web exec vitest run src/components/dashboard/ExpenseAnalysisPanel.test.tsx
```

Expected: all tests pass.

- [ ] **Step 2: Run the web build**

```bash
pnpm --filter web build
```

Expected: build succeeds.

- [ ] **Step 3: Review the final diff**

Confirm the diff contains only the design/plan documents, analytics contract/query/tests, frontend type/component/test, and no generated reports or unrelated files.

- [ ] **Step 4: Merge into main from a clean main worktree**

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git merge --no-ff feature/admin-expense-description-details
git push origin main
```

Expected: merge succeeds without conflicts and `origin/main` contains the feature commits.
