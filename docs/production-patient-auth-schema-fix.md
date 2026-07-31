# Production Patient Auth Schema Fix

## Current production issue

Patient self-registration on production fails with `500 Internal Server Error` because the live D1 schema is behind the code expected by the patient auth and global identity flows.

Missing live columns observed in production:

- `global_patient_identity.claim_status`
- `global_patient_identity.claimed_auth_user_id`
- `global_patient_identity.claimed_at`
- `global_patient_identity.created_source`
- `global_patient_identity.created_tenant_id`
- `global_patient_auth.identity_id`

These columns are introduced by [0105_global_identity_claims.sql](/Users/rahmatullahzisan/Desktop/Dev/hms/migrations/0105_global_identity_claims.sql).

## Code fallback added

The application now tolerates older schemas by:

- aliasing missing identity lifecycle fields to safe defaults
- dynamically omitting `identity_id` from inserts when the column is absent
- skipping claim updates when the legacy table does not support them

This reduces runtime failures on stale environments, but production should still be migrated so claim lifecycle and account linkage work fully.

## Recommended production sequence

1. Deploy the application code that includes the legacy-schema fallback.
2. Apply [0105_global_identity_claims.sql](/Users/rahmatullahzisan/Desktop/Dev/hms/migrations/0105_global_identity_claims.sql) to the production D1 database.
3. Confirm schema with:

```sql
PRAGMA table_info(global_patient_identity);
PRAGMA table_info(global_patient_auth);
```

4. Re-run:

```bash
pnpm test:e2e:prod:auth
```

## Expected post-migration outcome

- `POST /api/patient-auth/register` returns `201`
- patient dashboard opens without auth bootstrap failure
- identity claim lifecycle fields are persisted correctly
- `global_patient_auth.identity_id` links account and global identity
