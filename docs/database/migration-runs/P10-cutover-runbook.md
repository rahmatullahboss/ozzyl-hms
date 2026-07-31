# P10 Canonical HMS Cutover Runbook Rehearsal

Date: 2026-07-14

Task: CDB-100 — Build and rehearse the domain cutover runbook

Worker branch: `task/cdb-100-cutover-runbook`

Program base: `4639008ab33f88ded46d45675eea212f62816fc4`

## Result

The fail-closed cutover checker and two isolated-clone rollback rehearsals passed.

Final checker result:

- decision: `go`
- rehearsal ready: `true`
- eligible for production cutover: `false`
- validated rehearsals: `2`
- blocking issues: `0`
- aggregate measured duration: `25,154 ms`
- maximum rollback duration: `4,597 ms`
- maximum reopen verification duration: `1,622 ms`
- production mutation performed: `false`
- evidence output: aggregate-only and PHI-free

`go` means that the CDB-100 rehearsal contract passed. It does not authorize CDB-101 or any production mutation. Production eligibility remains false because no named-domain production authorization was provided and canonical migrations remain unapplied in production.

## Scope

CDB-100 added:

- `scripts/canonical/cutover-check.ts`
- `test/canonical/cutover-runbook.test.ts`
- this aggregate rehearsal report

The task did not:

- apply a production migration;
- enable a production canonical or shadow flag;
- deploy a Worker;
- modify an active production report route;
- push Git state;
- merge to `main`;
- retire a legacy write path;
- reconnect the local server;
- execute CDB-101.

## Checker authority

The checker consumes an aggregate evidence document. It does not query or mutate a database itself.

It produces only:

- a stable `go` or `no_go` decision;
- rehearsal readiness;
- separately gated production eligibility;
- stable blocker codes;
- aggregate duration metrics;
- rehearsal count;
- issue count.

It does not echo:

- operator public IDs;
- bookmark IDs;
- export hashes;
- source row data;
- patient or clinical details;
- protected SQL;
- credentials or signed URLs.

Malformed runtime JSON fails closed with `CDB100_EVIDENCE_INVALID` rather than throwing an unclassified exception.

## Required ordered sequence

Every rehearsal must record these steps in this exact order:

1. `maintenance_mode`
2. `bookmark`
3. `export`
4. `delta_backfill`
5. `reconciliation`
6. `domain_flags`
7. `smoke_tests`
8. `go_no_go`
9. `reopen`

Every step requires a passed status and a measured positive safe-integer duration.

## Fail-closed gates

The checker blocks cutover for any of the following classes.

### Identity and rehearsal evidence

- fewer than two distinct rehearsals;
- duplicate rehearsal IDs;
- incomplete or reordered steps;
- invalid or unmeasured durations;
- production database identity mismatch;
- stale production identity inspection;
- unverified production account or manifest identity;
- exact clone UUID mismatch.

### Maintenance, backup, and rollback evidence

- maintenance/read-only mode or accountable owner missing;
- verified bookmark missing or tied to the wrong database;
- protected export missing, empty, unverified, or hash-mismatched;
- export source identity mismatch;
- missing encryption, access control, or retention ownership;
- rollback or reopen not verified;
- rollback or observation owner missing;
- rollback or reopen duration missing.

### Migration and backfill evidence

- incomplete delta-backfill checkpoints;
- failed backfill rows;
- source evidence drift;
- manifest checksum mismatch;
- unknown migration;
- pending approved migration.

### Reconciliation and processing evidence

- non-zero financial variance in any currency;
- unexplained variance;
- unresolved critical canonical exception;
- foreign-key violation;
- unsafe integer evidence;
- tenant-isolation violation;
- failed or dead-letter canonical outbox item;
- failed, retrying, or dead-letter accounting posting job.

### Flag and smoke-test evidence

- non-tenant-scoped flag plan;
- global canonical switch;
- missing domain flag plan;
- production flag enabled before authorization;
- missing smoke-test plan;
- incomplete required smoke coverage;
- any failed smoke scenario.

### Production authorization

Production eligibility additionally requires:

- `mode=production`;
- a proposed production mutation;
- explicit authorization for a named domain;
- a non-empty authorization identity;
- a future authorization expiry;
- zero other blocker issues.

A rehearsal can therefore be ready while production eligibility remains false.

## Test-driven verification

The first focused run failed because the cutover checker module did not exist.

Initial RED result:

- file: `test/canonical/cutover-runbook.test.ts`
- failure: expected missing module
- production code present before RED: no

Initial GREEN result:

- files: `1`
- tests: `15`
- failures: `0`

Adversarial review then found two correctness gaps:

1. a successful rehearsal incorrectly exposed `eligibleForProductionCutover=true` without production authorization;
2. malformed runtime JSON could throw before returning a classified no-go result.

Both were reproduced with failing tests and fixed.

Final focused result:

- files: `1`
- tests: `17`
- failures: `0`

Coverage includes all blocker classes, stable issue ordering, safe-integer duration handling, aggregate output minimization, rehearsal versus production eligibility, and malformed evidence.

## Clean baseline and structural verification

Before implementation:

- canonical/integration files: `30`
- tests: `247`
- failures: `0`

After implementation and review fixes:

- canonical/integration files: `31`
- tests: `264`
- failures: `0`
- focused cutover tests: `17`
- migration manifest entries: `443`
- new database migration: none
- canonical governance issues: `0`
- TypeScript errors: `0`

## Protected export evidence

Existing access-controlled exact snapshot:

- path class: protected storage outside Git
- SHA-256: `7e2e94b23846dcc56e1ebfae835881e025e525f9f56e733d1ad4f59478aec65f`
- size: `44,183,552` bytes
- encrypted/access-controlled evidence: required by the aggregate checker input
- source contents committed to Git: no

The hash and size were freshly recomputed before the checker run.

## Isolated clone identity

Rehearsal database:

- name: `hms-canonical-rehearsal-20260713-b6036e`
- UUID: `6f9a17af-8e3e-4b26-85b7-08c653a706db`
- region: `APAC`
- restored baseline size: `44,138,496` bytes
- exact UUID match: passed

The clone contains all eleven approved canonical migrations:

- `0505_canonical_program_foundation.sql`
- `0506_canonical_practitioners.sql`
- `0507_canonical_encounters.sql`
- `0508_canonical_service_catalog.sql`
- `0509_canonical_service_requests_events.sql`
- `0510_canonical_invoices.sql`
- `0511_canonical_payments.sql`
- `0512_canonical_adjustments.sql`
- `0513_canonical_practitioner_compensation.sql`
- `0514_canonical_inventory_links.sql`
- `0515_canonical_accounting_outbox.sql`

Approved generated manifest checksum:

- `sha256:b94ce61da321c806cbfe17c8fbc3f6d3006f8e28d6c868ecc288e1fe11cf8b09`

## Clone aggregate readiness checks

The aggregate readiness query was executed twice before rollback drills.

Both passes returned:

- unresolved critical canonical issues: `0`
- outbox retry items: `0`
- outbox dead-letter items: `0`
- accounting retry jobs: `0`
- accounting dead-letter jobs: `0`
- incomplete migration runs: `0`
- failed reconciliation runs: `0`
- non-zero reconciliation variance runs: `0`
- enabled canonical production-mode flags: `0`
- prohibited global flags: `0`
- foreign-key violations: `0`
- database changed: `false`
- rows written: `0`

## Rehearsal 1

Pre-mutation bookmark:

- `00000024-00000000-000050a8-d3d9a808603f6e96a6f0a2a950766c9f`

Controlled clone-only mutation:

- created one temporary PHI-free rehearsal marker table;
- inserted one synthetic rehearsal marker;
- production contacted for mutation: no;
- production flag changed: no;
- canonical domain data changed: no.

Rollback:

- restored exact clone to the pre-mutation bookmark;
- restore duration: `4,597 ms`;
- prior post-mutation bookmark: `00000025-ffffffff-000050a8-b5fb123c6fa5b5aec4441f430b95f1f9`.

Post-restore and reopen verification:

- temporary marker tables: `0`
- clone size: `44,138,496` bytes
- unresolved critical issues: `0`
- blocked outbox items: `0`
- blocked accounting jobs: `0`
- enabled canonical flags: `0`
- foreign-key violations: `0`
- verification query changed database: `false`
- verification query rows written: `0`
- reopen verification duration: `1,622 ms`.

## Rehearsal 2

Pre-mutation bookmark:

- `00000026-00000000-000050a8-0de1ef6754f09ca888fe1919960aa63d`

Controlled clone-only mutation:

- recreated the temporary PHI-free marker table;
- inserted a second synthetic rehearsal marker;
- production contacted for mutation: no;
- production flag changed: no;
- canonical domain data changed: no.

Rollback:

- restored exact clone to the second pre-mutation bookmark;
- restore duration: `4,531 ms`;
- prior post-mutation bookmark: `00000026-ffffffff-000050a8-2307c468c195364049a9835f3a95de13`.

Post-restore and reopen verification:

- temporary marker tables: `0`
- clone size: `44,138,496` bytes
- unresolved critical issues: `0`
- blocked outbox items: `0`
- blocked accounting jobs: `0`
- enabled canonical flags: `0`
- foreign-key violations: `0`
- verification query changed database: `false`
- verification query rows written: `0`
- reopen verification duration: `962 ms`.

## Aggregate checker execution

Protected evidence was stored outside Git under the access-controlled CDB-100 rehearsal directory.

Checker result after review hardening:

```json
{
  "schemaVersion": 1,
  "decision": "go",
  "rehearsalReady": true,
  "eligibleForProductionCutover": false,
  "validatedRehearsalCount": 2,
  "issueCount": 0,
  "totalDurationMs": 25154,
  "maxRollbackDurationMs": 4597,
  "maxReopenDurationMs": 1622,
  "productionMutationPerformed": false,
  "aggregateOnly": true
}
```

No protected IDs, hashes, operator identities, or row details are emitted by the checker result itself.

## Production read-only boundary

Fresh production identity:

- database name: `hms-super-admin-production-apac`
- UUID: `c68a5360-a2c1-44cc-9e71-f21057bea102`
- region: `APAC`
- table count: `779`
- database size at inspection: `34,693,120` bytes

Read-only migration listing shows all eleven canonical migrations `0423` through `0433` as pending application.

Therefore:

- production canonical migration set applied: no
- production cutover authorized: no
- production eligibility: false
- production flags enabled by CDB-100: no
- production rows written by CDB-100: `0`
- Worker deployment performed: no
- Time Travel restore performed on production: no

One initial read-only aggregate query used an incorrect assumed settings-table name and failed atomically. Corrected SQL attempts were blocked by the tool safety layer before execution. No write occurred. Production migration state was then verified through the read-only Wrangler migration listing instead.

## Go/no-go verdict

### CDB-100 rehearsal verdict

`GO`

The fail-closed checker, ordered workflow, aggregate readiness checks, two distinct bookmarks, two real clone-only mutations, two restores, two reopen checks, and measured timing requirements passed.

### CDB-101 production verdict

`NO-GO — AUTHORIZATION REQUIRED`

Blocking facts:

- explicit named-domain production authorization is absent;
- canonical migrations `0423` through `0433` remain pending in production;
- no production domain flag plan has been authorized for execution;
- no production maintenance window has been authorized for CDB-101;
- CDB-100 does not own production cutover execution.

The next task remains `CDB-101` with status `pending_authorization`. No production action may occur from this report alone.

## Program integration

- implementation commit: `98b163e1`
- worker evidence commit: `afe2b276`
- non-fast-forward program merge: `7e75225bb0af8978d9e1a31aa65e3aacf3b0d74f`
- integrated verification: `31 files / 264 tests / 0 failures`
- integrated governance issues: `0`
- integrated migration manifest entries: `443`
- integrated TypeScript errors: `0`
- CDB-101 branch created: no
- next state: `pending_authorization`
