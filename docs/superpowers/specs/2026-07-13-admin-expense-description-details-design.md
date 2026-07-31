# Admin Expense Analysis Description Details Design

## Goal

Add a **Details** column to the admin dashboard expense-analysis table so an administrator can see why the expenses in each category were paid, without leaving the dashboard.

## Approved interaction

- Show the first **two** expense descriptions in each category row.
- When more descriptions exist, show an accessible **“+ N more”** button.
- Clicking the button expands that row to show every available description.
- The expanded control changes to **“Show less”** so the row can be collapsed again.
- Empty descriptions render as **“No description provided”** rather than disappearing.

## Data contract

Extend each `ExpenseAnalysisRow` with:

```ts
details: string[];
```

The analytics query will add a detail value to each source fact:

- Operating expense: `expenses.description`, falling back to `No description provided`.
- Doctor payout: `cash_drawer_movements.description`, falling back to `Doctor payout` (or the payout reference when available).

Descriptions are aggregated per category and returned as a JSON array. Existing totals, payment methods, statuses, filtering, sorting, and pagination remain unchanged.

## UI layout

Column order:

1. Category
2. Details
3. Transactions
4. Paid Amount
5. Payment Methods
6. Statuses

The Details cell uses a compact list. Each item is readable and wraps naturally; the table retains horizontal scrolling on smaller screens.

Expansion state is local to `ExpenseAnalysisPanel` and keyed by category. A page/data change removes expansion state for categories no longer present.

## Accessibility

- The expansion control is a real button.
- Its accessible label names the category and the number of hidden descriptions.
- `aria-expanded` reflects the current row state.
- The plus icon is decorative; the button text communicates the action.

## Tests

Backend tests will verify:

- SQL selects operating-expense and doctor-payout descriptions.
- API rows return parsed `details` arrays.
- Missing details receive the documented fallback.
- Tenant isolation and existing paid-only rules remain intact.

Frontend tests will verify:

- The Details heading and first two descriptions are visible.
- Extra descriptions are hidden initially.
- “+ N more” expands all details.
- “Show less” collapses the row.
- Rows with no description display the fallback.

## Scope

No schema migration, expense editing, new detail page, or change to accounting calculations is required.
