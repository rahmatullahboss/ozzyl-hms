# CDB-V1-040A Financial Read Provider Foundation

Date: 2026-07-29  
Branch: `program/cdb-main-continuous-20260725`  
Worktree: `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`

## Checkpoint

`CDB-V1-040A-FINANCIAL-READ-PROVIDER-FOUNDATION-VERIFIED`

This checkpoint implements the first bounded slice of `CDB-V1-040-CANONICAL-READ-PROVIDERS-AND-SHADOW-COMPARISON`. It makes invoice, payment/allocation and patient-deposit read providers available as repository code. It does not switch any production or application consumer to Canonical reads.

Implemented provider boundaries:

- `canonical_invoice_provider_v1` — `src/lib/canonical/contracts/invoice-provider.ts`;
- `canonical_payment_provider_v1` — `src/lib/canonical/contracts/payment-provider.ts`;
- `canonical_deposit_provider_v1` — `src/lib/canonical/contracts/deposit-provider.ts`.

Shared provider and evidence infrastructure:

- `src/lib/canonical/financial-read-provider.ts`.

## Provider behaviour

All three providers support `legacy`, `shadow` and `canonical` modes from tenant-scoped `canonical_feature_flags`.

- missing, disabled or unknown flags resolve to `legacy`;
- `shadow` returns the legacy projection while reading and comparing the exact mapped Canonical projection;
- `canonical` returns the Canonical projection only when one exact tenant-scoped source mapping and one exact Canonical row exist;
- changing the flag back to `legacy` is the immediate rollback;
- no provider flag is enabled by repository work.

Exact mapping uses `canonical_source_mappings`:

- invoice: `invoice / legacy_live_bill / invoice number`;
- payment: `payment_receipt / legacy_live_payment / receipt number`;
- deposit: `deposit / legacy_live_deposit / deposit number`.

The providers fail closed on ambiguous or missing mappings in Canonical mode and never search another tenant for a matching display number.

## Exact financial comparison

Legacy decimal amounts are converted once to integer BDT minor units. Canonical values must already be safe integers.

Invoice evidence compares:

- exact invoice number and mapped Canonical public ID;
- document and settlement status;
- total, paid and due minor units;
- active line count;
- `paid_minor + due_minor = total_minor`.

Payment evidence compares:

- exact receipt number and mapped receipt public ID;
- status;
- total, allocated and unallocated minor units;
- tender and allocation counts;
- `allocated_total_minor + unallocated_minor = total_minor`.

Deposit evidence compares:

- exact deposit number and mapped deposit public ID;
- status;
- original, applied, refunded and available minor units;
- active application count;
- `applied_minor + refunded_minor + available_minor = amount_minor`.

## Persisted shadow evidence

Shadow comparisons are persisted in existing `canonical_reconciliation_runs`; no new migration is required. Each deterministic run records:

- provider and consumer IDs;
- exact source and Canonical row keys;
- legacy and Canonical status;
- row counts and integer minor-unit totals;
- elapsed time and latency budget;
- deterministic variance classes and IDs;
- build SHA and observation timestamp;
- rollback mode `legacy`;
- SHA-256 evidence hash.

Evidence summaries exclude patient names, mobile numbers, addresses, diagnoses and other free-text PHI.

## Governance result

The frozen authority contract now records the three finance provider boundaries as `existing`, while retaining:

- modes: `legacy | shadow | canonical`;
- default mode: `legacy`;
- rollback mode: `legacy`;
- production enabled: `false`;
- activation requires separate authorization: `true`.

Provider-boundary summary:

- 9 existing provider boundaries;
- 9 contract-only provider boundaries.

Regenerated deterministic repository state:

- 951 protected surfaces;
- 235 protected writers;
- 519 protected readers;
- 85 protected tables;
- 118 Canonical-command writers;
- 110 atomic-compatibility writers;
- 3 governed-external writers;
- 0 strict-blocked writers;
- 0 command-required writers;
- 4 isolated fixtures;
- 0 unclassified writers;
- 0 implementation groups;
- repository access evidence: 1,032 writers and 2,702 readers.

## Verification

- pre-sync focused provider and continuity suite: 5 files / 27 tests / 0 failures;
- first synchronized main source: `757c6ebc3ed8ae07d989f84a783a7f1faaf8e275`;
- first main-to-CDB merge: `f6918401f`;
- first post-sync backend/CDB suite: 6 files / 40 tests / 0 failures;
- first post-sync web billing suite: 4 files / 169 tests / 0 failures;
- latest synchronized main source: `f11f09f3526ea453632951455c73c727568dbfdb`;
- latest main-to-CDB merge: `1e669b7c6`;
- latest post-sync CDB suite: 5 files / 27 tests / 0 failures;
- latest post-sync dashboard accessibility suite: 6 files / 35 tests / 0 failures;
- root and web TypeScript: passed;
- governed migration manifest: 504 migrations;
- full `canonical:check`: passed with zero governance issues.

## Explicit incomplete scope

This checkpoint does not yet:

- wire billing routes, dashboard cards, reports, exports, scheduled jobs or admin tools to these provider functions;
- run a bounded protected-clone batch across real tenant data;
- implement credit/refund, compensation, cash-custody or reporting-metric providers;
- authorize Canonical read promotion.

## Next checkpoint

`CDB-V1-040B-FINANCIAL-READ-CONSUMER-AND-SHADOW-BATCH-INTEGRATION`

Wire invoice, payment and deposit providers into bounded protected consumers through legacy-default adapters, include dashboards/reports/exports where applicable, and produce a local or separately authorized protected-clone shadow batch with exact row keys, statuses, minor-unit totals, deterministic variance IDs, latency evidence and immediate rollback.

Production queries, provider activation, deployment, traffic change, migration/backfill, destructive retirement, push and CDB-to-main integration remain unauthorized.
