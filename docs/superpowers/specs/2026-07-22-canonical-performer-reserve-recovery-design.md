# Canonical Performer Reserve Recovery Design

## Goal

Eliminate the remaining Tenant 102 `doctor-compensation.accrue` shadow failures caused by performer-reserve invoice-line authority and missing live service mappings, without changing legacy authority or enabling production strict mode.

## Current Evidence

The current production deployment predates the latest doctor-compensation recovery commits on `main`. Current `main` already covers the production-shaped doctor accrual failures for missing invoices, recovered net-line authority, gross mismatch, and reserve-adjusted commission-base reconciliation.

The performer-reserve path remains different:

- It requires an already-existing canonical invoice line and fails instead of recovering the legacy bill invoice.
- It assumes the live source-line identity always resolves directly.
- It requires a pre-existing `legacy_billing_service_item` mapping and fails when a newly created or previously unbackfilled billing service item is used.
- It compares the canonical line only against live gross authority and cannot use a recovered net-line authority safely.

## Design

### Invoice authority

Create a focused shared resolver for a legacy bill invoice line. The resolver will:

1. Compute the live canonical invoice and line identities from invoice number and source-line identity.
2. Read the direct live line.
3. If absent, call the existing idempotent `ensureCanonicalInvoiceForLegacyBill` recovery.
4. Retry the direct live line.
5. If still absent, resolve the legacy invoice item by the source-line ordinal and read the deterministic recovered `invoice_item:<id>` line.
6. Return both the line and its authority mode:
   - `live_gross`: canonical line amount is gross and explicit discount remains separate.
   - `legacy_recovered_net`: canonical line amount is the legacy net line and canonical discount for this compensation projection must be zero.

Both doctor compensation and performer reserve will consume this resolver so the identity and authority rules cannot drift.

### Performer reserve amounts

For `live_gross`, preserve the existing assertions:

- canonical line amount equals the full line gross;
- unit gross minus unit discount equals unit net;
- reserve equals the configured rule result.

For `legacy_recovered_net`, accept the recovered line as net line authority:

- canonical line amount must equal the total net service line;
- compensation accrual units keep their unit gross, unit discount, and unit net snapshots;
- the invoice linkage is accepted because the sum of unit net values reconciles to the recovered line;
- the canonical compensation row remains unit-level and does not rewrite invoice amounts.

The live performer input will include total line net authority so multi-quantity unit accruals can validate against the recovered line deterministically.

### Live service mapping recovery

Add a focused live recovery for `billing_service_items`:

1. Read the billing service item and its active department.
2. Derive canonical item kind using the same department classification rules as service-catalog backfill.
3. Generate the same deterministic service public ID and source evidence contract as the backfill.
4. Insert the canonical service catalog item and source mapping idempotently.
5. If an existing mapping conflicts with the deterministic ID or is non-mapped, fail closed.

The recovery creates only the catalog item and mapping required by compensation. Price backfill remains governed by the service-catalog backfill program and is not silently synthesized here.

## Safety

- Legacy statements remain authoritative in shadow mode.
- No production writes, deployment, feature-flag changes, issue resolution, or backfill execution are part of this branch.
- All recovery operations are deterministic and idempotent.
- Conflicting existing canonical identities fail closed rather than being overwritten.
- Current doctor compensation behavior must remain regression-clean.

## Verification

Required tests:

- Performer reserve recovers a missing canonical invoice.
- Performer reserve accepts a legacy recovered net-line authority.
- Multi-unit reserve totals reconcile to the recovered net line.
- Missing billing-service mapping is created deterministically.
- Conflicting service mapping fails and leaves legacy shadow write successful with a recorded issue.
- Existing live performer and doctor compensation tests remain green.
- Canonical focused suite and TypeScript verification pass.
