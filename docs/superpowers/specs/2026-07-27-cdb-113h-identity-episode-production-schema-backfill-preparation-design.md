# CDB-113H Identity and Episode Production Schema/Backfill Preparation Design

**Checkpoint:** `CDB-113H-IDENTITY-EPISODE-PRODUCTION-SCHEMA-BACKFILL-PREPARATION`  
**Date:** 2026-07-27  
**Mode:** read-only planning and evidence  
**Production mutation authorized:** no

## 1. Design objective

CDB-113H converts the CDB-113G schema blocker into a deterministic future execution graph. It does not apply migrations or backfills. It binds the exact repository migration hashes, production ledger state, semantic migration status, tenant-100 aggregate baseline, backfill dependencies, reconciliation equations, rollback prerequisites, and separate future authorization gates.

No production migration or backfill is authorized by this design.

## 2. Why standard pending-list execution is unsafe

Wrangler reports these pending files:

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

Production already records `0541_patient_merge_map_hardening.sql`, while the repository uses `0541_canonical_local_sync_protocol.sql`. Production also already contains the exact table and four indexes represented by repository `0547_patient_merge_map_hardening.sql`.

Therefore migration names, hashes, and semantic effects must be reviewed independently. Numeric ordering alone cannot establish migration identity.

## 3. Migration semantics

### True pending, low-to-medium schema risk

- repository `0541` creates disconnected local-sync protocol tables;
- `0542` alters the new inbox table and adds assertion/triggers;
- `0543` alters an existing outbox table containing 66 tenant-100 rows;
- `0544` creates patient-link authority for 325 patient sources;
- `0545` alters 30 existing tenant-100 practitioner rows with version/evidence defaults;
- `0546` creates appointment authority for 141 appointment/consultation sources.

Local sync must remain disabled before, during, and after these schema changes.

### Ledger-name drift

`0547_patient_merge_map_hardening.sql` is schema-equivalent to production `0541_patient_merge_map_hardening.sql`. The future clone rehearsal must prove:

- zero table change;
- zero index change;
- zero row change;
- only the new migration ledger name becomes recorded.

### High-risk rebuild

`0548_canonical_encounter_admission_bed_convergence.sql` creates the missing `canonical_admissions` and `canonical_beds` authorities, but also rebuilds `canonical_encounters` and `canonical_bed_stays`.

Tenant 100 has:

- 234 existing canonical encounter rows;
- 28 existing canonical bed-stay rows.

The 262 rows require exact pre/post parity, not only successful migration exit status.
### Additional pending non-identity migrations

`0549_approval_revision_policy.sql` rebuilds approval decision/event tables with revision-scoped history. `0550_canonical_credit_note_cash_refund_reversals.sql` adds immutable refund-reversal authority. Both are included in the protected clone rehearsal because Wrangler reports them in the same serial pending set, but neither changes the four identity/episode authority blockers or authorizes runtime activation.

## 4. Required authority result

After a successful clone rehearsal, the schema must include:

- `canonical_tenant_patient_links`;
- `canonical_tenant_patient_link_events`;
- `canonical_appointments`;
- `canonical_appointment_status_events`;
- `canonical_appointment_encounter_links`;
- `canonical_care_locations`;
- `canonical_beds`;
- `canonical_admissions`;
- `canonical_admission_status_events`;
- hardened `canonical_encounters`;
- hardened `canonical_bed_stays`;
- canonical sync inbox and lifecycle support.

CDB-113G's direct observation blockers remain:

- `canonical_tenant_patient_links`;
- `canonical_appointments`;
- `canonical_admissions`;
- `canonical_beds`.

## 5. Backfill graph

The backfill graph is serial where identity evidence is required:

```text
PATIENT_LINKS ─┬─> APPOINTMENTS ─> ENCOUNTER_ADMISSION_BED
PRACTITIONERS ─┘
```

Patient links and practitioners may be rehearsed as separate partitions, but appointments must wait for both. Encounter/admission/bed convergence must wait for patient, practitioner, and appointment evidence.

Every partition must be:

- tenant-scoped;
- deterministic;
- resumable;
- issue-preserving instead of guessing;
- idempotent;
- followed by a zero-new-row second pass;
- followed by persistent aggregate reconciliation.

## 6. Clone rehearsal architecture

A future authorized clone rehearsal must:

1. capture a protected production export and Time Travel bookmark;
2. build an isolated clone with verified database identity;
3. record exact pre-migration table counts, schemas, indexes, triggers, FKs, and migration ledger;
4. apply `0541` through `0550` serially using the reviewed hashes;
5. prove `0547` is a schema-equivalent no-op;
6. prove `0548` preserves all 234 encounter and 28 bed-stay rows;
7. prove `0549` preserves approval decision/event rows while enforcing revision contracts;
8. prove `0550` adds refund-reversal schema with valid FKs and no runtime activation;
9. run FK and schema checks;
10. run four backfill partitions serially;
11. rerun every partition with zero new business rows;
12. persist reconciliation receipts;
13. capture rollback/reopen timing;
14. destroy or retain the protected clone according to the authorization.

The clone must never be confused with production, preview, or an active local-sync node.

## 7. Reconciliation equations

At minimum:

```text
patient_sources = patient_links + stable_patient_link_issues
practitioner_sources = practitioner_mappings + stable_practitioner_issues
appointment_sources = appointment_mappings + stable_appointment_issues
encounters_before_0548 = encounters_after_0548
bed_stays_before_0548 = bed_stays_after_0548
second_pass_new_business_rows = 0
active_fk_violations = 0
cross_tenant_relationships = 0
unexplained_duplicate_active_mappings = 0
```

The current aggregate baselines include 325 patients, 30 practitioner sources, 141 appointment intents, 234 canonical encounters, 65 admissions, 31 beds, 32 patient-bed-info rows, and 28 canonical bed stays.

## 8. Authorization separation

The design creates six independent future stages:

1. `H0_PROTECTED_EXPORT_AND_CLONE`;
2. `H1_CLONE_SERIAL_MIGRATION_REHEARSAL`;
3. `H2_CLONE_BACKFILL_RECONCILIATION`;
4. `H3_PRODUCTION_SCHEMA_AUTHORIZATION`;
5. `H4_PRODUCTION_BACKFILL_AUTHORIZATION`;
6. `H5_REPEAT_READONLY_OBSERVATION`.

Authorization for clone access does not authorize production schema mutation. Production schema authorization does not authorize tenant backfill. Backfill authorization does not authorize provider flags, route wiring, traffic movement, or promotion.

## 9. Stop conditions

Stop immediately if:

- any migration hash differs;
- production/clone identity is ambiguous;
- protected export or bookmark evidence is absent;
- `0547` causes a schema or row mutation beyond ledger reconciliation;
- `0548` changes encounter or bed-stay counts;
- FK violations increase;
- any backfill guesses identity from names, phones, labels, numeric coincidence, or time proximity;
- second pass writes new business rows;
- provider flags become enabled;
- any step attempts production mutation without stage-specific authorization.

## 10. Current result and next checkpoint

The preparation is locally complete when its checker passes, but `mutationReady` remains false.

Exact next checkpoint:

`CDB-113H1-PROTECTED-CLONE-MIGRATION-REHEARSAL-AUTHORIZATION-REQUIRED`

No production migration or backfill is authorized.
