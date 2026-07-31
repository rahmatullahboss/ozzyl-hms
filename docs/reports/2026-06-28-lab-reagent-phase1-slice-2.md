# Lab Reagent Inventory Phase 1 Slice 2

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

## Completed

- Linked reagent consumption now writes canonical inventory consumption records after deducting InventoryStock.
- The compatibility lab movement log is still kept so existing reports and idempotency behavior continue working during migration.
- Legacy lab stock rows continue using the old path.
- TS and checked-in runtime JS were kept in sync.
- Added regression coverage proving the canonical InventoryConsumption insert is emitted for linked mapped reagent usage.

## Verification

Targeted verification:

```text
7 test files passed
24 tests passed
```

Full backend verification:

```text
Command: pnpm vitest run
Test Files: 677 passed
Tests:      14,296 passed
```

## Notes

This slice does not yet remove lab_consumable_movements. It makes canonical inventory records available first, then keeps the legacy log as a compatibility/reporting bridge until lab monitoring/report pages are converted.

## Remaining Phase 1 work

- Convert lab monitoring stock reads to inventory-backed projections.
- Move waste, transfer, and manual stock-out routes to canonical inventory services.
- Later, make lab_consumable_movements compatibility-only or deprecate it after reports are converted.
