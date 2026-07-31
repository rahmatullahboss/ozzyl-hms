# Incident Runbook — Ozzyl HMS (Production)

> **Owner:** Platform / SRE
> **Last updated:** 2026-06-16
> **Status:** Active

This runbook describes how the production Ozzyl HMS Worker is observed,
who is paged, and what to do when an alert fires. It pairs with:

- `docs/RUNBOOK_BACKUP_RESTORE.md` — DR / restore drill
- `wrangler.toml` — production env (workers_dev, stub/placeholder vars)
- `src/lib/server-error-logging.ts` — structured log payload shape
- `src/index.ts` — `/api/health` and `/api/health/deep` endpoints

---

## 1. Observability pipeline

```
[Worker / request] ─► structured JSON log
   (severity, tenant_id, user_id, request_id, cf_ray)
        │
        ▼
[Cloudflare Worker Logs / Logpush]
        │
        ▼
[Aggregator — Sentry, Datadog, Logflare, or self-hosted Loki]
        │
        ▼
[Alert rule] ──► [Slack / WhatsApp channel] ──► [On-call engineer]
        │
        ▼
[Runbook step]
```

The Worker emits structured logs via `console.error('[SERVER_ERROR]', ...)`
with the shape defined in `src/lib/server-error-logging.ts`:

- `event`: `server_error` (5xx) | `http_error` (4xx)
- `severity`: `info` | `warning` | `error` | `critical` (mapped from
  HTTP status; 5xx = `critical`, 4xx = `warning`)
- `tenant_id`, `user_id`, `request_id` (falls back to `cf_ray`)
- `status`, `method`, `path`, `queryKeys`, `message`, `errorName`,
  `stack` (truncated in production), `environment`, `timestamp`

We do **not** vendor a hard Sentry SDK dependency. The shape is
framework-agnostic; any sink that ingests JSON can consume it.

### Logpush / Worker Logs

Cloudflare Worker Logs and Traces are enabled in `wrangler.toml`
(`[observability]` block, head_sampling_rate = 1). Configure Logpush
to ship logs to the aggregator bucket (see the Cloudflare dashboard
or `wrangler` CLI).

---

## 2. Severity & paging policy

| Severity | Definition | Response | Page who |
|---|---|---|---|
| `critical` | Patient-safety-impacting outage (auth down, billing down, lab result delivery failed, SMS/email 100% failure) | < 5 min | On-call engineer + product owner |
| `error`    | Sustained 5xx, payment failure rate > 1%, D1 error spike | < 15 min | On-call engineer |
| `warning`  | Login failure spike, queue backlog growing, single cron failure, scheduled job not running | < 1 hour | On-call engineer (next business day for non-critical hours) |
| `info`     | Notable non-fatal events, e.g. 4xx burst from a single IP | next business day | Aggregate, no page |

**Channels:**

- `#hms-incidents` (Slack) — all critical + error alerts
- `#hms-warnings` (Slack) — warnings, queue backlog, cron failures
- WhatsApp bridge: PagerDuty / Opsgenie for `critical` after-hours

---

## 3. Alert catalog

Each alert below lists: condition, threshold, who pages, runbook link.
All thresholds are *starting* values — tune in the first 30 days based
on real traffic.

### 3.1 5xx rate

- **Condition:** 5xx responses per minute across all routes
- **Threshold:** `> 0.5% of total requests over 5 min` ⇒ `error`;
  `> 2% over 5 min` ⇒ `critical`
- **Pages:** On-call engineer
- **First action:** check Cloudflare status page → look at the most
  frequent 5xx `path` in Logpush → roll back last deploy if correlated
  → see `/api/health/deep` for dependency status
- **Runbook:** §5.1 below

### 3.2 Login failures

- **Condition:** 401/403 from `/api/auth/*`, `/api/login*`,
  `/api/tenant/auth/*` paths
- **Threshold:** `> 50 failures per minute from a single IP` ⇒ `warning`
  (possible credential stuffing); `> 200 per minute` ⇒ `critical`
- **Pages:** On-call engineer
- **First action:** confirm the source IP via `cf-ray` → block at WAF
  if a brute-force pattern is confirmed → check if a legitimate
  release broke auth (lockout window, password hash change)
- **Runbook:** §5.2

### 3.3 Payment failures

- **Condition:** bKash / Nagad / SSLCommerz callback failures or
  `payments` route 5xx
- **Threshold:** any callback returning non-2xx from a payment provider
  → `warning`; > 1% of transactions failing for 5 min → `critical`
- **Pages:** On-call engineer + product owner (because revenue impact)
- **First action:** check provider status pages → verify webhook
  signature parsing is still working → reconcile pending payments
  with provider portal
- **Runbook:** §5.3

### 3.4 D1 errors

- **Condition:** any unhandled D1 exception in a Worker request
- **Threshold:** `> 0` ⇒ `critical` (D1 should never throw in normal
  operation; even one indicates schema drift or quota)
- **Pages:** On-call engineer
- **First action:** check `wrangler d1 execute` for the same database
  → check migration manifest in `migrations/` → if quota, check
  Cloudflare dashboard
- **Runbook:** §5.4

### 3.5 Sync failures (local server → cloud)

- **Condition:** `/api/local-server/schema-sync` or push-sync errors
- **Threshold:** `> 0` per local server per hour ⇒ `warning`;
  consecutive failures for a tenant > 6 hours ⇒ `error`
- **Pages:** On-call engineer
- **First action:** check local server's `/api/local-server/status` →
  check CORS / network reachability → look at recent schema manifest
  upload errors
- **Runbook:** §5.5

### 3.6 Queue backlog (when queues are wired up)

- **Condition:** Cloudflare Queue backlog (visible in dashboard) or
  in-process `queue` route 5xx
- **Threshold:** `> 100 messages visible for > 10 min` ⇒ `warning`;
  `> 1000 for > 30 min` ⇒ `critical`
- **Pages:** On-call engineer
- **First action:** check consumer worker status → check for poison
  messages → drain manually with `wrangler queues consumer` if safe
- **Runbook:** §5.6

### 3.7 Cron failures

- **Condition:** scheduled job (`src/scheduled.ts`) logs an error, or
  expected cron does not produce a heartbeat within 1.5× its interval
- **Threshold:** any failure ⇒ `warning`; 3 consecutive failures ⇒
  `error`
- **Pages:** On-call engineer
- **First action:** check `wrangler tail` for the schedule invocation
  → confirm cron expression is still active (`wrangler triggers list`)
  → if account cron limit is the cause, see the migration plan in §6

---

## 4. Health endpoints

### `/api/health` (public, cheap)

Returns `{ status, version, timestamp }`. No DB / KV / R2 calls.
Cache-friendly. Wire this into an external uptime monitor
(e.g. Better Stack, Pingdom, UptimeRobot, or Cloudflare Health
Checks). Minimum check interval: 60s. Any non-2xx ⇒ page.

### `/api/health/deep` (token-gated; P1-53)

Probes D1 + KV + R2. Returns 200 with all `ok`, 503 with `degraded`
if any subsystem is unreachable. Wire this into the same monitor at
a 5-minute cadence.

**Configuration:**

- Set the token per env:
  ```
  wrangler secret put DEEP_HEALTH_TOKEN --env production
  ```
- The token must be a high-entropy random string (e.g. 32+ bytes).
- The uptime monitor sends it in the `X-Health-Token` header.
- Local development (`development`, `local_server` env) bypasses
  the check for developer ergonomics. **All other environments
  require the token** — if the secret is unset in production,
  every non-local call returns 403 (fail-closed).

The check intentionally does not expose internal topology beyond the
`checks: { db, kv, r2 }` summary and a duration — sufficient for an
operator to act on, insufficient for a public attacker to fingerprint
the deployment.

---

## 5. First-response steps

### 5.1 5xx storm

1. Pull `wrangler tail --env production --format=json` to see live logs.
2. Find the most frequent 5xx `path`. If it correlates with the last
   deploy, roll back via `wrangler rollback --env production`.
3. If not correlated, check Cloudflare status (cf.status) → check D1
   status (cf dashboard) → check the recent schema migrations.
4. If patient-safety-impacting (e.g. lab results not delivering),
   follow §5.7.

### 5.2 Login brute force

1. Group the 401/403 by `cf-connecting-ip` (in `userAgent` field's
   complement or via Cloudflare Analytics).
2. Add a WAF rule or rate-limit block for the source.
3. Audit `/api/audit/*` logs to confirm no successful logins slipped
   through.

### 5.3 Payment provider outage

1. Pause the `payments` route via the feature flag (see
   `src/lib/feature-flags.ts`).
2. Notify the hospital's billing team that online payments are paused;
   in-person collections continue.
3. After provider recovery, replay the pending payments queue and
   reconcile.

### 5.4 D1 error

1. Run `wrangler d1 execute DB --env production --remote --command
   "SELECT name FROM sqlite_master WHERE type='table';"` to confirm
   schema is intact.
2. If the error is `table not found` or `no such column`, the
   migration manifest in `migrations/` is behind production. Apply
   with `pnpm deploy:production` (it builds and uploads the manifest).
3. If quota, the error will be `exceeded quota`; raise a ticket with
   Cloudflare and shed non-critical writes (analytics, audit).

### 5.5 Sync failures

1. From the local server, run `bash scripts/local-server/health-check.sh`.
2. If `cloudSyncConfigured: false`, the local server cannot reach
   the cloud — check the `CLOUD_SYNC_BASE_URL` and
   `CLOUD_SYNC_TOKEN` secrets on the local server.
3. If the token has rotated on the cloud side, regenerate it on the
   local server.

### 5.6 Queue backlog

1. Open Cloudflare dashboard → Workers → Queues.
2. Inspect message sample. If poison messages are obvious (bad
   payload, repeated 4xx), purge the poison batch.
3. If consumer is down, restart the consumer worker; messages will
   resume processing.

### 5.7 Patient-safety escalation (out of band)

For any failure that risks patient safety (e.g. lab result delivery
broken, wrong patient data displayed, prescription record corrupted):

1. Page product owner immediately on WhatsApp.
2. Add a `critical` banner to the patient portal
   (`HMS_APP_URL/maintenance.json` is polled by the SPA) — see
   `web/src/lib/maintenance-mode.ts`.
3. Open an incident ticket. Do not declare "all clear" until a full
   audit confirms no incorrect data was shown to any patient.

---

## 6. Scheduled jobs (P0-41)

The production Worker has its cron trigger **disabled** because the
Cloudflare account has hit the 5-cron limit. We do **not** add new
crons to this worker.

**Implemented, not yet deployed:** `src/lis-jobs.ts` and
`wrangler.lis-jobs.toml` define a dedicated route-less Worker with one
five-minute trigger for durable LIS retraction-notification retries.
The main Worker still performs immediate post-approval/manual-retry
dispatch with `waitUntil`, and keeps `src/scheduled.ts` as a backward-
compatible dispatcher.

Do **not** deploy `wrangler.lis-jobs.toml` until operations consolidates
or removes an existing account cron trigger and assigns one slot to
`hms-lis-jobs-production`. After a slot is available:

1. Apply and verify migration `0408_lis_retraction_notification_dispatch.sql`.
2. Deploy with `wrangler deploy -c wrangler.lis-jobs.toml`.
3. Verify the Worker trigger is `*/5 * * * *` and the `DB` binding points
   to `hms-super-admin-production-apac`.
4. Create a synthetic retraction event and verify the outbox moves from
   `pending` to `sent`, with one sent delivery per eligible recipient.
5. Confirm no duplicate `notifications.dedupe_key` or patient portal
   `dedupe_key` is created after two trigger runs.

Until the jobs Worker is deployed, an accountable laboratory governance
user must monitor:

`GET /api/lab-machines/retraction-notification-outbox?status=failed&includeDeliveries=true`

For a reviewed transient failure, queue an accountable retry with:

`POST /api/lab-machines/retraction-notification-outbox/{outboxId}/retry`

A malformed immutable payload or no eligible recipient is a terminal
patient-safety incident, not a blind retry condition. Correct the
recipient/configuration cause, document the incident, then use the
manual retry endpoint only when the evidence is safe to resend.

---

## 7. On-call schedule

The on-call rotation is maintained in the operations calendar
(separate from this repo). The platform lead is the default backup
when the on-call engineer is unreachable for > 15 min.

### Hand-off checklist (every Monday)

- [ ] Verify uptime monitor is firing for both `/api/health` and
      `/api/health/deep` (token).
- [ ] Verify Logpush destination is receiving recent logs.
- [ ] Review the previous week's `critical` / `error` alerts; close
      any open incidents.
- [ ] Verify the `DEEP_HEALTH_TOKEN` secret is still set in
      production (`wrangler secret list --env production`).
- [ ] Run a backup-restore drill (see `docs/RUNBOOK_BACKUP_RESTORE.md`).
