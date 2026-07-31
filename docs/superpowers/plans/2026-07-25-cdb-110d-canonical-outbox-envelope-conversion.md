# CDB-110D Canonical Outbox-to-Envelope Conversion Implementation Plan

> **Execution:** Follow TDD in the continuous CDB worktree. Keep conversion read-only and offline.

**Goal:** Convert exact allowlisted canonical outbox rows into validated CDB-110B envelopes with deterministic aggregate versions and canonical dependency evidence.

**Architecture:** A pure/read-only adapter loads one exact source outbox row, validates its aggregate/event pair and payload shape, proves every aggregate predecessor is supported, derives aggregate version from source outbox commit order, queries canonical dependency authority, and delegates final digest/idempotency validation to `createCanonicalSyncEnvelope()`.

## Constraints

- Branch: `program/cdb-main-continuous-20260725`.
- Before a new slice, merge reviewed `main → CDB` only when main advances.
- No CDB→main integration during the program.
- No source outbox mutation, sync inbox insertion, transport, route, worker, fetch, production access, local-server start, deployment, or feature-flag change.
- Do not use `event_version` as aggregate sequence.

## Task 1: Define source-row and payload validation

**Files:**
- Create: `src/lib/canonical/local-sync-outbox-converter.ts`
- Create: `test/canonical/canonical-sync-outbox-converter.test.ts`

- [ ] RED: missing tenant/event row fails.
- [ ] RED: exact aggregate/event mismatch and unsupported event fail.
- [ ] RED: `event_version != 1`, cancelled/dead-letter status, malformed JSON, array/null payload, and unsupported command-envelope version fail.
- [ ] RED: direct payload and `runCanonicalBatch` command-envelope payload normalize to the same event object.
- [ ] RED: payload aggregate identity mismatch fails.
- [ ] Implement exact source-row parsing and allowlist metadata.

## Task 2: Derive deterministic aggregate versions

**Files:**
- Modify: `src/lib/canonical/local-sync-outbox-converter.ts`
- Modify: `test/canonical/canonical-sync-outbox-converter.test.ts`

- [ ] RED: first source event converts with aggregate version 1 even though `event_version` is 1.
- [ ] RED: second allowlisted event for the same aggregate converts with version 2.
- [ ] RED: equal occurrence timestamps still follow source outbox `id` order.
- [ ] RED: unsupported predecessor for the same aggregate fails closed.
- [ ] RED: events from another tenant or aggregate do not affect rank.
- [ ] Implement positive-safe-integer rank from exact predecessor counts.

## Task 3: Extract canonical dependencies

**Files:**
- Modify: `src/lib/canonical/local-sync-outbox-converter.ts`
- Modify: `test/canonical/canonical-sync-outbox-converter.test.ts`

- [ ] RED: encounter has no internal dependency.
- [ ] RED: service request requires encounter.
- [ ] RED: service event requires request and encounter.
- [ ] RED: invoice requires encounter and every referenced service event.
- [ ] RED: payment receipt requires every allocated invoice.
- [ ] RED: deposit recorded requires receipt; deposit applied requires invoice.
- [ ] RED: compensation accrual requires invoice and optional service event.
- [ ] RED: inventory movement requires optional invoice and service event.
- [ ] RED: missing authority row fails closed.
- [ ] Implement deterministic sorted, deduplicated dependencies with minimum version 1.

## Task 4: Verify operation and envelope semantics

**Files:**
- Modify: `src/lib/canonical/local-sync-outbox-converter.ts`
- Modify: `test/canonical/canonical-sync-outbox-converter.test.ts`

- [ ] RED: invoice cancellation and payment reversal produce tombstone operations.
- [ ] RED: creation/update/status events produce upsert.
- [ ] RED: source public IDs and source node IDs remain stable protocol IDs; source numeric row ID is absent from output.
- [ ] RED: same source row produces deterministic digest/idempotency output.
- [ ] RED: converter does not update outbox delivery columns or insert inbox rows.
- [ ] Run protocol/inbox/readiness regressions.
- [ ] Commit converter slice.

## Task 5: Record CDB-110D evidence

**Files:**
- Modify: `docs/database/canonical-local-sync-entity-registry.yaml`
- Modify: `scripts/canonical/check-canonical-local-sync-readiness.ts`
- Modify: `test/canonical/canonical-local-sync-readiness.test.ts`
- Modify: `task-progress.yaml`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`
- Create: `docs/database/migration-runs/P11-canonical-outbox-envelope-conversion.md`

- [ ] Record offline converter evidence and advance implementation task to CDB-110E.
- [ ] Keep runtime consumption and business apply disconnected; readiness remains 8 blocked / 0 ready.
- [ ] Run focused converter/protocol/inbox/local-sync suite.
- [ ] Run full canonical suite, governance, retirement/readiness checks, TypeScript, 472 migration manifest, worktree policy, diff check, and all builds.
- [ ] Commit receipt on CDB branch only.
- [ ] Confirm local `main` remains unchanged.

## Completion

CDB-110D completes deterministic offline outbox conversion only. Runtime claiming, publishing, transport, entity-specific apply, recovery rehearsal, and activation remain later CDB-110 work.
