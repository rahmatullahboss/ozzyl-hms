# Lab Reagent Inventory Phase 1 Slice 1

Date: 2026-06-28
Branch: feature/lab-reagent-mis-ready-inventory

## Completed

- Linked lab consumables now prefer InventoryStock when inventory_item_id is available.
- Legacy lab consumables still use the old lab stock path for compatibility.
- The profile lookup is guarded for older schemas.
- TS and checked-in runtime JS were kept in sync.
- Added regression coverage for linked mapped reagent usage.

## Verification

Command:

```text
pnpm vitest run test/lab-consumables-automation.test.ts test/lab-consumables-hardening.test.ts test/lab-consumable-stock-lifecycle-db.test.ts test/lab-inventory-bridge-contract.test.ts test/lab-inventory-bridge-db.test.ts test/integration/routes/inventory/inventory-lab-ot-adapters.test.ts test/integration/routes/inventory/inventory-stock-overview.test.ts
```

Result:

```text
7 test files passed
24 tests passed
```

## Remaining Phase 1 work

- Add canonical InventoryConsumption records for linked reagent usage.
- Convert lab monitoring reads to inventory-backed projections.
- Move waste, transfer, and manual stock-out routes to canonical inventory services.
