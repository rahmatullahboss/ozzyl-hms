# CDB-105A Legacy-Write Retirement Preparation Design

## Status

Approved continuation design for the long-running CDB program branch.

## Context

The historical remote branch `origin/feature/hms-canonical-data-architecture` is an ancestor of current local `main`; current `main` contains all historical CDB work plus later reviewed commits. The continuous branch `program/cdb-main-continuous-20260725` starts at the exact current local-main head.

The program integration direction is now intentionally asymmetric:

- regularly synchronize reviewed local `main` into the continuous CDB branch;
- do not merge CDB checkpoints back into `main` while the program remains active;
- perform one final CDB-to-main integration only after all locally executable CDB work, review, and verification are complete;
- never overwrite or adopt the dirty owner-facing checkout at `/Users/rahmatullahzisan/Desktop/Dev/hms`.

## Problem

`docs/database/legacy-table-disposition.yaml` currently registers five active legacy tables and 65 exact direct-write allowances. Governance proves that every allowance points to a real file and a real write, but it does not prove why the write is still required, which authority mode it serves, what blocks retirement, or when it was last reviewed.

Many entries still say “remove by P05/P06/P07/P08” even though production cutover and observation have not completed. Removing those writes now would break disabled/shadow compatibility or strict atomic dual-write. Leaving them without current lifecycle evidence would allow stale exceptions to survive indefinitely.

## Decision

Split original CDB-105 into two controlled stages:

### CDB-105A — local preparation

Perform locally without production mutation:

1. classify every registered direct legacy write;
2. require lifecycle and retirement evidence in governance;
3. produce a deterministic aggregate retirement report;
4. update the tracker with the continuous branch and one-way synchronization contract;
5. preserve all reviewed runtime behavior.

### CDB-105B — actual retirement

Deferred until the named production domain has completed canonical cutover and observation. It will remove compatibility writes, introduce required compatibility views/adapters, and prove zero active production writers. It must not begin from phase labels alone.

## Registry contract

Every direct-write allowance must retain its existing exact `path`, `table`, `owner`, `removalPhase`, and `reason`, and add:

- `lifecycleStatus`:
  - `legacy_authority` — the active legacy path still owns the write in disabled or legacy mode;
  - `canonical_compatibility` — canonical strict/shadow orchestration deliberately maintains a guarded legacy projection;
  - `protected_fixture` — a protected synthetic verification fixture creates and removes exact evidence;
- `retirementBlocker` — a non-empty precise reason that retirement is unsafe now;
- `retirementTask` — the checkpoint that must remove or reclassify the allowance, initially `CDB-105B`;
- `reviewedAtUtc` — an ISO-8601 UTC timestamp.

Governance must reject missing fields, invalid lifecycle values, invalid timestamps, wildcard scope, duplicate scope, stale paths, and allowances that no longer match an actual write.

## Deterministic report

A local-only report command will summarize:

- registered legacy tables by disposition and write policy;
- allowances by table, owner, lifecycle status, and removal phase;
- allowances with missing or invalid retirement evidence;
- exact paths requiring CDB-105B review.

The report must not inspect production, expose tenant data, or mutate files/databases.

## Runtime safety

CDB-105A changes governance metadata, tests, local reporting, planning documents, and tracker state only. It must not:

- remove a legacy write;
- alter disabled, shadow, or strict runtime behavior;
- create a destructive migration;
- enable local-server synchronization;
- change production flags, traffic, data, or deployment state;
- merge CDB checkpoints into `main`.

## Verification

Required gates:

- focused governance and retirement-report tests;
- real repository canonical governance with zero issues;
- TypeScript;
- migration manifest remains unchanged in count;
- task worktree policy and diff check;
- current continuous branch remains ahead of or equal to local `main`, never behind when implementation starts.

## Completion boundary

CDB-105A is complete when every current allowance has validated lifecycle evidence, the deterministic report passes, and the tracker records the one-way synchronization contract. This does not claim that legacy writes are retired or that P11 is complete.
