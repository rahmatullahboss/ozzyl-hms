# Canonical Unpaid Invoice Cancellation Design

**Date:** 2026-07-23
**Base:** local `main` at `f57539677`
**Status:** Approved by the existing CDB-102E design and the user's instruction to complete the remaining canonical gaps from current local `main`.

## Problem

Approved cancellation of an unpaid legacy bill updates `bills`, `invoice_items`, performer reserves, doctor commission accruals and income, but the strict boundary `bill.cancel.unpaid` is blocked because no canonical invoice cancellation command exists. The canonical schema already supports `status='cancelled'` and `cancelled_at_utc`; fabricating a credit note would misrepresent a cancellation as a posted adjustment document.

## Decision

Implement a dedicated canonical unpaid-invoice cancellation lifecycle.

1. Resolve the canonical invoice from the persisted legacy bill mapping.
2. Require the canonical invoice to be posted and genuinely unpaid:
   - `paid_minor = 0`;
   - `credited_minor = 0`;
   - `due_minor = total_minor`;
   - `net_due_minor = total_minor`;
   - no active payment allocation;
   - no active deposit application;
   - no posted credit note.
3. Reject cancellation when any canonical compensation accrual has a settled balance.
4. Set the canonical invoice to `cancelled` with an immutable cancellation timestamp while preserving original invoice totals and balance projections for audit.
5. Reduce every unpaid canonical compensation accrual for the invoice by its full payable balance using an immutable `service_cancellation` adjustment. The accrual becomes `reversed` when payable and settled balances are both zero.
6. Commit canonical invoice state, compensation adjustments, source mappings, outbox event and the existing legacy financial statements through one `executeStrictFinancialMutation` boundary.
7. Keep clinical lab cancellation after the confirmed financial commit. Clinical cancellation functions are idempotent and are not the financial authority.

## Command

Create `cancelUnpaidInvoice()` in `src/lib/canonical/commands/cancel-invoice.ts`.

Input:

```ts
interface CancelUnpaidInvoiceInput {
  tenantId: string;
  invoicePublicId: string;
  reasonCode: string;
  cancelledAtUtc: string;
  businessDate: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
}
```

Result:

```ts
interface CancelUnpaidInvoiceResult {
  invoicePublicId: string;
  status: 'cancelled';
  totalMinor: number;
  reversedCompensationMinor: number;
  reversedCompensationCount: number;
}
```

The command reads compensation rows after idempotency replay detection and derives deterministic adjustment IDs from the cancellation source and accrual public ID. It stores only reason codes, public IDs, amounts and hashes in canonical outbox/mapping data; free-text approval notes remain only in the legacy audit fields.

## Live projection

Create `resolveLiveUnpaidInvoiceCancellationProjection()` in `src/lib/canonical/live-unpaid-invoice-cancellation.ts`.

It accepts the persisted legacy bill identity, invoice number, total, paid amount, cancellation timestamp and fixed reason code. It resolves the existing canonical invoice mapping, verifies that the mapped canonical invoice corresponds to the same legacy bill authority, and creates deterministic command/outbox identities and normalized source evidence.

It does not recover or create a missing invoice. In shadow mode a missing mapping remains visible as a canonical shadow failure; in strict mode no legacy mutation commits.

## Legacy atomic statements

For an unpaid bill the strict authoritative batch contains:

- `bills.status='cancelled'` with reviewer/reason/timestamp;
- all active `invoice_items` cancelled;
- reserved `diagnostic_performer_reserves` cancelled;
- accrued `doctor_commission_accruals` cancelled;
- idempotent legacy commission-cancellation accounting events for each accrued commission row;
- the existing negative `income` correction.

All statements include tenant and expected-state predicates. The command receives them as `authoritativeStatements`; therefore strict canonical validation failure writes neither legacy nor canonical state.

## Accounting

Add `canonical.invoice.cancelled` to the canonical accounting poster. A cancelled unpaid invoice posts the exact inverse of issuance:

- debit `patient_revenue`;
- credit `accounts_receivable`.

The poster reads a canonical invoice whose status is `cancelled`, requires a positive total and uses existing tenant accounting mappings. The outbox event carries the invoice public ID and total only.

## Replay and concurrency

- The idempotency key is stable per tenant and legacy bill cancellation.
- A replay returns the original result before state-dependent validation.
- The canonical invoice update predicates on the original posted/unpaid state.
- Every compensation update predicates on the original adjusted, settled, payable and status values.
- Source mapping conflicts fail the atomic batch.
- A second semantically different cancellation using the same key raises an idempotency conflict.

## Route behavior

`executeBillCancellationApproval()` continues converting paid bills to credit-note workflow. For a genuinely unpaid bill it:

1. loads and validates the persisted bill and payment total;
2. loads accrued legacy commission rows for statement/event construction;
3. builds legacy statements without executing them;
4. calls `executeStrictFinancialMutation` with `bill.cancel.unpaid`;
5. resolves and executes `cancelUnpaidInvoice`;
6. runs clinical lab cancellation only after the financial commit;
7. writes the existing audit log.

The route coverage record changes from `blocked_in_strict` to `integrated` only after command, route and accounting tests pass.

## Testing

- Command tests use real in-memory SQLite migrations.
- Successful cancellation proves invoice state, compensation adjustments, mappings, outbox payload and legacy authoritative statements commit atomically.
- Replays are duplicate-safe.
- Payments, deposit applications, credit notes, settled compensation, cross-tenant mappings and stale invoice state all fail closed.
- Accounting poster tests prove cancellation produces balanced inverse entries.
- Approval route tests prove disabled behavior remains compatible, shadow mode records canonical failure without undoing legacy success, and strict mode writes both authorities atomically.

## Non-goals

- Paid cancellation or cash refund attribution.
- Production deployment, migration, backfill, feature-flag mutation or Tenant-100 strict activation.
- Deleting invoice lines or changing original invoice amounts.
- Recovering missing canonical invoices inside the cancellation command.
