# CDB-110M Canonical Network Delivery Adapter Implementation Plan

**Design checkpoint:** `abdd7dd46`

## Task 1 — Shared delivery request validation

1. Export the existing delivery-request validator from `local-sync-delivery.ts` as `validateCanonicalSyncDeliveryRequest()`.
2. Keep database delivery behavior unchanged.
3. Run existing delivery/orchestration tests and TypeScript.
4. Commit the shared-validator checkpoint if the change is independently useful; otherwise include it with Task 2.

## Task 2 — Wire protocol sender and receiver

1. Add RED tests for:
   - HTTPS endpoint and exchange dependency validation;
   - deterministic request body and digest headers;
   - request wrapper/digest tampering before target invocation;
   - successful applied response round trip;
   - retry/dead-letter/busy result round trips;
   - non-200 response rejection;
   - malformed, oversized, wrong-protocol, wrong-digest, extra-key, and wrong-event response rejection.
2. Create `src/lib/canonical/local-sync-network-delivery.ts`.
3. Implement stable error codes and bounded body parsing.
4. Implement strict request/result discriminated-union validation.
5. Implement `createCanonicalSyncNetworkDeliveryPort()`.
6. Implement `handleCanonicalSyncNetworkDeliveryExchange()`.
7. Run focused network and existing delivery/orchestration tests plus TypeScript.
8. Commit the wire-contract checkpoint.

## Task 3 — Real source-to-target in-memory exchange

1. Add a real two-database integration test.
2. Bind the CDB-110L consumer connection to the sender network adapter.
3. Use an injected in-memory exchange that calls the receiver handler.
4. Bind the receiver handler to `createCanonicalSyncDatabaseDeliveryPort(targetDb)`.
5. Verify source claim, target apply, entity version/inbox completion, source publication, later idle drain, and duplicate-free replay.
6. Add transport tamper/retry evidence where the source lifecycle remains fail-closed.
7. Commit the integration checkpoint.

## Task 4 — Runtime isolation

1. Add `test/canonical/canonical-sync-network-delivery-runtime-isolation.test.ts`.
2. Prove no route, Worker/startup module, scheduler, local-server loop, or shell script imports the network module.
3. Prove the module contains no `fetch`, Hono, process/environment, filesystem, HTTP/TLS/socket import, timer, wall-clock, random-ID, credential, or loop primitive.
4. Add the network module to approved offline isolation evidence without weakening existing consumer/orchestrator isolation.
5. Commit the isolation checkpoint.

## Task 5 — Readiness capability evidence

1. Extend registry protocol foundation with network-adapter contract status/module/test/isolation-test paths.
2. Extend readiness checker schema, evidence validation, and output.
3. Update readiness fixtures and negative evidence tests.
4. Assert:
   - `networkDeliveryAdapterContractStatus=verified_offline`;
   - `runtimeConsumptionConnected=false`;
   - `businessApplyConnected=false`;
   - all entity consumption flags remain false;
   - 0 ready / 8 blocked remains unchanged.
5. Commit readiness evidence.

## Task 6 — Full verification and receipt

Run:

- focused network/consumer/delivery/orchestration/isolation/readiness tests;
- `pnpm vitest run test/canonical`;
- `pnpm exec tsc --noEmit`;
- `pnpm canonical:check`;
- `pnpm canonical:local-sync-readiness`;
- `pnpm canonical:legacy-retirement-readiness`;
- `pnpm build:migrations`;
- web, patient, and admin production builds.

Then:

1. write `docs/database/migration-runs/P11-canonical-network-delivery-adapter.md`;
2. update `task-progress.yaml` and continuation contract;
3. record exact commits and branch relationship;
4. run metadata tests and YAML parse;
5. commit verification and final receipt metadata;
6. leave the worktree clean and at least as current as local `main`.

## Safety

Do not modify legacy sync routes or shell worker, register a route/Worker/scheduler/startup caller, create a built-in network client, read credentials or environment variables, make a network request, deploy, mutate production, activate synchronization, retire legacy writes, push, or integrate CDB into `main`.
