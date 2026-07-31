# Discount Allocation and Doctor Waiver Implementation Plan

## Safety

The HMS is running in production. All changes must be additive and backward-compatible. Existing `discount_amount`, `discount_percent`, `discount_by_name`, and payment behavior must continue to work.

## Implemented Scope

1. Add `bill_discount_allocations` table and indexes.
2. Add doctor commission waiver/balance columns for future payout reconciliation.
3. Add pure utility logic for source allocation and waiver capping.
4. Add tests for utility edge cases.
5. Add discount reason selector to the IPD discharge modal.
6. Store discount allocation rows from settlement and IPD discharge bill flows.

## Current Phase Boundaries

Phase 1 records allocation detail but does not yet force doctor payout reports to use `payable_commission_amount`. This avoids changing production payout behavior before finance verifies reports.

## Verification

Run targeted tests first:

```bash
npm test -- test/discount_allocation.test.ts
npm test -- web/src/components/reception/DischargeModal.test.tsx
```

Then run broader checks:

```bash
npm test
npm run typecheck
```

## Follow-up Phase

After validating source allocation reports in production data, update doctor payout queries to use earned minus waiver / payable balance columns and add doctor statement reports.
