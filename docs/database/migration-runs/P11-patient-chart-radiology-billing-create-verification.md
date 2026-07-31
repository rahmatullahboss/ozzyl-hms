# P11 Patient-Chart Radiology Billing Create Verification

**Checkpoint:** CDB-113

**Verified:** 2026-07-24T15:24:32+06:00

**Branch:** `fix/canonical-patient-chart-radiology-billing-create-20260724`

**Base:** local `main` at `408430fa50c6677ba90bf879b4bb36cbb79c6624`

**Boundary:** `patient-chart.radiology-billing.create`

## Result

The boundary is implemented and locally verified as `integrated`.

`POST /api/patients/:id/chart/radiology-order` now executes through `executeStrictFinancialMutation()` while preserving the historical free-text and zero-value workflow in disabled and shadow modes. Strict mode atomically commits guarded requisition, bill and invoice-item authority with canonical service-request, accepted-service-event and invoice authority.

The primary RIS `radiology.billing.create` route was not modified and remains fail-closed in strict mode.

## Checkpoint commits

- `6777ab007` — design and implementation plan
- `e5f1ac489` — composite canonical radiology requisition billing command
- `c522cdefa` — quick-radiology original legacy and strict adapter
- `d82846db1` — route, coverage, governance and executable behavior integration
- `dc89c83a` — obsolete patient-route strict guard import cleanup

## Legacy and shadow isolation

`executePatientChartRadiologyOriginalLegacy()` preserves the original sequence:

1. resolve an optional active imaging item by submitted name;
2. allocate accession number;
3. insert the requisition;
4. allocate diagnostic invoice number;
5. insert a zero- or positive-value bill;
6. insert one invoice item using the committed requisition ID;
7. link the requisition to the bill.

When no active imaging item resolves, the submitted free-text imaging type/name are retained and the route still creates a paid zero-value legacy bill. The original executor contains no financial assertion table, canonical schema dependency, stronger catalog predicate, `changes()` assertion or `visit_services` insert.

Shadow mode commits this original workflow first. Canonical projection failure records a processing issue and does not alter the successful legacy response.

## Strict authority

`preparePatientChartRadiologyStrictContext()` runs only after strict policy is selected. Before accession or invoice sequence allocation it requires:

- an active resolved imaging item;
- an active canonical billing-service mapping;
- a positive price;
- exact major/minor-unit price parity.

Free-text, zero-price and unmapped requests therefore fail closed before sequence allocation in strict mode, while remaining supported in disabled and shadow modes.

`preparePatientChartRadiologyStrictStatements()` guards:

- tenant-owned patient;
- active imaging item resolved by the submitted name;
- current active billing-service item and price;
- unique accession identity;
- requisition insertion;
- unique invoice identity and exact bill totals;
- invoice-item linkage to the inserted requisition;
- requisition-to-bill linkage;
- one-row assertions and assertion cleanup.

Stale price, patient mismatch, duplicate accession/invoice or any row-count mismatch rolls back all strict legacy and canonical facts.

## Canonical authority

`createRadiologyRequisitionBilling()` creates deterministic:

- canonical billing-service mapping/recovery;
- active service request;
- accepted posted service event;
- positive canonical invoice and service line;
- source mappings for request and event using the actual committed `radiology_requisitions.id` selected by accession number;
- child and outer command outbox events.

The source type/table are `legacy_radiology_requisition` and `radiology_requisitions`, matching the existing service-operations backfill contract. Replay is deterministic; conflicting evidence is rejected.

The guarded legacy statements are passed as the command's authoritative statements, so strict legacy and canonical facts share one D1 batch.

## Route and accounting behavior

After commit, the route reloads requisition and bill IDs by accession and invoice number rather than relying on batch result indexes.

Positive-value post-commit behavior remains:

- diagnostic performer reserve and commission preparation;
- audit logging;
- accounting posting queue scheduling.

Disabled and shadow modes retain the legacy bill-created accounting event. Strict mode sets `skipBillAccountingEvent: true` because canonical invoice outbox authority is already committed atomically. Zero-value legacy/shadow orders retain the historical absence of bill-created accounting events.

`FINANCIAL_ROUTE_COVERAGE['patient-chart.radiology-billing.create']` now records:

```text
status: integrated
canonicalCommand: createRadiologyRequisitionBilling
```

Direct `bills` and `invoice_items` compatibility allowances moved from `src/routes/tenant/patients.ts` to `src/lib/canonical/patient-chart-radiology-billing.ts`. The patient route no longer directly inserts those financial authority tables.

## Adversarial review

Validated before the final gate:

1. Disabled and shadow modes never evaluate strict preparation.
2. Free-text and zero-value legacy behavior remains executable and returns `201`.
3. Shadow canonical failure returns the committed legacy success response.
4. Strict missing-item/mapping/positive-price validation occurs before sequence allocation and legacy insert.
5. Guarded legacy and canonical facts share one atomic batch.
6. Source mappings use the actual committed requisition ID.
7. Current catalog price and submitted-name identity are revalidated in the strict batch.
8. Strict mode skips only the duplicate bill accounting event.
9. No `visit_services` or canonical dependency entered the original executor.
10. The primary RIS radiology route remains unchanged and blocked in strict mode.
11. The unused patient-route unsupported-boundary import was removed after both quick diagnostic boundaries became integrated.

No unresolved Critical or High finding remained.

## Fresh verification

### Focused CDB-113 gate

- 7 test files passed
- 76 tests passed

Coverage includes command, adapter, source contract, executable legacy/shadow/strict behavior, cross-route shadow isolation, financial route coverage and schema governance.

### Full canonical gate

- 129 test files passed
- 905 tests passed

### Other gates

- TypeScript: passed
- Canonical schema governance: 0 issues
- Generated migration manifest: 467 migrations
- Web production build: passed
- Patient production build: passed
- Admin production build: passed
- Task worktree policy: passed
- `git diff --check`: passed

## Remaining work

The next financial writer boundary is `pharmacy.billing.finalize`. Other registered fail-closed runtime writers remain:

- `radiology.billing.create`
- `reception.visit-billing.create`
- `settlement.finalize`

This checkpoint does not claim production strict readiness.

## Production safety statement

No remote push, deployment, production migration, production backfill, feature-flag change, traffic change, tenant-data mutation, production observation, rollback or legacy retirement occurred. All implementation and verification were local to the isolated task worktree.
