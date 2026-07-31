# P11 Canonical Outbox-to-Envelope Conversion Verification

**Checkpoint:** CDB-110D

**Verified:** 2026-07-25T06:51:18+06:00

**Branch:** `program/cdb-main-continuous-20260725`

**Worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`

**Reviewed local-main base:** `6a932aa97d415f52a498165e2c53a49b83dd470a`

**Verified implementation head before this receipt:** `462c839bb1c6cd8f2ff2e3e3f05f81be832db07f`

## Result

CDB-110D added a deterministic, read-only adapter that converts one exact canonical outbox row into a validated CDB-110B sync envelope. It does not claim, update, publish, acknowledge, retry, cancel, or dead-letter the source event; it does not insert into the sync inbox; and it does not register a route, worker, network transport, or local-server process.

The converter verifies:

- exact tenant/event source identity;
- reviewed aggregate/event mapping;
- event-schema version;
- convertible source status;
- direct-event or command-envelope payload shape;
- payload aggregate identity;
- deterministic aggregate sequence;
- canonical dependency authority;
- stable public-ID protocol semantics;
- deterministic digest and idempotency evidence.

The real readiness result remains truthful:

```text
canonical sync entities: 8
ready: 0
blocked: 8
protocol foundation: verified_offline
inbox lifecycle: verified_offline
outbox conversion: verified_offline
runtime consumption connected: false
business apply connected: false
```

## Event allowlist

The converter exposes a machine-checkable exact allowlist covering eight aggregate types and seventeen event mappings.

| Source aggregate | Sync entity | Event | Operation |
| --- | --- | --- | --- |
| `canonical_encounter` | `encounter` | `canonical.encounter.started` | `upsert` |
| `canonical_encounter` | `encounter` | `canonical.encounter.completed` | `upsert` |
| `canonical_service_request` | `service_request` | `canonical.service_request.created` | `upsert` |
| `canonical_service_event` | `service_event` | `canonical.service_event.recorded` | `upsert` |
| `canonical_invoice` | `invoice` | `canonical.invoice.issued` | `upsert` |
| `canonical_invoice` | `invoice` | `canonical.invoice.cancelled` | `tombstone` |
| `canonical_payment_receipt` | `payment_receipt` | `canonical.payment.receipt.posted` | `upsert` |
| `canonical_payment_receipt` | `payment_receipt` | `canonical.payment.receipt.pending` | `upsert` |
| `canonical_payment_receipt` | `payment_receipt` | `canonical.payment.receipt.failed` | `upsert` |
| `canonical_payment_receipt` | `payment_receipt` | `canonical.payment.reversed` | `tombstone` |
| `canonical_deposit` | `deposit` | `canonical.deposit.recorded` | `upsert` |
| `canonical_deposit` | `deposit` | `canonical.deposit.applied` | `upsert` |
| `compensation_accrual` | `compensation_accrual` | `canonical.compensation.accrued` | `upsert` |
| `compensation_accrual` | `compensation_accrual` | `canonical.compensation.adjusted` | `upsert` |
| `compensation_accrual` | `compensation_accrual` | `canonical.compensation.performer-reserve.accrued` | `upsert` |
| `canonical_inventory_movement` | `inventory_movement` | `canonical.inventory.stock_movement.recorded` | `upsert` |
| `canonical_inventory_movement` | `inventory_movement` | `canonical.inventory.movement.posted` | `upsert` |

Every supported row must use `event_version = 1`. New event-schema versions or event types fail closed until explicitly reviewed.

## Aggregate version authority

`canonical_outbox_events.event_version` is an event-schema version, not aggregate sequence authority. CDB-110D therefore derives sync `aggregateVersion` from exact committed source order:

```text
count of canonical_outbox_events rows
for the same tenant + aggregate type + aggregate public ID
whose source outbox id is less than or equal to the selected row id
```

Before accepting the rank, the converter proves every predecessor/current row is an allowlisted event with schema version 1. An unsupported predecessor fails closed instead of producing a remote version sequence that cannot be explained.

Tests prove:

- the first event is version 1;
- the second event is version 2 even when both event-schema versions are 1;
- equal occurrence timestamps still follow committed source row order;
- other tenants and aggregates do not affect the rank;
- source numeric row IDs are never exposed in protocol output.

## Payload normalization

Two current source payload forms are supported:

1. direct canonical event objects;
2. `runCanonicalBatch()` command envelopes with `schemaVersion = 1` and the event under `event`.

Malformed JSON, null/array payloads, unsupported command-envelope schemas, invalid command metadata, and non-plain event objects fail closed.

For every mapped event, the expected aggregate identity field must equal `aggregate_public_id`:

- `encounterPublicId`;
- `requestPublicId`;
- `eventPublicId`;
- `invoicePublicId`;
- `receiptPublicId`;
- `depositPublicId`;
- `accrualPublicId`;
- `movementPublicId`.

## Dependency authority

Dependencies are read from canonical tables or exact reviewed payload fields; legacy numeric IDs are not used.

| Entity | Dependency evidence |
| --- | --- |
| Encounter | no internal protocol dependency |
| Service request | `canonical_service_requests.encounter_public_id` |
| Service event | request and encounter from `canonical_service_events` |
| Invoice | optional encounter plus every referenced invoice-line service event |
| Payment receipt | every allocated invoice from `canonical_payment_allocations` |
| Deposit recorded | payment receipt from exact payload `receiptPublicId` |
| Deposit applied | invoice from exact payload `invoicePublicId` |
| Compensation accrual | invoice and optional service event from canonical accrual authority |
| Inventory movement | optional invoice and service event from canonical movement authority |

Dependencies are sorted and deduplicated with minimum version 1. Missing authority and conflicting dependency evidence fail closed.

## Source status and read-only proof

Conversion is allowed for `pending`, `processing`, `published`, and `retry` rows. `cancelled` and `dead_letter` source rows are rejected.

Tests snapshot all outbox delivery columns before and after repeated conversion and prove they are unchanged. They also prove no sync inbox row is created. Repository reference audit found no route, worker, scheduler, or runtime caller for the converter.

## TDD receipts

- The first focused test failed with module-not-found.
- Direct and command-envelope normalization, source validation, rank sequencing, all eight dependency families, tombstone mapping, deterministic replay evidence, and read-only behavior were implemented from the failing contract.
- The converter suite initially passed 12 tests.
- An additional governance test then locked exact coverage to eight aggregate types, seventeen unique event mappings, and two tombstone mappings.
- Real migration/schema and producer audits confirmed the queried dependency columns and reviewed event variants match current canonical authority.

## Checkpoint commits

- `a7b97fe9` — CDB-110D design and implementation plan;
- `462c839b` — offline canonical outbox-to-envelope converter and focused tests.

These commits exist only on `program/cdb-main-continuous-20260725`. They were not merged or cherry-picked into local `main`.

The verified tracker, registry evidence, continuation contract, allowlist governance, and this report were committed as `87f842c2a471478cc46fe9d18dfa025067f29369` before the final metadata receipt.

## Verification receipt

| Gate | Receipt |
| --- | --- |
| Converter suite | 1 file, 13 tests passed |
| Focused converter/protocol/inbox/readiness/local-sync suite | 6 files, 50 tests passed |
| Full canonical suite | 149 files, 1,096 tests passed |
| Canonical governance | 0 issues |
| Legacy retirement readiness | 65 blocked, 0 eligible |
| Canonical local-sync readiness | 8 blocked, 0 ready |
| Event allowlist | 8 aggregate types, 17 mappings, 2 tombstones |
| TypeScript | `pnpm exec tsc --noEmit` passed |
| Migration manifest | 472 migrations generated |
| Task worktree policy | passed with task-owned receipt changes |
| Web production build | passed |
| Patient production build | passed |
| Admin production build | passed |

Expected SQLite experimental warnings, the reviewed financial-shadow fixture warning, the reviewed settlement legacy fallback warning, patient chunk-size warning, and existing Vite deprecation warnings did not fail any gate.

## Branch relationship

Before this receipt:

```text
main HEAD: 6a932aa97d415f52a498165e2c53a49b83dd470a
CDB HEAD: 462c839bb1c6cd8f2ff2e3e3f05f81be832db07f
main...CDB: 0 / 25
```

Local `main` did not advance during CDB-110D, so no `main → CDB` synchronization commit was required. No CDB commit flowed to `main`.

## Continuation

The next safe local slice is CDB-110E: implement entity-specific canonical business apply handlers offline, using exact public-ID payload contracts and CDB-110C atomic applied receipts, without route registration or transport activation.

CDB-110 remains incomplete until entity-specific cloud/local apply, source claiming/publication, transport wiring, disconnected rehearsal and recovery, and explicit owner activation authorization are complete.

## Safety

No push, deployment, production access, production mutation, network request, source outbox mutation, outbox claim/publication, sync inbox insertion, route registration, scheduled worker, local-server start, synchronization activation, feature-flag change, legacy-write retirement, or local-main integration occurred. The dirty owner-facing checkout remained read-only and untouched.
