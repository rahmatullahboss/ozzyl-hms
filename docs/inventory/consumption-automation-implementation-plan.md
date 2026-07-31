# Inventory Consumption Automation — Implementation Plan

Last updated: 2026-07-01

## Goal

Implement a unified consumption automation layer for non-lab and cross-department inventory deduction without duplicating the existing inventory issue engine.

This plan must be followed together with:

- `docs/inventory/consumption-automation-design.md`
- `docs/inventory/consumption-automation-sop.md`
- existing `docs/inventory-danphe-gap-review.md`
- existing `docs/ot-blueptint.md`
- existing reagent docs under `docs/superpowers/specs/2026-06-28-lab-reagent-mis-ready-inventory-design.md`

## Non-duplication guardrails

1. Do not create a new stock balance table that competes with `InventoryStock`.
2. Do not create a separate ledger for automated consumption.
3. Do not replace `recordInventoryIssue`; call it for final stock deduction.
4. Do not rebuild lab reagent mapping in phase 1; keep it and later bridge to unified rules.
5. Do not rebuild OT module; extend OT workflow to create/confirm consumption events.
6. Do not duplicate approval center; use existing approval/audit patterns.

## Current system anchor points

Use these current files/components:

- `src/lib/inventory-issue-service.ts` — canonical issue and stock deduction logic.
- `src/routes/tenant/inventory/issues.ts` — issue route wrapper and exported `recordInventoryIssue` wrapper.
- `src/routes/tenant/inventory/workflowAdapters.ts` — existing lab/OT consumption adapters.
- `src/routes/tenant/inventory/index.ts` — inventory route registration and RBAC mapping.
- `web/src/pages/inventory/InventoryIssuePage.tsx` — current manual issue UI.
- `web/src/pages/inventory/InventoryDashboard.tsx` — owner/dashboard integration point.
- `web/src/pages/inventory/InventoryLedger.tsx` — final movement visibility.
- `web/src/pages/inventory/InventoryCountPage.tsx` — cycle count/approval integration.
- `web/src/pages/LabMonitoringDashboard.tsx` — reagent setup and mapping experience to mirror.

## Phase 0 — Discovery and safety checks

### Tasks

1. Map existing schema names:
   - `InventoryItem`
   - `InventoryStock`
   - `InventoryConsumption`
   - `InventoryConsumptionItem`
   - `InventoryTransaction`
   - stores/locations tables
   - approval/audit tables
2. Confirm `recordInventoryIssue` supports all fields needed for:
   - patient reference
   - visit/admission reference
   - OT/procedure reference
   - lab order reference
   - chargeable item
   - batch/stock reference
3. Identify service/billing catalog table used by reception and OT.
4. Identify OT case/procedure tables and status transitions.

### Output

- Update this plan if schema names differ.
- Add a short implementation report under `docs/reports/YYYY-MM-DD-inventory-consumption-phase0.md`.

## Phase 1 — Database foundation

### Migration

Create a new migration, for example:

```text
migrations/04xx_inventory_consumption_automation.sql
```

Add:

- `InventoryConsumptionRule`
- `InventoryConsumptionRuleItem`
- `InventoryConsumptionEvent`
- `InventoryConsumptionEventItem`
- `InventoryConsumptionException`
- `InventoryConsumptionPolicy`

### Indexes

Required indexes:

```sql
CREATE INDEX idx_consumption_rule_trigger
  ON InventoryConsumptionRule(tenant_id, TriggerType, TriggerId, IsActive);

CREATE INDEX idx_consumption_event_status
  ON InventoryConsumptionEvent(tenant_id, Status, ExpectedAt);

CREATE INDEX idx_consumption_event_reference
  ON InventoryConsumptionEvent(tenant_id, TriggerType, TriggerId);

CREATE INDEX idx_consumption_exception_status
  ON InventoryConsumptionException(tenant_id, Status, Severity);
```

### Constraints

- Unique active rule by `tenant_id + TriggerType + TriggerId + RuleCode`, where possible.
- Event idempotency by `tenant_id + TriggerType + TriggerId + RuleId`, where relevant.
- Soft-delete/inactive instead of hard delete for rules.

### Tests

- Migration smoke test / schema source test.
- Idempotency uniqueness test.

## Phase 2 — Service layer

### Create files

```text
src/lib/inventory-consumption-rules.ts
src/lib/inventory-consumption-events.ts
src/lib/inventory-consumption-posting.ts
src/lib/inventory-consumption-exceptions.ts
src/lib/inventory-consumption-reconciliation.ts
```

### Rule service

Functions:

```ts
listConsumptionRules(db, tenantId, filters)
getConsumptionRule(db, tenantId, ruleId)
createConsumptionRule(db, input)
updateConsumptionRule(db, input)
upsertConsumptionRuleItem(db, input)
deactivateConsumptionRule(db, tenantId, ruleId, userId)
findRulesForTrigger(db, tenantId, trigger)
```

### Event service

Functions:

```ts
createExpectedConsumptionEvent(db, triggerInput)
getConsumptionEvent(db, tenantId, eventId)
listConsumptionEvents(db, tenantId, filters)
confirmConsumptionEvent(db, input)
updateEventActualItem(db, input)
```

### Posting service

Functions:

```ts
postConsumptionEvent(c, tenantId, eventId, userId)
reverseConsumptionEvent(c, tenantId, eventId, userId, reason)
autoPostIfAllowed(c, tenantId, eventId, userId)
```

`postConsumptionEvent` must transform event items into `recordInventoryIssue` payload.

### Exception service

Functions:

```ts
createConsumptionException(db, input)
reviewConsumptionException(db, input)
retryConsumptionException(c, tenantId, exceptionId, userId)
```

### Tests

Create:

```text
test/inventory-consumption-rules.test.ts
test/inventory-consumption-events.test.ts
test/inventory-consumption-posting.test.ts
```

Core scenarios:

1. create rule with items
2. find matching rule by trigger
3. create expected event from rule
4. auto mode posts exactly once
5. suggest mode does not deduct before confirmation
6. scan required blocks without scan
7. approval required creates exception
8. stock shortage creates exception
9. reversal creates linked reversal record

## Phase 3 — API routes

### Create files

```text
src/routes/tenant/inventory/consumptionRules.ts
src/routes/tenant/inventory/consumptionEvents.ts
src/routes/tenant/inventory/consumptionExceptions.ts
src/routes/tenant/inventory/consumptionReports.ts
```

Register them in:

```text
src/routes/tenant/inventory/index.ts
```

### Permissions

Suggested permission mapping:

| Endpoint group | Permission |
| --- | --- |
| rules read | `inventory:read` |
| rules write | `inventory:manage` |
| event read | `inventory:read` |
| event confirm/post | `inventory:consume` |
| exception review | `inventory:approve` or admin |
| reports | `inventory:read` |

### Tests

Create:

```text
test/integration/routes/inventory/consumption-rules.test.ts
test/integration/routes/inventory/consumption-events.test.ts
test/integration/routes/inventory/consumption-exceptions.test.ts
```

Scenarios:

- Unauthorized role blocked.
- Admin can create/update/deactivate rule.
- Storekeeper can confirm event if permitted.
- Duplicate event returns existing event or idempotent success.
- Exception retry calls posting service.

## Phase 4 — Trigger adapters

### Extend workflow adapters

Modify:

```text
src/routes/tenant/inventory/workflowAdapters.ts
```

Add:

```text
POST /workflow/trigger-consumption
POST /workflow/billing-item-consumption
POST /workflow/procedure-consumption
POST /workflow/ot-case-consumption
```

These should create expected events or directly post if rule mode is `auto`.

### Billing integration

When bill item is finalized:

1. If item has consumption rules:
   - create event
   - auto-post if rule mode is `auto`
   - otherwise show pending consumption queue
2. If no rule:
   - no stock movement
   - optionally create low-severity missing rule suggestion only for configured departments

### OT integration

OT should not blindly auto-post most items.

Flow:

```text
OT case scheduled / procedure selected
→ expected consumption event created
→ OT nurse opens event
→ confirms/scans actual items
→ post event when OT case closes
→ unconfirmed critical items block or warn on close based on policy
```

### Procedure/Nursing integration

Simple services like dressing/nebulization can use:

```text
bill/service selected
→ expected event
→ auto or quick-confirm
```

### Tests

- Billing trigger creates event.
- Auto trigger posts issue.
- OT trigger creates pending event.
- OT close with unconfirmed critical item blocks/warns according to policy.

## Phase 5 — Frontend UI

### Routes/pages

Add pages under `web/src/pages/inventory`:

- `ConsumptionRulesPage.tsx`
- `ConsumptionRuleForm.tsx`
- `ConsumptionQueuePage.tsx`
- `ConsumptionExceptionsPage.tsx`
- `ConsumptionReconciliationPage.tsx`

### Navigation

Add to inventory sidebar/navigation:

- Consumption Rules
- Consumption Queue
- Consumption Exceptions
- Consumption Reconciliation

### Dashboard widgets

Update `InventoryDashboard.tsx`:

- Pending consumption
- High variance
- Manual issue without reference
- Stock shortage exceptions
- High-value scan missing
- Consumption by department

### UX rules

- Never make staff search in long lists when context is known. Preload expected items.
- Show patient/procedure/bill reference prominently.
- Make scan field first for high-value items.
- Require variance reason only when outside tolerance.
- Keep manual issue but mark unreferenced manual issue as suspicious.

### Frontend tests

Create/update tests:

```text
web/src/pages/inventory/ConsumptionRulesPage.test.tsx
web/src/pages/inventory/ConsumptionQueuePage.test.tsx
web/src/pages/inventory/ConsumptionExceptionsPage.test.tsx
web/src/pages/inventory/InventoryDashboard.test.tsx
```

## Phase 6 — Starter rule catalog

### Create default catalog service

```text
src/lib/inventory-consumption-defaults.ts
```

Starter sets:

- Dressing Small
- Dressing Medium
- Nebulization
- IV Cannulation
- Catheterization
- Normal Delivery Pack
- C-Section Standard Pack
- Appendectomy Standard Pack
- Laparoscopic Cholecystectomy Starter Pack
- Minor Procedure Pack
- Emergency Resuscitation Starter Pack

### Endpoint

```text
POST /api/inventory/consumption-rules/defaults/seed
```

### UI

Button:

```text
Load starter consumption rules
```

Add warning:

```text
Starter quantities are editable estimates. Validate against hospital SOP and supplier pack sizes before strict enforcement.
```

### Tests

- Default catalog includes starter rules.
- Seed is idempotent.
- Existing tenant can load defaults without duplicating.

## Phase 7 — Admin monitoring and fraud controls

### Reports

Add backend report endpoints:

```text
GET /api/inventory/consumption-variance
GET /api/inventory/manual-issue-audit
GET /api/inventory/high-value-usage
GET /api/inventory/unconfirmed-consumption
```

### Fraud flags

Flag these:

- manual issue without reference
- stock issue by same staff repeatedly outside normal hours
- variance above threshold
- high-value item without scan
- write-off soon after GRN
- bill cancelled but stock not reversed
- OT case closed but consumption pending
- repeated stock shortage on billed procedures

### Admin UI

Add cards and detail drawers in owner/admin dashboard.

## Phase 8 — Rollout strategy

### Soft rollout

Default policy:

```text
Auto low-risk only = on
Strict blocking = off
High-value scan = warn first
Variance approval = warn first
Manual issue reference = warn first
```

### First hospital checklist

1. Load item master.
2. Create stores/locations.
3. Stock-in current balance.
4. Load starter consumption rules.
5. Validate top 20 services/procedures.
6. Enable auto for low-risk items.
7. Use suggest-confirm for OT/procedures.
8. Review variance daily for 7 days.
9. Enable scan/approval for high-value items.
10. Enable stricter controls after staff training.

## Phase 9 — Deployment and operational docs

Before deployment:

```text
pnpm exec vitest run inventory-consumption
pnpm exec vitest run test/integration/routes/inventory/consumption
pnpm --filter web test Consumption
pnpm exec tsc --pretty false --noEmit
pnpm --filter web build
```

After deployment:

- Confirm migrations applied.
- Open Inventory Dashboard.
- Load starter consumption rules on a test tenant.
- Create one dressing rule.
- Trigger one sample event.
- Confirm/post event.
- Verify stock ledger deduction.
- Verify variance report.

## Deliverable order

Recommended implementation order:

1. Migration + source tests.
2. Service layer + unit tests.
3. API routes + integration tests.
4. Basic UI for rule management.
5. Queue + confirmation UI.
6. Dashboard/exception reports.
7. Billing/OT adapters.
8. Starter rules.
9. Soft rollout policy.
10. Production deploy.

## Definition of done

This feature is done when:

- No duplicate stock ledger exists.
- All automated posting goes through `recordInventoryIssue`.
- Manual issue still works.
- Consumption rules can be configured.
- Events are created from bill/procedure/OT triggers.
- Auto mode posts exactly once.
- Suggest mode requires confirmation.
- Scan/approval modes block appropriately.
- Owner can see variance and manual issue risks.
- Cancellation/reversal is handled.
- Tests pass and build passes.
