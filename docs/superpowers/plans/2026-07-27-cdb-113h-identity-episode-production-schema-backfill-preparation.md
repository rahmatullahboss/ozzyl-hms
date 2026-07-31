# CDB-113H Identity and Episode Production Schema/Backfill Preparation Plan

**Checkpoint:** `CDB-113H-IDENTITY-EPISODE-PRODUCTION-SCHEMA-BACKFILL-PREPARATION`  
**Execution mode:** read-only preparation  
**Production mutation:** prohibited

## Goal

Produce a complete fail-closed preparation package for the ten Wrangler-pending migrations and four identity/episode backfill partitions, while preserving production state unchanged.

No production migration or backfill is authorized by this plan.

## Task 1 — Freeze migration identity

1. Bind exact names and SHA-256 hashes for:
   - `0541_canonical_local_sync_protocol.sql`;
   - `0542_canonical_sync_inbox_lifecycle.sql`;
   - `0543_canonical_sync_outbox_lifecycle.sql`;
   - `0544_canonical_tenant_patient_links.sql`;
   - `0545_canonical_practitioner_operational_adoption.sql`;
   - `0546_canonical_appointment_authority.sql`;
   - `0547_patient_merge_map_hardening.sql`;
   - `0548_canonical_encounter_admission_bed_convergence.sql`;
   - `0549_approval_revision_policy.sql`;
   - `0550_canonical_credit_note_cash_refund_reversals.sql`.
2. Fail if file content or order drifts.
3. Record the production ledger collision between repository `0541_canonical_local_sync_protocol.sql` and production `0541_patient_merge_map_hardening.sql`.
4. Keep `mutationReady=false`.

## Task 2 — Classify semantic pending state

Classify nine migrations as true pending and one as schema-equivalent ledger-name drift. The identity/episode subset remains seven true pending plus one ledger drift; `0549/0550` are true pending non-identity migrations.

`0547_patient_merge_map_hardening.sql` must be classified against the existing production table/index schema and production ledger entry. A future clone rehearsal must prove it is a no-op except for Wrangler ledger reconciliation.

`0548_canonical_encounter_admission_bed_convergence.sql` must be classified as a high-risk rebuild because it reconstructs `canonical_encounters` and `canonical_bed_stays`.

## Task 3 — Freeze production aggregate baseline

Persist count-only tenant-100 evidence:

- 325 patients;
- 30 practitioner sources;
- 30 canonical practitioners;
- 141 appointment/consultation intents;
- 0 legacy encounter-table rows;
- 164 visits;
- 234 canonical encounters;
- 65 admissions;
- 31 beds;
- 32 patient-bed-info rows;
- 28 canonical bed stays;
- 66 canonical outbox events;
- 0 patient-merge-record-map rows.

Record exact D1 identity verification, zero changed-database envelopes, zero rows written, and no mutation.

## Task 4 — Freeze backfill dependency order

The future clone backfill order must be:

1. `scripts/canonical/backfill-tenant-patient-links.ts`;
2. `scripts/canonical/backfill-practitioners.ts`;
3. `scripts/canonical/backfill-appointments.ts`;
4. `scripts/canonical/backfill-encounter-admission-bed-convergence.ts`.

Appointments depend on patient and practitioner evidence. Encounter/admission/bed convergence depends on patient, practitioner, and appointment evidence.

Each backfill must have:

- explicit tenant `100` scope;
- bounded chunk size and resume key;
- stable source-evidence hash;
- deterministic IDs;
- stable issue IDs for ambiguity;
- source-row atomicity;
- zero-new-business-row second pass;
- persistent aggregate reconciliation.

## Task 5 — Define clone rehearsal gates

Future `H0_PROTECTED_EXPORT_AND_CLONE` authorization must name:

- protected production export location;
- production Time Travel bookmark;
- exact clone identity;
- export/import checksums;
- clone replacement policy;
- protected file modes;
- explicit no-production-mutation boundary.

Future `H1_CLONE_SERIAL_MIGRATION_REHEARSAL` must:

1. capture pre-migration schema/count/FK evidence;
2. apply the ten reviewed migrations serially;
3. prove `0547` is schema-equivalent and row-neutral;
4. prove `0548` preserves all 234 encounter and 28 bed-stay rows;
5. prove `0549` exact-copies approval decisions/events and enforces revision-scoped history;
6. prove `0550` adds refund-reversal schema with valid FKs and no runtime activation;
7. verify all new authority schema;
8. verify zero active FK violations;
9. capture rollback/reopen timing.

## Task 6 — Define clone backfill and reconciliation gates

Future `H2_CLONE_BACKFILL_RECONCILIATION` must:

1. run patient-link and practitioner partitions;
2. reconcile exact mappings and issues;
3. run appointment partition;
4. reconcile intent/status/encounter-link evidence;
5. run encounter/admission/bed partitions;
6. reconcile occupancy, admission lifecycle, mapping, and tenant isolation;
7. rerun all partitions and require zero new business rows;
8. preserve all provider flags disabled.

## Task 7 — Separate production authorizations

Future production schema authorization (`H3`) must not imply production backfill authorization (`H4`).

`H3_PRODUCTION_SCHEMA_AUTHORIZATION` requires:

- successful protected clone receipt;
- exact migration names and hashes;
- maintenance window;
- named rollback owner;
- pre-action bookmark/export;
- FK and row-count acceptance thresholds;
- immediate stop and restore procedure.

`H4_PRODUCTION_BACKFILL_AUTHORIZATION` requires:

- schema-ready production;
- exact tenant `100` scope;
- exact scripts, partitions, chunk sizes, and resume keys;
- zero-write second pass;
- read-only post-backfill reconciliation;
- separate rollback and stop conditions.

Neither stage authorizes feature flags, route changes, traffic changes, deployment, local sync, legacy retirement, push, or CDB-to-main integration.

## Task 8 — Repeat observation only after reconciliation

`H5_REPEAT_READONLY_OBSERVATION` may begin only when:

- `canonical_tenant_patient_links` exists;
- `canonical_appointments` exists;
- `canonical_admissions` exists;
- `canonical_beds` exists;
- all required mappings reconcile;
- provider flags remain disabled;
- a new read-only observation window is authorized.

## Verification

Run:

```text
pnpm vitest run test/canonical/identity-episode-production-schema-backfill-preparation.test.ts
pnpm exec tsx scripts/canonical/check-identity-episode-production-schema-backfill-preparation.ts
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build:migrations
pnpm vitest run test/canonical
pnpm canonical:local-sync-readiness
pnpm canonical:legacy-retirement-readiness
pnpm worktree:check -- --mode=task --allow-dirty
```

## Current stop gate

All six future stages remain unauthorized.

Exact next checkpoint:

`CDB-113H1-PROTECTED-CLONE-MIGRATION-REHEARSAL-AUTHORIZATION-REQUIRED`

No production migration or backfill is authorized.
