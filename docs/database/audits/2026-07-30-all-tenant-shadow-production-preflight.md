# CDB-V1-070 All-Tenant Shadow Production Preflight Audit

**Observed:** 2026-07-30  
**Workspace:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Production database:** `hms-super-admin-production-apac`  
**Production database UUID:** `c68a5360-a2c1-44cc-9e71-f21057bea102`  
**Audit mode:** aggregate/read-only  
**Production mutation performed:** no

## Owner direction

Enable Canonical shadow processing for every active tenant while Legacy remains fully available and continues serving user-visible reads and writes. Compare Legacy and Canonical evidence over multiple days before considering any Canonical promotion.

## Read-only production evidence

### Existing financial shadow

Command:

```text
pnpm exec tsx scripts/canonical/validate-production-financial-shadow-scope.ts --output <protected-output>
```

Result:

- evidence ready: `true`;
- activation ready: `true`;
- active tenant IDs: `1`, `100`, `101`, `102`;
- issue count: `0`;
- rows written: `0`;
- production mutation performed: `false`.

Conclusion: the existing non-blocking financial dual-write/shadow policy is already active for every current active tenant and must not be rewritten merely to satisfy the new request.

### Nine read-provider shadow flags

A new aggregate-only provider-scope validator checked the exact nine CDB-V1-060 provider keys for every active tenant.

Result:

- evidence ready: `true`;
- activation ready: `false`;
- provider count: `9`;
- active tenant count: `4`;
- expected flag rows after activation: `36`;
- current shadow-enabled rows: `0`;
- current missing rows: `36`;
- issue count: `9`;
- rows written: `0`;
- production mutation performed: `false`.

Each provider currently reports `PROVIDER_SHADOW_INCOMPLETE`:

- `canonical_invoice_provider_v1`;
- `canonical_payment_provider_v1`;
- `canonical_deposit_provider_v1`;
- `canonical_patient_identity_provider_v1`;
- `canonical_practitioner_provider_v1`;
- `canonical_appointment_provider_v1`;
- `canonical_encounter_provider_v1`;
- `canonical_admission_bed_provider_v1`;
- `canonical_compensation_accrual_provider_v1`.

### Production Worker binding

Current production deployment status:

- active version: `4f5d8f93-92d4-4fda-8fba-c0a2863f1b71` at `100%`;
- active tag: `release-20260729T184651Z-f11f09f352-dashboard-modal`;
- active source commit: `f11f09f3526ea453632951455c73c727568dbfdb`;
- retained rollback version: `db8ece29-efd0-4827-8b65-968619557f0d` at `0%`.

Conclusion: production does not yet run the CDB programme branch implementation containing the complete nine-provider shadow path.

### Production migration state

The production migration list contains 29 pending migrations:

1. `0541_canonical_local_sync_protocol.sql`
2. `0542_canonical_sync_inbox_lifecycle.sql`
3. `0543_canonical_sync_outbox_lifecycle.sql`
4. `0544_canonical_tenant_patient_links.sql`
5. `0545_canonical_practitioner_operational_adoption.sql`
6. `0546_canonical_appointment_authority.sql`
7. `0547_patient_merge_map_hardening.sql`
8. `0548_canonical_encounter_admission_bed_convergence.sql`
9. `0549_approval_revision_policy.sql`
10. `0550_canonical_credit_note_cash_refund_reversals.sql`
11. `0551_workforce_roster_integrity.sql`
12. `0552_attendance_projection_integrity.sql`
13. `0553_mfa_registration_schema_repair.sql`
14. `0554_canonical_prescription_medication_intent.sql`
15. `0555_canonical_clinical_document_diagnosis.sql`
16. `0556_canonical_patient_vital_measurement.sql`
17. `0557_canonical_medication_administration.sql`
18. `0558_canonical_lab_result_specimen.sql`
19. `0559_canonical_radiology_acquisition_report.sql`
20. `0560_canonical_emergency_case_triage.sql`
21. `0561_compensation_rule_route_identity.sql`
22. `0563_practitioner_route_identity.sql`
23. `0564_patient_import_route_identity.sql`
24. `0565_appointment_route_identity.sql`
25. `0566_appointment_schedule_route_identity.sql`
26. `0567_encounter_visit_route_identity.sql`
27. `0568_service_delivery_route_identity.sql`
28. `0569_service_catalog_route_identity.sql`
29. `0570_doctor_commission_rule_version_snapshot.sql`

A corrected repository review found that 27 of the 29 migration candidates are additive, while `0548_canonical_encounter_admission_bed_convergence.sql` and `0549_approval_revision_policy.sql` use data-preserving SQLite table rebuild sequences with rename/copy/drop operations. The earlier zero-match static-scan conclusion was incorrect. These two migrations require explicit rebuild authorization, pre/post row-parity evidence, a bounded exclusive-lock budget, protected backup/Time Travel evidence and post-apply integrity verification; they must not be treated as ordinary zero-downtime additive changes.

## Repository implementation added

### All-tenant provider shadow SQL contract

`scripts/canonical/set-production-all-tenant-provider-shadow.ts` now provides:

- exact nine-provider scope;
- all-active-tenant shadow upsert;
- explicit `responseAuthority=legacy`;
- explicit `readPolicy=shadow`;
- exact disable-only rollback;
- aggregate-only post-state verification SQL;
- strict evaluation of missing, non-shadow, duplicate or inconsistent evidence.

### Read-only production validator

`scripts/canonical/validate-production-all-tenant-provider-shadow-scope.ts` now:

- verifies the exact production D1 name and UUID;
- executes only aggregate `SELECT` evidence;
- rejects any D1 response that reports a database change or written row;
- writes a mode-600 receipt only under an existing mode-700 directory outside the repository;
- exits non-zero when the all-tenant provider shadow state is incomplete.

Package command:

```text
pnpm canonical:production-all-tenant-provider-shadow-scope -- --output <protected-output>
```

## Safety decision

The nine provider flags were **not** activated during this audit. Immediate activation would be unsafe because:

1. the production Worker is still bound to the pre-CDB `origin/main` commit;
2. all nine provider flag rows are absent;
3. 29 required/prerequisite migrations are pending;
4. required all-tenant backfills and second-pass evidence have not run against the current production source;
5. exact candidate, backup/bookmark, owner, threshold and rollback bindings are not yet present in one fresh protected execution authorization.

## Required next execution sequence

1. integrate and deploy the exact reviewed candidate with all new providers Legacy-default;
2. capture protected backup/Time Travel and candidate evidence;
3. apply and verify the exact pending migration set without user-facing downtime;
4. run bounded all-tenant backfills and mandatory second pass;
5. reconcile all active tenants with zero unexplained variance;
6. activate the nine provider flags for all active tenants in `shadow` mode with Legacy response authority;
7. run the aggregate validator and require 36/36 exact rows for the current tenant set;
8. observe daily and retain immediate provider-disable and Worker rollback paths.

## Repository verification

- focused tests: 9 files / 42 tests passed;
- root TypeScript: passed;
- task tracker YAML: valid;
- migration manifest: 504 governed migrations;
- schema and authority governance: zero issues;
- access governance: 260 tables / 1,035 writers / 2,726 readers / zero issues;
- identity and episode coverage: 859 reader pairs / 297 paths / 63 tables / zero unknown assignments;
- protected-core inventory: 954 surfaces / 235 writers / 522 readers;
- protected writer coverage: zero command-required and zero unclassified writers;
- historical protected-clone rehearsal: result ready, zero issues, Legacy final provider;
- historical CDB-V1-060 package: package ready, execution not ready, zero issues.

## Final audit status

- existing financial all-tenant shadow: active and healthy;
- nine-provider all-tenant shadow: not active;
- production mutation: none;
- deployment/traffic change: none;
- migration/backfill: none;
- Legacy authority: unchanged;
- next state: exact zero-downtime deploy/migrate/backfill/reconcile authorization required before activation.
