# CDB-110E Canonical Sync Business Apply Implementation Plan

> **Execution:** Use TDD in the continuous CDB worktree. Keep all projection and apply behavior offline and unreferenced by runtime routes/workers.

**Goal:** Authenticate event-time canonical mutation facts in sync envelopes and apply all eight reviewed entity families atomically with CDB-110C inbox completion.

**Architecture:** A source projector derives a versioned business payload from immutable canonical facts and the exact outbox event. The CDB-110D converter hashes that wrapper into the envelope. A target planner parses the wrapper, emits guarded entity-specific SQL plus exact change assertions, and an offline completion wrapper delegates to `completeCanonicalSyncInboxEvent()`.

## Constraints

- Branch: `program/cdb-main-continuous-20260725`.
- Sync reviewed `main → CDB` only if local main advances.
- Never integrate CDB into main during this program slice.
- No route, worker, scheduler, queue, fetch, network, production, local-server start, deployment, or feature-flag change.
- Never transport raw numeric cross-database identity.
- Never copy a mutable current-row snapshot as historical event authority.
- Every zero-row or multi-row unexpected business mutation must abort the whole inbox completion batch.

## Task 1: Lock the versioned business payload contract

**Files:**
- Create: `src/lib/canonical/local-sync-business-payload.ts`
- Create: `test/canonical/canonical-sync-business-payload.test.ts`
- Modify: `src/lib/canonical/local-sync-outbox-converter.ts`
- Modify: `test/canonical/canonical-sync-outbox-converter.test.ts`

- [ ] RED: raw event payload is rejected by business parsing.
- [ ] RED: versioned payload authenticates compact event plus mutation delta.
- [ ] RED: unsupported schema, entity/event/mutation mismatch, numeric identity, and malformed collections fail closed.
- [ ] Implement plain-object, UTC, hash, integer, money, public-ID, and deterministic-order validators.
- [ ] Extend converter to project the versioned wrapper before envelope hashing.

## Task 2: Project and apply encounter/service request/service event

**Files:**
- Modify: `src/lib/canonical/local-sync-business-payload.ts`
- Create: `src/lib/canonical/local-sync-business-apply.ts`
- Create: `test/canonical/canonical-sync-business-apply-clinical.test.ts`

- [ ] RED: encounter start resolves patient sync key and inserts exact initial state.
- [ ] RED: encounter completion requires exact in-progress prior state.
- [ ] RED: service request creation resolves patient, encounter, and catalog authority.
- [ ] RED: service event updates request fulfillment and inserts immutable event atomically.
- [ ] RED: missing patient/catalog/request, stale fulfillment, over-fulfillment, wrong status, and duplicate conflicts roll back inbox/version/business rows.
- [ ] Implement source projection and target guarded statements.

## Task 3: Project and apply invoice issue/cancellation

**Files:**
- Modify: `src/lib/canonical/local-sync-business-payload.ts`
- Modify: `src/lib/canonical/local-sync-business-apply.ts`
- Create: `test/canonical/canonical-sync-business-apply-invoice.test.ts`

- [ ] RED: issued invoice payload contains immutable header and every deterministic typed line.
- [ ] RED: target inserts header with initial balances and all lines.
- [ ] RED: missing patient/service-event or line conflict rolls back all mutations.
- [ ] RED: unpaid cancellation uses exact compare-and-swap.
- [ ] RED: compensation cancellation totals/counts match immutable adjustment facts.
- [ ] RED: stale paid/credited invoice or stale accrual fails closed.
- [ ] Implement cancellation compensation side effects without hard deletes.

## Task 4: Project and apply payment/deposit events

**Files:**
- Modify: `src/lib/canonical/local-sync-business-payload.ts`
- Modify: `src/lib/canonical/local-sync-business-apply.ts`
- Create: `test/canonical/canonical-sync-business-apply-payment-deposit.test.ts`

- [ ] RED: pending/failed/posted receipt projection includes exact tenders and allowed allocations.
- [ ] RED: posted receipt applies invoice balance deltas in deterministic allocation order.
- [ ] RED: reversal applies reversal/refund and receipt/tender/allocation/invoice projections atomically.
- [ ] RED: deposit record resolves patient/receipt and inserts initial liability state.
- [ ] RED: deposit application applies exact deposit/invoice before/after balances.
- [ ] RED: out-of-order balances, missing dependencies, duplicate IDs, and partial mutations roll back.
- [ ] Implement guarded statements and assertions.

## Task 5: Project and apply compensation/inventory events

**Files:**
- Modify: `src/lib/canonical/local-sync-business-payload.ts`
- Modify: `src/lib/canonical/local-sync-business-apply.ts`
- Create: `test/canonical/canonical-sync-business-apply-compensation-inventory.test.ts`

- [ ] RED: accrual projection contains immutable rule/calculation authority and applies initial balances.
- [ ] RED: adjustment projection applies exact before/after accrual balances.
- [ ] RED: inventory projection applies exact balance quantity/version and immutable movement.
- [ ] RED: missing practitioner/rule/item/location/lot, stale balance version, negative-policy conflict, or duplicate source fact fails closed.
- [ ] Implement deterministic statement planning.

## Task 6: Integrate offline completion and governance evidence

**Files:**
- Modify: `src/lib/canonical/local-sync-business-apply.ts`
- Create: `test/canonical/canonical-sync-business-completion.test.ts`
- Modify: `docs/database/canonical-local-sync-entity-registry.yaml`
- Modify: `scripts/canonical/check-canonical-local-sync-readiness.ts`
- Modify: `test/canonical/canonical-local-sync-readiness.test.ts`
- Modify: `task-progress.yaml`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`
- Create: `docs/database/migration-runs/P11-canonical-sync-business-apply.md`

- [ ] RED: business mutations, entity version, and inbox applied receipt commit atomically.
- [ ] RED: claim expiry, version gap, business assertion failure, and semantic tampering roll back all layers.
- [ ] Confirm no route/worker/runtime references.
- [ ] Record business apply as `verified_offline` while runtime consumption/transport remain disconnected.
- [ ] Keep readiness blocked until source claiming/publication and transport/orchestration are implemented.
- [ ] Run focused suites, full canonical suite, governance, retirement/readiness, TypeScript, migration manifest, worktree policy, diff check, and all builds.
- [ ] Commit CDB-only checkpoint and confirm local main unchanged.

## Completion

CDB-110E completes authenticated offline business projection and apply. Runtime outbox claiming/publication, delivery transport, automatic orchestration, disconnected recovery rehearsal, and explicit activation remain later CDB-110 work.
