# Financial read consumer and shadow batch integration audit

Date: 2026-07-30

## Checkpoint

`CDB-V1-040B-FINANCIAL-READ-CONSUMER-AND-SHADOW-BATCH-INTEGRATION-VERIFIED`

## Scope completed

This checkpoint wires the invoice, payment and deposit providers from CDB-V1-040A through one shared legacy-default consumer boundary:

- `src/lib/canonical/financial-read-consumer-adapters.ts` assigns stable bounded consumer IDs for billing detail, report, dashboard, export, scheduled job and admin reads;
- `runFinancialReadShadowBatch` accepts at most 100 exact tenant-scoped records, rejects duplicate provider/consumer/source scopes, requires shadow mode with legacy selected, and fails closed on provider errors, missing evidence, missing exact mappings, latency breaches or unexplained variance;
- successful batch evidence contains only provider/consumer identity, exact source and Canonical row keys, deterministic variance IDs, elapsed time, latency budget, build SHA and legacy rollback mode;
- `GET /api/billing/:id/inspector` now crosses the invoice consumer adapter. Legacy remains the default projection, shadow remains legacy-selected while persisting evidence, and Canonical selection requires the separately governed provider flag;
- invoice legacy settlement normalization now includes active deposit applications in paid settlement while keeping cash paid and deposit applied separate in the inspector response.

No provider was enabled by this checkpoint.

## Local shadow evidence

A real SQLite/D1 local harness executed six bounded consumer scopes:

1. invoice / billing detail;
2. invoice / report;
3. payment / dashboard;
4. payment / export;
5. deposit / scheduled job;
6. deposit / admin.

All six reads retained `selectedProvider=legacy`, produced exact source and Canonical row keys, persisted six passed `canonical_reconciliation_runs` rows, recorded build SHA `cc5b5f41d`, emitted no variance IDs and retained immediate `rollbackMode=legacy`. The evidence contains no patient name, mobile, address or diagnosis data.

## Fail-closed rules verified

- empty or oversized batch;
- duplicate provider/consumer/source scope;
- provider execution failure;
- mode other than `shadow` or selected provider other than `legacy`;
- missing shadow evidence;
- missing exact Canonical mapping;
- deterministic unexplained money/status/count variance;
- latency budget breach, represented by the provider evidence as a critical variance.

## Deterministic repository state

- protected surfaces: 952;
- protected HTTP routes: 44;
- protected UI flows: 28;
- protected writers: 235;
- protected readers: 520;
- protected tables: 85;
- Canonical-command writers: 118;
- atomic-compatibility writers: 110;
- governed-external writers: 3;
- command-required writers: 0;
- isolated fixtures: 4;
- unclassified writers/readers: 0;
- remaining implementation groups: 0;
- repository access evidence: 1,032 writers and 2,703 readers;
- identity/episode coverage: 849 readers, 296 paths and 63 tables;
- provider boundaries: 9 existing and 9 contract-only.

## Safety boundary

This checkpoint did not query or mutate production, apply a migration or backfill, enable a provider, change traffic, deploy, activate local sync, push the branch or integrate CDB into main. The local SQLite shadow run is test evidence only and is not protected-clone or production authorization.

## Verification

- focused provider, consumer and invoice-inspector suite: 3 files / 16 tests / 0 failures;
- combined focused and protected-core continuity suite: 7 files / 37 tests / 0 failures;
- root TypeScript: passed;
- governed migration manifest: 504 migrations;
- full `canonical:check`: passed with zero governance issues.

## Next bounded checkpoint

`CDB-V1-040C-REMAINING-CRITICAL-READ-PROVIDER-INTEGRATION`

Wire the remaining patient/practitioner, Reception episode and practitioner-compensation critical readers through legacy-default providers and prepare a separately authorized protected-clone comparison package. Production reads and provider activation remain unauthorized.
