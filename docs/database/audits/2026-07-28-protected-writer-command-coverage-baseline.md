# CDB-V1-030A Protected Writer Command Coverage Baseline

**Checkpoint:** `CDB-V1-030A-PROTECTED-WRITER-COMMAND-COVERAGE-BASELINE`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Reviewed:** 2026-07-28  
**Production access or mutation performed:** no

## Result

The protected Core V1 writer inventory is now bound to the frozen CDB-V1-020 authority and command contracts in:

- `docs/database/protected-core-v1-writer-command-coverage.json`
- builder: `scripts/canonical/protected-core-writer-command-coverage.ts`
- generator: `scripts/canonical/generate-protected-core-writer-command-coverage.ts`
- checker: `scripts/canonical/check-protected-core-writer-command-coverage.ts`
- contract: `test/canonical/protected-core-writer-command-coverage.test.ts`

All **218 protected writers** are classified:

| Classification | Count | Meaning |
|---|---:|---|
| Canonical command | 107 | Current Canonical authority writer retained behind its frozen command boundary |
| Atomic compatibility | 43 | Legacy-compatible writer registered under an integrated strict financial or exact command-route boundary |
| Governed external | 3 | `users` or `global_patient_identity` remains external authority |
| Strict blocked | 0 | No currently discovered writer is assigned only to an explicit strict block |
| Command required | 61 | Writer is known but requires command implementation or route integration before strict promotion |
| Fixture isolated | 4 | Protected smoke fixtures must remain outside production runtime |

**Unclassified writers:** `0`

The 61 command-required writers are grouped into **17 protected concept implementation groups**. The baseline deliberately records `commandCoverageComplete: false`; it does not claim CDB-V1-030 completion.

## Classification rules

A writer is accepted only when it resolves to at least one frozen Core V1 concept and command name.

- `canonical_authority` writers become `canonical_command` and may not be replaced by direct ad-hoc SQL.
- A route present in `FINANCIAL_ROUTE_COVERAGE` with `integrated` status, or an exact reviewed command-route integration whose required adapter tokens are all present, becomes `atomic_compatibility`; legacy projection writes are allowed only in the same guarded mutation as the Canonical command.
- Exact writes to `users` or `global_patient_identity` remain `external_governed`; they must not create duplicate Canonical person authorities.
- `protected_fixture` writers become `fixture_isolated` and cannot be imported by production routes.
- Remaining legacy or compatibility writers become `command_required` and remain ineligible for strict promotion.
- Any future `blocked_in_canonical_mode`, `retirement_candidate` or migration-only protected writer becomes `strict_blocked` until replacement proof exists.

## Frozen execution requirements

Every writer entry records:

- exact path, table and operations;
- protected concept IDs;
- lifecycle status and current target-command disposition;
- required frozen command names/modules;
- implemented versus contract-only command modules;
- strict financial boundary IDs where present;
- atomic transaction, idempotency, audit/outbox, compatibility and rollback rules;
- the exact next action.

The mandatory transaction rule is:

> Source compatibility fact, Canonical fact, exact source mapping, idempotency receipt, audit evidence and outbox event must succeed in one D1 batch or the complete mutation rolls back.

## Remaining implementation

The next checkpoint is `CDB-V1-030B-PROTECTED-COMMAND-IMPLEMENTATION-AND-ROUTE-INTEGRATION`.

It must reduce the 63 `command_required` writers by implementing the frozen command-only boundaries and integrating route writers without changing CDB-V1-020 owner tables, command names, provider keys, public IDs, status vocabularies, money equations or compatibility contracts.

Completion requires every protected writer to be one of:

- `canonical_command`;
- `atomic_compatibility`;
- `external_governed`;
- an intentionally isolated non-runtime fixture.

Replay, changed-replay conflict, concurrency guards, tenant isolation, full-batch rollback and zero unexplained minor-unit variance remain mandatory.

## Verification

```text
pnpm canonical:protected-core-writer-coverage-generate
pnpm canonical:protected-core-writer-coverage-check
pnpm vitest run test/canonical/protected-core-writer-command-coverage.test.ts
pnpm canonical:check
pnpm exec tsc --noEmit
pnpm worktree:check -- --mode=task --allow-dirty
```

The checker fails on a missing writer, missing frozen concept/command, stale artifact, missing source path, incomplete one-batch rule, atomic writer without a strict boundary, fixture mismatch, Canonical classification mismatch or any production authorization flag.

No production database, runtime, deployment, provider flag, traffic, migration/backfill or legacy retirement was accessed or changed.
