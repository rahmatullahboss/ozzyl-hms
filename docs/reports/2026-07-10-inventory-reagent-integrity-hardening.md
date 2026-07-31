# Inventory and Reagent Integrity Hardening Report

Date: 2026-07-10
Branch: `fix/inventory-reagent-integrity-hardening`
Worktree: `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/main-shareholder-merge`

## Executive result

The high-risk inventory and reagent issues identified in the July 10 review have been implemented in an isolated clean worktree.

The change hardens canonical stock issue, reagent retry/idempotency, QC and expiry consistency, demand intelligence, reorder updates, reagent lot validation and reconciliation. Existing inventory and reagent API contracts remain in place, with one additive reconciliation endpoint and migration.

The dirty `abdullah` worktree was not modified.

## Implemented changes

### 1. Shared usable-stock policy

Created `src/lib/inventory-lot-policy.ts` and reused it from inventory FEFO/issue and inventory intelligence.

The shared policy now consistently enforces:

- inactive and blocked stock rejection,
- QC pending/failed/rejected rejection,
- `accepted`, `passed` and `not_required` usable QC states,
- same-day expiry rejection,
- same-day after-open expiry rejection,
- usable quantity as available minus reserved, damaged and blocked quantity.

### 2. Atomic canonical inventory issue allocation

Created `src/lib/inventory-movement-service.ts`.

For each issue allocation, the following now run in one D1 batch:

- guarded `InventoryStock` update,
- `InventoryConsumptionItem` creation,
- `InventoryStockTransaction` ledger creation,
- `InventoryAuditLog` creation.

The guard checks the loaded available, reserved, damaged and blocked quantities, plus stock/QC/expiry state. A concurrent change returns HTTP 409 without leaving a stock-only or ledger-only write.

Ledger balance is now based on canonical `AvailableQuantity`, not usable quantity. Example: available 100, reserved 10, issue 20 produces ledger balance 80 rather than 70.

### 3. Atomic new-stock adjustment

When adjustment-in creates a new stock lot, `InventoryStock` and its opening adjustment transaction now execute in one D1 batch. Required metadata is validated before the batch.

The previous generated one-year expiry and generated adjustment batch number were removed.

### 4. Retry-safe reagent consumption

Modified `src/lib/lab-consumables.ts` and synchronized the checked-in runtime sibling `src/lib/lab-consumables.js`.

The reagent flow no longer treats one existing movement as proof that every mapped reagent was consumed.

It now tracks each mapped consumable independently using:

- expected quantity,
- canonical committed quantity,
- lab movement projected quantity,
- pending/partial/committed/failed lifecycle.

On retry:

- fully committed mappings are skipped,
- partially committed mappings consume only the remaining quantity,
- a canonical inventory deduction with a missing lab projection is backfilled without deducting stock again,
- the outer order-item claim is committed only after all mandatory mappings are complete.

Legacy lab stock update, usage movement and operation log now execute in one D1 batch.

### 5. Additive integrity migration

Added `migrations/0400_inventory_reagent_integrity_hardening.sql`.

It creates:

- `lab_consumable_mapping_progress`, unique by tenant, lab order item and consumable;
- `inventory_demand_source_event`, unique by tenant, source type and source id;
- tenant/status/order/date indexes.

The migration manifest was rebuilt successfully.

### 6. Reagent reconciliation

Created `src/lib/lab-reagent-reconciliation.ts`.

Reconciliation classifies mappings as:

- `complete`,
- `partial`,
- `projection_missing`,
- `mismatch`.

Added manager-protected endpoint:

`GET /api/lab-monitoring/inventory-reconciliation`

It supports status, order-item and limit filters and returns a status summary. Receptionist access is denied.

### 7. Inventory demand aggregation

Created `src/lib/inventory-intelligence/demand.ts`.

Committed inventory consumption items now create idempotent source events and rebuild the tenant/item/day demand aggregate from those events. Duplicate retries do not increase demand twice.

Inventory intelligence no longer reports a trusted `ready` state before real demand events exist; it returns `not_configured` until demand history starts accumulating.

### 8. Reorder partial updates

`PUT /inventory/reorder/config/:itemId` now preserves omitted fields.

Updating only the preferred vendor no longer disables automatic reorder or resets the formula. Legacy formula aliases remain accepted but the canonical enum is persisted.

### 9. Reagent batch and expiry validation

A `lab_reagent` item master now requires:

- `IsBatchRequired = true`,
- `IsExpiryRequired = true`.

GRN and direct adjustment validate the item policy before creating stock. Reagent stock cannot be received or created without a real batch and expiry date.

GRN no longer stores the fabricated batch value `NA`.

### 10. Test coverage command hardened

`pnpm test:inventory` now includes the high-risk reagent lifecycle, stock-out, retry, reconciliation, migration and demand aggregation suites. A green inventory run can no longer silently omit these reagent regressions.

## Verification evidence

### TypeScript

Command:

```bash
pnpm exec tsc --noEmit
```

Result: exit code 0, no TypeScript errors.

### Migration manifest

Command:

```bash
pnpm build:migrations
```

Result: exit code 0; 412 migrations written to the generated manifest.

### Inventory and reagent regression suite

Command:

```bash
pnpm test:inventory
```

Result:

- Backend inventory/reagent: 69 files, 503 tests passed.
- Frontend inventory: 31 files, 140 tests passed.
- Total: 100 files, 643 tests passed.
- Failures: 0.

### Production web build

Command:

```bash
pnpm --filter web build
```

Result: exit code 0; TypeScript and Vite production build passed and PWA assets were generated.

## Deployment sequence

1. Merge the feature branch after review.
2. Apply migration `0400_inventory_reagent_integrity_hardening.sql` to local/staging first.
3. Deploy API/runtime TypeScript and synchronized JS files together.
4. Keep reagent policy in `soft` mode initially.
5. Run or review `/api/lab-monitoring/inventory-reconciliation` for new/retried order items.
6. Confirm no `partial`, `projection_missing` or `mismatch` rows remain.
7. Enable strict reagent mode tenant-by-tenant only after readiness and reconciliation are clean.

## Remaining structural limitations

These are not regressions introduced by this change, but they remain broader architecture work:

- Inventory issue quantity/line/ledger/audit is atomic per stock allocation. A multi-lot or multi-item issue can still have earlier allocations committed if a later independent allocation conflicts. A future saga/operation-status layer should reconcile or compensate whole-request partial completion.
- The inventory consumption header and optional patient billing provisional line are outside the allocation batch. Core stock integrity is protected, but a future whole-request transaction/saga should include header and billing lifecycle.
- Existing historical reagent usage predating migration 0400 has no mapping-progress rows. Historical reconciliation requires a one-time backfill if hospitals need retrospective analysis.
- Legacy `lab_consumable_stock` remains as a compatibility projection for unlinked/older deployments. For linked reagents, `InventoryStock` remains authoritative; full legacy table removal should be a separate migration.
- GRN is validated more safely, but its full header/item/stock/mirror workflow is still a multi-step process and should later migrate to the same canonical movement/saga architecture.

## Go-live recommendation

The module is substantially safer for a small or medium hospital pilot and for soft-mode reagent automation. Strict mode should be enabled only after migration 0400 is applied and tenant reconciliation is clean.
