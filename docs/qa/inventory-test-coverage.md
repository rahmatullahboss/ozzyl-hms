# Inventory Test Coverage Matrix

Date: 2026-07-10

## Command

Run the full inventory-focused suite with:

```bash
npm run test:inventory
```

This runs backend inventory route/unit tests and frontend inventory page tests in one command.

## Current verified coverage

Latest verified run:

- Backend inventory/reagent/cancellation suite: 82 test files, 553 tests passed
- Frontend inventory/reagent UX suite: 39 test files, 214 tests passed
- Total inventory-focused coverage run: 121 test files, 767 tests passed

## Backend areas covered

- Master data: items, item categories/UOM settings, vendors, stores, locations
- Procurement: purchase requests, RFQ, purchase orders, fiscal year sequencing
- Receiving: goods receipt, opening stock import, item/vendor import/export
- Stock control: stock overview, stock ledger, reorder, dashboard batching
- Movement: requisitions, dispatch, FIFO dispatch, transfer FIFO, returns
- Safety: over-dispatch prevention, duplicate opening stock prevention, invalid CSV rows
- Adjustments: adjustment requests, counts, write-off, return-to-vendor
- Traceability: QR, reservations, donations, fixed assets
- Reports/accounting: inventory reports, edge-case reports, inventory accounting
- Bridges: lab reagent bridge, OT inventory adapter, pharmacy bridge
- Reagent integrity: per-mapping retry progress, canonical projection backfill, atomic legacy usage, reconciliation and manager-only route access
- Request atomicity: whole-request rollback across header, stock, lines, ledger, audit, billing and demand writes
- Replay safety: API/UI/lab/OT/consumption-event idempotency, payload mismatch detection and journal recovery
- Operational diagnostics: failed/stale operation listing and legacy partial-record classification
- Lot safety: shared QC/expiry/after-open/reserved-stock policy and mandatory reagent batch/expiry validation
- Receipt normalization: purchase-to-issue unit conversion, rejected quantity exclusion and reagent QC quarantine
- Goods-receipt atomicity: header, lines, canonical stock, ledger and PO status commit/rollback as one D1 batch
- Goods-receipt replay: payload-bound API/UI idempotency, mismatch rejection, projection repair and concurrent PO over-receipt guard
- Cancellation safety: source-linked, atomic, retry-safe multi-lot reagent reversal and reversed canonical issue lifecycle
- Cancellation saga: atomic invoice/bill/lab/visit/commission core, durable operation status, changed-payload rejection and post-core reversal recovery
- Exception control: repeated open reagent exceptions are deduplicated with occurrence tracking
- Readiness: canonical inventory plus unlinked legacy lots, onboard expiry and shortage aliases without mirror double-counting
- Billing policy: consistent billing-time behavior plus fail-closed strict activation until transactional billing-stock capability exists
- Intelligence: idempotent demand aggregation and not-configured status before real demand events exist
- Consumption automation: rules, events, queue, exceptions, posting, triggering, billing hook
- Coverage guard: every inventory backend route module must map to test files

## Frontend areas covered

- Every `web/src/pages/inventory/*.tsx` page must have a colocated test file.
- Inventory dashboard/report helper tests
- Stock list helper tests
- Write-off/return/report/quick-start/consumption automation helper tests
- Import/export onboarding UI tests for opening stock
- Admin inventory alerts, inventory analytics, inventory accounting pages
- Dedicated Reagent Control navigation, plain-language soft/strict policy summaries and action prioritization
- Progressive disclosure for test recipes, bulk tools, policy controls, stock setup and operation logs
- Action-oriented reagent issues, reconciliation mismatch presentation and production reason-code grouping
- Accessibility: tab roles, selected state, keyboard focus movement, labelled disclosures and mobile overflow
- Query loading guards and no policy mutation during page entry
- Reachability of advanced reagent catalog, full lab monitoring and machine settings

## Guardrail

`test/inventory-coverage-matrix.test.ts` fails when:

1. A new backend inventory route module is added without mapping tests.
2. A mounted inventory route is not represented in the coverage map.
3. A new inventory UI page is added without a colocated test.
4. A high-risk workflow category loses its test mapping.

This does not replace manual exploratory QA, but it prevents silent gaps in inventory regression coverage.
