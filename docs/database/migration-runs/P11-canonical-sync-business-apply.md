# P11 Canonical Sync Business Projection and Apply Verification

**Checkpoint:** CDB-110E

**Verified:** 2026-07-25T17:05:00+06:00

**Branch:** `program/cdb-main-continuous-20260725`

**Worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`

**Reviewed local-main base:** `f42f83ef858284f3adf42359aad9d760ee593e79`

**Verified implementation head before this receipt:** `a954cab31`

## Result

CDB-110E now provides authenticated offline business projection and atomic target apply for all eight reviewed canonical sync entity families:

1. encounter;
2. service request;
3. service event;
4. invoice;
5. payment receipt;
6. deposit;
7. compensation accrual;
8. inventory movement.

The implementation remains offline-only. It does not claim or publish source outbox rows, deliver envelopes over a network, register a route, start a worker, schedule a job, activate local sync, retire legacy writes, or mutate production.

The real readiness result remains intentionally blocked:

```text
canonical sync entities: 8
ready: 0
blocked: 8
protocol foundation: verified_offline
inbox lifecycle: verified_offline
outbox conversion: verified_offline
business apply: verified_offline
runtime consumption connected: false
business apply connected: false
```

Invoice cancellation and payment reversal tombstones are verified offline. The other entity families remain blocked on tombstone semantics in addition to source consumption. Every entity remains blocked on source outbox consumption and runtime orchestration.

## Authenticated business payload

`src/lib/canonical/local-sync-business-payload.ts` defines a versioned business payload whose digest is bound into the canonical sync envelope. Validation rejects:

- event/mutation kind mismatches;
- public-ID mismatches;
- malformed dates, timestamps, currencies, hashes, enums, and integer values;
- invoice amount or status arithmetic that does not reconcile;
- payment reversal/refund balance tampering;
- compensation accrual or adjustment arithmetic/status tampering;
- inventory direction, conversion, signed quantity, balance, version, transfer, or invoice-link tampering.

The target never reconstructs authority from current mutable source state. The source-side projector reads immutable canonical facts and places the exact transition evidence inside the authenticated envelope.

## Source-side projection

`src/lib/canonical/local-sync-business-projector.ts` projects reviewed event-time authority for:

- encounter start/completion;
- service-request creation;
- service-event recording;
- invoice issue/cancellation;
- payment receipt posted/pending/failed;
- payment reversal plus refund;
- deposit record/application;
- compensation accrual/adjustment;
- inventory movement and event-time balance version.

Projection fails closed when immutable source facts, dependencies, event identity, business date, occurrence time, evidence hashes, guards, or before/after balances do not match the selected outbox event.

## Target-side apply

`src/lib/canonical/local-sync-business-apply.ts` applies each reviewed mutation with public-ID authority and guarded SQL. Important boundaries include:

- patient, encounter, service-catalog, request, event, invoice, practitioner, rule, item, location, and lot dependencies;
- immutable invoice lines, tenders, allocations, refunds, reversals, compensation adjustments, and inventory movements;
- exact compare-and-swap before/after balances;
- aggregate version progression by exactly one;
- negative-stock policy enforcement;
- duplicate source-fact rejection;
- compensation settlement guard during payment reversal;
- idempotent operation-step guards.

Business mutation statements, operation-step assertions, entity-version advancement, and the inbox `applied` receipt are submitted through one `db.batch()` transaction.

## Atomic completion proof

`test/canonical/canonical-sync-business-completion.test.ts` proves the complete transaction boundary:

- successful business mutation, entity version, and applied receipt commit together;
- expired claim rolls back every layer;
- aggregate-version gap rolls back an otherwise valid business mutation;
- business assertion failure leaves version and applied receipt untouched;
- authenticated semantic tampering is rejected before the business batch runs;
- no route, worker, scheduler, or runtime consumer references the offline apply module.

## Registry and readiness truthfulness

`docs/database/canonical-local-sync-entity-registry.yaml` records:

- offline cloud/local business apply capability for all eight entities;
- version conflict policy and dependency ordering for all eight entities;
- invoice/payment tombstone support;
- `businessApplyStatus: verified_offline`;
- `runtimeConsumptionConnected: false`;
- `businessApplyConnected: false`.

The readiness checker validates the implementation and evidence paths but does not convert offline capability into activation readiness. Current blockers remain:

- `LOCAL_CANONICAL_OUTBOX_CONSUMPTION_MISSING` for all eight entities;
- `TOMBSTONE_SUPPORT_MISSING` for encounter, service request, service event, deposit, compensation accrual, and inventory movement;
- source claim/publication, delivery transport, automatic claim/apply orchestration, recovery rehearsal, and owner activation authorization are not implemented.

## Checkpoint commits

- `dccc9e800` — CDB-110E design and implementation plan;
- `9d46e4903` — clinical sync business apply;
- `7b1292864` — invoice sync business apply;
- `6f0a7cf0b` — invoice cancellation sync business apply;
- `2df9b7729` — payment, deposit, and payment-reversal sync business apply;
- `1826e880c` — conflict-free local `main` to CDB synchronization;
- `a954cab31` — compensation and inventory sync business apply;
- `6f56824e` — atomic completion, readiness, tracker, and verification evidence.

These commits exist only on `program/cdb-main-continuous-20260725`. No CDB commit was merged or cherry-picked into local `main`.

## Verification receipt

| Gate | Receipt |
| --- | --- |
| Focused CDB-110E integration | 15 files, 104 tests passed |
| Atomic completion proof | 1 file, 6 tests passed |
| Full canonical suite | 160 files, 1,155 tests passed |
| TypeScript | `pnpm exec tsc --noEmit` passed |
| Canonical governance | 0 issues |
| Canonical local-sync readiness | 8 blocked, 0 ready; business apply verified offline |
| Legacy retirement readiness | 65 blocked, 0 eligible |
| Migration manifest | 472 migrations generated |
| Web production build | passed |
| Patient production build | passed |
| Admin production build | passed |

Expected SQLite experimental warnings, the reviewed financial-shadow fixture warning, the reviewed settlement legacy fallback warning, patient chunk-size warning, and existing Vite deprecation warnings did not fail any gate.

## Branch relationship

Before this receipt:

```text
main HEAD: f42f83ef858284f3adf42359aad9d760ee593e79
CDB implementation HEAD: a954cab31
main...CDB: 0 / 34
```

The CDB branch contains the latest local `main` through merge commit `1826e880c`. The dirty owner-facing root checkout remained read-only and untouched.

## Continuation

The next safe local scope is an offline CDB-110F audit and design for source canonical-outbox claiming/publication lifecycle. It must remain separate from delivery transport and runtime activation.

CDB-110 remains incomplete until source claiming/publication, delivery transport, automatic claim/apply orchestration, disconnected recovery rehearsal, remaining tombstone semantics, legacy-write retirement evidence, production observation, and explicit owner activation authorization are complete.

## Safety

No push, deployment, production access, production mutation, network request, source outbox mutation, source claim/publication, sync transport, route registration, scheduled worker, local-server start, synchronization activation, feature-flag change, legacy-write retirement, or CDB-to-main integration occurred.
