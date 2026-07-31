# IPD Discharge Bill Payment Ledger Design

**Date:** 2026-07-16  
**Scope:** IPD discharge invoice print only

## Problem

The current discharge invoice shows a large `PAID` status block on the left and aggregate totals on the right. Although the totals include paid and deposit-adjusted amounts, a reader cannot easily understand the payment sequence—for example, that the patient deposited ৳300 earlier and paid the remaining amount during discharge.

## Goal

Make the discharge bill self-explanatory by showing a compact chronological payment ledger in the left financial block while retaining a clear final settlement status.

## Scope and boundaries

- Apply only when `invoiceLayout === 'discharge'`.
- Keep consultation, diagnostic, and generic invoice layouts unchanged.
- Reuse the existing `/api/billing/:id` response fields:
  - `payments[]`
  - `deposit_adjustments[]`
- Do not add or change database tables, migrations, or API endpoints.
- Keep the existing totals block on the right as the financial summary/source of truth.

## Approaches considered

### 1. Add explanatory text under the existing PAID badge

This is the smallest visual change, but it still compresses multiple transactions into one sentence and becomes unclear when there are several deposits or payments.

### 2. Show a compact transaction ledger in the existing left block — selected

This uses the available print space to show each payment event with date/time, type, method, receipt reference, and amount. It provides the clearest audit trail without changing backend behavior.

### 3. Move the full ledger below the totals table

This gives more width but increases invoice height and separates the transaction history from the payment status. It is less suitable for A5 discharge prints.

## Selected UI design

For an IPD discharge bill, replace the current content of the left `invoice-payment-compact` block with:

1. A header row:
   - Title: `Payment History` / `পেমেন্ট হিস্টরি`
   - Final status badge on the right: `PAID`, `PARTIAL`, or `UNPAID`
2. A chronological transaction list, oldest first.
3. One row per event containing:
   - Date and time
   - Transaction label
   - Payment method when available
   - Receipt/reference number when available
   - Amount aligned to the right
4. A compact final line when fully settled:
   - `Settled at discharge` / `ডিসচার্জের সময় পরিশোধ`
   - The discharge/final payment amount when it can be identified
5. The invoice identifier remains in the block, but visually secondary.

### Transaction labels

- Entries from `deposit_adjustments[]`: `Deposit Adjusted` / `ডিপোজিট সমন্বয়`
- Entries from `payments[]`:
  - The final payment made when the bill becomes settled: `Discharge Settlement` / `ডিসচার্জ সেটেলমেন্ট`
  - Earlier payments: `Payment Received` / `পেমেন্ট গ্রহণ`

The final settlement payment is identified from the latest applicable payment in the chronological list when the bill is fully paid. The UI must not invent a settlement amount when payment data is missing or ambiguous.

## Data transformation

Create a print-only normalized ledger model from existing arrays:

```ts
interface InvoicePaymentLedgerEntry {
  id: string;
  kind: 'payment' | 'deposit_adjustment';
  label: string;
  amount: number;
  paymentMethod?: string | null;
  reference?: string | null;
  createdAt: string;
  isDischargeSettlement?: boolean;
}
```

Transformation rules:

- Convert every valid positive `payments[]` entry into a `payment` ledger entry.
- Convert every valid positive `deposit_adjustments[]` entry into a `deposit_adjustment` ledger entry.
- Sort by `createdAt` ascending; use a stable ID as a tie-breaker.
- Ignore zero, negative, or non-finite display amounts.
- Mark only the latest payment as `isDischargeSettlement` when the invoice is fully settled.
- Do not count ledger rows again when calculating totals; totals continue to use existing bill amount helpers.

## Empty and incomplete data behavior

- If no transaction rows are returned, retain the existing status-oriented payment block rather than showing an empty ledger.
- Missing payment method, receipt number, or receiver name should simply be omitted.
- Invalid dates should display the original value or a safe fallback without breaking the print page.
- A paid invoice with incomplete transaction history still shows `PAID`, but does not fabricate transaction details.

## Layout and print behavior

- Preserve the existing two-column financial layout.
- The ledger must fit A5 and A4 print modes without overlapping the totals or footer.
- Use compact rows and controlled wrapping.
- For long histories, keep all entries visible; reduce spacing/font size within reasonable readability limits rather than clipping data.
- On narrow screen preview, continue stacking totals and payment sections according to the existing responsive behavior.

## Component changes

### `web/src/pages/BillPrint.tsx`

- Normalize the existing payments and deposit adjustments into ledger entries.
- Pass ledger data and discharge-only labels to `InvoiceTotalsPayment`.
- Add print CSS for the ledger header, rows, metadata, status badge, and compact A5 behavior.

### `web/src/components/invoice/InvoiceTotalsPayment.tsx`

- Add optional payment-ledger props.
- Render the ledger only when supplied for a discharge invoice and at least one valid entry exists.
- Preserve the current payment status block as the fallback and as the behavior for all other invoice layouts.

## Testing

Add focused component/page tests covering:

1. A discharge bill with an earlier deposit adjustment and a final payment displays both chronologically.
2. The latest payment is labelled as discharge settlement only when the bill is fully settled.
3. A partially paid discharge bill shows `PARTIAL` and does not incorrectly label a payment as final settlement.
4. A discharge bill without transaction history falls back to the current status block.
5. Consultation and diagnostic invoices remain unchanged.
6. Invalid/zero transaction amounts are excluded from the display ledger.

## Acceptance criteria

- A reader can tell how much was paid earlier and how much was paid at discharge.
- Fully settled discharge bills clearly show `PAID`.
- The right-side totals remain accurate and unchanged.
- No duplicate financial calculation is introduced.
- No database or API contract change is required.
- Non-discharge invoice layouts retain their current appearance and behavior.
