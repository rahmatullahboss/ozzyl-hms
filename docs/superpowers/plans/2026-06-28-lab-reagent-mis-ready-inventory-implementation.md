# Lab Reagent Inventory — MIS/LIS Ready MVP Implementation Plan

Date: 2026-06-28
Branch: `feature/lab-reagent-mis-ready-inventory`
Spec: `docs/superpowers/specs/2026-06-28-lab-reagent-mis-ready-inventory-design.md`

## 1. Implementation Intent

Implement reagent inventory in two tracks:

1. **MVP without MIS/LIS**: Hospitals can manage reagent inventory manually and semi-automatically from day one.
2. **MIS/LIS-ready foundation**: The inventory core must be ready for gradual machine/analyzer integration without rewriting stock logic.

The first production release must not wait for analyzer integration. The system should work with manual stock receive, QC, open vial, test mapping, result-based estimated consumption, manual usage, waste, reconciliation, alerts, and reports.

## 2. Non-Negotiable Architecture Rules

1. `InventoryStock` is the canonical source of stock quantity.
2. Do not introduce any new independent lab stock balance table.
3. Existing `lab_consumable_stock` must not remain a competing write ledger.
4. Result finalization, manual lab usage, waste approval, and reconciliation must all mutate stock through the canonical inventory issue/adjustment engine.
5. Lab-specific metadata may live in lab tables, but quantity lives in inventory.
6. All stock mutation must be idempotent and auditable.
7. MVP must support soft mode so lab results are not blocked while a hospital is still setting up reagent mapping.
8. Strict mode must be supported or easy to enable later for mature hospitals.
9. MIS/LIS integration must enter through normalized event APIs, not by directly changing inventory internals.

## 3. Current System Findings To Respect

Existing useful pieces:

- `InventoryItem` already supports `ItemType = lab_reagent`.
- Inventory GRN and issue engines already exist.
- Lab monitoring has consumables, stock in/out, QC, open vial, transfer, waste, alerts, and operation logs.
- Result finalization already calls mapped reagent consumption in some paths.
- Draft result does not consume stock in the newer route.
- Existing tests cover FEFO, QC/expiry exclusion, idempotency, draft result, and bridge behavior.

Known gaps to fix:

- Dual ledger mismatch risk between `InventoryStock` and `lab_consumable_stock`.
- Test-to-consumable mapping UI is missing.
- Canonical `/api/inventory/lab/reagent-consumption` UI is missing.
- Manual lab monitoring consumption and canonical inventory consumption can diverge.
- Money unit handling in lab UI may be taka/paisa inconsistent.
- Machine/analyzer identity is not yet a first-class workflow.

## 4. Work Breakdown

### Baseline verification — 2026-06-28

Before production code changes, the full backend Vitest suite was run from the feature branch.

Result:

```text
Test Files: 677 passed
Tests:      14,295 passed
Command:    pnpm vitest run
```

This is the known-good checkpoint for Phase 1 implementation.

### Phase 0 — Branch and documentation

Status: completed.

Tasks:

- Create branch `feature/lab-reagent-mis-ready-inventory`.
- Add design spec doc.
- Add implementation plan doc.
- Add Codex handoff plan.

Acceptance:

- Docs exist in `docs/superpowers/specs` and `docs/superpowers/plans`.
- No production code behavior changed yet.

### Phase 1 — InventoryStock canonicalization

Goal: remove the dual-ledger risk before adding more features.

Tasks:

1. Audit every write to `lab_consumable_stock` and `lab_consumable_movements`.
2. Classify each write as:
   - replace with inventory issue/receipt/adjustment
   - keep as metadata only
   - compatibility-only temporary path
3. Refactor result auto-consumption to use canonical inventory issue engine.
4. Refactor manual lab consumption endpoint to use canonical inventory issue engine.
5. Make lab dashboard read reagent stock from `InventoryStock` joined with lab metadata.
6. Preserve old route responses where frontend depends on them, but source data from canonical stock.
7. Add validation tests proving lab and inventory balance cannot diverge.

Files likely involved:

- `src/lib/lab-consumables.ts`
- `src/lib/lab-inventory-bridge.ts`
- `src/routes/tenant/labMonitoring.ts`
- `src/routes/tenant/lab.ts`
- `src/routes/tenant/lab-results.ts`
- `src/routes/tenant/inventory/workflowAdapters.ts`
- `src/routes/tenant/inventory/issues.ts`
- `web/src/pages/LabMonitoringDashboard.tsx`
- existing lab consumable tests

Acceptance:

- Final lab result consumes `InventoryStock`.
- Manual lab reagent usage consumes `InventoryStock`.
- Lab dashboard stock quantity matches inventory stock quantity.
- Draft result does not consume.
- Re-finalization does not consume twice.

### Phase 2 — Lab reagent metadata tables

Goal: move QC/open-vial/analyzer metadata out of stock quantity ledger.

Tasks:

1. Add migration for `lab_reagent_profiles`.
2. Add migration for `lab_reagent_lot_quality`.
3. Backfill from existing lab consumables and lab stock rows.
4. Add repository/helper functions:
   - load reagent profile
   - ensure reagent profile from inventory item
   - ensure lot quality row from inventory stock
   - usable lot query with QC/expiry/onboard filters
5. Update stock receive/bridge behavior so lab reagent lots get metadata created.
6. Keep `lab_consumable_stock` read-only or compatibility-only until fully removed.

Acceptance:

- QC status is attached to `InventoryStock` through metadata.
- Open-vial expiry is attached to `InventoryStock` through metadata.
- Usable stock query excludes QC pending/failed, expired, and onboard-expired lots.

### Phase 3 — Lab inventory API layer

Goal: introduce clean lab-facing APIs that read/write canonical inventory.

Tasks:

1. Add route namespace `/api/lab-inventory`.
2. Implement:
   - `GET /overview`
   - `GET /reagents`
   - `GET /reagents/:itemId/lots`
   - `POST /lots/:stockId/qc`
   - `POST /lots/:stockId/open`
   - `POST /manual-usage`
3. Refactor old lab monitoring endpoints to call shared services or mark as compatibility.
4. Add authorization permissions.
5. Add zod schemas.

Acceptance:

- New APIs work from canonical inventory.
- Old dashboard can continue functioning during migration.
- Permission checks are clear and role-safe.

### Phase 4 — Test mapping backend cleanup

Goal: make test-to-reagent mapping production-safe.

Tasks:

1. Either reuse existing `lab_test_consumable_map` or migrate to versioned `lab_test_consumable_mappings`.
2. Support:
   - active/inactive
   - version/effective date
   - machine-specific optional mapping
   - mandatory/optional item
   - quantity per test
3. Add endpoints:
   - `GET /api/lab-inventory/test-mappings`
   - `POST /api/lab-inventory/test-mappings`
   - `PUT /api/lab-inventory/test-mappings/:id`
   - `DELETE /api/lab-inventory/test-mappings/:id`
4. Update result consumption to read active mapping.

Acceptance:

- Mapping can be managed without direct database work.
- Result finalization uses active mapping only.
- Missing mapping creates visible warning/exception in soft mode.

### Phase 5 — Soft/strict consumption mode and exceptions

Goal: support real hospital rollout safely.

Tasks:

1. Add tenant configuration keys:
   - `lab_inventory_mode`: disabled, soft, strict
   - `auto_consume_on_result_finalization`
   - `allow_result_without_stock`
   - `require_test_mapping_for_completion`
2. Add `lab_inventory_exceptions` migration.
3. Update result finalization flow:
   - strict mode blocks if mandatory stock/mapping missing
   - soft mode finalizes result and creates exception
   - disabled mode skips stock consumption but warns in dashboard
4. Add exception report API.

Acceptance:

- First hospital can use soft mode without blocking lab result workflow.
- Mature hospitals can use strict mode later.
- All stock issues are visible to admin/lab manager.

### Phase 6 — Frontend MVP pages

Goal: make the feature usable by hospital staff.

Tasks:

1. Add or refactor Lab Inventory navigation.
2. Build/extend pages:
   - Overview
   - Reagent Stock
   - Lot QC
   - Open Vial
   - Test Mapping
   - Manual Usage
   - Waste/Adjustment
   - Reports/Exceptions
3. Keep UI simple for first hospital:
   - clear status badges
   - simple forms
   - explicit warnings
   - no heavy analyzer setup in MVP path
4. Fix price/unit display so taka/paisa is consistent.

Acceptance:

- Lab user can manage reagent inventory without developer help.
- Admin can see exceptions and low-stock/expiry warnings.
- Mapping UI exists.
- Manual usage UI exists.

### Phase 7 — Reconciliation and audit hardening

Goal: make real-world mismatch manageable.

Tasks:

1. Add stock count workflow for lab inventory.
2. Physical count creates adjustment request.
3. Admin/lab manager approval applies inventory adjustment.
4. Add reason codes:
   - manual use not entered
   - spillage
   - expired
   - count error
   - wrong stock-in
   - machine prime
   - other
5. Add audit logs to all actions.

Acceptance:

- Lab tech cannot silently change stock.
- Adjustments are approved and auditable.
- Mismatch reports identify operational problems.

### Phase 8 — Reporting and dashboard polish

Goal: make reagent system useful for hospital management.

Tasks:

1. Reagent usage report.
2. Test-wise reagent cost report.
3. Waste/loss report.
4. Expiry report.
5. QC report.
6. Open vial report.
7. Reorder suggestions.
8. Unmapped tests report.
9. Inventory exception report.

Acceptance:

- Admin can see reagent cost and wastage.
- Lab manager can prevent stock-out and expiry loss.
- Reports use canonical inventory records.

### Phase 9 — MIS/LIS-ready integration foundation

Goal: prepare for machine integration without implementing every analyzer protocol now.

Tasks:

1. Add `lab_machines` if not already available in a compatible form.
2. Add `lab_machine_test_code_map`.
3. Add `lab_machine_events` or equivalent event inbox.
4. Build normalized ingestion service interface:
   - receive machine result event
   - resolve order/test
   - attach result data
   - trigger existing finalization/consumption flow only through normal domain service
5. Do not allow raw machine events to directly mutate stock.
6. Keep connector-specific parsers outside core inventory.

Acceptance:

- Machine integration can be added later by feeding normalized events.
- Same consumption logic is reused for manual, result-entry, and machine-result paths.
- Duplicate machine events are idempotent.

### Phase 10 — First analyzer connector later

Goal: integrate one real machine after MVP is stable.

Candidates:

- file-drop result import
- TCP listener
- ASTM parser
- HL7 parser
- vendor-export CSV/XML parser

Acceptance:

- One machine can send/import results.
- Result event attaches to lab order item.
- Stock consumption remains canonical and idempotent.

## 5. Suggested Implementation Order For First Coding Session

1. Inspect current lab inventory files and tests.
2. Add a service-level design boundary:
   - `src/lib/lab-inventory.ts` or similar
   - reusable functions for usable stock, QC metadata, and canonical consumption
3. Add tests first for canonical stock consumption:
   - result finalization decrements `InventoryStock`
   - no `lab_consumable_stock` divergence
4. Refactor `consumeMappedLabConsumables` to use inventory issue engine.
5. Add/adjust compatibility queries for lab dashboard.
6. Run targeted tests.
7. Only after backend is safe, add UI mapping/manual usage pages.

## 6. Test Commands To Run

Targeted tests currently expected to be relevant:

```bash
pnpm vitest run test/lab-consumables-automation.test.ts test/lab-consumables-hardening.test.ts test/lab-consumable-stock-lifecycle-db.test.ts test/lab-inventory-bridge-contract.test.ts test/lab-inventory-bridge-db.test.ts test/integration/routes/inventory/inventory-lab-ot-adapters.test.ts test/integration/routes/inventory/inventory-stock-overview.test.ts
```

After API/frontend work:

```bash
pnpm vitest run test/integration/routes/inventory/inventory-lab-ot-adapters.test.ts
pnpm --filter web test -- LabMonitoringDashboard.test.ts
```

If web test filter does not work in this repo, run the closest existing targeted web test command and report any unrelated timeouts separately.

## 7. Risks and Mitigations

### Risk: Lab and inventory stock mismatch

Mitigation: canonicalize on `InventoryStock` before adding new UI features.

### Risk: Result workflow blocked at hospital because stock setup is incomplete

Mitigation: MVP default soft mode, with visible exceptions.

### Risk: Machine integration later forces redesign

Mitigation: add machine event boundary; machine events call the same domain service as manual/final result flows.

### Risk: Staff forget manual usage

Mitigation: daily reconciliation, exception report, and simple manual usage UI.

### Risk: Old lab monitoring endpoints keep writing old ledger

Mitigation: route all old endpoints through canonical service or mark them read-only/compatibility.

## 8. Definition of Done

A PR for MVP is done when:

- branch remains isolated from main
- docs are updated
- inventory stock is canonical for reagent stock
- lab stock UI does not show a different balance from inventory
- test mapping UI exists
- manual usage UI exists
- result completion consumes mapped stock exactly once
- soft/strict behavior is tested
- waste/adjustment has approval and audit
- reports and alerts are usable
- no full MIS/LIS dependency exists for MVP
- future machine event boundary is documented or stubbed
