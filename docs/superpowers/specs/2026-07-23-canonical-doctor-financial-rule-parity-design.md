# Canonical Doctor Financial Rule Parity Design

**Date:** 2026-07-23
**Status:** Approved by direct implementation request

## Goal

Preserve the active doctor commission, waiver, performer reserve, settlement, paid, and outstanding rules after legacy financial tables are retired. The active doctor dashboard must be able to switch summary and drill-down together to a canonical provider without changing its `doctor-compensation-v1` response contract.

## Rules to preserve

1. Gross, discount, performer reserve, commission base, earned, doctor waiver, payable, paid, and outstanding remain separate values.
2. `commission base = gross - discount - performer reserve` for referral and prescribing commission.
3. `earned` is the deterministic rule result before waiver or later canonical adjustments.
4. Doctor waiver is stored as a separate immutable reporting fact and is included within canonical `adjusted_minor`.
5. `payable before settlement = canonical payable_minor + settled_minor = earned - all canonical adjustments`.
6. `paid = settled_minor` after settlement reversals.
7. `outstanding = canonical payable_minor`, never below zero.
8. Performer reserve has zero waiver. Its reserved amount is earned and payable; settlement moves it from outstanding to paid.
9. Reversed accruals and fully reversed settlements do not contribute.
10. Legacy performer-style accruals must not double-count a dedicated performer reserve.
11. BDT values are stored in minor units and converted to major units only at the dashboard boundary.

## Architecture

### Explicit provider switch

Use a dedicated tenant flag, `canonical_doctor_analytics_v1`, separate from the generic `canonical_reporting_v1` canary flag.

- absent, disabled, or `legacy`: serve the legacy provider;
- `shadow`: serve the legacy provider and keep the canonical provider available for parity verification;
- `canonical`: serve the canonical provider for both summary and detail requests.

Summary and drill-down never use mixed providers.

### Canonical reporting context

Add `canonical_compensation_reporting_context`, keyed by canonical accrual. It stores reporting-only source semantics that are not reconstructable from hashes after legacy cutoff:

- source kind and incentive type;
- legacy bill, invoice-item, and lab-order-item identifiers for traceability;
- detail/test display name;
- waiver reason and immutable doctor waiver minor units;
- source reference and evidence hash.

Live doctor commission and performer reserve projections create this context in the same canonical command batch as the accrual. Historical accruals are recovered by a bounded, idempotent source-mapping backfill. Tenant financial clone/import preparation requires migration `0530`, includes the context table in the bundle, and fails the cutover gate while any active accrual lacks context.

### Canonical dashboard provider

Create a canonical implementation of the existing dashboard contract. It reads only canonical tables and canonical source mappings:

- practitioners and mappings for stable doctor identity;
- invoices, lines, service events, service catalog, participants, receipts, and allocations for activity and collection evidence;
- compensation accruals, rules, reporting context, settlements, and allocations for financial lifecycle values.

Patient and accession display values may remain `null` when no canonical display authority exists; financial values must never be fabricated.

## Failure behavior

- A malformed or conflicting canonical row fails the canonical request instead of silently falling back to legacy in `canonical` mode.
- Missing provider flag defaults to legacy.
- `shadow` mode does not change the active response.
- All canonical provider SQL is read-only.

## Testing

1. Live projection tests prove reporting context is written atomically.
2. Canonical provider tests cover full waiver, paid and unpaid performer reserve, partial settlement, settlement reversal, and double-count prevention.
3. Provider-router tests prove `canonical_reporting_v1` alone cannot switch the dashboard.
4. Route tests prove summary and detail switch together only through `canonical_doctor_analytics_v1`.
5. Existing legacy dashboard tests remain unchanged and green.

## Verification evidence

- Live doctor and performer projections write context in the same canonical command batch; context conflicts fail instead of being ignored.
- Immutable `doctor_waiver_minor` remains separate from later canonical adjustments while payable, paid, and outstanding use the canonical accrual invariant.
- Historical context recovery is bounded, idempotent, source-mapping based, and reports the remaining active accrual count. Tenant financial preparation requires zero remaining rows.
- The dedicated `canonical_doctor_analytics_v1` flag is the only active-provider switch. Missing, disabled, and shadow modes continue serving legacy; canonical mode never silently falls back.
- Canonical finance and lifecycle verification: 20 files, 112 tests passed.
- Dashboard, callers, tenant import/backfill, and schema governance verification: 10 files, 79 tests passed.
- TypeScript `tsc --noEmit`, migration manifest generation, and schema governance passed.

## Known non-financial display gaps

- Canonical patient display authority is not yet connected to this provider, so patient names remain `null` rather than being reconstructed or fabricated.
- Accession identifiers remain `null` unless a future canonical diagnostic event contract supplies them.
- These display gaps do not affect gross, discount, reserve, base, earned, waiver, payable, paid, outstanding, settlement, or collection totals.
