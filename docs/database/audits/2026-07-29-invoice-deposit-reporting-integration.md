# CDB-V1-030N Invoice, Deposit and Reporting Integration Audit

**Checkpoint:** `CDB-V1-030N-INVOICE-DEPOSIT-REPORTING-INTEGRATION-VERIFIED`
**Date:** 2026-07-29
**Branch:** `program/cdb-main-continuous-20260725`
**Scope:** local repository implementation and deterministic governance only
**Production query, mutation, migration/backfill, provider activation, deployment, traffic change, push or CDB-to-main integration:** none

## Outcome

The protected invoice-document, patient-deposit-liability and reporting-metric writer slice is command-complete. Eight live writer pairs are now recognized as guarded atomic compatibility boundaries, and the obsolete direct `bills` updater in `src/lib/billing-payment-state.ts` has been removed so payment-state calculation is pure and no longer creates a parallel invoice authority.

Completed writer pairs:

- `src/lib/billing-create-batch.ts` / `bills`;
- `src/lib/billing-create-batch.ts` / `invoice_items`;
- `src/lib/canonical/appointment-billing-finalization.ts` / `bills`;
- `src/lib/canonical/appointment-billing-finalization.ts` / `invoice_items`;
- `src/lib/canonical/gateway-payment-verification.ts` / `billing_deposits`;
- `src/lib/canonical/gateway-payment-verification.ts` / `bills`;
- `src/lib/executed-refund.ts` / `bills`;
- `src/lib/payment-void-execution.ts` / `bills`.

## Command boundaries retained

No new financial authority was invented. Existing reviewed commands remain authoritative:

- `issueInvoice` and `issueInvoiceWithFullPayment` for bill and invoice-line creation;
- `settleGatewayPayment` for one verified gateway payment plus optional advance-deposit liability;
- `reverseCreditNoteCashRefund` for executed-refund rejection and invoice restoration;
- `reversePayment` for payment-void invoice restoration;
- existing service-event, financial-batch assertion, source-mapping, idempotency and outbox composition.

The legacy compatibility statements remain inside the strict financial command batch. Disabled and shadow modes preserve the original HTTP and workflow behaviour. Strict mode commits compatibility rows, Canonical finance facts, exact mappings, idempotency receipts, accounting assertions and outbox evidence atomically.

## Identity, money and concurrency rules

- Invoice identity is tenant-scoped and mapped from the exact legacy invoice or bill source.
- Invoice lines retain exact source identity and service-event or adjustment lineage.
- Gateway overpayment creates a distinct patient-deposit liability with a distinct receipt identity.
- All Canonical money evidence uses integer minor units and `BDT` currency.
- Bill snapshots are row-count guarded; stale paid, total, status, appointment, provisional-item or gateway-log state fails closed.
- Payment reversal is blocked when paid doctor compensation exists.
- Exact replay remains deterministic; changed replay conflicts.
- Tenant isolation is preserved for invoice, deposit, payment and refund relationships.
- Any failed compatibility, Canonical, assertion, mapping or outbox statement rolls back the complete mutation.

## Deterministic governance evidence

`test/canonical/invoice-deposit-reporting-governance.test.ts` proves that all eight live pairs classify as `atomic_compatibility`, that the direct updater is absent, and that no command-required writer remains for:

- `invoice_document`;
- `patient_deposit_liability`;
- `reporting_metric_read_promotion`.

After this checkpoint:

- protected surfaces: 939;
- protected writers: 234;
- protected readers: 509;
- protected tables: 84;
- Canonical-command writers: 117;
- atomic-compatibility writers: 104;
- governed-external writers: 3;
- command-required writers: 6;
- isolated fixtures: 4;
- remaining implementation groups: 1;
- unknown or unclassified writers/readers: 0;
- repository authority-access registry: 1,030 writers and 2,689 readers;
- identity/episode coverage: 849 reader pairs across 296 paths and 63 tables.

## Verification

Focused verification passed:

- 12 files;
- 82 tests;
- 0 failures.

The focused suite covers billing batch construction, appointment finalization, gateway verification, executed-refund reversal, payment void, financial route coverage, strict mutation isolation, reception integrity and deterministic writer governance.

Additional gates passed:

- TypeScript `tsc --noEmit`;
- migration manifest build with 504 governed migrations;
- full `canonical:check` with zero schema, authority, access, identity/provider, protected-inventory, contract or writer-coverage issues.

## Safety

No production database was queried or mutated. No migration/backfill was applied. No provider flag, local-sync authority, traffic route or deployment was changed. No push or CDB-to-main integration occurred.

## Exact next bounded checkpoint

`CDB-V1-030O-CANONICAL-OUTBOX-ATOMIC-ASSERTION-INTEGRATION`

Complete the six remaining `accounting_posting_events` writer pairs across:

- `src/lib/billing-refund-commission.ts`;
- `src/lib/billing-refund-dispute.ts`;
- `src/lib/canonical/appointment-billing-finalization.ts`;
- `src/lib/canonical/compensation-accrual-route-integration.ts`;
- `src/lib/canonical/gateway-payment-verification.ts`;
- `src/lib/executed-refund.ts`.

Reuse `src/lib/canonical/command-batch.ts` and `src/lib/canonical/financial-batch-assertion.ts`; preserve existing accounting compatibility; require deterministic source-event identity, exact payload evidence, tenant isolation, replay/conflict behaviour, atomic assertion/outbox composition and complete rollback. Do not access or mutate production.
