# P04 Canonical Service Catalog Rehearsal

**Task:** CDB-040 — Create unified service catalog and effective pricing

**Date:** 2026-07-14

**Branch:** `task/cdb-040-service-catalog`

## Delivered

Migration `0426_canonical_service_catalog.sql` adds two additive, tenant-scoped authorities:

- `canonical_service_catalog_items`
- `canonical_service_prices`

Catalog items use stable public IDs, typed item kinds, optional tenant-scoped codes, explicit units, lifecycle status, and source-evidence hashes. Prices use integer minor units, explicit currency, typed contexts, UTC effective periods, restrictive foreign keys, and evidence hashes. Legacy service and price tables remain unchanged.

## Source-unit policy

Unit interpretation was derived from linked source evidence:

- billing and price-category REAL values: major BDT, exact conversion to minor units;
- laboratory integer price: major BDT;
- radiology `price_paisa`: minor units;
- consultation integer fee: major BDT;
- bed, procedure, and medicine REAL values: exact decimal conversion only.

No value is rounded. Values with more than two decimal places receive an ambiguous price mapping and an issue.

## Conflict policy

- Names alone never merge catalog items.
- Duplicate or cross-source codes never select a silent winner.
- Exact linked lab/radiology prices reuse the billing service and price.
- Linked price differences remain ambiguous.
- Overlapping price contexts remain ambiguous.
- Same bed type and exact rate may reuse one item and price; different rates remain conflicts.
- Missing units remain issues.
- Changed evidence on a previously mapped source creates an issue instead of rewriting canonical history.
- Failed or cancelled migration runs cannot be reused.

## Verification

Focused service-catalog tests cover schema constraints, price units, duplicate codes, linked-price conflicts, exact/inexact conversion, category overlap, consultation, bed, procedure, medicine, missing units, tenant isolation, evidence drift, rollback/resume, rerun idempotency, and terminal-run rejection.

- focused tests: `8` passed
- full canonical and migration tests: `15` files / `109` tests
- governance: `0` issues
- migration manifest: `436`
- TypeScript: `0` errors

## Source audit

Aggregate source counts:

- billing service items: `405`
- price-category rows: `368`
- laboratory tests: `207`
- radiology items: `154`
- consultation fees: `108`
- beds: `63`
- procedures: `0`
- medicines: `28`
- tenant scopes: `6`

Audit findings:

- duplicate billing-code groups: `61`
- duplicate billing-code rows: `122`
- linked laboratory rows: `147`; exact major-unit matches: `145`; conflicts: `2`
- linked radiology rows: `125`; exact minor-unit matches: `125`
- conflicting bed-rate groups: `2`
- missing medicine units: `3`
- inexact live-source decimal prices: `0`

No names, codes, patient data, or raw operational SQL is included here.

## Exact-snapshot rehearsal

Migration result:

- service tables: `2`
- migration-ledger entry: `1`
- pre-backfill FK violations: `0`

First pass across six tenants:

- source rows scanned: `1,333`
- items created: `641`
- prices created: `1,009`
- mappings created: `2,298`
- issue rows created: `70`

Second pass:

- source rows scanned: `1,333`
- items, prices, mappings, and issues created: `0`

Final state:

- catalog items: `641`
- prices: `1,009`
- item mappings: `965`
- price mappings: `1,333`
- issue rows: `70`
- issue occurrences: `138`
- mappings without evidence: `0`
- invalid money/currency rows: `0`
- FK violations: `0`

Issue classes:

- `SERVICE_BED_TYPE_PRICE_CONFLICT`: `2` rows / `9` occurrences
- `SERVICE_CODE_DUPLICATE`: `61` / `122`
- `SERVICE_LINKED_PRICE_CONFLICT`: `2` / `2`
- `SERVICE_PRICE_PERIOD_OVERLAP`: `2` / `2`
- `SERVICE_UNIT_MISSING`: `3` / `3`

These are explained source conflicts, not unexplained reconciliation variance.

## Rehearsal clone

Target UUID: `6f9a17af-8e3e-4b26-85b7-08c653a706db`

Pre-apply bookmark:

`00000015-00000000-000050a7-e50c3407066964ba1c39ca6e4feaf3ba`

`0426` applied successfully. No migration remained pending. The protected bundle contained `4,126` canonical insert statements, was `2,280,085` bytes, and had SHA-256:

`deedbc146202b6ba16a9a88864a30a5c514e52c68231389caaa06ff796b8be1c`

The clone imported `4,127` queries and reached:

`00000015-000002a5-000050a7-87433cde84364ccd047579089c566a90`

Final-code regeneration produced the same checksum, proving the clone contains the final implementation result. Remote counts matched the exact snapshot and FK violations remained zero.

Final read-only bookmark:

`00000016-00000000-000050a7-ed35e09bcc3c3b1c330bdfc7daef0942`

## Production boundary

Fresh production read-only verification showed:

- canonical tables: `0`
- migrations `0423` through `0426` recorded: `0`
- latest migration ID: `447`
- rows written: `0`

No production mutation, deployment, push, `main` merge, restore, or local-server activation occurred.

Protected rehearsal artifacts remain outside Git under the CDB-040 rehearsal directory.
