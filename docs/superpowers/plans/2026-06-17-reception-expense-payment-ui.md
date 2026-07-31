# Reception Expense Payment UI Fix

## Problem
The reception shift handover modal currently shows an Expense Payment section, but the fields are disabled and the UI says:

> Expense payment needs expense category setup first.

This is misleading because `src/routes/tenant/expenses.ts` already supports creating expenses with a plain `category` string through `POST /api/expenses`. There is no separate expense-category setup endpoint required for the current backend flow.

## Existing backend behavior
`POST /api/expenses` accepts:

```json
{
  "date": "YYYY-MM-DD",
  "category": "Transport",
  "amount": 500,
  "description": "Rickshaw fare - paid to Karim"
}
```

For reception/receptionist users, the route:
- Requires an active billing counter session.
- Checks drawer cash availability.
- Inserts an expense record.
- If approved, queues direct expense accounting.
- Inserts a `cash_drawer_movements` row with `movement_type = cash_out` and `reference_type = expense` or `expense_pending`.

## Required frontend fix
File:

```text
web/src/components/reception/ReceptionTopBar.tsx
```

Replace the disabled Expense Payment stub with a working form.

### Add state

```ts
const [expenseAmount, setExpenseAmount] = useState('');
const [expenseCategory, setExpenseCategory] = useState('');
const [expensePaidTo, setExpensePaidTo] = useState('');
const [expenseNote, setExpenseNote] = useState('');
```

### Add default categories

```ts
const DEFAULT_EXPENSE_CATEGORIES = [
  { value: 'Tea / Snacks', labelKey: 'teaSnacks', defaultLabel: 'Tea/snacks' },
  { value: 'Stationery', labelKey: 'stationery', defaultLabel: 'Stationery' },
  { value: 'Transport / Rickshaw', labelKey: 'transportRickshaw', defaultLabel: 'Transport/rickshaw' },
  { value: 'Maintenance', labelKey: 'maintenance', defaultLabel: 'Maintenance' },
  { value: 'Cleaning', labelKey: 'cleaning', defaultLabel: 'Cleaning' },
  { value: 'Other', labelKey: 'other', defaultLabel: 'Other' },
];
```

### Add mutation

```ts
const createExpensePayment = useApiMutation<unknown, { date: string; category: string; amount: number; description?: string }>(
  'post',
  '/api/expenses',
  {
    onSuccess: () => {
      toast.success(t('expensePaymentRecorded', { defaultValue: 'Expense payment recorded' }));
      setExpenseAmount('');
      setExpenseCategory('');
      setExpensePaidTo('');
      setExpenseNote('');
      queryClient.invalidateQueries({ queryKey: ['billing-counter'] });
      queryClient.invalidateQueries({ queryKey: ['reception'] });
    },
    onError: (error) => toast.error(error.message || t('failedRecordExpensePayment', { defaultValue: 'Failed to record expense payment' })),
  },
);
```

### Submit payload

```ts
const today = new Date().toISOString().slice(0, 10);
const description = [expenseNote.trim(), expensePaidTo.trim() ? `Paid to: ${expensePaidTo.trim()}` : null]
  .filter(Boolean)
  .join(' | ');

createExpensePayment.mutate({
  date: today,
  category: expenseCategory,
  amount: Number(expenseAmount),
  description,
});
```

### Validation
Disable submit when:
- no active counter
- amount is blank or <= 0
- category is blank
- note and paid-to are both blank
- mutation is pending

### UI copy
Replace:

```text
Expense payment needs expense category setup first.
Expense setup required
```

With:

```text
Expense will reduce the current drawer cash and create an expense record.
Record expense
```

## Acceptance criteria
- Expense amount/category/vendor/note fields are enabled.
- Default categories show in the select.
- Submit calls `POST /api/expenses`.
- Success clears fields and refreshes billing-counter/reception queries.
- Drawer cash decreases through the existing backend cash drawer movement.
- No separate expense category setup page is required for this flow.
