# CDB-110L Canonical Local Outbox Consumer Connection Implementation Plan

**Design checkpoint:** `69a9fb5a4`

## Task 1 — Typed consumer connection contract

1. Add RED tests for invalid source DB, invalid delivery port, invalid orchestration input before mutation, published propagation, idle propagation, retry/dead-letter/source-ack-pending propagation, and exact one-call delegation.
2. Create `src/lib/canonical/local-sync-consumer.ts`.
3. Validate source DB and delivery port at connection creation.
4. Validate orchestration input before delegation.
5. Delegate exactly once to `runCanonicalSyncOrchestrationOnce()` and return its result unchanged.
6. Run focused consumer/orchestrator tests and TypeScript.
7. Commit the consumer contract checkpoint.

## Task 2 — Runtime-isolation evidence

1. Add `test/canonical/canonical-sync-local-outbox-consumer-runtime-isolation.test.ts`.
2. Prove no source route, Worker entry point, scheduler, startup module, local-server loop, or shell script imports the connection.
3. Prove the module contains no fetch, Hono, network API, timers, environment lookup, process access, filesystem access, wall-clock, or random-ID primitive.
4. Add the consumer module to the approved offline-module set without weakening existing delivery/orchestrator isolation.
5. Run isolation tests and commit the checkpoint.

## Task 3 — Readiness capability metadata

1. Extend registry protocol foundation with:
   - `localOutboxConsumerContractStatus`;
   - `localOutboxConsumerModule`;
   - `localOutboxConsumerTest`;
   - `localOutboxConsumerRuntimeIsolationTest`.
2. Extend the readiness checker schema, evidence validation, and output.
3. Update readiness fixtures/tests.
4. Assert all eight entities remain blocked only on `LOCAL_CANONICAL_OUTBOX_CONSUMPTION_MISSING`.
5. Keep `runtimeConsumptionConnected=false`, `businessApplyConnected=false`, and every entity `localCanonicalOutboxConsumption=false`.
6. Commit readiness evidence.

## Task 4 — Full verification and receipt

Run:

- focused consumer/orchestrator/isolation/readiness tests;
- `pnpm vitest run test/canonical`;
- `pnpm exec tsc --noEmit`;
- `pnpm canonical:check`;
- `pnpm canonical:local-sync-readiness`;
- `pnpm canonical:legacy-retirement-readiness`;
- `pnpm build:migrations`;
- web, patient, and admin production builds.

Then:

1. write `docs/database/migration-runs/P11-canonical-local-outbox-consumer-connection.md`;
2. update `task-progress.yaml` and the continuation contract;
3. record exact implementation and verification commits;
4. run metadata tests and YAML parse;
5. commit verification and final metadata receipts;
6. leave the worktree clean and at least as current as local `main`.

## Safety

Do not modify `src/routes/sync.ts`, `scripts/local-server/sync-worker.sh`, Worker startup files, scheduler files, deployment configuration, environment variables, feature flags, production data, or legacy-write retirement state. Do not push, deploy, register, activate, or integrate into `main`.
