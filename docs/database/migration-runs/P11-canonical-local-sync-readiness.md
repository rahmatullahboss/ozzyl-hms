# P11 Canonical Local-Sync Readiness Verification

**Checkpoint:** CDB-110A

**Verified:** 2026-07-25T05:08:59+06:00

**Branch:** `program/cdb-main-continuous-20260725`

**Reviewed local-main base:** `6a932aa97d415f52a498165e2c53a49b83dd470a`

**Verified implementation head before this receipt:** `f19abe88b28b56fba7a211501f09f9fadb410d12`

## Result

Canonical public-ID local-server synchronization readiness is now explicit and fail closed. No local server was activated and no data was transferred.

The current repository result is:

```text
canonical sync entities: 8
ready: 0
blocked: 8
```

Every tracked aggregate has canonical table, stable public-ID migration evidence, and canonical outbox production evidence. All remain blocked because the local transport and apply protocol is incomplete.

## Tracked canonical aggregates

| Entity | Canonical table | Public ID | Canonical outbox evidence |
| --- | --- | --- | --- |
| `encounter` | `canonical_encounters` | `encounter_public_id` | present |
| `service_request` | `canonical_service_requests` | `request_public_id` | present |
| `service_event` | `canonical_service_events` | `event_public_id` | present |
| `invoice` | `canonical_invoices` | `invoice_public_id` | present |
| `payment_receipt` | `canonical_payment_receipts` | `receipt_public_id` | present |
| `deposit` | `canonical_deposits` | `deposit_public_id` | present |
| `compensation_accrual` | `canonical_compensation_accruals` | `accrual_public_id` | present |
| `inventory_movement` | `canonical_inventory_movements` | `movement_public_id` | present |

## Common blocked dimensions

All eight entities currently report:

- `LOCAL_CANONICAL_OUTBOX_CONSUMPTION_MISSING`;
- `CLOUD_CANONICAL_APPLY_MISSING`;
- `LOCAL_CANONICAL_APPLY_MISSING`;
- `VERSION_CONFLICT_POLICY_MISSING`;
- `TOMBSTONE_SUPPORT_MISSING`;
- `DEPENDENCY_ORDERING_MISSING`.

Canonical event creation is not the missing layer. The missing layer is the canonical sync transport, durable inbox/apply authority, conflict semantics, correction/tombstone semantics, and dependency-aware ordering.

## Existing sync audit

The existing local sync implementation remains unsafe for canonical activation:

| Audit | Result |
| --- | --- |
| Generic `entityId` transport | present |
| Legacy snapshot `SELECT *` | present |
| Snapshot `INSERT OR REPLACE` apply | present |
| Declared core outbox gaps | 8 |
| Declared numeric/entity mapping gaps | 7 |

Cloud pull currently transports whole table rows using table primary keys and applies them by replacement. Core legacy entities such as bills, invoice items, payments, deposits, visits, appointments, and admissions remain in that model. This is not equivalent to tenant-scoped canonical public-ID event synchronization.

## Registry and checker

CDB-110A added:

- `docs/database/canonical-local-sync-entity-registry.yaml`;
- `scripts/canonical/check-canonical-local-sync-readiness.ts`;
- `test/canonical/canonical-local-sync-readiness.test.ts`;
- package command `canonical:local-sync-readiness`.

The checker validates:

- unique entity types;
- exact migration table and public-ID column evidence;
- canonical outbox source evidence;
- internal and external dependencies;
- complete readiness booleans and blockers;
- stable readiness reasons;
- existing legacy sync blockers and declared gap counts.

It reads repository files only. It does not access a database, network, token, secret, or production environment.

## TDD receipt

- Initial suite failed with module-not-found.
- The blocked entity test established stable readiness reason order.
- A synthetic entity became ready only when all seven readiness dimensions were true and its blocker was empty.
- Missing public-ID migration evidence failed closed.
- Duplicate entity types and unknown dependencies failed closed.
- The real repository reported eight blocked and zero ready entities.

## Commits

- `281b815f` — CDB-110A design and implementation plan;
- `f19abe88` — canonical sync registry, local readiness checker, CLI, and tests.

These commits exist only on `program/cdb-main-continuous-20260725`. They were not merged or cherry-picked into local `main`.

The verified tracker, continuation contract, and this report were committed as `a943b6acb841d10e3822b6942829009b5776a69d` before the final metadata receipt.

## Verification

| Gate | Receipt |
| --- | --- |
| CDB-110A readiness suite | 1 file, 5 tests passed |
| Local-sync regression suite | 4 files, 20 tests passed |
| Full canonical suite | 144 files, 1,051 tests passed |
| Canonical governance | 0 issues |
| Legacy retirement readiness | 65 blocked, 0 eligible |
| Canonical local-sync readiness | 8 blocked, 0 ready |
| TypeScript | passed |
| Migration manifest | 470 migrations generated |
| Task worktree policy | passed |
| Web build | passed |
| Patient build | passed |
| Admin build | passed |

Expected SQLite experimental warnings and existing reviewed fixture/frontend warnings did not fail any gate.

## Continuation

CDB-110A readiness is complete. CDB-110 itself is not complete.

The next safe local slice is CDB-110B: implement an offline canonical sync envelope, durable inbox receipt model, deterministic dependency planner, replay/conflict rules, and tests without connecting routes or activating a server.

Activation remains prohibited until every entity is ready, disconnected rehearsal and recovery pass, and explicit owner authorization is received.

## Safety

No push, deployment, network request, cloud pull, outbox flush, production access, production mutation, local-server start, synchronization activation, feature-flag change, legacy write retirement, or local-main integration occurred. The dirty owner-facing checkout remained read-only.
