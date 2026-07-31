# CDB-110A Canonical Local-Sync Readiness Design

## Status

Approved local-only continuation design. This checkpoint does not activate a local server, contact a cloud endpoint, or move data.

## Goal

Replace assumption-based local-server readiness with a fail-closed, machine-checkable contract proving whether each core canonical aggregate is safe for bidirectional synchronization by stable public ID.

## Audit findings

The existing sync stack is not canonical-public-ID complete:

- local outbox events accept generic `entityType` plus `entityId`, including legacy integer IDs;
- patient synchronization uses a local-ID to cloud-ID mapping table because independent SQLite integer namespaces are not interchangeable;
- core billing/admission entities are explicitly listed as local outbox and ID-mapping gaps;
- cloud pull exports `SELECT *` table snapshots and applies them with `INSERT OR REPLACE` using the table primary key;
- default pull coverage includes legacy `bills`, `invoice_items`, `payments`, deposits, admissions, visits, and appointments;
- the current cloud apply registry contains only a small set of patient, doctor-round, and medicine entities;
- the pull protocol has no canonical aggregate version, durable tombstone, dependency graph, or explicit conflict policy.

The canonical program already provides stable public IDs and `canonical_outbox_events`, but the local sync transport does not consume that authority.

## Core synchronization aggregates

CDB-110A tracks these eight canonical aggregates:

| Entity | Canonical table | Public ID | Dependency class |
| --- | --- | --- | --- |
| `encounter` | `canonical_encounters` | `encounter_public_id` | root care event |
| `service_request` | `canonical_service_requests` | `request_public_id` | encounter dependent |
| `service_event` | `canonical_service_events` | `event_public_id` | request/encounter dependent |
| `invoice` | `canonical_invoices` | `invoice_public_id` | encounter/service dependent |
| `payment_receipt` | `canonical_payment_receipts` | `receipt_public_id` | invoice dependent |
| `deposit` | `canonical_deposits` | `deposit_public_id` | patient/receipt dependent |
| `compensation_accrual` | `canonical_compensation_accruals` | `accrual_public_id` | invoice/service dependent |
| `inventory_movement` | `canonical_inventory_movements` | `movement_public_id` | item/location dependent |

## Readiness dimensions

Each registry entry records and validates:

- canonical table and public-ID column;
- expected canonical aggregate type;
- required dependency entities;
- canonical outbox production status;
- local canonical outbox consumption status;
- cloud canonical apply status;
- local canonical apply status;
- version/conflict policy status;
- tombstone/delete status;
- dependency-ordering status;
- current blocker and implementation task.

An entity is ready only when every readiness boolean is true.

## Required protocol

The future canonical sync protocol must use:

- tenant-scoped stable public IDs as the entity identity;
- `event_public_id` and event version for replay and ordering;
- deterministic idempotency keys;
- explicit aggregate version or optimistic conflict token;
- durable inbox receipts before apply;
- immutable/tombstone correction semantics instead of destructive remote deletion;
- dependency-aware application order;
- exact allowlisted payload schemas, never generic `SELECT *` row transport;
- fail-closed unsupported entity handling;
- bounded retries and poison/dead-letter evidence;
- no cross-tenant mappings or numeric-ID equivalence assumptions.

## Existing legacy sync disposition

The current generic local sync routes remain available only as historical/offline code. CDB-110A must not broaden their coverage or activate them.

The following are explicit blockers:

- legacy snapshot pull with `INSERT OR REPLACE`;
- generic numeric/local entity IDs;
- missing core outbox emitters;
- missing canonical cloud/local apply mappers;
- no tombstones;
- no version conflict contract;
- no dependency ordering.

## Checker behavior

A local-only checker reads the canonical sync registry and repository source/migrations. It validates:

- every registry entity is unique;
- every canonical table and public-ID column appear in a migration;
- dependency references target registered entities or explicitly named external roots;
- booleans and blockers are complete;
- ready entities have no blocker;
- blocked entities have a blocker;
- current legacy sync source still contains the audited unsafe patterns so activation cannot be falsely claimed;
- the real repository currently reports zero ready and eight blocked entities.

The checker does not inspect a database, access a network, read secrets, or mutate files.

## Activation gate

Local-server sync activation remains prohibited until:

1. every required entity is ready;
2. legacy snapshot pull is disabled or strictly excluded from canonical domains;
3. canonical outbox-to-sync transport is implemented;
4. local and cloud apply are symmetric and tested;
5. replay, conflict, tombstone, dependency, tenant-isolation, and partial-failure tests pass;
6. a disconnected rehearsal and recovery drill pass;
7. explicit owner activation authorization is received.

## Branch policy

All work remains on `program/cdb-main-continuous-20260725`. Reviewed `main` commits flow into CDB before new slices. No CDB commit flows to `main` until complete program review and final integration.

## Completion boundary

CDB-110A is complete when the entity registry, checker, tests, report, tracker, and verification gates pass with a truthful blocked result. It does not claim that synchronization is implemented or activated.
