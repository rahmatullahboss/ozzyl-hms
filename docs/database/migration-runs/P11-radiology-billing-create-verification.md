# P11 Radiology Billing Create Verification

**Checkpoint:** CDB-115

**Verified:** 2026-07-24T21:00:42+06:00

**Task branch:** `fix/canonical-radiology-billing-create-20260724`

**Integrated branch:** local `main`

**Task base:** local `main` at `317f8696c54a124b4b4be2d15f836e87a19eb853`

**Current-main integration base:** `317f8696c54a124b4b4be2d15f836e87a19eb853`

**Boundary:** `radiology.billing.create`

## Result

The primary RIS requisition-create boundary is implemented and locally verified as `integrated`.

`POST /` in `src/routes/tenant/radiology/orders.ts` now executes through `executeStrictFinancialMutation()` and uses:

- `executeRadiologyOrderOriginalLegacy()` for disabled and shadow authority;
- `prepareRadiologyOrderStrictContext()` plus `prepareRadiologyOrderStrictStatements()` for guarded strict authority;
- `createRadiologyRequisitionBilling()` for canonical service-request, accepted-event and invoice authority.

The request-idempotency reservation/replay, post-commit billing side effects, accounting queue, audit log and response contract remain route-level behavior.

## Checkpoint commits

- `0acca27ab` — design and implementation plan
- `0dec886f6` — original/strict RIS adapter and executable tests
- `7ef7b324f` — active Radiology catalog and price authority hardening
- `262581f04` — primary RIS route integration
- `7e0bcac2e` — route coverage and shadow-isolation registration
- `0ca5e08ee` — production bills-trigger parity coverage
- `262aae430` — strict radiology invoice-line authority alignment

## Original legacy and shadow authority

`executeRadiologyOrderOriginalLegacy()` preserves the historical primary RIS workflow:

1. tenant-owned patient validation;
2. optional visit, admission, active prescriber, imaging type and imaging item validation;
3. submitted free-text name/procedure preservation and legacy catalog fallback;
4. accounting-period validation;
5. accession-number allocation;
6. invoice-number allocation;
7. full-shape `radiology_requisitions` insertion;
8. `bills` insertion;
9. dependent `invoice_items` insertion and requisition bill-link update;
10. existing route post-commit finalization, accounting, audit and idempotency completion.

The original executor contains no canonical schema dependency, financial assertion, strict-only mapping requirement, `changes()` assertion or stronger patient/reference rule. Free-text and zero-value requisitions remain successful legacy operations; a zero-value bill remains `paid` and the requisition remains linked with paid billing status.

Shadow mode commits this original workflow first. A missing mapping, zero value, canonical catalog conflict or other canonical projection failure records `CANONICAL_SHADOW_WRITE_FAILED` and does not alter the committed legacy `201` response.

## Strict preflight

Strict preparation is lazy and runs only after strict policy selection. Before accession or invoice sequence allocation it requires:

- tenant-owned patient;
- an optional visit belonging to the same tenant and patient;
- an optional admission belonging to the same tenant and patient;
- an optional active tenant prescriber;
- active imaging item and imaging type authority;
- exact item/type identity;
- active mapped billing service;
- active billing-service department with code `RAD`;
- exact current item/type/display-name/service/price authority;
- positive price and exact major/minor-unit parity;
- open accounting period.

Free-text, unmapped and zero-value requests therefore remain valid in disabled/shadow mode but fail closed in strict mode before either sequence or any financial/source mutation.

## Strict atomic authority

The strict authoritative statement set atomically commits:

- the full RIS requisition shape, including visit, admission, prescriber, ward, insurance, urgency and source names;
- the live bill and current category totals;
- the actual invoice item linked to the committed requisition row;
- the requisition-to-bill link and unpaid billing status;
- canonical service request and accepted service event;
- canonical invoice and invoice line;
- actual requisition source mappings;
- deterministic outbox and command authority.

The guarded batch revalidates patient, visit, admission, prescriber, imaging item/type, active `RAD` department, linked service, current price, names, accession uniqueness and invoice non-existence. Every critical compatibility row is followed by a one-row financial assertion and all assertion rows are cleared before commit.

SQLite race tests prove complete rollback for current price, service-department, item/type, visit-patient, admission-patient and prescriber-activity changes.

## Production trigger parity

Production creates a `bill_created` accounting event through `trg_bills_insert_accounting_event` after a positive bill insert.

The strict adapter does not insert a competing legacy accounting event. Its production-parity SQLite fixture now installs the actual trigger shape and verifies:

- the strict transaction succeeds with exactly one trigger-created accounting event;
- the event key is `billing:1:bill_created`;
- payload source is `db_trigger`;
- no financial assertion residue remains;
- every guarded race rolls back the requisition, bill, invoice item, trigger-created event and assertion rows together.

The route also uses `skipBillAccountingEvent: financialExecution.mode === 'strict'`, preventing a duplicate application-side bill-created event while preserving commission and performer-reserve side effects.

## Canonical invoice-line authority correction

Adversarial review found a High-risk identity mismatch across both radiology routes.

`createRadiologyRequisitionBilling()` creates its deterministic invoice-line authority from:

```text
1:test:<billingServiceItemId>
```

The post-commit billing helper previously derived its source-line key from the legacy requisition ID. A strict bill with performer-reserve or commission rules could therefore fail to resolve the canonical invoice line after the financial transaction had already committed.

Both the primary RIS route and patient-chart radiology route now pass the strict-only `canonicalSourceLineId` built from the mapped `billingServiceItemId`. Legacy and shadow payloads remain unchanged. The primary route also passes the actual committed invoice-item ID in strict mode.

## Route and idempotency behavior

The create handler no longer contains requisition, bill, invoice-item or bill-link mutation SQL. It only:

1. reserves/replays the existing request idempotency key;
2. prepares adapter input;
3. executes the financial coordinator;
4. reloads actual committed requisition, bill and invoice-item identities;
5. runs existing post-commit behavior;
6. completes the same idempotency record and response.

The response remains:

```text
{id, accessionNo, billId, invoiceNo, total, message: "Requisition created"}
```

Legacy/shadow committed IDs are retained as compatibility fallbacks for non-persistent test doubles. Strict mode requires the actual committed invoice-item reload.

Domain validation keeps the historical 404 behavior. Strict concurrency or canonical-authority failures return a sanitized `409`.

## Governance

`FINANCIAL_ROUTE_COVERAGE['radiology.billing.create']` now records:

```text
status: integrated
canonicalCommand: createRadiologyRequisitionBilling
```

`bills` and `invoice_items` are registered legacy financial tables. Narrow compatibility allowances were added for `src/lib/canonical/radiology-order-billing.ts`.

The existing allowances for `src/routes/tenant/radiology/orders.ts` remain justified because the separate cancellation workflow in that file still updates `bills` and `invoice_items`. No unrelated writer was allowlisted and schema governance remains at zero issues.

## Adversarial review

Validated before the final gate:

1. strict preparation is lazy;
2. legacy free-text and zero-value success remains intact;
3. shadow canonical failure preserves `201` and records an issue;
4. strict missing mapping fails before sequence or mutation;
5. strict mapped authority commits guarded legacy and canonical rows in one batch;
6. patient, visit, admission and prescriber ownership/activity races roll back;
7. active imaging item/type and active `RAD` catalog authority are checked before sequence and during commit;
8. current price and minor-unit parity are checked;
9. accession and invoice conflicts fail closed;
10. actual requisition, bill and invoice-item identities are reloaded;
11. request-idempotency reserve/replay/completion shape remains;
12. production bill-insert trigger is transactionally compatible;
13. strict accounting event duplication is prevented;
14. strict canonical invoice-line identity matches commission/reserve projection;
15. no create-handler finalization mutation SQL remains;
16. no unresolved Critical or High finding remains.

Two High-risk findings were corrected during review:

- strict catalog authority did not initially require the linked service to belong to an active `RAD` department;
- radiology post-commit commission/reserve projection used a different canonical source-line identity from the radiology command.

## Fresh verification

### Focused CDB-115 gate

- 10 test files passed
- 71 tests passed

Coverage includes the RIS adapter, canonical command, patient-chart adapter, primary and patient-chart route contracts, primary accounting behavior, shadow isolation, financial coverage, billing gate and continuation contract.

### Full canonical gate

- 135 test files passed
- 947 tests passed

### Other gates

- TypeScript: passed
- Canonical schema governance: 0 issues
- Generated migration manifest: 468 migrations
- Web production build: passed
- Patient production build: passed
- Admin production build: passed
- Task worktree policy: passed
- `git diff --check`: passed

## Remaining work

The next registered runtime boundary is `reception.visit-billing.create`, followed by `settlement.finalize`.

This checkpoint does not claim production strict readiness.

## Current-main integration

The reviewed CDB-115 commits were replayed serially onto local `main` in the dedicated clean integration worktree at `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/main-governance-integration-20260723` without conflict.

Current-main replay commits:

- `3fbd9ddab` — design and implementation plan
- `fbfe28375` — original/strict RIS adapter
- `6c4a84216` — active Radiology catalog authority hardening
- `15606d41b` — primary RIS route integration
- `d432ea404` — route coverage and shadow isolation
- `0be3a6ca1` — production bills-trigger parity coverage
- `801d3f3cd` — strict radiology invoice-line authority alignment
- `7edc70784` — checkpoint documentation

Fresh current-main verification passed after replay:

- 10 focused files / 71 tests;
- 135 canonical files / 947 tests;
- TypeScript;
- zero-issue canonical governance;
- 468 generated migrations;
- integration worktree policy;
- `git diff --check`;
- web, patient and admin production builds.

## Production safety statement

No remote push, deployment, production migration, production backfill, feature-flag change, traffic change, tenant-data mutation, production observation, rollback or legacy retirement occurred. All implementation and verification were local to the isolated task worktree.
