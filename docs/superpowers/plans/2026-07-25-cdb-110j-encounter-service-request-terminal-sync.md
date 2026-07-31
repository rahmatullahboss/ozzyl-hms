# CDB-110J Encounter and Service-Request Terminal Sync Implementation Plan

> **Execution mode:** single-agent serial TDD in the dedicated CDB worktree.

**Goal:** Add offline canonical source commands and authenticated lifecycle synchronization for service-request cancellation and encounter cancellation without runtime activation.

**Architecture:** Extend existing command/outbox/converter/business-payload/projector/apply authorities. Both terminal events remain `upsert` lifecycle transitions. Service requests must be cancelled before an encounter with active dependent requests can be cancelled.

## Constraints

- No physical delete or tombstone operation.
- No automatic cascade.
- No service-event cancellation or deposit refund projection.
- No runtime route, network adapter, worker, scheduler, CLI, startup hook, deployment, push, production access, or CDB-to-main merge.
- Preserve existing started/created historical event projection after terminal source state.
- All command and target mutations must be guarded and replay-safe.

## Task 1 — Source cancellation commands

**Files**

- Modify `src/lib/canonical/commands/start-encounter.ts`
- Modify `src/lib/canonical/commands/service-operations.ts`
- Modify `test/canonical/start-encounter.test.ts`
- Modify `test/canonical/service-operations-commands.test.ts`

### RED tests

Service-request cancellation:

- active request -> cancelled, exact timestamp, one cancellation outbox row;
- partially fulfilled request -> cancelled while fulfilled quantity is preserved;
- fulfilled/already-cancelled request fails unless exact replay;
- exact replay returns same result and does not duplicate outbox;
- malformed identity/time fails before mutation.

Encounter cancellation:

- in-progress encounter with no active request -> cancelled and ended timestamp set;
- active or partially fulfilled dependent request blocks cancellation;
- after request cancellation, encounter cancellation succeeds;
- cancellation before start, completed/cancelled state, or malformed input fails;
- exact replay does not duplicate outbox.

### Implementation

- use `readCanonicalCommandReplay()` before state loading;
- use guarded SQL updates inside `runCanonicalBatch()`;
- service request event: `canonical.service_request.cancelled`;
- encounter event: `canonical.encounter.cancelled`;
- preserve source evidence and historical rows;
- close active encounter participants on encounter cancellation.

### Gate

```bash
pnpm vitest run test/canonical/start-encounter.test.ts test/canonical/service-operations-commands.test.ts
pnpm exec tsc --noEmit
```

Commit:

```text
feat(canonical): add clinical cancellation commands
```

## Task 2 — Converter and typed business payload

**Files**

- Modify `src/lib/canonical/local-sync-outbox-converter.ts`
- Modify `src/lib/canonical/local-sync-business-payload.ts`
- Modify `test/canonical/canonical-sync-outbox-converter.test.ts`
- Modify `test/canonical/canonical-sync-business-payload.test.ts`

### RED tests

- encounter cancellation converts as entity encounter, aggregate version 2, operation upsert;
- request cancellation converts as entity service_request, aggregate version 2, operation upsert and encounter dependency;
- wrong event type/aggregate/identity fails;
- payload parser accepts exact typed mutations;
- parser rejects wrong operation, kind, time, quantity, identity, or source hash.

### Implementation

Add event mappings and mutation kinds:

```text
encounter_cancelled
service_request_cancelled
```

Update contract map, parser union, validators, and projected event allowlist.

Commit:

```text
feat(canonical): define clinical cancellation sync payloads
```

## Task 3 — Source projector and target apply

**Files**

- Modify `src/lib/canonical/local-sync-business-projector.ts`
- Modify `src/lib/canonical/local-sync-business-apply.ts`
- Modify `test/canonical/canonical-sync-business-projector-clinical.test.ts`
- Modify `test/canonical/canonical-sync-business-apply-clinical.test.ts`

### RED projector tests

- cancelled encounter source authority projects exact mutation;
- historical start still projects after cancellation;
- cancelled request projects exact mutation including fulfilled quantity;
- historical create still projects after cancellation;
- wrong source status/time/payload/evidence fails.

### RED apply tests

- encounter in_progress -> cancelled, version 1 -> 2;
- request active/partially fulfilled -> cancelled, version 1 -> 2;
- missing predecessor, conflicting target state, wrong quantity/time/evidence fail atomically;
- replay returns applied evidence without duplicate mutation.

### Implementation

- extend source row interfaces and event branches;
- add guarded apply preparation functions;
- add mutation dispatch cases;
- preserve all existing source and target fields except terminal status/time.

Commit:

```text
feat(canonical): apply clinical cancellation sync mutations
```

## Task 4 — Ordered orchestration and readiness

**Files**

- Add/modify focused offline orchestration test
- Modify registry v2 terminal verification for encounter/service_request
- Modify readiness tests
- Modify tracker/continuation test
- Create verification report

### Ordered scenario

1. publish encounter started;
2. publish request created;
3. local encounter cancellation attempt fails with active request;
4. cancel and publish request;
5. cancel and publish encounter;
6. verify target states and aggregate versions 2;
7. verify replay safety and no duplicate outbox/inbox/business rows.

### Readiness

After completion:

```text
encounter terminalSemanticsVerified: true
service_request terminalSemanticsVerified: true
terminal gaps: service_event, deposit
ready: 0
blocked: 8
runtime consumption: false
```

## Final gates

```bash
pnpm vitest run focused CDB-110J tests
pnpm vitest run test/canonical
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm canonical:local-sync-readiness
pnpm canonical:legacy-retirement-readiness
pnpm build:migrations
pnpm --filter web build
pnpm build:patient
pnpm build:admin
```
