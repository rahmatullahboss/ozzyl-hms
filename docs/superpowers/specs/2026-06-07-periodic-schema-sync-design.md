# Periodic Cloud → Local Schema Sync Design

## Goal

Add a periodic schema synchronization job that keeps the hospital LAN local server's D1 schema aligned with the latest cloud migrations, while protecting live patient data from destructive changes that need human review.

## Why This Change

The current local-server model (see `AGENTS.md`, `scripts/local-server/migrate.sh`) is intentionally frozen-schema:

- Local D1 is bootstrapped from `schema.sql` + `tenant-schema.sql` only.
- Versioned `migrations/*.sql` are NOT auto-applied to local.
- The only path to a new local install is "import a tenant-scoped cloud snapshot" via `scripts/local-server/import-snapshot.sh`.
- New code reaches local via `git pull` in `scripts/local-server/update-stack.sh`.

The gap: when a new cloud migration introduces a new table or column that the updated code reads/writes, the local D1 has no schema for it. This causes runtime errors on the local server until a maintainer manually adds the new table to `tenant-schema.sql` and re-imports a snapshot. The manual step is easy to forget on a hospital LAN server that the maintainer may only touch once a month.

The fix is a one-way cloud → local schema sync that:

1. Auto-applies safe migrations (CREATE TABLE, ADD COLUMN with default, CREATE INDEX, etc.) without human intervention.
2. Queues destructive migrations (DROP, RENAME, ALTER COLUMN TYPE, DROP TABLE) for explicit admin approval.
3. Tracks per-migration apply state on the local D1.
4. Runs inside the existing `hms-sync` worker, with no new containers and no new auth tokens.

## Scope

### In Scope

- New cloud endpoint `GET /api/sync/schema/manifest[/:checksum]` that returns the list of available migrations and their SQL content.
- Build-time script that embeds `migrations/*.sql` files into the cloud worker bundle.
- New local engine (`src/lib/local-server/schema-sync.ts`) that classifies, applies, and tracks migrations.
- Three new local tables: `local_schema_migrations`, `local_schema_sync_approvals`, `local_schema_sync_log`.
- New local endpoints: `/api/local-server/schema-sync/*` for admin approval flow.
- Worker enhancement in `scripts/local-server/sync-worker.sh` to call schema sync on a separate cadence from outbox flush.
- New admin panel page `LocalSchemaSync.tsx` for review and approval.
- One-time bootstrap migration for existing local installs.
- Filename convention: `NNNN_*.sql` = safe, `NNNNd_*.sql` = destructive.
- Configuration via `HMS_LOCAL_SCHEMA_SYNC_*` env vars.
- Unit and integration tests for the engine.

### Out of Scope

- Automatic revert / rollback of an applied migration.
- Cloud-side tracking of which local server has applied which migration (the local is the source of truth for "what I have").
- Bidirectional schema sync (cloud → local only).
- Sync of D1 data (already handled by `local_sync_outbox`).
- Schema sync for the production D1 (cloud has its own `wrangler d1 migrations apply`).
- Real-time push of schema changes (only periodic polling; no WebSocket / Durable Object).
- NFC/QR card workflow (separate concern; see `2026-04-10-emergency-profile-design.md`).
- Patient-managed profile editing (admin only).

## Architecture Overview

```
┌─────────────────────────────────┐                ┌──────────────────────────────┐
│         CLOUD (D1 + Worker)     │                │   LOCAL (Docker, 192.168.x)  │
│                                 │                │                              │
│  migrations/0334_add_*.sql  ────┼─── embedded ───┼─►  at build time, all SQL    │
│  migrations/0334d_drop_*.sql    │   as TS module │    files compiled into       │
│  migrations/0335_*.sql          │                │    schema-migrations.ts      │
│         │                       │                │                              │
│         ▼                       │                │         │                    │
│  GET /api/sync/schema/manifest  │  ◄─── HTTPS ───┼─  sync-worker.sh polls       │
│  (returns: filename, safety,    │   bearer auth  │  every 15 min                │
│   sql content)                  │                │         │                    │
└─────────────────────────────────┘                │         ▼                    │
                                                  │  local_schema_migrations     │
                                                  │  (tracks what's applied)     │
                                                  │         │                    │
                                                  │         ├── safe migration   │
                                                  │         │   → apply to D1     │
                                                  │         │                    │
                                                  │         └── destructive       │
                                                  │             → approval queue  │
                                                  │                  │            │
                                                  │                  ▼            │
                                                  │     Admin Panel UI            │
                                                  │     Settings > Schema Sync    │
                                                  │     (Approve / Reject)        │
                                                  └──────────────────────────────┘
```

**Key principles**:

- **Code bundle ships with migrations**: At build time, a script reads `migrations/*.sql` and embeds them as a TypeScript module. This avoids needing R2 or external storage.
- **Single worker reuses existing infrastructure**: The existing `hms-sync` container's `sync-worker.sh` will gain a new "schema sync cycle" step. No new containers.
- **Cloud never receives sync data for migrations**: Unlike the outbox (which is local → cloud), this is one-way (cloud → local). No write to `cloud_schema_*` tables from local.

## Filename Convention (Safety Classification)

A single regex governs classification (case-insensitive on the `d` suffix):

```
/^(\d{4})(?:([dD])_|_)([a-z0-9_]+)\.sql$/i
```

Decoded:
- `NNNN` — 4-digit sequence number
- `([dD])_` — optional `d`/`D` followed by `_` → destructive
- `_` — required separator (literal underscore)
- `[a-z0-9_]+` — description (lowercase, digits, underscores)
- `.sql` — required extension

Examples:

| Filename | Safety | Sort position |
|---|---|---|
| `0334_add_appointments_table.sql` | safe | before `0334d_*.sql` |
| `0334d_drop_legacy_orders_column.sql` | destructive | after `0334_*.sql`, before `0335_*.sql` |
| `0335_create_billing_invoices.sql` | safe | after all `0334*` files |

**Why this convention**:

- Same `0334` group means the destructive variant is conceptually a follow-up to that migration.
- Sort order is deterministic: `0334_*.sql` < `0334d_*.sql` < `0335_*.sql` (because `_` is ASCII 95 and `d` is ASCII 100).
- Cloud applies in filename order; local applies in the same order.
- Detection is a single regex; no SQL parser needed.
- A new file in `migrations/` that does not match the regex is rejected by the build script with a clear error (catches typos early).

## Components

### A. Cloud-Side

#### A1. Build-time manifest generator

A new script `scripts/build-migration-manifest.ts`:

1. Reads all `migrations/*.sql` files matching `^(\d{4})(d?)_.*\.sql$`.
2. For each, extracts `order` (number for `NNNN`, or `NNNN.1` for `NNNNd`).
3. Computes `safety` from the regex.
4. Computes `sha256` of the SQL content as `content_hash`.
5. Generates `src/data/schema-migrations.generated.ts` with a typed `MIGRATIONS` constant.
6. The generated file is `.gitignore`d and regenerated on every `pnpm build`.

Output shape:

```ts
export const MIGRATIONS = [
  {
    filename: "0334_add_appointments_table.sql",
    order: 334,
    safety: "safe",
    contentHash: "sha256:abc123...",
    sql: "CREATE TABLE appointments (...);",
  },
  // ...
];
```

#### A2. New endpoints in `src/routes/sync.ts`

**`GET /api/sync/schema/manifest/checksum`** (lightweight, used for polling)

- Auth: existing `authorizeSyncRequest` (Bearer `CLOUD_SYNC_TOKEN`).
- Response: `{ "version": "2026-06-07T12:34:56.789Z", "checksum": "sha256:..." }`.
- Cheap to call; the local worker calls this first.

**`GET /api/sync/schema/manifest`** (full payload, only when checksum differs)

- Auth: same as above.
- Response:
  ```json
  {
    "version": "2026-06-07T12:34:56.789Z",
    "migrations": [
      { "filename": "0334_add_appointments_table.sql", "safety": "safe", "contentHash": "sha256:abc", "sql": "..." }
    ]
  }
  ```
- `version` is the cloud worker's build timestamp; locals use it as a cache key.

#### A3. No new cloud tables

The manifest is derived from the embedded module. No `cloud_schema_*` table is needed. The local is the source of truth for "what I have applied."

### B. Local-Side

#### B1. New tables (added to `tenant-schema.sql`)

```sql
CREATE TABLE IF NOT EXISTS local_schema_migrations (
  filename TEXT PRIMARY KEY,
  safety TEXT NOT NULL CHECK(safety IN ('safe', 'destructive')),
  content_hash TEXT NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  duration_ms INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS local_schema_sync_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL UNIQUE,
  safety TEXT NOT NULL CHECK(safety IN ('destructive')),
  content_hash TEXT NOT NULL,
  sql_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'approved', 'rejected', 'applied', 'failed')),
  reviewed_by TEXT,
  reviewed_at DATETIME,
  apply_error TEXT,
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  applied_at DATETIME
);

CREATE TABLE IF NOT EXISTS local_schema_sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  filename TEXT NOT NULL,
  event TEXT NOT NULL,                          -- 'detected' | 'applied' | 'queued' | 'approved' | 'rejected' | 'failed' | 'drift'
  actor TEXT,                                    -- admin user_id or the literal string 'system'
  message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_local_schema_approvals_status
  ON local_schema_sync_approvals(status, detected_at);
CREATE INDEX IF NOT EXISTS idx_local_schema_log_filename
  ON local_schema_sync_log(filename, created_at);
```

#### B2. Engine module — `src/lib/local-server/schema-sync.ts`

Pure functions, easily unit-testable:

- `classifyMigration(filename): 'safe' | 'destructive'`
- `reconcileLocal(db, manifest): Promise<{ toApply: SafeMigration[]; toQueue: DestructiveMigration[]; drift: string[] }>`
- `applyMigration(db, migration): Promise<{ duration_ms: number; error?: string }>`
- `recordApproval(db, migration): Promise<void>`
- `listPendingApprovals(db): Promise<Approval[]>`
- `setApprovalStatus(db, filename, status, actor): Promise<void>`
- `logEvent(db, filename, event, actor, message): Promise<void>`

All D1 writes use `db.batch([...])` so SQL execution and bookkeeping succeed or fail together.

#### B3. New endpoints — `src/routes/local-server/schema-sync.ts`

All admin endpoints require JWT auth + `admin:settings` permission (existing `requirePermission` pattern).

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/local-server/schema-sync/status` | `{ lastSyncAt, schemaVersion, appliedCount, pendingCount, lastError, dryRun }` |
| `GET` | `/api/local-server/schema-sync/approvals` | List of pending / approved / failed entries with SQL preview |
| `POST` | `/api/local-server/schema-sync/approvals/:filename/approve` | Approve (admin role required) |
| `POST` | `/api/local-server/schema-sync/approvals/:filename/reject` | Reject (admin role required) |
| `GET` | `/api/local-server/schema-sync/log?limit=50` | Recent audit log |
| `POST` | `/api/local-server/schema-sync/sync` | Internal endpoint called by `sync-worker.sh` with the fetched manifest. No JWT (network-localhost only — Docker bridge only, no Caddy binding). |
| `POST` | `/api/local-server/schema-sync/sync/apply-approved` | Internal endpoint. No JWT. Runs apply on any `local_schema_sync_approvals` row with `status='approved'`. |

The `POST /sync` endpoint accepts `{ version, migrations: [...] }` in the request body and runs `reconcileLocal` + applies safe migrations + queues destructive. The `POST /sync/apply-approved` endpoint is a no-body call. Both are exposed only on the Docker bridge network (no public binding via Caddy) and reject requests whose source IP is not in `127.0.0.0/8` or the bridge subnet.

#### B4. Worker enhancement — `scripts/local-server/sync-worker.sh`

The existing worker loop gets a new step:

```
every HMS_LOCAL_SCHEMA_SYNC_INTERVAL_SECONDS (default 900 = 15 min):
  if HMS_LOCAL_SCHEMA_SYNC_ENABLED != 1: skip
  if CLOUD_SYNC_BASE_URL / CLOUD_SYNC_TOKEN not set: skip
  1. GET /api/sync/schema/manifest/checksum with bearer auth
  2. If checksum differs from last-cached:
     a. GET /api/sync/schema/manifest (full payload)
     b. POST /api/local-server/schema-sync/sync with the manifest body
     c. Cache new checksum to $HMS_LOCAL_STATE_DIR/schema-sync-cache.json
  3. POST /api/local-server/schema-sync/sync/apply-approved (no manifest; just runs apply on status='approved' rows)
  4. Log result
```

The outbox flush (existing) and schema sync (new) share the same worker process but have independent intervals and independent failure handling. A failure in one does not block the other.

#### B5. Admin panel UI — `web/src/pages/LocalSchemaSync.tsx`

New page in admin panel sidebar: **Settings → Schema Sync**.

Components:

- **Status card**: last sync time, schema version (from cloud), applied count, pending count, dry-run indicator.
- **Pending Approvals table**: filename, safety badge (red `destructive`), first 200 chars of SQL in a collapsible preview, Approve / Reject buttons.
- **Apply Log**: last 50 events, polled every 30s.
- **Failed Migrations panel**: if any safe migration has been failing, show a prominent banner with the last error and a "Retry" button.

i18n: English + Bengali keys, matching the existing convention.

### C. Data Flow

```
TIME 0: Maintainer writes migrations/0334_*.sql + 0334d_*.sql and pushes to git.
TIME 1: pnpm build && wrangler deploy --env production.
         - Cloud D1 receives the migrations via wrangler.
         - schema-migrations.generated.ts is embedded in the cloud worker bundle.
TIME 2: Local server polls (every 15 min by default).
         - Calls /api/sync/schema/manifest/checksum.
         - Receives new version, downloads full manifest.
TIME 3: Local worker POSTs the manifest to /api/local-server/schema-sync/sync.
         - Engine reads manifest, compares with local_schema_migrations.
         - Sorts by `order` ascending.
TIME 4: For 0334_add_appointments_table.sql (safe):
         - db.batch([applySQL, insertMigrationRow, logEvent])
         - log: "applied (1234ms)"
TIME 5: For 0334d_drop_legacy_orders_column.sql (destructive):
         - db.batch([insertApprovalRow, logEvent])
         - log: "queued_for_approval"
TIME 6: Admin opens the local admin panel.
         - Sees pending approval with SQL preview.
         - Clicks Approve → status = 'approved', actor = admin user_id, reviewed_at = now.
TIME 7: Next worker cycle (within 15 min):
         - Finds status = 'approved' rows.
         - db.batch([applySQL, updateApprovalStatus, logEvent])
         - status = 'applied', applied_at = now.
```

### D. Failure Handling

| Scenario | Behavior |
|---|---|
| Safe migration fails on apply | `local_schema_migrations.last_error` recorded, `local_schema_sync_log` entry added, admin panel banner shown. Worker does NOT proceed to the next migration in the same cycle. Next cycle retries from the failed one. |
| Destructive migration fails after approval | `local_schema_sync_approvals.status` = 'failed', `apply_error` recorded. Admin can retry from the panel; re-approval NOT required. |
| Cloud unreachable for >24h | Worker logs warning, continues outbox sync. Schema sync skipped. Local still operates normally on existing schema. |
| Local D1 has older schema than cloud expects (drift) | Detected by `content_hash` mismatch: local has row for `filename=X` with `content_hash=Y` but cloud manifest has `content_hash=Z` (and `Y ≠ Z`). Worker logs error, marks the local row as `drift` in `local_schema_sync_log`, and does NOT auto-apply. Admin sees a "drift detected" banner in the panel with both hashes displayed. Resolution: admin clicks "Reset and re-apply" which deletes the local row, archives a backup, and queues re-apply on the next cycle. |
| Local D1 has a newer migration than cloud | Worker logs warning, skips. |
| SQL transaction partial failure | `db.batch([...])` rolls back atomically. |
| Worker crashes mid-apply | `local_schema_migrations` row was not inserted, so the next cycle retries. Idempotent. |
| New migration file does not match the regex | Build script fails CI with a clear error message. No silent miss. |

> **Note on the `actor` field** in `local_schema_sync_log`: worker-initiated events always use the literal string `'system'`. Admin-initiated events (approve/reject/reset) use the user_id from the JWT in the request. This separates human actions from automated ones in the audit trail.

## Configuration

### Cloud

No new environment variables. The existing `CLOUD_SYNC_TOKEN` is reused for auth.

### Local (in `/data/hms/config/local-server.env` or `.dev.vars.local_server`)

```
HMS_LOCAL_SCHEMA_SYNC_ENABLED=0
HMS_LOCAL_SCHEMA_SYNC_INTERVAL_SECONDS=900
HMS_LOCAL_SCHEMA_SYNC_MAX_PER_CYCLE=5
HMS_LOCAL_SCHEMA_SYNC_DRY_RUN=0
```

- `HMS_LOCAL_SCHEMA_SYNC_ENABLED=0` is the default; admins opt in per tenant.
- `HMS_LOCAL_SCHEMA_SYNC_MAX_PER_CYCLE` rate-limits how many migrations apply per 15-min cycle. Protects against a large cloud deploy flooding the local.
- `HMS_LOCAL_SCHEMA_SYNC_DRY_RUN=1` makes the engine report what it would do without executing SQL. Useful for first-time setup on a production-shaped local.

## Testing Strategy

### Unit tests (`tests/lib/local-server/schema-sync.test.ts`)

- `classifyMigration` — 12+ cases: `0334_*.sql` (safe), `0334d_*.sql` (destructive), `0334D_*.sql` (case-insensitive destructive), invalid filenames (rejected by build, but the engine also defends).
- `reconcileLocal` — 6+ cases: empty, fully synced, partial sync, drift detected, content_hash mismatch.
- `applyMigration` — success, transaction rollback on simulated SQL error, idempotency.
- Approval queue logic — pending → approved → applied, pending → rejected, idempotent re-approval.
- Dry-run mode — records intent but does not execute SQL.

### Integration tests (`tests/integration/schema-sync.test.ts`)

Use `wrangler dev --local --env local_server` for an in-process local D1.

- Seed `local_schema_migrations` with one already-applied row.
- Mock the cloud manifest endpoint with 3 migrations (1 safe, 1 destructive, 1 already-applied).
- Call `/api/local-server/schema-sync/sync` directly.
- Assert: 1 row added to `local_schema_migrations`, 1 row added to `local_schema_sync_approvals` (status='pending'), 1 row skipped (already applied).
- Approve the destructive migration via the approval endpoint.
- Re-trigger sync with a dry-run flag off; assert applied.

### Manual smoke test

1. Deploy 1 safe + 1 destructive migration to a dev cloud env.
2. Reset local D1 state to baseline.
3. Trigger a worker cycle manually (or set `HMS_LOCAL_SCHEMA_SYNC_INTERVAL_SECONDS=30` for the test).
4. Verify in admin panel: 1 safe auto-applied, 1 in approval queue.
5. Approve the destructive one.
6. Wait for next cycle, verify applied.
7. Inspect `local_schema_sync_log` for full audit trail.

## Rollout Plan

**Step 1**: Add the 3 new tables to `tenant-schema.sql` and create migration `0336_local_schema_sync_tables.sql` for existing local installs.

**Step 2**: Build the manifest generator + cloud endpoint. Deploy to production. (Cloud-only change; no effect on local yet.)

**Step 3**: Build the local engine + worker enhancement + new endpoints. Deploy. (Feature is gated by `HMS_LOCAL_SCHEMA_SYNC_ENABLED=0` so it does not activate yet.)

**Step 4**: Build the admin panel UI. Deploy.

**Step 5**: Set `HMS_LOCAL_SCHEMA_SYNC_ENABLED=1` on a test local server. Monitor for 48h.

**Step 6**: Promote to all local servers. Document in `docs/operations/local-server.md`.

## Backward Compatibility

- All new code is purely additive.
- Existing `migrate.sh` and `tenant-schema.sql` baseline flow unchanged.
- `local_sync_outbox` (data sync) is completely separate, untouched.
- Existing local D1s without the new tables get a one-time migration `0336_local_schema_sync_tables.sql` that adds only the 3 new tables.
- If `HMS_LOCAL_SCHEMA_SYNC_ENABLED` is unset / `0`, the worker skips schema sync entirely.
- The new `/api/local-server/schema-sync/*` endpoints are gated by JWT + admin permission; they cannot be hit by unauthenticated clients.

## Open Decisions (Resolved During Brainstorm)

- **Goal**: Auto-apply non-destructive only. ✓
- **Classification mechanism**: Filename convention. ✓
- **Approval flow**: Local admin panel UI. ✓
- **Safe migrations logged in audit trail**: Yes. ✓
- **Re-prompt on rejected migration when content changes**: Yes, with "previously rejected" indicator. ✓
- **Dry-run mode**: Yes, controlled by `HMS_LOCAL_SCHEMA_SYNC_DRY_RUN=1`. ✓
