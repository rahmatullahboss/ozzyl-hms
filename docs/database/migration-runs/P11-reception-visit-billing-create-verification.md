# P11 Reception Visit Billing Create Verification

**Checkpoint:** CDB-116

**Verified:** 2026-07-24T23:36:56+06:00

**Task branch:** `fix/canonical-reception-visit-billing-create-20260724`

**Task base:** local `main` at `31b3ca6be0812dad46393cf6cbe43f6d5143c483`

**CDB-116 replay head on local main:** `8c846333a`

**Final verified local main head:** `f5d93816db181ebc783fc2bfc6b7d1763bae00db`

Parallel local-main commits `e0eebda6d` and `f5d93816d` were preserved and included in the final verification.

**Boundary:** `reception.visit-billing.create`

## Result

The reception visit-service final billing boundary is implemented and locally verified as `integrated`.

`POST /visits/:visitId/generate-bill` now executes through `executeStrictFinancialMutation()` and uses:

- `executeReceptionVisitBillingOriginalLegacy()` for disabled and shadow authority;
- `prepareReceptionVisitBillingStrictContext()` plus `prepareReceptionVisitBillingStrictStatements()` for guarded strict authority;
- `createReceptionVisitBilling()` for canonical service-request, accepted-event and discount-aware invoice authority.

The route continues to own authorization, request idempotency, pending-service snapshot loading, discount and scheme validation, scheme usage, post-commit commission/performer-reserve behavior, accounting queue, audit and the existing response contract.

## Checkpoint commits

- `8605ba9e1` — design and implementation plan
- `0d73bca9f` — composite canonical reception visit billing command
- `516205973` — original conditional-claim legacy executor
- `2299e26f1` — strict preflight, guarded compatibility statements and production-trigger fixture
- `33ff4e70b` — route integration and executable runtime policy coverage
- `9eb73e626` — route coverage and cross-route shadow isolation
- `4b8a3d322` — commit-time catalog and encounter race guards
- `6594c6136` — nullable reference, actual billed-source mapping and visit authority hardening
- `ffaeaec3d` — exact catalog evidence, active mapping and temporal authority hardening

## Original legacy and shadow authority

`executeReceptionVisitBillingOriginalLegacy()` preserves the historical sequence:

1. accounting-period validation;
2. invoice-number allocation;
3. one bulk claim of the exact selected pending `visit_services` IDs from `pending` to `billing`;
4. conditional bill insertion only when every selected row is in the temporary `billing` state;
5. bill discount-allocation insertion;
6. one invoice-item insertion per selected service;
7. service linkage to the bill and status transition to `billed`;
8. optional doctor-commission accrual linkage for lab-order items;
9. optional lab-order bill and billing-status linkage;
10. failed-bill temporary-claim reset from `billing` to `pending`;
11. authoritative bill-ID resolution and the historical concurrency conflict when no bill committed.

The original executor contains no canonical schema dependency, financial assertion, strict-only catalog/encounter check or `changes()` assertion.

The route preserves the historical accounting-period check location: after confirming pending services exist and before discount/scheme validation. The adapter dependency is a no-op in route orchestration, preventing duplicate checks without changing order.

Shadow mode commits this original workflow first. Canonical mapping, encounter or catalog failure records `CANONICAL_SHADOW_WRITE_FAILED` and leaves the committed legacy `201` response unchanged.

### Nullable legacy service reference parity

The original route allowed historical/manual services whose `service_item_id` is `NULL` and used `reference_id` as the invoice-item reference fallback.

During review, the new route mapping was found to convert `NULL` to `0`, which would have changed invoice-item source identity. The route now preserves `NULL`; disabled/shadow mode again uses:

```text
service_item_id ?? reference_id
```

Strict mode still requires a positive mapped billing-service item and therefore fails closed for an unmapped manual service. Executable route coverage verifies reference `777` is preserved and `0` is not written.

## Strict preflight

Strict preparation is lazy and runs only after strict policy selection. Before invoice-number allocation it verifies:

- the visit belongs to the same tenant and patient and retains the expected referring doctor;
- a mapped canonical encounter exists, belongs to the same patient and is `planned` or `in_progress`;
- every selected service ID is unique and positive;
- every selected service belongs to the same tenant, visit and patient;
- every service remains pending and unbilled;
- every strict service has a positive billing-service item ID;
- service type and description are present;
- quantity is a positive safe integer;
- amount, item discount, line total, subtotal, bill discount and final total use exact cent precision;
- `amount × quantity - discount_amount = total_amount` for every line;
- selected-service totals equal the bill subtotal;
- discount allocations equal the bill discount;
- the final total equals subtotal minus bill discount, including a valid zero-total fully discounted bill;
- the legacy billing item and department are active;
- the canonical service mapping is active or can be safely prepared;
- an optional lab-order-item reference belongs to a tenant-owned lab order for the same patient and visit and remains unbilled;
- the accounting period is open.

Only after these checks does strict mode allocate the invoice number.

## Strict atomic compatibility authority

The strict authoritative statements atomically commit:

- one exact guarded claim per selected `visit_services` row;
- the bill and category totals;
- bill discount allocations;
- one invoice item per exact claimed service;
- each service-to-bill linkage;
- optional doctor-commission accrual linkage;
- optional lab-order linkage and billing status;
- the production bill-insert accounting trigger event.

Each critical row is followed by a one-row financial assertion. Assertions are cleared before commit.

Strict service claims revalidate the complete current source snapshot:

- service patient, visit, type, description and item ID;
- doctor, amount, discount, quantity and total;
- reference type and reference ID;
- pending/unbilled state;
- current visit patient and referring doctor;
- active billing item and active department;
- exact service department ID;
- exact item code, item name and price;
- exact department code and department name;
- an existing canonical mapping, when present, still points to an active service;
- the mapped canonical encounter still exists, matches the patient and remains active.

SQLite race tests prove complete rollback for changes to service amount, patient, reference, status, bill link, catalog activity, catalog price, catalog name, catalog code, catalog department, department activity, department code, visit doctor, encounter mapping, encounter status and lab-order reference.

## Composite canonical command

`createReceptionVisitBilling()` commits deterministic canonical authority for the exact billed services:

- one canonical service request per `visit_services.id`;
- one accepted service event per request;
- one service mapping per unique billing-service item;
- source mappings from the canonical request/event to the actual `visit_services.id`;
- one canonical invoice service line per legacy invoice item identity;
- one negative `RECEPTION_BILL_DISCOUNT` line for the bill-level discount;
- canonical invoice header, source mapping and outbox events;
- one outer deterministic command envelope.

Item-level discounts are already represented in each stored `visit_services.total_amount` and are not subtracted again. The bill-level discount is represented exactly once as a canonical adjustment line.

A positive subtotal can be fully discounted to a zero final total. The canonical invoice remains posted with zero due.

### Source-line identity

Every canonical service invoice line uses the exact identity expected by post-commit finance processing:

```text
<lineNumber>:<serviceType>:<legacyReferenceId>
```

The legacy reference uses the lab-order-item ID for lab services and otherwise the billing-service item/reference fallback. This matches `recordBillFinalizationSideEffects()` and future live invoice-line recovery.

### Actual billed-source mapping

Adversarial review found that initial source mappings required only the visit-service identity, not proof that the source row had actually committed to the same bill.

Mappings now require:

- the exact tenant, visit, patient and billing-service item;
- exact service type, description and quantity;
- exact minor-unit line total;
- the exact legacy reference rule;
- source status `billed`;
- a non-null source bill ID;
- the linked bill invoice number equals the canonical invoice number;
- the canonical service row is active.

A stale `pending` or temporary `billing` row cannot be mapped. Assertion failure rolls back every canonical fact and authoritative statement.

## Active catalog and evidence authority

`PreparedCanonicalBillingServiceMapping` now exposes source-derived status.

Reception strict preparation and the composite command require `status: active`. An inactive live billing item or an existing inactive canonical mapping fails before authoritative writes.

Commit-time guards also prevent an active mapping from becoming inactive inside the outer batch. Tests prove both the strict compatibility batch and composite command roll back fully and restore the active status on failure.

The exact catalog snapshot is bound through commit. Price, item code/name, service department, department code/name and activity changes after preflight all roll back the full strict transaction.

## Production accounting-trigger parity

The production `trg_bills_insert_accounting_event` trigger creates a `bill_created` event for a positive bill or discount.

The strict SQLite fixture installs the production trigger shape and verifies:

- successful strict billing produces exactly one trigger-created event;
- no financial assertion residue remains;
- every guarded race rolls back the bill, invoice items, allocations, service/lab links, trigger-created event and assertion rows together.

The route uses:

```text
skipBillAccountingEvent: financialExecution.mode === 'strict'
```

This prevents a duplicate application-side bill-created event while preserving performer-reserve and commission behavior.

## Route and idempotency behavior

The generate-bill handler no longer contains bill, invoice-item or service-claim mutation SQL. It:

1. validates visit, request and discount authority;
2. reserves/replays optional request idempotency;
3. loads pending services;
4. preserves accounting-period and scheme validation order;
5. prepares shared adapter evidence;
6. runs the financial coordinator;
7. reloads the committed bill by tenant/invoice;
8. reloads committed invoice-item IDs ordered by insertion;
9. requires exact strict invoice-item count;
10. runs existing scheme, finance, accounting and audit behavior;
11. completes the existing response and idempotency contract.

The response remains:

```text
{
  message: "Bill generated from visit services",
  billId,
  invoiceNo,
  total,
  serviceCount
}
```

The canonical issued timestamp now uses the actual current UTC instant, while the Bangladesh-local business date remains separate. This matches the legacy bill creation time more closely than a synthetic local-midnight timestamp.

Strict assertion, mapping or canonical-authority failures return a sanitized `409`. Historical `400`, `403`, `404` and idempotency behavior remain.

## Governance

`FINANCIAL_ROUTE_COVERAGE['reception.visit-billing.create']` now records:

```text
status: integrated
canonicalCommand: createReceptionVisitBilling
```

Direct compatibility writes moved from `src/routes/tenant/reception.ts` to `src/lib/canonical/reception-visit-billing.ts`.

Narrow adapter allowances were added for:

- `bills`;
- `invoice_items`;
- `doctor_commission_accruals`.

The now-stale route allowances for those tables were removed. No unrelated writer was allowlisted. Canonical schema governance remains at zero issues.

Cross-route shadow isolation extracts the original helper/executor section and rejects canonical tables, financial assertions, catalog recovery and strict-only predicates.

## Adversarial review

Validated before the final gate:

1. original statement sequence and failed-claim reset remain exact;
2. accounting-period validation order remains exact;
3. request-idempotency replay and mismatch behavior remain;
4. discount, high-discount referral and scheme eligibility remain;
5. scheme usage and existing response remain;
6. shadow canonical failure preserves the legacy `201` response and records an issue;
7. strict missing encounter/catalog authority fails before invoice allocation or mutation;
8. fully discounted zero-total billing remains valid;
9. strict source rows are exact and unique;
10. visit patient/referring-doctor authority is commit-bound;
11. catalog item and department evidence is commit-bound;
12. existing canonical service mappings remain active through commit;
13. canonical encounter authority remains active through commit;
14. lab-order references remain exact through commit;
15. actual billed source rows and matching bill invoice are required for source mappings;
16. legacy nullable service reference fallback is preserved;
17. canonical invoice-line identity matches post-commit finance processing;
18. production bill trigger is transactionally compatible;
19. nested invoice-batch preparation does not retain a child command claim/outbox;
20. no unresolved Critical or High finding remains.

Four High-risk issue groups were corrected during review:

- strict commit initially revalidated service state but not complete catalog/encounter/visit authority;
- nullable legacy `service_item_id` was converted to `0`, changing source identity;
- canonical mappings initially did not prove the source service was billed to the same invoice;
- exact active catalog evidence and active canonical mapping were not bound through commit.

## Fresh verification

### Focused CDB-116 gate

- 10 test files passed
- 143 tests passed

Coverage includes the reception composite command, original/strict adapter, reception route runtime/source contract, existing reception integration suite, reception integrity hardening, billing-scheme audit coverage, financial route coverage, cross-route shadow isolation, live service-catalog recovery and the main continuation contract.

### Full canonical gate

- 137 test files passed
- 988 tests passed
- Executed against final local-main head `f5d93816d` with a 20-second per-test ceiling because the default 5-second ceiling caused reporting-wrapper contention; the same affected files also passed independently.

### Other gates

- TypeScript: passed
- Canonical schema governance: 0 issues
- Generated migration manifest: 469 migrations
- Web production build: passed
- Patient production build: passed
- Admin production build: passed
- Task worktree policy: passed
- Integration worktree policy: passed
- `git diff --check`: passed

## Remaining work

The only remaining registered P11 runtime boundary is:

```text
settlement.finalize
```

This checkpoint does not claim production strict readiness.

## Current-main integration result

The reviewed CDB-116 commits were replayed serially onto the dedicated clean local-main integration worktree without conflict, producing replay head `8c846333a`.

While final verification was running, local `main` advanced through `e0eebda6d` and `f5d93816d`. Both parallel reception/billing fixes were preserved. The focused CDB-116 gate, full canonical suite, TypeScript, governance, migration manifest, integration worktree policy and all three production builds were rerun against final head `f5d93816d`.

CDB-117 may begin from that reviewed local-main head.

## Production safety statement

No remote push, deployment, production migration, production backfill, feature-flag change, traffic change, tenant-data mutation, production observation, rollback or legacy retirement occurred. All implementation and verification were local to the isolated task worktree.
