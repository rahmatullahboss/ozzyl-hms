# HMS Local Server Deployment

This mode runs the HMS Worker on the hospital LAN with local D1/KV/R2/Durable Object storage. It keeps daily hospital traffic local and reduces Cloudflare Worker invocations to cloud-only access and sync batches.

## Target Topology

```text
Hospital PCs / tablets
  -> http://192.168.1.240 or http://hms.local
  -> Caddy reverse proxy on the local server
  -> HMS local Worker container
  -> Wrangler local persistence under /data/hms/state

Local server
  -> outbound internet for Tailscale, updates, backups, and cloud sync
  -> no inbound public port forwarding required

Cloudflare production
  -> remains the public/cloud system of record for cloud users
  -> receives tenant-scoped sync metadata batches from the local outbox
```

For Patient Care Hospital, the current network convention is:

```text
Server OS: 192.168.1.240
iDRAC:     192.168.1.241
Router:    192.168.1.1
Remote SSH over Tailscale: 100.100.219.62
```

## What Runs Locally

- Staff web app, admin app, and patient app static assets.
- API routes through the same Hono Worker code.
- D1-compatible relational storage in Wrangler local persistence.
- KV/R2/Durable Object local simulations.
- SMS, email, online payment, Workers AI, and Vectorize are disabled or stubbed while offline.

## Source Of Truth Rules

The first production-ready local rollout should be **local-write-primary** for the selected tenant:

- Hospital staff use the local URL for daily work.
- Local writes are recorded locally first.
- Cloud sync is async and idempotent.
- Cloud should not simultaneously edit the same tenant operational rows until conflict rules exist.
- Cloud can still provide public site, marketplace, release metadata, and remote reporting views.

This avoids split-brain writes while the outbox/ingest layer is being built.

## First Install On The Hospital Server With Docker Compose

Use the prepared Ubuntu server on the hospital LAN. The server should already have:

- static LAN IP `192.168.1.240`
- Tailscale remote access
- Docker Engine and Docker Compose plugin
- `/data` mounted on the large local volume

Clone or update the repo at `/opt/hms`, then run:

```bash
cd /opt/hms
pnpm local-server:install-stack
```

Open from hospital PCs:

```text
http://192.168.1.240
```

Optional DNS/LAN alias:

```text
http://hms.local
```

The Docker stack is defined in:

```text
deploy/local-server/compose.yml
deploy/local-server/Dockerfile
deploy/local-server/Caddyfile
```

It runs:

| Service | Purpose |
| --- | --- |
| `hms-app` | HMS Worker in `local_server` mode |
| `hms-sync` | sync worker that flushes pending local outbox events to cloud and pulls tenant-scoped cloud snapshots back to local |
| `caddy` | LAN reverse proxy on port 80 |

The container is configured with:

```text
HMS_LOCAL_STATE_DIR=/data/hms/state
HMS_LOCAL_VARS_FILE=/data/hms/secrets/.dev.vars.local_server
```

Cloud sync pairing is controlled by the local vars file:

```text
CLOUD_SYNC_BASE_URL="https://hms-saas-production.rahmatullahzisan.workers.dev"
CLOUD_SYNC_TOKEN="<server-specific secret>"
```

The token must match the production `CLOUD_SYNC_TOKEN` Worker secret. Do not print the token in logs, docs, commits, or support screenshots.

## Cloud To Local Data Sync

The local sync worker runs every `HMS_LOCAL_SYNC_INTERVAL_SECONDS` seconds, defaulting to 300 seconds. Each cycle is sequential, so a second cycle cannot overlap the current push/pull cycle:

1. `POST /api/sync/outbox/flush` on the local app sends pending `local_sync_outbox` events to the production Worker.
2. `POST /api/sync/cloud-pull/run` on the local app fetches an authenticated tenant-scoped snapshot from production and applies it locally.

Worker network safety defaults:

```bash
HMS_LOCAL_SYNC_CONNECT_TIMEOUT_SECONDS=10
HMS_LOCAL_SYNC_REQUEST_TIMEOUT_SECONDS=60
HMS_LOCAL_SYNC_STARTUP_JITTER_SECONDS=30
```

The connect/request timeouts prevent a dead network call from stopping all future cycles. Startup jitter spreads multiple hospitals across the interval instead of making every server contact cloud at the same second. Set jitter to `0` only for deterministic local testing.

Data pull is gated by the local outbox push. The worker runs `cloud-pull/run` only when `outbox/flush` returns HTTP 200. If the push cannot complete, that cycle skips cloud pull so an older cloud snapshot cannot overwrite unsynced local writes.

### Current incremental push coverage

Hospital local-server sync uses an explicit outbox; it is not automatic full-database replication yet. Current local emitters are:

- `ipd_doctor_round`
- `billing_provisional_doctor_round`
- `patients`
- `global_patient_identity`
- `patient_health_links`
- `medicine_catalog_entry`

The patient/global-identity/link events currently run after the main patient write rather than in the same D1 batch, so they remain a known durability gap. Patient emitter coverage is also route-partial: the primary patient route emits these events, while emergency/portal/referral creation paths still need the same write-boundary contract. Patient numeric IDs are now translated through a stable server/tenant/entity/local-ID to cloud-ID mapping and a tenant-scoped patient sync key; local outbox rows are not marked exported until the cloud confirms and the local server persists that mapping. Cloud pull translates the cloud patient ID back to the original local ID. Ambiguous UHID/patient-code matches, mapped identity changes, and unsafe first-import collisions remain failed for review instead of overwriting data.

Core write paths still requiring outbox expansion include appointments, visits, admissions, queue entries, bills, invoice items, payments, and billing deposits.

Payload-bearing events without an explicit cloud mapper remain failed/poison for review. They are never reported as successfully synced. Expand coverage only by adding the outbox event in the same write transaction and a tenant-scoped cloud mapper with idempotency and conflict tests.

The cloud snapshot endpoint is:

```text
GET /api/sync/tenant-snapshot?tenantId=<tenant-id>
```

It is server-to-server only and requires the configured cloud-sync bearer token. It exports only allowlisted tables and only rows belonging to the requested tenant. Most allowlisted rows use `INSERT OR REPLACE` after tenant/schema filtering. Signed IPD rounds and patient identities are preflighted first: conflicting signed content or numeric-ID/natural-identity mismatches fail the table for review instead of replacing the local record.

Current authentication still uses one configured cloud-sync bearer token. The server ID and tenant ID are validated in payloads and mappings, but the credential is not yet cryptographically bound to one hospital server. Per-server credentials or signed requests remain a P1 hardening item before broad multi-hospital rollout.

To restrict the cloud-pull tables for a specific hospital, set this in `/data/hms/config/local-server.env`:

```bash
HMS_LOCAL_CLOUD_PULL_TABLES=patients,admissions,visits,beds,doctors,settings
```

If omitted, the built-in allowlist is used. Do not add another hospital's tables or remove tenant scoping from the sync routes.

Check local cloud-pull status:

```bash
curl -fsS -H "Authorization: Bearer <sync-token>" \
  http://127.0.0.1/api/sync/cloud-pull/status
```

The status response contains table names, last snapshot IDs, row counts, and errors only. It does not expose patient row payloads.

Current conflict policy: ordinary allowlisted rows remain last-applied-snapshot wins, but signed IPD rounds and patient identities are protected by semantic conflict checks and fail for review instead of overwriting. During early rollout, avoid editing the same operational row from both cloud and hospital LAN unless that entity has an explicit conflict policy. Local-only writes still need an outbox event at their write boundary before they can be pushed to cloud.

## Database Bootstrap

For an actual hospital tenant, do not export the full multi-tenant production database to the hospital server. Bootstrap in two layers:

1. a schema-only snapshot from the current production D1 schema
2. a tenant-scoped data snapshot for the selected hospital

This is safer than replaying every historical migration into an old local database, because production migration history can include reconciled, renamed, or processed migrations.

Create the schema-only snapshot from the workstation:

```bash
pnpm local-server:export-schema -- --output /secure/path/production-schema-snapshot.sql
```

Apply it to a fresh local D1 state on the hospital server:

```bash
ssh <hospital-ssh-name> 'cd /opt/hms && docker compose --env-file /data/hms/config/local-server.env -f deploy/local-server/compose.yml run --rm --no-deps hms-app bash -lc "cd /app && pnpm exec wrangler d1 execute hms-local-server --env local_server --local --persist-to /data/hms/state --file=/data/hms/imports/production-schema-snapshot.sql"'
```

Then prepare a tenant-scoped SQL snapshot that contains only:

- Rows for the selected tenant.
- Global reference/master rows that are safe for that tenant to receive.
- No other tenant patient, billing, audit, user, or clinical data.

Export the tenant data:

```bash
pnpm local-server:export-tenant -- --tenant-id <tenant-id> --no-delete --output /secure/path/<tenant>-snapshot.sql
```

Import that tenant-scoped snapshot after the schema exists:

```bash
pnpm local-server:import /secure/path/<tenant>-snapshot.sql
```

For empty local smoke testing only, initialize the baseline repo tables:

```bash
pnpm local-server:migrate
```

The repo's historical versioned migrations are not a reliable fresh-install path by default because production migration history has been reconciled over time. For targeted schema upgrades after deployment:

```bash
HMS_LOCAL_APPLY_VERSIONED_MIGRATIONS=1 pnpm local-server:migrate
```

When adding a new table that must exist on local installs, update both:

- the numbered migration under `migrations/`
- the baseline schema file used by local bootstrap, usually `tenant-schema.sql`

For LAN or Tailscale numeric-host access, set one default tenant in `/data/hms/secrets/.dev.vars.local_server`:

```text
LOCAL_TENANT_ID=<tenant-id>
LOCAL_TENANT_SUBDOMAIN=<tenant-subdomain>
```

Do not hardcode these values in the repo. Each hospital local server must set its own tenant values.

## Local-Only Hostnames

The local Worker accepts any LAN/Tailscale host header when `LOCAL_TENANT_ID` or `LOCAL_TENANT_SUBDOMAIN` is configured. A friendly name such as `pcare.com` is therefore a DNS/client-network concern, not an app code change.

Recommended options:

- LAN-wide: add a DNS override on the hospital router or local DNS server, e.g. `pcare.com -> 192.168.1.240`.
- Tailscale-only: add split DNS or a hosts entry on the operator machines, e.g. `pcare.com -> 100.100.219.62`.
- Single machine: add an `/etc/hosts` entry on that device.

Use a domain you control or an internal-only name where possible. Using a public domain name that you do not own can conflict with real internet DNS outside the LAN/Tailscale context.

## Persistent Local Data

By default local data is stored in:

```text
.local-hms/state
```

For Docker installs, persistent local data is stored in:

```text
/data/hms/state
/data/hms/secrets
/data/hms/uploads
/data/hms/caddy
```

The start script creates the local vars file with a local JWT secret if it does not exist. This file must stay on the server and must not be committed:

```text
/data/hms/secrets/.dev.vars.local_server
```

For non-Docker debugging, override paths before starting:

```bash
export HMS_LOCAL_STATE_DIR=/var/lib/hms-local/state
export HMS_LOCAL_VARS_FILE=/var/lib/hms-local/secrets/.dev.vars.local_server
export HMS_LOCAL_PORT=8787
pnpm local-server:start
```

## Production Worker Count Reduction

Static app entry links are served by `_redirects` instead of the Worker:

- `/admin -> /admin/index.html`
- `/patient -> /patient/index.html`
- tutorial redirects

Cloudflare Worker now runs first only for dynamic routes:

- `/api/*`
- `/patient/*` for patient deep-link shell routing
- `/site`
- `/site/*`

Daily LAN traffic should use the local server. Cloudflare should receive only external users, public site traffic, and later sync requests.

## Automatic Code Updates

The local server can poll GitHub for new commits and update itself without exposing
an inbound webhook port. Install the systemd timer on the hospital server:

```bash
cd /opt/hms
pnpm local-server:install-auto-update
```

The timer runs every 5 minutes. Each run:

- fetches `origin/main`
- exits without rebuilding when the server is already current
- refuses to update if tracked files were edited directly on the server
- takes a local backup before applying a new commit
- fast-forwards to the new commit, rebuilds the Docker stack, and verifies health
- rolls back to the previous revision if the health check fails

Manual update remains available:

```bash
cd /opt/hms
pnpm local-server:update-stack
```

## Backup Baseline

At minimum, back up:

```text
/data/hms/state
/data/hms/secrets/.dev.vars.local_server
/data/hms/uploads
```

Recommended schedule:

- Hourly local disk snapshot during hospital hours.
- Nightly encrypted copy to another local disk/NAS.
- Cloud sync/export once internet returns.

Manual backup:

```bash
cd /opt/hms
pnpm local-server:backup
```

Backups are written under:

```text
/data/backups/hms/<timestamp>/hms-local-data.tgz
```

## Local Update Flow

When cloud production is deployed from `main`, update the hospital local stack from the same branch:

```bash
cd /opt/hms
pnpm local-server:update-stack
```

The update script:

1. creates a local backup
2. fetches and fast-forwards `origin/main`
3. rebuilds the Docker image
4. restarts the stack
5. checks `/api/local-server/status`
6. rolls back to the previous Git revision if the health check fails

For unattended updates, run the same command from a systemd timer only after the hospital agrees on an update window. Do not auto-update during billing/reception peak hours.

## Health Checks

Local server:

```bash
curl -fsS http://192.168.1.240/api/local-server/status
```

Docker stack:

```bash
cd /opt/hms
pnpm local-server:health
```

## Next Sync Phase

The local status endpoint is:

```text
GET /api/local-server/status
```

It reports whether the server is in `local_server` mode and whether cloud sync secrets are configured. The next implementation phase should add an immutable local outbox and an idempotent cloud ingest endpoint before enabling automatic cloud reconciliation.

Required sync implementation pieces:

- `local_outbox` table with immutable event rows.
- Per-event `tenant_id`, entity type, entity id, operation, payload hash, and idempotency key.
- Cloud ingest endpoint scoped to one tenant and authenticated with a server-specific token.
- Retry state with exponential backoff and poison-event quarantine.
- R2/file sync for uploads using signed URLs, not D1 blob storage.
- Audit rows for sync export/import without logging sensitive payloads.
