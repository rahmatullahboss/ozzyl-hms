# Workstation Local-First HMS Design

Date: 2026-08-12

## Topology

```text
Browser/PWA
   |
   | http://127.0.0.1:<port>
   v
Workstation HMS runtime
   - same Hono/Worker application
   - persistent local D1-compatible state
   - local static assets
   - durable local_sync_outbox
   - unique workstation node identity
   |
   | background sync when internet is reachable
   v
Production Worker / D1
```

The central hospital local server may still exist for other deployment modes, but it is not required for a workstation to remain usable.

## Why a workstation runtime instead of generic browser write caching

The HMS backend contains domain rules for billing, admissions, commissions, deposits, audit and clinical records. A service worker cannot safely synthesize the authoritative result of arbitrary mutations. Running the same backend code against persistent local D1 state preserves those rules and allows generated IDs, transactions and dependent writes to exist locally before cloud sync.

## Workstation identity

Each workstation receives a stable random ID generated once and persisted outside the database state directory. Suggested format:

`hms-workstation-<uuid>`

The ID is injected as `LOCAL_SERVER_ID`. Idempotency keys therefore remain stable across process restarts and unique across workstations.

## Storage

Each node owns a dedicated state directory. The runtime must always start with `--local --persist-to <node-state-dir>` and must never point to a shared network filesystem.

Recommended paths:

- Windows: `%LOCALAPPDATA%\\OzzylHMS\\workstation\\state`
- macOS: `~/Library/Application Support/OzzylHMS/workstation/state`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/ozzyl-hms/workstation`

The browser PWA cache is only the UI cache. Clinical/financial source data lives in the workstation runtime state.

## Provisioning

First provisioning while online performs:

1. Generate workstation ID and local JWT secret.
2. Configure tenant ID/subdomain and cloud sync credentials.
3. Build/current static assets available locally.
4. Apply local schema migrations.
5. Pull an allowed tenant snapshot from cloud into the empty workstation DB.
6. Mark node ready only after schema + snapshot verification passes.

Subsequent launches do not require internet.

## Local write path

1. Browser submits to localhost.
2. The normal HMS route validates authorization/business rules.
3. Domain rows and outbox rows commit atomically where supported.
4. UI receives local success immediately.
5. Sync worker sees the durable outbox later.
6. Production `/api/sync/ingest` applies known entity types idempotently and records entity mappings.
7. Local outbox rows are marked delivered only after cloud acknowledgement.

## Cloud pull path

A node pulls only after its pending outbox has been safely flushed, except for immutable/reference tables that are explicitly classified as pull-safe. This prevents a fresh cloud snapshot from silently replacing unsynced local changes.

Cloud snapshots are tenant-scoped and table allowlisted. Signed clinical records and finalized/immutable financial data require conflict-specific handling.

## Connectivity

`navigator.onLine` is advisory only. The runtime sync worker determines cloud availability through real HTTP calls with bounded connect/request timeouts. The UI should show:

- Local: healthy/unhealthy
- Internet/cloud: online/offline
- Pending sync count
- Last successful push/pull
- Conflict/error count

## Offline authentication

The workstation runtime has its own local JWT secret and local copy of permitted staff/tenant configuration. Offline authentication must validate against local data; cloud refresh cookies are not the offline authority. Password/verifier synchronization must use existing password hashing policy and never store plaintext credentials.

## Sync conflict rules

Default policy is fail closed:

- duplicate idempotency key + same payload: acknowledge as duplicate;
- duplicate key + different payload: conflict;
- cloud immutable/finalized state changed: conflict;
- signed clinical record changed: conflict;
- local entity requires cloud ID: resolve/persist mapping before dependent child events;
- dependency not mapped yet: retry later, do not poison immediately;
- unsupported entity type: retain event and report coverage gap.

## Performance

For provisioned workstations, routine reads/writes have LAN-loopback/local-disk latency rather than internet/D1 round-trip latency. Cloud sync is decoupled from interactive response time.

## Security

- Bind workstation runtime to loopback by default (`127.0.0.1`), not `0.0.0.0`.
- Keep per-workstation secrets in a user-private config file.
- Do not expose the runtime to LAN unless explicitly configured.
- Cloud sync token is scoped to sync endpoints only.
- Browser persistent access tokens remain prohibited; local login issues local runtime tokens.
- Local data at rest should ultimately be protected using OS disk encryption and/or application-level encrypted sensitive stores.

## Rollout guard

Do not enable full tenant 102 local-authoritative operation until sync coverage includes every write entity used by its production reception/IPD/billing workflow and an outage/reconnect rehearsal passes against a production clone.
