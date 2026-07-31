# Ozzyl HMS — Backup & Recovery Runbook

> **Version**: 1.0 | **Owner**: Engineering Team | **Last Updated**: 2026-03-13

---

## Overview

This runbook defines the backup strategy and recovery procedures for the Ozzyl HMS
platform running on Cloudflare D1 (SQLite), Cloudflare R2, and Cloudflare KV.

---

## 1. What Gets Backed Up

| Data Store | Contents | Criticality |
|------------|----------|-------------|
| Cloudflare D1 | Patient records, bills, payments, visits | 🔴 Critical |
| Cloudflare R2 | Medical documents, PDFs, profile images | 🟠 High |
| Cloudflare KV | Rate-limit state, session tokens, cache | 🟡 Medium |

---

## 2. Backup Schedule

| Backup Type | Frequency | Retention | Method |
|-------------|-----------|-----------|--------|
| **Full D1 dump** | Daily (01:00 UTC) | 30 days | Wrangler export + R2 upload |
| **Transaction log** | Every hour | 7 days | D1 time-travel (Cloudflare managed) |
| **R2 versioning** | On every write | 30 versions | R2 Object versioning |
| **Manual snapshot** | Before each release | Kept indefinitely | Dev team responsibility |

---

## 3. Automated Backup (D1 → R2)

### 3.1 Set up the scheduled backup Worker

```toml
# wrangler.toml
[triggers]
crons = ["0 1 * * *"]   # Daily at 01:00 UTC
```

### 3.2 Backup script (`workers/backup/index.ts`)

```typescript
export default {
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dbName = 'ozzyl-hms-prod';

    // Export D1 to R2
    // Note: Use wrangler CLI in CI or Cloudflare API for production backups
    console.log(`[BACKUP] Starting backup at ${timestamp}`);

    // Rotate old backups (older than 30 days)
    // Implement using R2.list() + delete on old keys
  },
};
```

### 3.3 Manual backup command

```bash
# Export production D1 database to file
npx wrangler d1 export DB --remote --output ./backup-$(date +%Y%m%d).sql

# Upload to R2
npx wrangler r2 object put hms-backups/db/$(date +%Y%m%d).sql \
  --file ./backup-$(date +%Y%m%d).sql
```

---

## 4. Recovery Procedures

### 4.1 D1 Database Recovery

**RTO**: 30 minutes | **RPO**: 1 hour (maximum data loss)

```bash
# Step 1: List available backups in R2
npx wrangler r2 object list hms-backups/db/

# Step 2: Download the desired backup
npx wrangler r2 object get hms-backups/db/20260313.sql --file restore.sql

# Step 3: Apply to a new D1 database (NEVER restore to prod directly)
npx wrangler d1 create ozzyl-hms-restore-$(date +%Y%m%d)
npx wrangler d1 execute ozzyl-hms-restore-$(date +%Y%m%d) \
  --remote --file ./restore.sql

# Step 4: Verify the restore
npx wrangler d1 execute ozzyl-hms-restore-$(date +%Y%m%d) \
  --remote --command "SELECT COUNT(*) FROM patients"

# Step 5: Swap DNS/worker binding after validation
# Update wrangler.toml to point DB binding to the new database
```

### 4.2 Tenant-Specific Recovery

```bash
# Export only one tenant's data (emergency)
npx wrangler d1 execute DB --remote --command \
  "SELECT * FROM patients WHERE tenant_id = 5" \
  --json > tenant_5_patients.json
```

### 4.3 Point-in-Time Recovery (D1 Time Travel)

Cloudflare D1 provides managed time travel (available on paid plans):

```bash
# Restore D1 to a specific timestamp via Cloudflare dashboard:
# → Cloudflare Dashboard → D1 → [database] → Backups → Restore to time
#
# Via API:
curl -X POST "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/d1/database/$DB_ID/restore" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"timestamp": "2026-03-13T01:00:00Z"}'
```

---

## 5. R2 Document Recovery

```bash
# List versions of a file
npx wrangler r2 object list hms-documents/ --prefix "tenant-5/"

# Restore a specific version
npx wrangler r2 object get hms-documents/tenant-5/report.pdf \
  --version-id <versionId> --file restored_report.pdf
```

---

## 6. Verification Checklist (Post-Recovery)

After any restore, run these checks before declaring recovery complete:

- [ ] **Patient count** matches pre-incident count (± expected transactions)
- [ ] **Latest bill** created before incident is present
- [ ] **Payment records** are intact (no duplicate payments)
- [ ] **Sequence counters** are correct (invoice/receipt numbers)
- [ ] **Tenant isolation** works (tenant A cannot see tenant B's data)
- [ ] **API health check** returns `"db_status": "ok"`
- [ ] **Frontend login** works for at least one tenant

### Verification command

```bash
npx wrangler d1 execute DB --remote --command "
  SELECT
    (SELECT COUNT(*) FROM patients)  as patients,
    (SELECT COUNT(*) FROM bills)     as bills,
    (SELECT COUNT(*) FROM payments)  as payments,
    (SELECT MAX(created_at) FROM bills) as latest_bill
"
```

---

## 7. Escalation Path

| Severity | Action | Response Time |
|----------|--------|---------------|
| **P0** Data loss | Page on-call engineer | 15 minutes |
| **P1** Degraded data | Notify engineering team | 30 minutes |
| **P2** Minor discrepancy | Create incident ticket | 4 hours |

**On-call rotation**: See `docs/on-call.md`  
**Incident response**: See `docs/incident-response.md`  
**Cloudflare status**: [cloudflarestatus.com](https://cloudflarestatus.com)

---

## 8. Contact & Resources

| Resource | Link |
|----------|------|
| Cloudflare D1 Docs | https://developers.cloudflare.com/d1 |
| D1 Time Travel | https://developers.cloudflare.com/d1/reference/time-travel |
| R2 Versioning | https://developers.cloudflare.com/r2/buckets/object-versioning |
| Incident Runbook | `docs/incident-response.md` |
