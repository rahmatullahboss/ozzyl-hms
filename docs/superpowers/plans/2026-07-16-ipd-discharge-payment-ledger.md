# IPD Discharge Payment Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the left-side payment status block on IPD discharge invoices with a compact chronological payment ledger while preserving a clear PAID/PARTIAL/UNPAID status and leaving all non-discharge invoice layouts unchanged.

**Architecture:** Add a pure print-domain normalizer that merges existing `payments[]` and `deposit_adjustments[]` into stable chronological ledger entries. `BillPrint.tsx` creates ledger data only for discharge invoices and passes it to `InvoiceTotalsPayment`, which renders the ledger when valid rows exist and otherwise falls back to the current status block. Existing bill amount helpers and the right-side totals remain the financial source of truth.

**Tech Stack:** React 19, TypeScript 5.9, Vite 8, Vitest 4, Testing Library, lucide-react, existing `/api/billing/:id` response.

## Global Constraints

- Apply only when `invoiceLayout === 'discharge'`.
- Keep consultation, diagnostic, and generic invoice layouts unchanged.
- Reuse existing `payments[]` and `deposit_adjustments[]`; do not change the database, migrations, or API contract.
- Keep the existing right-side totals and bill amount helper calculations unchanged.
- Ignore zero, negative, and non-finite transaction amounts.
- Sort ledger rows oldest first using a stable ID tie-breaker.
- Mark only the latest valid payment as discharge settlement, and only when the invoice is fully settled.
- Do not fabricate payment method, reference, date, or settlement details when source data is missing.
- Keep all ledger rows printable in A5 and A4 without clipping.

---

## File Structure

**Create**
- `web/src/lib/print/paymentLedger.ts` — pure transaction normalization and settlement-marking logic.
- `web/src/lib/print/paymentLedger.test.ts` — behavioral tests for ordering, filtering, and settlement identification.

**Modify**
- `web/src/components/invoice/types.ts` — shared ledger entry type used by print page and component.
- `web/src/components/invoice/InvoiceTotalsPayment.tsx` — optional discharge ledger rendering with current block as fallback.
- Rename `web/src/components/invoice/InvoiceTotalsPayment.test.ts` to `web/src/components/invoice/InvoiceTotalsPayment.test.tsx` — retain source regressions and add real DOM tests for ledger, status, fallback, and unchanged normal behavior.
- `web/src/pages/BillPrint.tsx` — create discharge-only ledger, localize labels/methods, pass props, and add print CSS.
- `web/src/pages/BillPrint.test.ts` — source-level integration assertions for discharge-only wiring and compact print styles.

---

### Task 1: Build and test the pure payment-ledger normalizer

**Files:**
- Create: `web/src/lib/print/paymentLedger.test.ts`
- Create: `web/src/lib/print/paymentLedger.ts`
- Modify: `web/src/components/invoice/types.ts:58-65`

**Interfaces:**
- Consumes:
  - `payments: ReadonlyArray<PaymentLedgerSource>`
  - `depositAdjustments: ReadonlyArray<DepositAdjustmentLedgerSource>`
  - `isFullySettled: boolean`
- Produces:
  - `buildInvoicePaymentLedger(input): InvoicePaymentLedgerEntry[]`
  - `InvoicePaymentLedgerEntry` exported from `web/src/components/invoice/types.ts`

- [ ] **Step 1: Add the shared ledger type**

Append this interface after `InvoicePaymentInfo` in `web/src/components/invoice/types.ts`:

```ts
export interface InvoicePaymentLedgerEntry {
  id: string;
  kind: 'payment' | 'deposit_adjustment';
  amount: number;
  paymentMethod?: string | null;
  reference?: string | null;
  createdAt: string;
  isDischargeSettlement: boolean;
}
```

- [ ] **Step 2: Write failing normalizer tests**

Create `web/src/lib/print/paymentLedger.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildInvoicePaymentLedger } from './paymentLedger';

describe('buildInvoicePaymentLedger', () => {
  it('merges deposits and payments in chronological order and marks the latest payment when settled', () => {
    const result = buildInvoicePaymentLedger({
      payments: [
        {
          id: 9,
          amount: 33_900,
          receipt_no: 'PAY-009',
          payment_method: 'cash',
          created_at: '2026-07-16T10:00:00Z',
        },
      ],
      depositAdjustments: [
        {
          id: 3,
          amount: 300,
          deposit_receipt_no: 'DEP-003',
          payment_method: 'cash',
          created_at: '2026-07-14T08:00:00Z',
        },
      ],
      isFullySettled: true,
    });

    expect(result).toEqual([
      {
        id: 'deposit_adjustment-3',
        kind: 'deposit_adjustment',
        amount: 300,
        paymentMethod: 'cash',
        reference: 'DEP-003',
        createdAt: '2026-07-14T08:00:00Z',
        isDischargeSettlement: false,
      },
      {
        id: 'payment-9',
        kind: 'payment',
        amount: 33_900,
        paymentMethod: 'cash',
        reference: 'PAY-009',
        createdAt: '2026-07-16T10:00:00Z',
        isDischargeSettlement: true,
      },
    ]);
  });

  it('does not mark a partial payment as discharge settlement', () => {
    const result = buildInvoicePaymentLedger({
      payments: [{ id: 1, amount: 1_000, created_at: '2026-07-16T09:00:00Z' }],
      depositAdjustments: [],
      isFullySettled: false,
    });

    expect(result[0]?.isDischargeSettlement).toBe(false);
  });

  it('filters invalid amounts and uses stable ids to order equal timestamps', () => {
    const result = buildInvoicePaymentLedger({
      payments: [
        { id: 2, amount: 200, created_at: '2026-07-16T09:00:00Z' },
        { id: 1, amount: 100, created_at: '2026-07-16T09:00:00Z' },
        { id: 3, amount: 0, created_at: '2026-07-16T10:00:00Z' },
        { id: 4, amount: Number.NaN, created_at: '2026-07-16T11:00:00Z' },
      ],
      depositAdjustments: [
        { id: 5, amount: -50, created_at: '2026-07-15T08:00:00Z' },
      ],
      isFullySettled: true,
    });

    expect(result.map((entry) => entry.id)).toEqual(['payment-1', 'payment-2']);
    expect(result.map((entry) => entry.isDischargeSettlement)).toEqual([false, true]);
  });
});
```

- [ ] **Step 3: Run the normalizer test and verify RED**

Run:

```bash
cd web && npm test -- src/lib/print/paymentLedger.test.ts
```

Expected: FAIL because `./paymentLedger` does not exist.

- [ ] **Step 4: Implement the minimal normalizer**

Create `web/src/lib/print/paymentLedger.ts`:

```ts
import type { InvoicePaymentLedgerEntry } from '../../components/invoice/types';

interface PaymentLedgerSource {
  id: number | string;
  amount: number;
  receipt_no?: string | null;
  payment_method?: string | null;
  created_at?: string | null;
}

interface DepositAdjustmentLedgerSource {
  id: number | string;
  amount: number;
  deposit_receipt_no?: string | null;
  payment_method?: string | null;
  created_at?: string | null;
}

interface BuildInvoicePaymentLedgerInput {
  payments: ReadonlyArray<PaymentLedgerSource>;
  depositAdjustments: ReadonlyArray<DepositAdjustmentLedgerSource>;
  isFullySettled: boolean;
}

function isPositiveFiniteAmount(value: unknown): value is number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0;
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

export function buildInvoicePaymentLedger({
  payments,
  depositAdjustments,
  isFullySettled,
}: BuildInvoicePaymentLedgerInput): InvoicePaymentLedgerEntry[] {
  const entries: InvoicePaymentLedgerEntry[] = [
    ...depositAdjustments
      .filter((entry) => isPositiveFiniteAmount(entry.amount))
      .map((entry) => ({
        id: `deposit_adjustment-${entry.id}`,
        kind: 'deposit_adjustment' as const,
        amount: Number(entry.amount),
        paymentMethod: entry.payment_method ?? null,
        reference: entry.deposit_receipt_no ?? null,
        createdAt: entry.created_at ?? '',
        isDischargeSettlement: false,
      })),
    ...payments
      .filter((entry) => isPositiveFiniteAmount(entry.amount))
      .map((entry) => ({
        id: `payment-${entry.id}`,
        kind: 'payment' as const,
        amount: Number(entry.amount),
        paymentMethod: entry.payment_method ?? null,
        reference: entry.receipt_no ?? null,
        createdAt: entry.created_at ?? '',
        isDischargeSettlement: false,
      })),
  ].sort((left, right) => {
    const timeDifference = timestamp(left.createdAt) - timestamp(right.createdAt);
    return timeDifference || left.id.localeCompare(right.id, undefined, { numeric: true });
  });

  if (isFullySettled) {
    const latestPayment = [...entries].reverse().find((entry) => entry.kind === 'payment');
    if (latestPayment) latestPayment.isDischargeSettlement = true;
  }

  return entries;
}
```

- [ ] **Step 5: Run the normalizer tests and verify GREEN**

Run:

```bash
cd web && npm test -- src/lib/print/paymentLedger.test.ts
```

Expected: all three tests PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add web/src/components/invoice/types.ts web/src/lib/print/paymentLedger.ts web/src/lib/print/paymentLedger.test.ts
git commit -m "feat(billing): normalize discharge payment ledger"
```

---

### Task 2: Render the discharge ledger with status and fallback behavior

**Files:**
- Rename: `web/src/components/invoice/InvoiceTotalsPayment.test.ts` → `web/src/components/invoice/InvoiceTotalsPayment.test.tsx`
- Modify: `web/src/components/invoice/InvoiceTotalsPayment.test.tsx`
- Modify: `web/src/components/invoice/InvoiceTotalsPayment.tsx:1-122`

**Interfaces:**
- Consumes:
  - `paymentLedger?: InvoicePaymentLedgerEntry[]`
  - `formatLedgerDateTime?: (value: string) => string`
  - ledger labels inside the existing `labels` object
- Produces:
  - `.invoice-payment-ledger` markup only when `paymentLedger.length > 0`
  - unchanged `.invoice-payment-compact-status` fallback when ledger data is absent

- [ ] **Step 1: Rename the test file for JSX and add DOM behavior tests while retaining existing regression assertions**

Run:

```bash
mv web/src/components/invoice/InvoiceTotalsPayment.test.ts web/src/components/invoice/InvoiceTotalsPayment.test.tsx
```

Then update `web/src/components/invoice/InvoiceTotalsPayment.test.tsx` to import `render`, `screen`, and the component. Define a reusable base prop object containing all existing required numeric fields and labels. Add these tests:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import InvoiceTotalsPayment from './InvoiceTotalsPayment';

const labels = {
  paymentMethod: 'Payment Method',
  subtotal: 'Subtotal',
  discount: 'Discount',
  discountReason: 'Reason',
  discountReference: 'Reference',
  approvedBy: 'Approved By',
  tax: 'Tax',
  totalAmount: 'Total Amount',
  paid: 'Paid',
  depositAdjusted: 'Deposit Adjusted',
  due: 'Due',
  paidStatus: 'PAID',
  partialStatus: 'PARTIAL',
  unpaidStatus: 'UNPAID',
  unpaidAmount: 'Unpaid',
  paymentHistory: 'Payment History',
  paymentReceived: 'Payment Received',
  dischargeSettlement: 'Discharge Settlement',
  ledgerDepositAdjusted: 'Deposit Adjusted',
  settledAtDischarge: 'Settled at discharge',
  receipt: 'Receipt',
};

const baseProps = {
  identifier: <span>INV-1</span>,
  subtotal: 35_445,
  discount: 1_245,
  tax: 0,
  total: 34_200,
  paid: 34_200,
  depositAdjusted: 300,
  outstanding: 0,
  status: 'paid',
  money: (amount: number) => `৳${amount}`,
  labels,
};

it('renders deposit then discharge settlement with PAID status', () => {
  render(
    <InvoiceTotalsPayment
      {...baseProps}
      paymentLedger={[
        {
          id: 'deposit_adjustment-1',
          kind: 'deposit_adjustment',
          amount: 300,
          paymentMethod: 'Cash',
          reference: 'DEP-1',
          createdAt: '2026-07-14T08:00:00Z',
          isDischargeSettlement: false,
        },
        {
          id: 'payment-2',
          kind: 'payment',
          amount: 33_900,
          paymentMethod: 'Cash',
          reference: 'PAY-2',
          createdAt: '2026-07-16T10:00:00Z',
          isDischargeSettlement: true,
        },
      ]}
      formatLedgerDateTime={(value) => value.slice(0, 10)}
    />,
  );

  expect(screen.getByText('Payment History')).toBeInTheDocument();
  expect(screen.getByText('PAID')).toBeInTheDocument();
  expect(screen.getAllByText('Deposit Adjusted')).toHaveLength(2);
  expect(screen.getByText('Discharge Settlement')).toBeInTheDocument();
  expect(screen.getByText('Settled at discharge')).toBeInTheDocument();
  expect(screen.getByText('৳300')).toBeInTheDocument();
  expect(screen.getByText('৳33900')).toBeInTheDocument();
});

it('shows PARTIAL and does not invent discharge settlement', () => {
  render(
    <InvoiceTotalsPayment
      {...baseProps}
      paid={1_000}
      depositAdjusted={0}
      outstanding={33_200}
      status="partial"
      paymentLedger={[
        {
          id: 'payment-1',
          kind: 'payment',
          amount: 1_000,
          createdAt: '2026-07-16T09:00:00Z',
          isDischargeSettlement: false,
        },
      ]}
    />,
  );

  expect(screen.getByText('PARTIAL')).toBeInTheDocument();
  expect(screen.getByText('Payment Received')).toBeInTheDocument();
  expect(screen.queryByText('Discharge Settlement')).not.toBeInTheDocument();
  expect(screen.queryByText('Settled at discharge')).not.toBeInTheDocument();
});

it('falls back to the existing compact status block when ledger is empty', () => {
  const { container } = render(
    <InvoiceTotalsPayment {...baseProps} paymentMethodLabel="Cash" paymentLedger={[]} />,
  );

  expect(container.querySelector('.invoice-payment-ledger')).not.toBeInTheDocument();
  expect(container.querySelector('.invoice-payment-compact-status')).toBeInTheDocument();
  expect(screen.getByText('Payment Method')).toBeInTheDocument();
  expect(screen.getByText('Cash')).toBeInTheDocument();
});
```

Keep the existing raw-source regression checks for `.invoice-payment-compact`, absence of old card classes, and `.invoice-subtotal-row`.

- [ ] **Step 2: Run component tests and verify RED**

Run:

```bash
cd web && npm test -- src/components/invoice/InvoiceTotalsPayment.test.tsx
```

Expected: FAIL because ledger props and labels do not exist and no ledger markup is rendered.

- [ ] **Step 3: Extend component props and render the ledger**

In `InvoiceTotalsPayment.tsx`:

1. Import `InvoicePaymentLedgerEntry`.
2. Add optional props:

```ts
paymentLedger?: InvoicePaymentLedgerEntry[];
formatLedgerDateTime?: (value: string) => string;
```

3. Add labels:

```ts
paymentHistory: string;
paymentReceived: string;
dischargeSettlement: string;
ledgerDepositAdjusted: string;
settledAtDischarge: string;
receipt: string;
```

4. Compute:

```ts
const hasLedger = Boolean(paymentLedger?.length);
const settlementEntry = paymentLedger?.find((entry) => entry.isDischargeSettlement);
const formatEntryDate = (value: string) => {
  if (!value) return '';
  try {
    return formatLedgerDateTime?.(value) ?? value;
  } catch {
    return value;
  }
};
```

5. Inside the existing payment box, conditionally render:

```tsx
{hasLedger ? (
  <div className="invoice-payment-ledger" data-testid="invoice-payment-ledger">
    <div className="invoice-payment-ledger-header">
      <div>
        <WalletCards aria-hidden="true" />
        <strong>{labels.paymentHistory}</strong>
      </div>
      <span className="invoice-payment-ledger-status">{statusTitle}</span>
    </div>

    <div className="invoice-payment-ledger-list">
      {paymentLedger!.map((entry) => {
        const entryLabel = entry.kind === 'deposit_adjustment'
          ? labels.ledgerDepositAdjusted
          : entry.isDischargeSettlement
            ? labels.dischargeSettlement
            : labels.paymentReceived;
        const metadata = [
          formatEntryDate(entry.createdAt),
          entry.paymentMethod,
          entry.reference ? `${labels.receipt}: ${entry.reference}` : null,
        ].filter(Boolean);

        return (
          <div className="invoice-payment-ledger-row" key={entry.id}>
            <div className="invoice-payment-ledger-description">
              <strong>{entryLabel}</strong>
              {metadata.length > 0 && <span>{metadata.join(' · ')}</span>}
            </div>
            <strong className="invoice-payment-ledger-amount">{money(entry.amount)}</strong>
          </div>
        );
      })}
    </div>

    {isPaid && settlementEntry && (
      <div className="invoice-payment-ledger-settlement">
        <span>{labels.settledAtDischarge}</span>
        <strong>{money(settlementEntry.amount)}</strong>
      </div>
    )}

    <div className="invoice-large-identifier">{identifier}</div>
  </div>
) : (
  <>
    <div className="invoice-payment-compact-status">
      <WalletCards aria-hidden="true" />
      <strong>{statusTitle}</strong>
    </div>
    {paymentMethodLabel && (
      <div><span>{labels.paymentMethod}</span><strong>{paymentMethodLabel}</strong></div>
    )}
    {outstanding > 0 && (
      <div className="invoice-payment-compact-due">
        <span>{labels.unpaidAmount}</span>
        <strong>{money(outstanding)}</strong>
      </div>
    )}
    <div className="invoice-large-identifier">{identifier}</div>
  </>
)}
```

Do not change the totals markup.

- [ ] **Step 4: Run component tests and verify GREEN**

Run:

```bash
cd web && npm test -- src/components/invoice/InvoiceTotalsPayment.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add web/src/components/invoice/InvoiceTotalsPayment.tsx web/src/components/invoice/InvoiceTotalsPayment.test.tsx
git commit -m "feat(billing): render discharge payment history"
```

---

### Task 3: Wire the ledger only into IPD discharge print and add compact print styling

**Files:**
- Modify: `web/src/pages/BillPrint.test.ts:307-344`
- Modify: `web/src/pages/BillPrint.tsx:1-28, 623-660, 962-998`
- Modify: `web/src/pages/BillPrint.tsx:324-341, 386-444` (embedded print CSS)

**Interfaces:**
- Consumes: `buildInvoicePaymentLedger` from Task 1.
- Produces: `paymentLedger` and ledger labels only for `invoiceLayout === 'discharge'`.

- [ ] **Step 1: Add failing BillPrint integration assertions**

Extend `web/src/pages/BillPrint.test.ts` with:

```ts
it('builds and passes payment history only for discharge invoices', async () => {
  const source = await import('./BillPrint?raw');
  const text = String(source.default ?? '');

  expect(text).toContain("import { buildInvoicePaymentLedger } from '../lib/print/paymentLedger';");
  expect(text).toContain('const isFullySettled = outstanding <= 0');
  expect(text).toContain('const dischargePaymentLedger = invoiceLayout === \'discharge\'');
  expect(text).toContain('buildInvoicePaymentLedger({');
  expect(text).toContain('payments,');
  expect(text).toContain('depositAdjustments,');
  expect(text).toContain('isFullySettled,');
  expect(text).toContain('paymentLedger={localizedDischargePaymentLedger}');
});

it('includes compact discharge ledger styles without changing the two-column totals layout', async () => {
  const source = await import('./BillPrint?raw');
  const text = String(source.default ?? '');

  expect(text).toContain('.invoice-payment-ledger {');
  expect(text).toContain('.invoice-payment-ledger-header {');
  expect(text).toContain('.invoice-payment-ledger-row {');
  expect(text).toContain('.invoice-payment-ledger-settlement {');
  expect(text).toContain('.invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-row {');
  expect(text).toContain('grid-template-areas: "payment totals";');
});
```

- [ ] **Step 2: Run BillPrint tests and verify RED**

Run:

```bash
cd web && npm test -- src/pages/BillPrint.test.ts
```

Expected: the two new tests FAIL because the normalizer, props, labels, and styles are not wired.

- [ ] **Step 3: Import and construct the discharge-only ledger**

Add:

```ts
import { buildInvoicePaymentLedger } from '../lib/print/paymentLedger';
```

After `invoiceLayout` is computed, add:

```ts
const isFullySettled = outstanding <= 0
  && (bill.status === 'paid' || settledAmount >= Number(bill.total_amount ?? 0));
const dischargePaymentLedger = invoiceLayout === 'discharge'
  ? buildInvoicePaymentLedger({
      payments,
      depositAdjustments,
      isFullySettled,
    })
  : undefined;
```

Keep all existing amount calculations unchanged.

- [ ] **Step 4: Localize payment methods per ledger entry and pass props**

Before passing entries, map payment methods without mutating the normalized data:

```ts
const localizedDischargePaymentLedger = dischargePaymentLedger?.map((entry) => ({
  ...entry,
  paymentMethod: entry.paymentMethod
    ? t(`payMethod_${entry.paymentMethod}`, {
        defaultValue: entry.paymentMethod,
        lng: printLang,
      })
    : null,
}));
```

Pass to `InvoiceTotalsPayment`:

```tsx
paymentLedger={localizedDischargePaymentLedger}
formatLedgerDateTime={formatLocalizedDateTime}
```

Add labels:

```ts
paymentHistory: l('Payment History', 'পেমেন্ট হিস্টরি'),
paymentReceived: l('Payment Received', 'পেমেন্ট গ্রহণ'),
dischargeSettlement: l('Discharge Settlement', 'ডিসচার্জ সেটেলমেন্ট'),
ledgerDepositAdjusted: l('Deposit Adjusted', 'ডিপোজিট সমন্বয়'),
settledAtDischarge: l('Settled at discharge', 'ডিসচার্জের সময় পরিশোধ'),
receipt: l('Receipt', 'রসিদ'),
```

Because the prop is `undefined` outside discharge layout, consultation, diagnostic, and generic invoices keep the current block.

- [ ] **Step 5: Add ledger CSS inside `getPrintStyles`**

Add after the existing `.invoice-payment-compact` rules:

```css
.invoice-payment-ledger {
  display: grid !important; width: 100%; gap: 7px; align-items: stretch !important;
}
.invoice-payment-ledger-header {
  display: flex !important; align-items: center; justify-content: space-between; gap: 10px;
  padding-bottom: 6px; border-bottom: 1px solid var(--invoice-line);
}
.invoice-payment-ledger-header > div { display: flex; align-items: center; gap: 7px; }
.invoice-payment-ledger-header svg { width: 18px; height: 18px; color: var(--invoice-teal-dark); }
.invoice-payment-ledger-header strong { color: var(--invoice-teal-dark); font-size: 11px; }
.invoice-payment-ledger-status {
  flex: none; border: 1px solid currentColor; border-radius: 999px; padding: 2px 7px;
  color: var(--invoice-teal-dark) !important; font-size: 8px; font-weight: 900; letter-spacing: .04em;
}
.invoice-payment-compact.is-partial .invoice-payment-ledger-status { color: #b45309 !important; }
.invoice-payment-compact.is-due .invoice-payment-ledger-status { color: #b42318 !important; }
.invoice-payment-ledger-list { display: grid !important; gap: 4px; width: 100%; }
.invoice-payment-ledger-row {
  display: grid !important; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 10px;
  padding: 4px 0; border-bottom: 1px dashed #cbd9df;
}
.invoice-payment-ledger-description { display: grid !important; gap: 2px; min-width: 0; }
.invoice-payment-ledger-description > strong { font-size: 9px; }
.invoice-payment-ledger-description > span { overflow-wrap: anywhere; font-size: 7.5px; line-height: 1.25; }
.invoice-payment-ledger-amount { white-space: nowrap; font-size: 9px; }
.invoice-payment-ledger-settlement {
  display: flex !important; justify-content: space-between; gap: 10px; padding-top: 2px;
  color: var(--invoice-teal-dark); font-size: 8.5px; font-weight: 800;
}
```

Add A5-specific rules near the current discharge A5 payment styles:

```css
.invoice-layout-discharge.invoice-paper-a5 .invoice-payment-compact {
  min-height: 46px; padding: 7px 10px; gap: 10px; font-size: 8.5px;
}
.invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger { gap: 4px; }
.invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-header { padding-bottom: 4px; }
.invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-header svg { width: 14px; height: 14px; }
.invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-header strong { font-size: 9px; }
.invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-row { gap: 6px; padding: 2px 0; }
.invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-description > strong,
.invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-amount { font-size: 7.5px; }
.invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-description > span { font-size: 6.5px; }
.invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-settlement { font-size: 7px; }
```

Do not add `max-height`, `overflow: hidden`, or clipping rules.

- [ ] **Step 6: Run focused tests**

Run:

```bash
cd web && npm test -- src/lib/print/paymentLedger.test.ts src/components/invoice/InvoiceTotalsPayment.test.tsx src/pages/BillPrint.test.ts
```

Expected: all focused tests PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add web/src/pages/BillPrint.tsx web/src/pages/BillPrint.test.ts
git commit -m "feat(billing): show IPD discharge payment ledger"
```

---

### Task 4: Full verification and regression check

**Files:**
- Verify only; modify production code only if a failing test or TypeScript error directly relates to this feature.

**Interfaces:**
- Confirms all prior task outputs integrate under the existing web build.

- [ ] **Step 1: Run the full web test suite**

```bash
cd web && npm test
```

Expected: PASS with no new failures.

- [ ] **Step 2: Run TypeScript and production build verification**

```bash
cd web && npm run build
```

Expected: TypeScript compilation and Vite production build PASS.

- [ ] **Step 3: Review the final diff for scope**

Confirm the diff contains only:

```text
web/src/components/invoice/types.ts
web/src/components/invoice/InvoiceTotalsPayment.tsx
web/src/components/invoice/InvoiceTotalsPayment.test.tsx
web/src/lib/print/paymentLedger.ts
web/src/lib/print/paymentLedger.test.ts
web/src/pages/BillPrint.tsx
web/src/pages/BillPrint.test.ts
docs/superpowers/plans/2026-07-16-ipd-discharge-payment-ledger.md
```

Also confirm:

```text
- no migration or backend route changes
- no change to getBillSettledAmount/getBillOutstandingAmount logic
- paymentLedger is undefined for non-discharge layouts
- no CSS clipping of ledger rows
```

- [ ] **Step 4: Commit any verification-only correction if needed**

Only when Task 4 required a directly related correction:

```bash
git add <corrected-files>
git commit -m "fix(billing): stabilize discharge ledger print"
```

If no correction was needed, do not create an empty commit.
