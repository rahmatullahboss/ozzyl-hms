# Canonical Patient-Chart Radiology Billing Create Design

**Date:** 2026-07-24

**Base:** local `main` at `408430fa5`

**Boundary:** `patient-chart.radiology-billing.create`

**Status:** Approved by the standing `CDB-CONTINUE` instruction to complete remaining canonical financial writers serially from the latest reviewed local `main`.

## Problem

`POST /api/patients/:id/chart/radiology-order` creates a radiology requisition, legacy bill, invoice item and requisition-to-bill link through separate writes. It is blocked in strict mode because those facts do not commit with canonical service-operation and invoice authority.

The route also supports a historical free-text mode: when no active imaging catalog item matches the supplied name, it still creates a requisition and a zero-value paid bill. Disabled and shadow behavior must remain unchanged.

## Source audit

The quick-radiology contract is distinct from the primary RIS requisition route:

- lookup is by case-insensitive imaging item name;
- visit/admission/prescriber are not captured;
- free-text requisitions are allowed;
- zero-value paid bills are allowed;
- the requisition is inserted before invoice-number allocation;
- one invoice item references the committed requisition ID;
- bill accounting/reserve side effects occur only for positive value.

The existing service-operations backfill maps each `radiology_requisitions.id` as source type `legacy_radiology_requisition`. A live command must use the same source identity so future backfill detects existing authority instead of creating duplicates.

## Decision

Create two focused modules:

1. `patient-chart-radiology-billing.ts`
   - exact original legacy executor;
   - strict read-only context preparation;
   - guarded strict legacy statements.
2. `create-radiology-requisition-billing.ts`
   - one canonical service request;
   - one accepted service event;
   - one positive canonical invoice and service line;
   - source mappings to the actual committed requisition ID;
   - command and child outbox events.

The existing asynchronous strict-statement factory is reused. No coordinator change is required.

## Policy behavior

### Disabled

Execute the original route workflow exactly:

1. resolve an optional active imaging item by name;
2. allocate accession number;
3. insert requisition, preserving free-text values when no item resolves;
4. allocate invoice number;
5. insert zero- or positive-value bill;
6. insert invoice item;
7. link requisition to bill;
8. run existing positive-value side effects and return the same response.

### Shadow

Execute and commit the same original legacy workflow, then attempt canonical projection best-effort. Free-text, zero-value or unmapped requests may fail canonical projection; that failure must not change the committed response.

### Strict

Before accession or invoice sequence allocation:

- an active imaging item must resolve;
- a positive safe two-decimal price is required;
- an active billing-service item mapping is required.

After validation, allocate identities and commit guarded requisition/bill statements with canonical service and invoice facts in one D1 batch. Free-text and zero-value requests return a conflict before sequence allocation.

This checkpoint does not invent zero-value canonical invoice semantics.

## Original legacy adapter

`executePatientChartRadiologyOriginalLegacy()` receives route data plus injected dependencies:

- `resolveImagingItemByName(name)`;
- `nextAccessionNo()`;
- `nextInvoiceNo()`.

It preserves the current mutation order and SQL fields. The original executor contains no assertion table, canonical schema dependency, stronger catalog predicate, `changes()` guard or strict-only validation.

It returns the original requisition/bill mutation results plus a context containing generated identities, resolved/free-text display values, total and category totals.

## Strict context

`preparePatientChartRadiologyStrictContext()`:

- resolves the imaging item by name;
- requires `billingServiceItemId`;
- requires positive `pricePaisa` matching the major-unit price;
- allocates accession and invoice numbers only after validation;
- preserves urgency and requisition remarks.

## Strict statements

`preparePatientChartRadiologyStrictStatements()` guards:

- tenant-owned patient;
- active imaging item resolved by the submitted name;
- active billing-service item and current price;
- unique accession number;
- exact requisition insert fields;
- unique invoice number and exact bill totals;
- invoice item linked to the inserted requisition;
- requisition bill-link update;
- one-row assertions and assertion cleanup.

No `visit_services` or new accounting event is added to the legacy statement set.

## Canonical command

`createRadiologyRequisitionBilling()` accepts:

- tenant, patient and generated accession/invoice identities;
- imaging item and billing-service item identities;
- display name and positive total in minor units;
- normalized requested timestamp and business date;
- optional strict authoritative statements.

It prepares the canonical billing-service mapping, creates deterministic service-request, accepted-event, invoice-line and invoice IDs, then commits:

- canonical service catalog recovery if needed;
- active service request;
- accepted service event;
- canonical invoice and one service line;
- source mappings for request and event using the actual requisition ID selected by accession number;
- outbox events for request, event, invoice and outer command.

The invoice line references the accepted service event. The source mapping uses `legacy_radiology_requisition` and `radiology_requisitions`, matching backfill semantics.

## Route integration

The route keeps patient and accounting-period validation before the coordinator. It builds one preparation input and a mutable context holder populated by either the legacy executor or strict factory.

The canonical callback invokes `createRadiologyRequisitionBilling()` with the context and coordinator-supplied authoritative statements.

After commit, the route reloads requisition and bill IDs by accession/invoice number. It preserves audit and response fields.

`recordBillFinalizationSideEffects()` remains post-commit. Strict mode sets `skipBillAccountingEvent: true`; disabled/shadow retain the historical bill-created accounting event.

## Error behavior

- Missing/free-text imaging item in disabled/shadow: existing zero-value success behavior.
- Canonical shadow failure: recorded processing issue; legacy response unchanged.
- Missing mapping, zero price or stale strict catalog: HTTP 409 before or during the atomic strict batch.
- Concurrent patient/catalog/accession/invoice mutation: full strict rollback.

## Governance

Update `FINANCIAL_ROUTE_COVERAGE['patient-chart.radiology-billing.create']` to `integrated` with command `createRadiologyRequisitionBilling`.

Move the quick-radiology `bills` and `invoice_items` compatibility allowances from `src/routes/tenant/patients.ts` to `src/lib/canonical/patient-chart-radiology-billing.ts`. After both quick lab and quick radiology are integrated, the patient route should no longer contain direct inserts into those financial authority tables.

## Testing

TDD must prove:

1. original free-text and zero-value behavior remains unchanged;
2. original executor preserves lookup/sequence/write order;
3. strict missing item, mapping or positive price fails before sequences;
4. strict guarded statements are atomic under stale price, duplicate identity and patient mismatch;
5. canonical command creates request/event/invoice authority and actual-requisition mappings;
6. replay is deterministic and conflicting evidence is rejected;
7. shadow canonical failure preserves `201` response;
8. strict preflight produces no legacy insert;
9. accounting event is retained in legacy/shadow and skipped only in strict;
10. route coverage and governance report the boundary integrated;
11. radiology primary route remains untouched and blocked;
12. full canonical, TypeScript, governance and production build gates pass.

## Non-goals

- No integration of `radiology.billing.create` in the primary RIS route.
- No zero-value canonical invoice support.
- No change to radiology report/scanning workflow.
- No broad `patients.ts` refactor.
- No production push, deploy, migration, flag change, tenant mutation, observation or retirement.
