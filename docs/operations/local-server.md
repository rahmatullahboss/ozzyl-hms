# Local Server Schema Sync Operations

This document covers operations for the periodic cloud → local schema sync feature.

## Overview

The local server runs a sync worker that periodically pulls a schema manifest from the cloud. Safe migrations are auto-applied. Destructive migrations are queued for admin approval in the admin panel.

## Enabling

Edit `/data/hms/config/local-server.env` on the local server and add:

```bash
HMS_LOCAL_SCHEMA_SYNC_ENABLED=1
HMS_LOCAL_SCHEMA_SYNC_INTERVAL_SECONDS=900
HMS_LOCAL_SCHEMA_SYNC_MAX_PER_CYCLE=5
```

Then restart the local stack:

```bash
ssh pcare 'cd /opt/hms && docker compose --env-file /data/hms/config/local-server.env -f deploy/local-server/compose.yml up -d --build --remove-orphans'
```

## Approving a Destructive Migration

1. Open the admin panel: `http://<hospital-server-ip>/admin/schema-sync`
2. Sign in with admin credentials.
3. Under "Pending Destructive Approvals", review the SQL preview.
4. Click **Approve** to allow the next worker cycle (within 15 min) to apply it.
5. The **Apply Log** section shows the audit trail with timestamp, actor, and result.

## Disabling Temporarily (Dry Run)

Set `HMS_LOCAL_SCHEMA_SYNC_DRY_RUN=1` in the env file and restart. The worker will report what it would do but will not execute any SQL.

## Disabling Permanently

Set `HMS_LOCAL_SCHEMA_SYNC_ENABLED=0` and restart. The worker skips the schema sync cycle entirely.

## Filename Convention

When adding new cloud migrations, the filename determines safety:

- `NNNN_description.sql` (e.g., `0334_add_appointments_table.sql`) — **safe**, auto-applied.
- `NNNNd_description.sql` (e.g., `0334d_drop_legacy_column.sql`) — **destructive**, queued for approval.

The `d` suffix sorts correctly: `0334_*` < `0334d_*` < `0335_*`.

## Troubleshooting

### Local D1 has older schema than cloud

The "drift" status appears in the apply log when the local has a migration applied but the cloud has changed the SQL. Admin can reset and re-apply via the admin panel.

### Cloud unreachable for >24h

The worker logs warnings and continues the outbox sync. Schema sync is skipped. Local still operates on existing schema.

### Failed safe migration

The admin panel shows a banner with the last error. The next worker cycle retries from the failed migration.

## Audit

All schema sync activity is logged to `local_schema_sync_log` on the local D1, with actor = `'system'` (worker-initiated) or admin user_id (admin-initiated).
