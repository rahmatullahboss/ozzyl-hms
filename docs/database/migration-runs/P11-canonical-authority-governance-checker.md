# P11 Canonical Authority Governance Checker

**Checkpoint:** `CDB-112A-AUTHORITY-CHECKER-VERIFIED`  
**Program:** HMS Canonical Data Architecture  
**Branch:** `program/cdb-main-continuous-20260725`  
**Implementation commit:** `ea4a68ddc`  
**Execution mode:** local repository implementation and verification only  
**Production mutation performed: no**  
**Legacy writes retired: no**  
**Local-server synchronization activated: no**  
**Push or CDB-to-main integration performed: no**

## Objective

CDB-112A converts the full-HMS authority matrix from a documentation-only artifact into a fail-closed governance contract. The checker ensures that a future module, migration, report, or parallel branch cannot silently introduce another authority for an already governed business fact without failing the canonical verification gate.

The machine-readable source remains:

- `docs/database/canonical-authority-matrix.yaml`

The implementation is:

- `scripts/canonical/check-canonical-authority.ts`

The focused contract is:

- `test/canonical/canonical-authority-check.test.ts`

The durable new-session navigation document is:

- `docs/architecture/canonical-program-control-center.md`

## TDD evidence

### RED

The test was created before the checker implementation. The first focused run failed because the requested module did not exist:

```text
pnpm vitest run test/canonical/canonical-authority-check.test.ts
Error: Cannot find module '../../scripts/canonical/check-canonical-authority'
```

This proved that the new test was exercising a missing implementation rather than passing against existing behaviour.

### GREEN

The minimal checker and package commands were then implemented. The focused suite passed:

```text
pnpm vitest run test/canonical/canonical-authority-check.test.ts
1 file passed
8 tests passed
```

The test coverage includes:

1. the reviewed repository authority matrix passes with zero issues;
2. a canonical table with multiple owners fails closed;
3. an unowned registered canonical table fails closed;
4. a registered canonical table assigned to a gap or external concept fails closed;
5. a governed legacy table missing from all concepts fails closed;
6. matrix summary drift fails closed;
7. missing repository evidence paths fail closed;
8. any authority reference to `src/lib/financial-reconciliation/**` fails closed;
9. the package-level authority command remains mandatory inside the combined canonical governance command.

## Governance behaviour

The checker validates:

- matrix version, program name, and scope;
- the one-authority-per-fact policy;
- required canonical implementation roots;
- explicit rejection of the parallel financial-reconciliation architecture;
- local-sync expansion remains paused;
- production and destructive retirement authorization remain false;
- unique and valid business concept IDs;
- allowed target, source, backfill, reconciliation, cutover, and retirement statuses;
- required business concept metadata;
- exactly one implemented or partial canonical owner for every table registered in `canonical-source-of-truth.yaml`;
- no unknown, unowned, or multiply owned canonical table;
- no registered canonical table owned by a gap or externally governed concept;
- every governed legacy table is represented in the authority matrix;
- every registered module, writer, reader, backfill, and reconciliation evidence path exists;
- no concept appoints a rejected parallel implementation path;
- matrix summary counts equal calculated repository counts.

External operational authorities such as tenant patient identity and authentication users remain valid external-governed concepts. They may own their existing external tables, but they cannot claim a registered `canonical_*` table unless the concept becomes an implemented or partial canonical authority.

## Package commands

A separate schema-governance command is now retained:

```text
pnpm canonical:schema-check
```

The authority checker runs with:

```text
pnpm canonical:authority-check
```

The mandatory combined governance command is:

```text
pnpm canonical:check
```

`canonical:check` runs schema governance first and authority governance second. Either checker returning an issue causes the command to fail.

## Verified repository result

The current reviewed authority result is:

- business concepts: 45;
- registered canonical tables: 69;
- governed legacy tables: 5;
- implemented canonical concepts: 16;
- partial canonical concepts: 9;
- material canonical gaps: 18;
- externally governed concepts: 2;
- authority issues: 0;
- schema-governance issues: 0.

The implementation checkpoint was committed as:

```text
ea4a68ddc feat(canonical): enforce authority matrix
```

Fresh checkpoint verification also passed:

- continuity and governance focus: 4 files, 23 tests;
- complete canonical suite: 180 files, 1,294 tests;
- TypeScript: passed;
- canonical schema governance: 0 issues;
- canonical authority governance: 0 issues;
- migration manifest: 475 migrations;
- local-sync readiness: 0 ready and 8 blocked, as required while expansion is paused;
- legacy retirement readiness: 0 eligible and 65 blocked, as required before authorised cutover and observation.

## Safety result

No production database, protected production export, credential, secret, remote route, feature flag, traffic allocation, deployment, migration application, data backfill, or runtime synchronization process was accessed or changed by this checkpoint.

No legacy writer was removed. No compatibility path was retired. No destructive SQL or schema migration was introduced. The existing retirement gate remains authoritative and blocked until domain cutover, canonical read promotion, observation, rollback evidence, and fresh owner authorization are complete.

## Continuation

The exact next checkpoint is:

`CDB-112B-WRITER-READER-REGISTRIES`

It must add machine-readable full-HMS writer and reader registries, classify operational and migration paths, map active consumers to retirement blockers, and add fail-closed discovery checks. It must continue inside the same authoritative CDB program and must not revive a separate Canonical Finance architecture.
