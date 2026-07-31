# ADR-001: D1 versus PostgreSQL for the Canonical HMS

**Date:** 2026-07-13

**Status:** Accepted — complete the canonical redesign on Cloudflare D1 first; defer PostgreSQL evaluation until canonical models and write paths are stable and measured.

## Context

The live HMS currently uses one shared, tenant-scoped Cloudflare D1 database. The production snapshot contains hundreds of legacy tables and a large amount of SQLite-specific schema and application behavior. The canonical redesign is intended to replace ambiguous ownership, money, practitioner-role, billing, stock, cash, and accounting models without a big-bang application rewrite.

PostgreSQL remains attractive for a centralized enterprise HMS, but changing the database engine at the same time as the logical data-model redesign would combine two independent high-risk transformations.

The owner explicitly selected the D1-first path on 2026-07-13: fix and stabilize the canonical architecture on D1 before considering a PostgreSQL move.

## Decision

1. Continue the canonical HMS program on Cloudflare D1.
2. Do not restart the program as an immediate D1-to-PostgreSQL rewrite.
3. Keep new canonical domain code independent of direct D1 bindings through explicit database/transaction adapters.
4. Keep SQLite-specific DDL, PRAGMA usage, and D1 migration behavior inside the D1 adapter and migration layers.
5. Reconsider PostgreSQL only after the canonical models, transaction boundaries, write paths, reconciliation rules, and operational workload are stable and measured.
6. A future PostgreSQL move will be a separate, explicitly authorized migration program with its own rehearsal, rollback, cost, residency, and operations evidence.

CDB-020 was therefore authorized to reserve and rehearse migration `0505_canonical_program_foundation.sql` on local D1 and the isolated rehearsal clone. This decision does not authorize applying `0423` to production.

## Why PostgreSQL remains attractive

PostgreSQL is a strong default for a centralized enterprise HMS when the workload requires:

- many concurrent financial, billing, stock, clinical, and audit writes;
- rich multi-table transactions and explicit locking semantics;
- complex reporting, window functions, materialized views, and analytical queries;
- mature replication, observability, backup, extension, and administration tooling;
- larger individual databases without a per-database 10 GB ceiling;
- stronger options for row-level security, partitioning, constraints, and data lifecycle management.

Cloudflare Workers could continue to host the application while PostgreSQL is reached through Hyperdrive and a supported PostgreSQL driver or ORM dialect.

## Why an immediate switch is not a small change

Changing the database engine is not just rewriting DDL. It affects:

- D1 binding calls and transaction/batch APIs;
- Drizzle/SQL dialect and generated migrations;
- SQLite `PRAGMA`, trigger syntax, partial-index behavior, date functions, and type affinity;
- auto-increment and public-ID strategy;
- concurrency, retries, idempotency, and isolation assumptions;
- local development and test fixtures;
- production export/transform/import tooling;
- dual-run, reconciliation, rollback, and cutover operations;
- backup, credentials, networking, connection pooling, monitoring, and cost ownership.

With a live production database and a broad legacy schema, combining all of those changes with the canonical domain rewrite would substantially increase the number of simultaneous failure modes.

## D1-first implementation rules

New canonical modules must:

- keep domain commands independent of direct D1 bindings;
- use an explicit database transaction adapter;
- generate UTC timestamps in a portable application layer where possible;
- store canonical posted money as integer minor units with currency codes;
- use stable application-generated public IDs for synchronization boundaries;
- avoid SQLite-only behavior outside the D1 adapter/migration layer;
- preserve stable source mappings and reconciliation IDs;
- use additive migrations, idempotency claims, outbox events, and reconciliation evidence;
- remain testable without production D1 access;
- avoid designing table or command contracts that would prevent a later PostgreSQL implementation.

## Deferred PostgreSQL feasibility gate

The PostgreSQL feasibility gate is deferred, not cancelled. When reopened, it must use an isolated non-production PostgreSQL database and must not mutate production D1.

It should prove at least:

1. Canonical registry and domain tables can be represented without losing invariants.
2. The atomic command pattern can include idempotency claim, domain writes, reconciliation metadata, and outbox writes in one transaction.
3. Workers can connect through Hyperdrive with tested connection lifecycle, timeout, retry, and credential rotation behavior.
4. Billing/payment, commission, stock-movement, cash, and journal contention is benchmarked against measured HMS workloads.
5. D1 source rows can be transformed without guessing tenant IDs, money units, practitioner roles, or polymorphic references.
6. Backup, point-in-time recovery, staging refresh, rollback, and observability procedures are documented and rehearsed.
7. Provider, region, data residency, recurring cost, support ownership, and operational staffing are explicit.

## Revisit criteria

Reopen the PostgreSQL decision when one or more of the following is true:

- measured D1 write contention or latency threatens clinical or financial correctness;
- database size or tenant growth approaches D1 operational limits;
- required reporting or transaction semantics cannot be implemented safely on D1;
- tenant-level database partitioning becomes operationally impractical;
- canonical write paths and reconciliation are stable enough to support a separate engine cutover;
- the owner explicitly authorizes a PostgreSQL feasibility or migration program.

## Consequences

- P01 remains valid and complete.
- CDB-020 proceeds on D1 and has been rehearsed only on local/test D1 and the isolated clone.
- CDB-021 will implement D1 canonical primitives and an atomic command-batch abstraction without coupling domain contracts directly to D1.
- Existing production D1 remains operational and recoverable.
- Migration `0423` remains unapplied to production until a separate explicit production authorization and rollback gate.
- No PostgreSQL production cutover is authorized by this ADR.
- The local hospital server remains disconnected.
