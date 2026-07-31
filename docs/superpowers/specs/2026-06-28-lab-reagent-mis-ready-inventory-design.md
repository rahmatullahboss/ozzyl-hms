# Lab Reagent Inventory — MIS/LIS Ready MVP Design

Date: 2026-06-28
Branch: `feature/lab-reagent-mis-ready-inventory`
Status: Proposed / implementation-ready

## 1. Goal

Build a production-safe reagent and lab consumable inventory system that can run immediately without machine integration, while keeping the architecture ready for gradual MIS/LIS/analyzer integration.

The first release must support manual and semi-automated reagent inventory management for real hospitals:

- receive reagent stock through inventory/GRN
- track lot/batch, expiry, location, QC status, open-vial/onboard expiry
- map tests to expected reagent/consumable usage
- deduct stock when lab results are finalized
- allow manual usage for repeat tests, QC, calibration, spillage, maintenance, and machine priming
- support waste, stock count, reconciliation, alerts, and reports
- keep a clean integration layer for future machine/analyzer events

## 2. Terminology

- **MVP**: Manual or semi-automated reagent inventory. No analyzer connection is required.
- **MIS-ready / Machine Integration ready**: The data model and APIs include stable event boundaries so future analyzer/LIS/MIS integration can feed result events, run events, and optional reagent usage events without rewriting inventory.
- **LIS**: Laboratory Information System integration for machine result capture, ASTM/HL7/file/TCP workflows, QC events, and optional instrument-side run metadata.
- **Canonical inventory**: The single source of truth for stock balance.

## 3. Core Architecture Decision

### 3.1 Single source of truth

`InventoryStock` must be the canonical source of reagent stock quantity.

Lab-specific tables may store workflow metadata such as QC status, opened date, onboard expiry, analyzer assignment, and test mapping, but they must not maintain an independent stock balance that can diverge from `InventoryStock`.

### 3.2 Current dual-ledger risk to eliminate

The existing system has both:

- canonical inventory stock: `InventoryStock`
- lab-specific stock: `lab_consumable_stock`

The current bridge can mirror GRN stock into lab stock, and lab result completion can deduct from the lab-specific ledger. This creates a production risk where Inventory and Lab pages show different quantities.

Target behavior:

- stock receive: writes to `InventoryStock`
- result completion: deducts from `InventoryStock`
- manual lab usage: deducts from `InventoryStock`
- waste/adjustment: writes to `InventoryStock` through approved inventory workflows
- lab dashboard: reads from `InventoryStock` plus lab metadata/projections

## 4. Scope

### 4.1 MVP scope, no MIS/LIS required

1. Reagent item setup using `InventoryItem` with `ItemType = lab_reagent` or a dedicated lab consumable type.
2. Lot/batch and expiry tracking.
3. Stock locations: main store, lab store, fridge, analyzer, rack, room.
4. QC status per lot.
5. Open-vial/onboard expiry per lot.
6. Test-to-consumable mapping.
7. Auto-deduction when a lab order item is finalized.
8. Manual consumption entry.
9. Waste request and approval.
10. Stock count and reconciliation.
11. Low-stock, expiring, expired, QC-pending, onboard-expiring alerts.
12. Reagent cost and usage reports.
13. Audit trail for every stock mutation.

### 4.2 MIS/LIS-ready scope for later phases

1. Analyzer/machine master list and connector identity.
2. Integration event tables for machine result/run events.
3. Idempotent result event ingestion.
4. Mapping between machine test codes and HMS lab tests.
5. Optional machine-reported reagent usage ingestion.
6. TCP/file/ASTM/HL7 connector implementation after MVP.
7. Instrument QC/calibration event ingestion.

### 4.3 Out of scope for MVP

- Direct analyzer TCP listener implementation.
- Full ASTM/HL7 parser.
- Automatic machine-side reagent bottle level sync.
- Real-time QC result interpretation.
- Vendor-specific LIS protocol certification.

The MVP must still be designed so these can be added without changing the inventory core.

## 5. Domain Model

### 5.1 Reuse existing canonical tables

- `InventoryItem`
- `InventoryStock`
- `InventoryStockTransaction`
- `InventoryConsumption`
- `InventoryConsumptionItem`
- `InventoryAuditLog`
- `LabOrderItem` / existing lab order result tables

### 5.2 New or refactored lab metadata tables

#### `lab_reagent_profiles`

One row per reagent/consumable inventory item.

Recommended fields:

- `id`
- `tenant_id`
- `inventory_item_id`
- `reagent_type`: reagent, chemical, kit, tube, strip, slide, control, calibrator, diluent, wash_solution, other
- `storage_condition`
- `storage_min_temp`
- `storage_max_temp`
- `default_onboard_stability_days`
- `qc_required`
- `lot_qc_required`
- `machine_compatible`
- `default_consumption_unit`
- `unit_conversion_factor`
- `hazardous_category`
- `is_active`
- `created_by`, `created_at`, `updated_at`

#### `lab_reagent_lot_quality`

Metadata for a stock lot. Quantity remains in `InventoryStock`.

Recommended fields:

- `id`
- `tenant_id`
- `inventory_stock_id`
- `qc_status`: not_required, pending, passed, failed, blocked
- `qc_checked_by`
- `qc_checked_at`
- `qc_remarks`
- `opened_at`
- `opened_by`
- `onboard_stability_days`
- `onboard_expires_at`
- `assigned_machine_id`
- `blocked_reason`
- `created_at`, `updated_at`

#### `lab_test_consumable_mappings`

Expected reagent/consumable usage per test.

Recommended fields:

- `id`
- `tenant_id`
- `lab_test_id`
- `inventory_item_id`
- `machine_id` nullable
- `quantity_per_test`
- `unit`
- `is_mandatory`
- `usage_type`: patient_test, qc, calibration, control, repeat, maintenance
- `effective_from`
- `effective_to`
- `version`
- `is_active`
- `created_by`, `created_at`, `updated_at`

#### `lab_inventory_exceptions`

Created when result completion cannot safely deduct reagent in soft mode.

Recommended fields:

- `id`
- `tenant_id`
- `lab_order_item_id`
- `inventory_item_id`
- `required_quantity`
- `available_quantity`
- `exception_type`: no_mapping, insufficient_stock, qc_pending, expired, onboard_expired, no_usable_lot, duplicate_event, integration_error
- `status`: open, resolved, ignored, approved_negative_adjustment
- `resolution_notes`
- `resolved_by`, `resolved_at`
- `created_at`

### 5.3 Future MIS/LIS integration tables

These should be added when the integration phase starts, or stubbed minimally if helpful.

#### `lab_machines`

- `id`
- `tenant_id`
- `name`
- `brand`
- `model`
- `serial_no`
- `department_id`
- `connection_type`: none, file_drop, tcp, astm, hl7, api
- `connection_config_ref`
- `is_active`

#### `lab_machine_test_code_map`

- `id`
- `tenant_id`
- `machine_id`
- `machine_test_code`
- `lab_test_id`
- `specimen_type`
- `is_active`

#### `lab_machine_events`

- `id`
- `tenant_id`
- `machine_id`
- `external_event_id`
- `event_type`: result, run, qc, calibration, maintenance, reagent_usage
- `payload_json`
- `received_at`
- `processed_status`: pending, processed, failed, ignored
- `processed_at`
- `error_message`

The inventory core should never depend directly on vendor protocol payloads. It should receive normalized HMS events.

## 6. Workflows

### 6.1 Stock receive / GRN

1. Inventory user creates or receives an item with type `lab_reagent` or lab consumable.
2. GRN creates `InventoryStock` with lot/batch, expiry, quantity, purchase cost, location.
3. If the item has `qc_required = true`, create or update `lab_reagent_lot_quality` with `qc_status = pending`.
4. If QC is not required, set `qc_status = not_required`.
5. Lab dashboard immediately shows the lot but does not count pending/failed/expired lots as usable.

### 6.2 QC pass/fail

1. Lab user opens lot QC action.
2. User records pass/fail, notes, optional attachment/result reference.
3. System updates `lab_reagent_lot_quality`.
4. Failed/blocked lot cannot be issued.
5. QC action is audit logged.

### 6.3 Open vial / onboard stability

1. Lab user opens a reagent lot.
2. System records `opened_at`, `opened_by`, `onboard_stability_days`, `onboard_expires_at`.
3. Onboard-expired lots cannot be auto-selected for usage.
4. Alert appears before onboard expiry.

### 6.4 Test-to-reagent mapping

1. Admin/lab manager selects a lab test.
2. Adds reagent/consumable items and quantity per test.
3. Optional machine-specific mapping is allowed.
4. Mapping is versioned and has effective dates.
5. Old mappings remain available for audit.

### 6.5 Result completion auto-deduction

When a lab order item becomes final/completed:

1. Ensure the result is not draft.
2. Check idempotency by `tenant_id + lab_order_item_id`.
3. Load active mapping for the test and optional machine.
4. Validate mandatory items.
5. Select usable lots by FEFO from `InventoryStock` filtered by:
   - tenant
   - item
   - available quantity
   - non-expired stock expiry
   - QC passed or not required
   - onboard not expired
   - optional location/machine
6. Deduct stock using the canonical inventory issue engine.
7. Create `InventoryConsumption` and stock transactions.
8. Create `LabOperationLog` for reporting.
9. If stock is missing:
   - strict mode: block finalization
   - soft mode: finalize result and create `lab_inventory_exceptions`

MVP default should be soft mode to avoid blocking hospital lab operations during initial setup.

### 6.6 Manual usage

Manual usage is required for:

- repeat test
- QC run
- calibration
- control run
- spillage
- machine priming
- maintenance
- manual test not connected to a bill

Manual usage must write to the canonical inventory issue engine and should require reason, stock/item, quantity, user, and remarks.

### 6.7 Waste and discard

1. Lab user creates waste request.
2. Admin/lab manager reviews and approves.
3. Stock reduces only after approval.
4. Reason and audit trail are mandatory.

### 6.8 Stock count and reconciliation

1. User performs physical count by item/lot/location.
2. System compares physical vs expected.
3. Difference creates adjustment request.
4. Admin approval applies stock adjustment.
5. Reports show recurring mismatch patterns.

### 6.9 Alerts

Alerts must use usable-stock logic, not total stock.

Required alerts:

- out of stock
- low stock
- expiring soon
- expired
- QC pending
- QC failed
- onboard expiry soon
- opened but unused
- stock mismatch
- tests without mapping
- unresolved inventory exceptions

## 7. UI Pages

Recommended navigation:

```text
Lab Inventory
  - Overview
  - Reagent Stock
  - Lot QC
  - Open Vial / Analyzer Stock
  - Test Mapping
  - Manual Usage
  - Waste & Adjustment
  - Reconciliation
  - Reorder
  - Reports
  - Audit Log
```

### 7.1 Overview

Cards:

- usable reagent value
- blocked reagent value
- expiring value
- pending QC lots
- low stock items
- unresolved exceptions
- today reagent usage cost
- tests without mapping

### 7.2 Reagent Stock

Columns:

- item name/code
- lot/batch
- expiry
- location
- available quantity
- QC status
- opened/onboard expiry
- assigned machine
- cost
- actions

### 7.3 Test Mapping

Features:

- search by test
- add/edit/remove mapped reagent
- machine-specific mapping
- mandatory/optional flag
- version/effective dates
- copy mapping
- bulk import/export

### 7.4 Manual Usage

Form fields:

- item
- stock lot optional
- quantity
- machine optional
- lab order optional
- test optional
- reason
- remarks

### 7.5 Reports

Minimum reports:

- stock summary
- lot-wise stock
- expiry report
- QC report
- open vial report
- reagent usage by test
- reagent cost by date range
- waste/loss report
- reorder report
- inventory exception report

## 8. Permissions

Recommended permissions:

- `lab_inventory:read`
- `lab_inventory:consume`
- `lab_inventory:qc`
- `lab_inventory:waste_request`
- `lab_inventory:adjust_request`
- `lab_inventory:approve`
- `lab_inventory:mapping_manage`
- `inventory:receive`
- `inventory:issue`
- `inventory:adjust`
- `inventory:approve`
- `inventory:reports`

Role guidance:

- Lab tech: read, consume, QC entry, waste request
- Lab manager: QC approve, mapping manage, adjustment review
- Inventory manager: GRN, stock movement, supplier/purchase workflow
- Admin/director: approval, audit, reports

## 9. Configurations

Tenant-level settings:

- `lab_inventory_mode`: disabled, soft, strict
- `auto_consume_on_result_finalization`: true/false
- `allow_result_without_stock`: true/false
- `require_test_mapping_for_completion`: true/false
- `default_fefo_strategy`: expiry_first, received_first
- `qc_required_for_lab_reagents`: true/false
- `default_onboard_expiry_warning_days`
- `expiry_alert_days`
- `low_stock_alert_strategy`: static_reorder_level, usage_based

## 10. API Contract Summary

New or refactored APIs:

```text
GET  /api/lab-inventory/overview
GET  /api/lab-inventory/reagents
GET  /api/lab-inventory/reagents/:itemId/lots
POST /api/lab-inventory/lots/:stockId/qc
POST /api/lab-inventory/lots/:stockId/open
POST /api/lab-inventory/lots/:stockId/assign-machine
GET  /api/lab-inventory/test-mappings
POST /api/lab-inventory/test-mappings
PUT  /api/lab-inventory/test-mappings/:id
DELETE /api/lab-inventory/test-mappings/:id
POST /api/lab-inventory/manual-usage
GET  /api/lab-inventory/waste-requests
POST /api/lab-inventory/waste-requests
POST /api/lab-inventory/waste-requests/:id/approve
POST /api/lab-inventory/waste-requests/:id/reject
POST /api/lab-inventory/reconciliation/counts
POST /api/lab-inventory/reconciliation/:id/approve
GET  /api/lab-inventory/reports/usage
GET  /api/lab-inventory/reports/cost
GET  /api/lab-inventory/reports/exceptions
```

Future integration APIs:

```text
GET  /api/lab-machines
POST /api/lab-machines
GET  /api/lab-machines/:id/test-code-map
POST /api/lab-machines/:id/test-code-map
POST /api/lab-machine-events/ingest
POST /api/lab-machine-events/:id/reprocess
```

## 11. Idempotency and Safety

Must enforce:

- result completion consumption happens once per `lab_order_item_id`
- external machine events use stable `machine_id + external_event_id`
- stock deduction uses conditional update to avoid race double-deduct
- all stock mutations write audit log
- draft result never consumes stock
- re-submitted verified result does not consume twice
- failed deduction creates exception in soft mode

## 12. Testing Requirements

Backend tests:

- GRN creates usable/non-usable lab lot metadata correctly
- QC pending stock is excluded
- QC failed stock is excluded
- expired stock is excluded
- onboard expired stock is excluded
- FEFO lot selection works
- result finalization consumes once
- draft result does not consume
- repeated finalization does not double consume
- soft mode creates inventory exception
- strict mode blocks finalization
- manual usage deducts stock
- waste approval deducts stock
- stock count adjustment requires approval
- inventory and lab dashboard show same balance

Frontend tests:

- overview renders alerts
- reagent stock table shows lot/QC/open-vial status
- mapping CRUD works
- manual usage form validates reason and quantity
- stock exception report renders

## 13. Migration Strategy

1. Add lab metadata tables without deleting current tables.
2. Backfill `lab_reagent_profiles` from existing lab consumables and inventory items.
3. Backfill `lab_reagent_lot_quality` from existing lab stock rows linked by `inventory_stock_id`.
4. Move result auto-deduction to canonical inventory issue engine.
5. Update lab dashboard reads to canonical inventory.
6. Keep old lab stock tables read-only temporarily.
7. Add validation tests to prove no dual-ledger mismatch.
8. Remove or fully deprecate old writes only after production confidence.

## 14. Acceptance Criteria

The feature is MVP complete when:

- lab reagent stock balance has one source of truth
- receiving reagent through inventory appears in lab inventory
- QC pending/failed/expired/onboard-expired lots are not usable
- result finalization deducts mapped reagent exactly once
- manual QC/repeat/spillage usage can be entered
- stock waste and adjustment require approval
- lab reports show usage and cost from canonical inventory records
- tests without mapping are visible
- unresolved stock exceptions are visible
- the system can run without machine integration
- machine integration can be added later through event ingestion without rewriting inventory
