# Backup And Restore Runbook

Production data must be recoverable before the first real hospital goes live.

## Backup Scope

- D1 production database: `hms-super-admin-production`
- R2 production uploads bucket: `hms-uploads-production`
- KV production namespace: configuration, rate limits, feature flags
- Deployment metadata: commit SHA, migration list, Wrangler version

## Before Every Production Deploy

1. Export D1 production to a timestamped SQL file.
2. Store the SQL export outside the local machine and inside a restricted backup bucket/location.
3. Record the current commit SHA and migration list.
4. Confirm R2 object versioning or lifecycle backup policy is active.
5. Run restore rehearsal against a new/staging D1 database, not production.

## D1 Export

```bash
wrangler d1 export hms-super-admin-production --remote --env production --output ./backups/hms-prod-$(date +%Y%m%d-%H%M%S).sql
```

## Restore Drill

```bash
wrangler d1 create hms-restore-drill-$(date +%Y%m%d)
wrangler d1 execute hms-restore-drill-$(date +%Y%m%d) --remote --file ./backups/<backup-file>.sql
```

After restore, verify:

- patient count
- latest appointment
- latest bill and payment
- latest audit log
- sample R2 document metadata
- `/api/health/deep`

## Production Restore Rule

Never restore directly into production as the first step. Restore to a new database, verify, then switch bindings only after explicit approval and incident documentation.
