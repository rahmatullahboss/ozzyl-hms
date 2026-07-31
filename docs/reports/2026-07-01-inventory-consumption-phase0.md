# Inventory Consumption Automation — Phase 0 Review

Date: 2026-07-01

## Scope

Reviewed the current inventory, lab reagent, and OT consumption foundations before starting the unified consumption automation implementation.

## Existing foundations found

### Canonical inventory issue engine

File:

```text
src/lib/inventory-issue-service.ts
```

The service already supports:

- `department_issue`
- `patient_issue`
- `ot_consumption`
- `emergency_issue`
- `lab_consumption`
- `pharmacy_sale`
- `asset_issue`

The issue payload already includes useful references:

- `PatientId`
- `AdmissionId`
- `VisitId`
- `SurgeryId`
- `LabOrderId`
- `BillingReferenceId`
- stock/batch/item lines
- chargeable item support

Decision: new automation must post final stock deduction through this engine. No duplicate stock ledger should be created.

### Existing inventory workflow adapter

File:

```text
src/routes/tenant/inventory/workflowAdapters.ts
```

Already has adapter-style routes for:

- lab reagent consumption
- OT consumption

Decision: rule-driven triggers should extend this adapter pattern instead of creating disconnected stock deduction endpoints.

### Existing consumption tables

Migration:

```text
migrations/0253_inventory_complete_workflow.sql
```

Existing tables:

- `InventoryConsumption`
- `InventoryConsumptionItem`

Decision: new automation tables should store rules/events/exceptions and then link posted events to `InventoryConsumption.ConsumptionId`.

### Existing lab reagent automation

Files:

- `src/lib/lab-consumables.ts`
- `web/src/pages/LabMonitoringDashboard.tsx`
- `migrations/0393_lab_inventory_policy.sql`
- `migrations/0394_lab_inventory_exception_and_claim_lifecycle.sql`
- `migrations/0396_lab_test_consumable_map_lifecycle.sql`

Decision: do not rebuild lab reagent mapping in phase 1. Keep it, then later bridge or align it with the unified rule/event model.

### Existing OT blueprint

File:

```text
docs/ot-blueptint.md
```

The blueprint already defines OT inventory consumption and packs conceptually.

Decision: OT implementation should use `suggest_confirm`, scan-required, and approval modes rather than blindly auto-posting most OT consumables.

## Phase 1 decision

Implement DB foundation only:

- `InventoryConsumptionRule`
- `InventoryConsumptionRuleItem`
- `InventoryConsumptionEvent`
- `InventoryConsumptionEventItem`
- `InventoryConsumptionException`
- `InventoryConsumptionPolicy`

Migration:

```text
migrations/0398_inventory_consumption_automation.sql
```

## Safety notes

- No existing table is replaced.
- No new stock balance table is introduced.
- New event table links back to canonical `InventoryConsumption` through `PostedConsumptionId` and `ReversalConsumptionId`.
- Soft rollout remains the default policy.
