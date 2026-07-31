# Cloud Backup & Restore Runbook — Ozzyl HMS

> **Owner:** Platform / SRE
> **Last updated:** 2026-06-16
> **Status:** Active

This runbook covers backup and restore for the **cloud** production
Ozzyl HMS deployment. The hospital-local-server backup is handled
separately by `scripts/local-server/backup.sh` (see §7 for the link).

---

## 1. Scope

| Asset | Backing store | Backup target |
|---|---|---|
| Tenant + super-admin data | Cloudflare D1 (`hms-super-admin-production-apac`) | R2 `hms-backups` bucket (D1 export SQL) + secondary offsite copy |
| Object storage (uploads, lab PDFs, DICOM, exports) | R2 `hms-uploads-production` | R2 cross-region replication (or scheduled `rclone` mirror to cold storage) |
| Session, rate-limit, cache, feature flags | Cloudflare KV (`hms-super-admin-production-apac` KV) | Daily JSON export to R2 `hms-backups/kv/` |
| Durable Object state (DashboardDO) | Cloudflare DO storage | Implicit via Worker rollback; not separately exported |

---

## 2. RPO / RTO targets

| Tier | RPO (max data loss) | RTO (max downtime) | Owner |
|---|---|---|---|
| Production D1 (clinical + billing) | 15 minutes | 1 hour | Platform + product owner |
| Production R2 (uploads / DICOM) | 24 hours | 4 hours | Platform |
| Production KV (session, cache) | 24 hours | 4 hours (sessions re-login OK) | Platform |
| Local server data (hospital LAN) | 24 hours | 4 hours | Hospital IT |

If you cannot meet these targets with the current setup, raise it
to product owner **before** the next incident.

---

## 3. D1 export schedule

- **Tool:** `wrangler d1 export` (CLI) — produces a SQL dump
- **Frequency:** every 15 minutes (cron in `hms-jobs` worker — see
  `docs/INCIDENT_RUNBOOK.md` §6 for the cron migration plan)
- **Destination:** `s3://hms-backups/d1/<YYYY>/<MM>/<DD>/<HHMM>.sql`
  (via `rclone` from inside the cron worker)
- **Retention:** hourly snapshots × 24 h, daily × 30 d, weekly × 1 y
- **Verification:** a 1% sample row count is checked against the
  previous export; > 1% drop ⇒ page on-call (see
  `docs/INCIDENT_RUNBOOK.md` §3.4)

### Manual export (one-off)

```bash
# Production
wrangler d1 export hms-super-admin-production-apac \
  --env production --remote \
  --output=backups/d1/manual-$(date -u +%Y%m%dT%H%M%SZ).sql
```

Upload the resulting SQL to the backups bucket (see §3 above). Mark
the filename with the UTC timestamp; do not rely on local timezones.

### Restoring D1 from a SQL export

```bash
# 1. Make sure you have an approved incident ticket and a second pair
#    of eyes on the command. D1 restore is destructive.
# 2. Capture the current state FIRST:
wrangler d1 export hms-super-admin-production-apac \
  --env production --remote \
  --output=backups/d1/before-restore-$(date -u +%Y%m%dT%H%M%SZ).sql
# 3. Apply the chosen restore:
wrangler d1 execute hms-super-admin-production-apac \
  --env production --remote --file=backups/d1/<chosen>.sql
```

> **Important:** `wrangler d1 execute --file` will execute arbitrary
> SQL. If the chosen export is a full dump (CREATE + INSERT), this
> recreates the schema. If the dump is incremental (only INSERTs),
> apply against an empty D1 only.

---

## 4. R2 bucket replication / export

- **Tool:** Cloudflare R2 bucket replication (cross-region) for
  active-active read availability, plus a daily `rclone copy` to a
  cold offsite (Backblaze B2 / AWS S3 IA) for DR.
- **Frequency:** replication is continuous; offsite copy runs once per
  day in the `hms-jobs` worker.
- **Retention:** R2 production bucket: no auto-delete (clinical
  retention requirements); offsite: 1 year rolling.
- **Verification:** daily checksum compare between the R2 manifest
  and the offsite manifest; mismatch ⇒ page on-call.

### Restoring a single object

Use the Cloudflare dashboard or:

```bash
wrangler r2 object get hms-uploads-production/<key> \
  --file=restored-<key>
```

### Restoring the whole bucket

```bash
# Mirror offsite → R2 production bucket
rclone sync offsite:hms-backups/r2 hms-uploads-production:r2 \
  --transfers=8 --checkers=16
```

Coordinate with product owner before running a full bucket restore —
this can take hours for a large bucket and will temporarily double
storage cost.

---

## 5. KV export strategy

KV is best-effort cache + session data; an export is required for
audit, not for warm-up.

- **Tool:** `wrangler kv bulk get` (paginated) via a small script in
  the `hms-jobs` worker.
- **Frequency:** once per day.
- **Destination:** `s3://hms-backups/kv/<YYYY>/<MM>/<DD>.jsonl`
  (one JSON object per KV entry).
- **Restore:** not automatic. After a KV wipe, the system will
  rebuild sessions lazily on next user login. Cached values will
  rebuild on next read.

---

## 6. Restore drill (monthly)

A restore drill is mandatory. The platform lead schedules it on the
first Monday of every month and announces it in `#hms-incidents`.

### Drill steps

1. Pick a recent D1 export (e.g. from 7 days ago).
2. Create a fresh, throwaway D1 database for the drill:
   ```bash
   wrangler d1 create hms-restore-drill-$(date -u +%Y%m%d)
   ```
3. Import the export into the drill database:
   ```bash
   wrangler d1 execute hms-restore-drill-$(date -u +%Y%m%d) \
     --remote --file=backups/d1/<chosen>.sql
   ```
4. Point a staging Worker (or `wrangler dev` with a custom
   `database_id`) at the drill database and run:
   - `/api/health` and `/api/health/deep`
   - `pnpm test:production:unit` (against a vitest config that
     points to the drill database)
   - A small Playwright smoke (against the staging Worker that
     reads from the drill)
5. Spot-check 5 random tenant records: open the patient chart, a
   recent bill, and a lab result. Confirm timestamps and totals
   match the expected export.
6. **Delete the drill database**:
   ```bash
   wrangler d1 delete hms-restore-drill-$(date -u +%Y%m%d)
   ```
7. File a one-line summary in the operations log: export picked,
   checks passed/failed, any anomalies.

### Failure handling

If the drill fails:

- Open a `critical` incident (see `docs/INCIDENT_RUNBOOK.md` §2).
- Investigate root cause (export bug, schema drift, missing
  retention).
- Re-run the drill after the fix; do not skip.

---

## 7. Local server backup (link only)

The hospital LAN local server uses `scripts/local-server/backup.sh`
to tarball `/data/hms` and write a SHA256 manifest. That script is
**not** a substitute for the cloud backup plan above — they cover
disjoint deployments.

```bash
# Hospital IT runs daily via cron
bash scripts/local-server/backup.sh
# Default: /data/backups/hms/<UTC-timestamp>/hms-local-data.tgz
```

See `scripts/local-server/backup.sh` for the exact retention policy
and restore procedure on the local server.

---

## 8. Approvals and access

| Action | Approver | Notes |
|---|---|---|
| Read a backup (verification, audit) | Platform engineer | Log the request in the operations log |
| Restore a tenant in production | Product owner + platform lead | Two-person rule; second engineer must be on the bridge |
| Restore the whole D1 in production | Product owner + CTO + legal/compliance | Disaster declaration; this is a known-major incident |
| Delete a backup | Platform lead | Document retention vs. clinical retention before delete |

Access to the backups bucket is via Wrangler secrets on a small
operations Worker — never commit bucket credentials to the main
Worker or to a developer machine.

---

## 9. Verify restored tenant data

For a single-tenant restore (the most common case):

1. Open the patient list — confirm row counts match.
2. Open a random patient's chart, last visit, and last bill.
3. Compare the bill total to the source export: `grep '<bill_id>'
   backups/d1/<chosen>.sql` and reconstruct the line-item sum.
4. Open one lab result PDF (from R2) — confirm it renders.
5. Have the hospital's billing clerk sign off on a single bill
   before declaring restore complete.

For a full-D1 restore, run the monthly drill script (§6) end-to-end
*and* the single-tenant checks for the top 3 highest-revenue
tenants.
