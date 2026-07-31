# CDB-110N Canonical Network Authentication Evidence Implementation Plan

**Design checkpoint:** `9b2d30699`

## Task 1 — Canonical authentication message and dependency contract

1. Add RED tests for invalid evidence provider, signer, verifier, replay store, target handler, accepted time, and clock-skew policy.
2. Add deterministic message-builder tests.
3. Create `src/lib/canonical/local-sync-network-auth.ts`.
4. Implement exact public evidence validation and canonical message construction.
5. Implement stable error class/codes.
6. Run focused tests and TypeScript.

## Task 2 — Sender authentication wrapper

1. Add RED tests for exact five authentication headers and preserved CDB-110M headers/body.
2. Verify evidence provider is called once with endpoint, request digest, and event ID.
3. Verify signer is called once with key ID and canonical message.
4. Validate signature format before exchange.
5. Validate authentication receipt headers on the response.
6. Commit sender contract checkpoint.

## Task 3 — Receiver verification and replay evidence

1. Add RED tests for malformed/extra headers, key/timestamp/nonce/signature/digest/event tampering, stale/future signatures, and invalid signature.
2. Ensure verifier runs before replay reservation and target handler.
3. Implement replay-store handling for `reserved`, `exact_replay`, and `conflict`.
4. Allow exact replay to invoke the idempotent target handler.
5. Return exact authentication receipt headers.
6. Commit receiver/replay checkpoint.

## Task 4 — Authenticated source-to-target in-memory convergence

1. Wrap the CDB-110M sender exchange with the authentication sender.
2. Route the in-memory exchange through the authentication receiver and then the CDB-110M receiver.
3. Bind the target receiver to the real target database delivery port.
4. Verify source publication, target business/entity-version/inbox convergence, and later idle drain.
5. Simulate response loss and resend exact authenticated evidence; require `exact_replay` and duplicate-free target replay.
6. Simulate nonce collision with different request identity; require failure before target mutation.
7. Commit integration checkpoint.

## Task 5 — Runtime isolation

1. Add `test/canonical/canonical-sync-network-auth-runtime-isolation.test.ts`.
2. Prove no route/middleware, Worker/startup module, scheduler, local-server loop, or shell script imports the auth module.
3. Prove no crypto implementation, secret/key value, fetch, Hono, process/environment, filesystem, network import, timer, wall clock, random ID, or loop primitive exists.
4. Prove LIS/schema-sync auth modules and legacy sync runtime remain unchanged and unimported.
5. Commit isolation checkpoint.

## Task 6 — Readiness capability evidence

1. Add authentication contract status/module/test/isolation paths to the registry.
2. Extend readiness checker schema, evidence validation, and output.
3. Update readiness fixtures and negative evidence coverage.
4. Keep runtime/business connections false, all entity consumption flags false, and 0 ready / 8 blocked.
5. Commit readiness evidence.

## Task 7 — Full verification and receipt

Run:

- focused auth/network/consumer/orchestrator/isolation/readiness tests;
- `pnpm vitest run test/canonical`;
- `pnpm exec tsc --noEmit`;
- `pnpm canonical:check`;
- `pnpm canonical:local-sync-readiness`;
- `pnpm canonical:legacy-retirement-readiness`;
- `pnpm build:migrations`;
- web, patient, and admin production builds.

Then:

1. write `docs/database/migration-runs/P11-canonical-network-authentication-evidence.md`;
2. update `task-progress.yaml` and the continuation contract;
3. record exact implementation/verification commits and branch relationship;
4. run metadata tests and YAML parse;
5. commit verification and final receipt metadata;
6. leave the worktree clean and at least as current as local `main`.

## Safety

Do not read, create, pass, persist, or use real secrets or keys. Do not implement crypto, make network requests, modify or register routes/middleware/Workers/schedulers/startup code, read environment variables, deploy, mutate production, activate synchronization, retire legacy writes, push, or integrate CDB into `main`.
