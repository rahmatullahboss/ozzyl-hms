# CDB-V1-030G service delivery event route integration audit

**Date:** 2026-07-29  
**Checkpoint:** `CDB-V1-030G-SERVICE-DELIVERY-EVENT-ROUTE-INTEGRATION-VERIFIED`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Scope:** local protected-core implementation and repository evidence only

## Result

The four remaining protected `service_delivery_event` writer pairs now cross reviewed atomic command boundaries:

- `src/lib/billing-create-batch.ts` / `visit_services`;
- `src/lib/canonical/appointment-billing-finalization.ts` / `billing_provisional_items`;
- `src/routes/tenant/billingCancellation.ts` / `billing_provisional_items`; and
- `src/routes/tenant/visits.ts` / `visit_services`.

Billing or provisional acceptance is not treated as delivered care. The integrated paths record an `accepted` service event with fulfilled quantity remaining zero. Actual delivery, completion, dispense or other fulfilment remains a separate Canonical event. Cancellation preserves accepted history and appends an explicit cancellation receipt/outbox transition.

## Frozen command composition

`src/lib/canonical/commands/service-operations.ts` now supports reviewed outer-batch preparation for:

- service request creation;
- accepted service-event recording;
- exact service-event cancellation; and
- accepted-then-cancelled bootstrap for a previously unmapped compatibility row.

The commands retain the existing names `canonical.service_request.create`, `canonical.service_event.record` and `canonical.service_event.cancel`. Each command has its own tenant-scoped idempotency receipt and PHI-minimised outbox event. Exact replay returns the prior result; changed semantic evidence conflicts. A mixed prepared/replayed receipt state fails closed.

`src/lib/canonical/service-delivery-route-integration.ts` provides deterministic request, event and outbox identities, exact source mapping, optional same-batch encounter/service evidence and mapped or bootstrap cancellation. A service without an encounter is permitted only when exactly one active tenant-patient link exists. An encounter-linked service requires exact encounter/patient agreement. Practitioner participation requires one exact active mapping.

## Service identity

Direct and appointment consultation charges use one deterministic protected consultation service identity:

- kind: `consultation`;
- code: `PROTECTED-CONSULTATION`;
- display: `Consultation`;
- unit: `service`;
- status: `active`.

This bootstrap creates no price row and no parallel price authority. Existing doctor fees, invoice values and provisional amounts remain financial/compatibility projections. Catalog-backed bill lines reuse `prepareCanonicalBillingServiceMapping` and fail closed without one active exact service identity.

## Stable compatibility identity

Migration `0568_service_delivery_route_identity.sql` adds nullable tenant-scoped source identity to:

- `visit_services.canonical_source_key`; and
- `billing_provisional_items.canonical_source_key`.

Partial unique indexes prevent two rows in the same tenant from claiming the same non-null key. Existing rows are not rewritten.

## Route behaviour

### Direct visits

A new doctor consultation visit prepares the legacy visit, master-data audit and Canonical encounter first, then combines those statements with the consultation service identity, exact practitioner participant, legacy `visit_services` row, Canonical request/event, mappings, receipts and outbox in one D1 batch. Exact retry reuses visit and visit-service identity and does not allocate a second row.

### Direct billing

`buildBillCreationBatch` preserves its legacy array shape and attaches a non-enumerable async strict factory. Each visit-linked invoice line receives a stable source key and one legacy `visit_services` row. The strict factory resolves the exact visit encounter, active service and optional practitioner, then embeds bill, invoice-line and compatibility statements into the accepted-service command batch. Amount evidence is hashed in integer minor units.

### Appointment billing

Appointment provisional finalisation preserves the financial assertion boundary. Each provisional row receives a stable source key. The hidden strict factory combines bill/payment/cash/appointment/provisional statements with the protected consultation service, exact practitioner and optional exact encounter in one atomic service-acceptance batch. Billing does not increment service fulfilment.

### Provisional cancellation

The cancellation route reads and freezes the complete provisional snapshot. Its update is followed immediately by a `changes()` assertion, master-data audit and assertion cleanup. A mapped service event is cancelled directly. An unmapped row creates request and accepted-event history and cancels the event in the same batch. Concurrent row drift or a zero-row update aborts the entire transaction.

The existing success response remains `Provisional item cancelled`; already processed or missing rows remain a 404 response.

## Deterministic governance result

After access, identity/episode, protected inventory and writer-coverage regeneration:

- governed tables: 260;
- repository writers: 1,012;
- repository readers: 2,614;
- identity/episode eligible readers: 831 across 290 paths and 63 tables;
- protected surfaces: 911;
- protected routes: 44;
- protected UI flows: 28;
- protected writers: 223;
- protected readers: 493;
- protected tables: 83;
- Canonical-command writers: 112;
- atomic-compatibility writers: 57;
- governed-external writers: 3;
- command-required writers: 47;
- isolated fixtures: 4;
- remaining implementation groups: 10;
- unknown writers/readers: 0;
- unclassified protected writers: 0.

The four original writers are registered under:

- `service-delivery.billing-create`;
- `service-delivery.appointment-finalization`;
- `service-delivery.provisional-cancellation`; and
- `service-delivery.visit-consultation`.

Promotion remains fail-closed unless route, adapter, command, migration and replay/rollback evidence all remain present.

## Verification

Fresh local verification:

- focused service, appointment, encounter, visit, billing, queue and cancellation suite: 11 files, 219 tests, 0 failures;
- service route integration contract: 8 tests, 0 failures;
- appointment finance/service integration: 6 tests, 0 failures;
- TypeScript: passed;
- migration manifest: 502 conforming migrations;
- full `pnpm canonical:check`: passed with zero governance issues;
- protected inventory: 911 surfaces, 223 writers, 493 readers, zero unknown assignments;
- protected writer coverage: 47 command-required, 57 atomic-compatibility, zero unclassified;
- dirty-worktree policy: passed.

Expected error-path logging from the broad definitive-route test remains non-failing test noise and is unrelated to this checkpoint.

## Safety state

- production query performed: no;
- production mutation performed: no;
- production migration/backfill applied: no;
- provider or feature flag enabled: no;
- route or traffic cutover: no;
- deployment: no;
- local sync activation: no;
- legacy retirement or deletion: no;
- push: no;
- CDB-to-main integration: no.

## Exact next bounded slice

`CDB-V1-030H-PRACTITIONER-COMPENSATION-ACCRUAL-ADJUSTMENT-INTEGRATION`

Integrate the four remaining protected accrual/adjustment writers in `billing-refund-commission.ts`, `diagnostic-performer-reserve.ts`, `billingCancellation.ts` and `commissions.ts` with the frozen accrual and adjustment commands. Preserve billing, cancellation, diagnostic reserve and commission HTTP/UI behaviour; require exact invoice line/service event, practitioner, compensation rule/version and integer-minor-unit evidence; commit compatibility, Canonical accrual/adjustment/reversal, idempotency, audit and outbox atomically; prove replay, stale/concurrent rejection, tenant isolation and complete rollback; then regenerate governance artifacts.
