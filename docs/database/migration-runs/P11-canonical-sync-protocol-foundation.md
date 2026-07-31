# P11 Canonical Sync Protocol Foundation Verification

**Checkpoint:** CDB-110B

**Verified:** 2026-07-25T05:36:17+06:00

**Branch:** `program/cdb-main-continuous-20260725`

**Worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`

**Reviewed local-main base:** `6a932aa97d415f52a498165e2c53a49b83dd470a`

**Verified implementation head before this receipt:** `e5eb08251f3bd705cbc56a6632744aed019f9f12`

## Result

CDB-110B added an offline canonical synchronization protocol foundation without connecting it to an HTTP route, Worker transport, local-server process, cloud endpoint, or canonical business-table apply path.

Implemented foundations:

- a versioned tenant-scoped envelope using stable public IDs;
- stable canonical JSON payload hashing and deterministic idempotency;
- replay, semantic conflict, version-gap, tombstone, and dependency semantics;
- deterministic dependency-aware apply planning;
- additive durable inbox, dependency, and applied-version evidence tables;
- fail-closed protocol validation and persistence constraints.

This checkpoint does not claim runtime synchronization readiness. The CDB-110A result remains truthful:

```text
canonical sync entities: 8
ready: 0
blocked: 8
```

## Protocol envelope

`src/lib/canonical/local-sync-protocol.ts` defines:

- `protocolVersion: 1`;
- tenant identity;
- stable event and aggregate public IDs;
- event and entity types;
- positive aggregate versions;
- `upsert` and `tombstone` operations;
- UTC occurrence timestamp;
- stable source-node public ID;
- canonical payload plus lowercase SHA-256 digest;
- exact sorted dependency evidence;
- deterministic semantic idempotency key.

Raw numeric event, entity, dependency, and source-node database IDs are rejected. Numeric-text HMS tenant IDs such as `"100"` remain valid because tenant identity is a tenant scope, not an internal row identity.

Payloads use the existing canonical stable-JSON rules. Object-key order does not change payload digests or idempotency keys. Invalid values, unsupported operations, invalid UTC timestamps, duplicate dependency scopes, and self-dependencies fail closed.

## Apply planning

The pure planner receives validated envelopes and current applied entity-version evidence. It performs no database or network access.

It returns:

- `ready` envelopes in deterministic dependency order;
- `replay` envelopes for identical duplicate or already-applied evidence;
- `blocked` envelopes with stable `VERSION_GAP` and `DEPENDENCY_MISSING` reasons.

It fails closed for:

- mixed tenant input;
- duplicate event IDs with different semantics;
- duplicate entity/version authority;
- historical events inconsistent with applied evidence;
- same version with different event or payload;
- actionable dependency cycles.

Version-gapped circular inputs are not falsely classified as actionable cycles. They remain blocked with version and dependency reasons until predecessors exist.

`tombstone` is treated as a correction protocol operation. It does not instruct the planner to perform a physical delete.

## Durable persistence

Migration `0541_canonical_local_sync_protocol.sql` adds:

- `canonical_sync_inbox_events`;
- `canonical_sync_inbox_dependencies`;
- `canonical_sync_entity_versions`.

The migration is additive and registered in both the Drizzle canonical schema module and canonical source-of-truth registry.

Persistence constraints cover:

- tenant-scoped inbox, event, and idempotency uniqueness;
- protocol version `1`;
- positive aggregate and dependency versions;
- allowed inbox statuses and operations;
- non-negative attempt counts;
- valid canonical JSON payload text;
- lowercase 64-character payload, idempotency, and error digests;
- stable nonnumeric public IDs;
- UTC evidence timestamps ending in `Z`;
- exact dependency uniqueness and tenant-scoped inbox foreign-key lineage;
- non-negative applied entity versions and consistent last-event evidence.

The migration manifest increased from 470 to 471 migrations.

## Adversarial hardening

Review identified and fixed these issues before final verification:

1. The first schema draft allowed arbitrary nonempty idempotency keys instead of protocol SHA-256 evidence.
2. The first schema draft did not validate JSON payload text.
3. The first schema draft allowed raw numeric public IDs and weak timestamp evidence.
4. Initial cycle detection could classify version-gapped circular input as a dependency cycle.

Tests now prove all four cases fail or classify correctly.

## Registry state

`docs/database/canonical-local-sync-entity-registry.yaml` records:

```text
protocol foundation: verified_offline
runtime consumption connected: false
business apply connected: false
```

All eight aggregate entries advance their implementation task to CDB-110C. Their readiness booleans remain false because protocol code alone does not provide durable runtime claims, retries, outbox consumption, or canonical business-table apply.

## Checkpoint commits

- `6efba585f` — CDB-110B design and serial implementation plan;
- `35be486e5` — additive canonical sync protocol schema and governance registration;
- `f5a48510c` — offline envelope, replay/conflict, version, and dependency planner;
- `e5eb08251` — adversarial persistence and cycle-classification hardening.

These commits exist only on `program/cdb-main-continuous-20260725`. They were not merged or cherry-picked into local `main`.

The verified tracker, registry evidence, continuation contract, and this report were committed as `d59d77b3c170b4cd6dbd1db2bb4c0b4111411e11` before the final metadata receipt.

## Verification receipt

| Gate | Receipt |
| --- | --- |
| Protocol schema suite | 1 file, 4 tests passed |
| Protocol logic suite | 1 file, 11 tests passed |
| Combined sync regression suite | 6 files, 35 tests passed |
| Full canonical suite | 146 files, 1,066 tests passed |
| Canonical governance | 0 issues |
| Legacy retirement readiness | 65 blocked, 0 eligible |
| Canonical local-sync readiness | 8 blocked, 0 ready |
| TypeScript | `pnpm exec tsc --noEmit` passed |
| Migration manifest | 471 migrations generated |
| Task worktree policy | passed, clean before receipt edits |
| Web production build | passed |
| Patient production build | passed |
| Admin production build | passed |

Expected SQLite experimental warnings, reviewed legacy/shadow fixture warnings, and existing frontend chunk/deprecation warnings did not fail any gate.

## Branch relationship

Before this receipt:

```text
main HEAD: 6a932aa97d415f52a498165e2c53a49b83dd470a
CDB HEAD: e5eb08251f3bd705cbc56a6632744aed019f9f12
main...CDB: 0 / 16
```

Local `main` did not advance during CDB-110B, so no `main → CDB` synchronization commit was required. No CDB commit flowed to `main`.

## Continuation

The next safe slice is CDB-110C: offline durable inbox receipt insertion, claim/retry/dead-letter state transitions, and atomic applied-version receipt generation without route registration or server activation.

CDB-110 remains incomplete until canonical outbox consumption, symmetric cloud/local canonical business apply, recovery rehearsal, and explicit activation authorization are complete.

## Safety

No push, deployment, network request, cloud pull, outbox flush, route activation, local-server start, production access, production mutation, feature-flag change, legacy-write retirement, or local-main integration occurred. The dirty owner-facing checkout remained read-only.
