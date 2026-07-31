# Lab Reagent Inventory Phase 1 Slice 3

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

## Completed

- Converted the lab monitoring `/consumables` list projection in both TS and checked-in runtime JS.
- Linked consumables now report `total_stock` from canonical `InventoryStock`.
- Unlinked consumables still report `total_stock` from legacy `lab_consumable_stock`.
- The route has a fallback path for older schemas that do not yet have `lab_consumables.inventory_item_id`.
- Existing low-stock filtering remains based on the projected `total_stock`.

## Verification

Command:

```text
pnpm vitest run test/lab-monitoring-stock-queries.test.ts test/integration/routes/lab-monitoring-critical.test.ts test/lab-consumable-stock-lifecycle-db.test.ts test/lab-consumables-automation.test.ts
```

Result:

```text
4 test files passed
20 tests passed
```

Full backend verification after this slice:

```text
Command: pnpm vitest run
Test Files: 677 passed
Tests:      14,296 passed
```

## Not completed in this slice

- `/consumables/:id` detail stock projection is still pending. Tool safety blocked the larger endpoint replacement, so it was not forced blindly.
- Waste, transfer, and manual stock-out routes are still on the old lab stock write path.

## Next safe step

Patch `/consumables/:id` in smaller chunks or extract the projection into a small helper service, then verify with lab monitoring and lifecycle tests.
