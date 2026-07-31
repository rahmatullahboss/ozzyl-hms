# P11 CDB-110K Serial Implementation Plan

**Design checkpoint:** `e79eef15a`

## Task 1 — Service-event source cancellation

1. Add `CancelServiceEventInput` and result contracts.
2. Add RED tests for replay, current-last-event guard, request balance reversal, accepted-event zero-decrement, invalid time, and duplicate prevention.
3. Implement replay-first `cancelServiceEvent()`.
4. Guard event terminal transition and request fulfillment/status/last-event transition in one command batch.
5. Run focused command tests and TypeScript.
6. Commit the verified source-command slice.

## Task 2 — Converter and version scope

1. Add `canonical.service_event.cancelled` as service-event lifecycle `upsert`.
2. Add `canonical_refund / canonical.deposit.refunded` mapping to entity type `deposit`.
3. Separate source aggregate identity from envelope entity identity for deposit refunds.
4. Derive one deposit entity version stream across canonical deposit and deposit-refund source aggregates.
5. Add fail-closed tests for malformed identity and unsupported predecessors.
6. Commit converter/versioning slice after focused tests.

## Task 3 — Typed payload and source projection

1. Add `service_event_cancelled` mutation contract.
2. Add `deposit_refunded` mutation contract.
3. Preserve historical service-event recorded projection after cancellation.
4. Project service-event cancellation from exact event/request terminal authority.
5. Project deposit refund from refund facts and ordered cumulative refund authority.
6. Add tamper, time, quantity, balance, and identity tests.
7. Commit typed payload/projector slice.

## Task 4 — Target apply

1. Add guarded service-event cancellation apply.
2. Add guarded deposit refund balance update and refund-fact insert.
3. Preserve atomic inbox/entity-version completion.
4. Add stale target, missing predecessor, replay, and duplicate-free tests.
5. Commit target apply slice.

## Task 5 — Two-node rehearsal and readiness

1. Rehearse service request creation → service event recording → service event cancellation.
2. Prove source command replay and target redelivery replay.
3. Rehearse deposit recorded → deposit refunded using the existing refund outbox fact.
4. Prove cross-aggregate deposit versions and target convergence.
5. Mark service-event and deposit terminal semantics verified in the registry.
6. Assert zero remaining terminal gaps while 0/8 runtime-ready remains truthful.
7. Commit rehearsal/readiness slice.

## Task 6 — Full verification and receipt

Run:

- focused CDB-110K suites;
- `pnpm vitest run test/canonical`;
- `pnpm exec tsc --noEmit`;
- `pnpm canonical:check`;
- `pnpm canonical:local-sync-readiness`;
- `pnpm canonical:legacy-retirement-readiness`;
- `pnpm build:migrations`;
- web, patient, and admin production builds.

Then write the CDB-110K verification receipt, update `task-progress.yaml`, run metadata contracts, commit exact verification evidence, and leave the worktree clean.
