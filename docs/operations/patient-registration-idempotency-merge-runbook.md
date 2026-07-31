# Patient Registration Idempotency and Merge Operations Runbook

Date: 2026-07-26

## Purpose

This runbook covers deployment and verification for retry-safe patient registration and audited patient duplicate merge/rollback.

## Safety Rules

1. Export D1 before bulk merge maintenance.
2. Never merge on name or mobile alone when other demographics differ.
3. Do not merge while either patient has an active admission.
4. Always preview and compare both snapshots before apply.
5. Verified accounting journal lines and immutable clinical/audit evidence are retained on the inactive historical alias.
6. Never hard-delete a merged patient alias.
7. Do not log patient payloads or the short-lived confirmation value returned by preview.

## Deployment Order

```bash
pnpm build:migrations
pnpm exec tsc --noEmit
pnpm build
pnpm exec wrangler d1 migrations apply DB --env production --remote
pnpm exec wrangler d1 migrations list DB --env production --remote
pnpm exec wrangler deploy --env production
```

Required migrations:

- `0540_patient_registration_idempotency.sql`
- `0547_patient_merge_map_hardening.sql`

For hospital LAN/local-server deployment, follow `agents.md`. Do not blindly replay every historical migration against an imported tenant snapshot.

## Backup

```bash
pnpm exec wrangler d1 export DB \
  --env production \
  --remote \
  --output backups/prod-pre-patient-integrity-YYYYMMDD-HHMMSS.sql
```

The export contains sensitive patient and financial data. Do not commit or share it.

## Registration Idempotency Checks

Confirm the patient column and unique index:

```sql
SELECT name
FROM pragma_table_info('patients')
WHERE name = 'registration_idempotency_key';

SELECT name, sql
FROM sqlite_master
WHERE type = 'index'
  AND name = 'idx_patients_tenant_registration_idempotency';
```

Confirm no duplicate durable keys:

```sql
SELECT tenant_id, registration_idempotency_key, COUNT(*) AS row_count
FROM patients
WHERE registration_idempotency_key IS NOT NULL
  AND registration_idempotency_key <> ''
GROUP BY tenant_id, registration_idempotency_key
HAVING COUNT(*) > 1;
```

Expected: zero rows.

Inspect recent registration attempts without exposing stored response data:

```sql
SELECT tenant_id, idempotency_key, request_hash, status, source_id,
       created_at, updated_at
FROM billing_mutation_idempotency_keys
WHERE mutation_type = 'patient_registration'
ORDER BY updated_at DESC
LIMIT 100;
```

Find stale pending attempts:

```sql
SELECT tenant_id, idempotency_key, request_hash, created_at, updated_at
FROM billing_mutation_idempotency_keys
WHERE mutation_type = 'patient_registration'
  AND status = 'pending'
  AND updated_at < datetime('now', '-15 minutes')
ORDER BY updated_at ASC;
```

Before changing a stale attempt, check for a durable patient:

```sql
SELECT id, tenant_id, patient_code, registration_idempotency_key, created_at
FROM patients
WHERE tenant_id = ?
  AND registration_idempotency_key = ?;
```

When the patient exists, retry the original request with the same attempt key so the application reconstructs and completes the original response. Do not register another patient manually.

## Merge Workflow

Authorized roles: hospital admin, MD, and super-admin.

1. Scan candidates with `GET /api/patient-duplicates/scan`.
2. Compare two IDs with `GET /api/patient-duplicates/compare`.
3. Preview with `POST /api/patient-duplicates/preview-merge` using primary ID, secondary ID, and a meaningful reason.
4. Review movable and retained row counts plus both snapshots.
5. Apply with `POST /api/patient-duplicates/apply-merge`, supplying the short-lived confirmation value returned by preview.
6. Replaying an already-applied confirmation returns the original result without moving rows again.

Verify merge logs and record maps:

```sql
SELECT id, primary_patient_id, merged_patient_id, request_hash,
       rows_moved_json, applied_at
FROM patient_merge_log
WHERE tenant_id = ?
ORDER BY id DESC
LIMIT 20;

SELECT merge_log_id, table_name, column_name, COUNT(*) AS mapped_rows
FROM patient_merge_record_map
WHERE tenant_id = ?
GROUP BY merge_log_id, table_name, column_name
ORDER BY merge_log_id DESC, table_name, column_name;
```

Verify patient state:

```sql
SELECT id, patient_code, name, mobile, is_active, is_duplicate,
       duplicate_of_patient_id
FROM patients
WHERE tenant_id = ?
  AND id IN (?, ?);
```

Expected secondary state:

- inactive;
- duplicate-marked;
- linked to the surviving patient;
- visibly marked as merged in name/mobile.

## Reference Policies

- `move`: rows are reassigned to the surviving patient.
- `retain_verified_accounting`: only non-verified accounting rows move.
- `retain_immutable`: evidence remains on the historical alias.

Retained examples include verified accounting lines, protected analyzer/retraction evidence, issued certificates, portal/link/bridge/QR audit evidence, historical consent grants, and migration backup tables.

## Rollback

1. Read recent history from `GET /api/patient-duplicates/history`.
2. Reverse through `POST /api/patient-duplicates/unmerge` with merge-log ID and a clear reason.
3. Review returned `tables_reverted` and the merge audit.

Rollback uses `patient_merge_record_map` for exact table/column/record restoration and can read legacy map rows for older merges. The secondary patient identity and demographic state is restored from its saved snapshot. Rows that became immutable after merge may remain retained rather than being rewritten.

## Post-Deployment Verification

```bash
pnpm exec vitest run \
  test/patient-registration-idempotency-schema.test.ts \
  test/unit/request-idempotency.test.ts \
  test/patient-registration-idempotency.test.ts \
  test/patient-registration-linking.test.ts \
  test/mpi-merge.test.ts \
  test/patient-reference-registry.test.ts

pnpm --filter web exec vitest run \
  src/pages/PatientForm.idempotency.test.tsx \
  src/pages/PatientForm.test.ts

pnpm exec tsc --noEmit
pnpm build:migrations
pnpm exec wrangler d1 migrations list DB --env production --remote
```

Expected: tests pass, typecheck exits successfully, the generated migration manifest includes 0433 and 0434, and required production migrations are no longer pending.

## Incident Response

If duplicate patients reappear:

1. preserve both IDs and timestamps;
2. record user role and browser/network circumstances;
3. inspect patient-registration idempotency state and durable patient key;
4. do not delete either patient;
5. take a backup;
6. use audited preview/apply/rollback only.
