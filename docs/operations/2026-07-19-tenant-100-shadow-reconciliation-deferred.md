# Tenant 100 canonical shadow reconciliation — deferred issue

Date: 2026-07-19

## Deployment context

Tenant `100` remains in financial canonical shadow mode. Legacy financial authority remains unchanged. Tenant `101` and Tenant `102` canonical flags remain unchanged.

The IPD credit-discharge release was reviewed and merged into the canonical integration branch. Production deployment is being allowed to proceed for the urgent discharge fix while the following known shadow-only variance is explicitly deferred.

## Known reconciliation variance

Pre-deployment aggregate reconciliation reported:

- `activationReady: false`
- `issueCount: 7`
- Legacy invoice count: `235`
- Canonical invoice count: `234`
- Net variance: one fully paid invoice for `৳350`
- Receipt variance: `৳350`
- Allocation variance: `৳350`
- Deposit, credit-note, refund, reversal, tenant-isolation, duplicate-mapping, blocked-outbox, blocked-accounting, and unresolved-critical controls: zero

The unmatched legacy transaction is:

- Legacy bill ID: `6655`
- Invoice: `INV-D-2026-000022`
- Patient ID: `2161`
- Visit ID: `2771`
- Amount: `৳350`
- Paid: `৳350`
- Due: `৳0`
- Created: `2026-07-19 16:48:39`
- Line item: `Complete Blood Count E2E`

This record was created after the previously documented zero reconciliation and has no corresponding canonical invoice/source mapping, receipt, or allocation.

## Deferred follow-up

Before any future canonical read promotion, canonical-only authority change, or shadow-to-canonical cutover:

1. Identify and fix the route or automated E2E path that created bill `6655` without strict canonical shadow writes.
2. Apply only an approved, evidence-bound repair/backfill for the missing invoice, receipt, allocation, and source mappings.
3. Re-run Tenant 100 reconciliation until every count and amount variance is zero and `activationReady: true`.
4. Confirm no Tenant 100/101/102 flag or financial authority was modified during repair.

## Deployment constraint

This deferral permits the urgent IPD discharge feature release only. It does not approve canonical cutover, canonical reads, legacy authority changes, flag changes, or unapproved migrations.
