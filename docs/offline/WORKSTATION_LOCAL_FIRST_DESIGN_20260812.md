# Workstation Local-First HMS Design

Date: 2026-08-12

## Topology

```text
Browser/PWA
   |
   | always http://127.0.0.1:<port>
   v
Workstation HMS node (one per PC)
   - same Hono/Worker application
   - persistent local D1-compatible state
   - local static assets
   - durable local_sync_outbox
   - immutable workstation UUID + short code
   |
   | preferred coordination path when LAN coordinator is healthy
   v
Hospital LAN coordinator
   - shared sequence/range coordination
   - shared resource/conflict coordination
   - cloud-facing sync/proxy role as coverage matures
   |
   | internet
   v
Production Worker / D1

Fallback when the LAN coordinator is unavailable:

Workstation HMS node -> direct cloud sync when internet is reachable.
Workstation HMS node -> local-only operation when neither LAN nor cloud is reachable.
```

The central hospital LAN server is therefore **preferred but never required for a workstation to remain usable**. A PC does not switch its browser between cloud/LAN/local URLs: the browser always talks to its own localhost node. The node decides which upstream coordination path is currently safe.

## Why a workstation runtime instead of generic browser write caching

The HMS backend contains domain rules for billing, admissions, commissions, deposits, audit and clinical records. A service worker cannot safely synthesize the authoritative result of arbitrary mutations. Running the same backend code against persistent local D1 state preserves those rules and allows generated IDs, transactions and dependent writes to exist locally before upstream sync.

## Workstation identity

Each workstation has two stable identities generated once and persisted outside the database state directory:

- authoritative origin ID: `hms-workstation-<uuid>`;
- readable workstation code: `WS-<8 chars>`.

The UUID is the sync/idempotency origin and must never be regenerated for a provisioned node merely because the process or PC restarted. The short code is used as the human-readable number namespace.

The identity is also copied into a singleton `workstation_node_identity` table inside the local database so shared sequence generation can detect workstation mode without changing every business-route call site.

## Collision-free numbering

A copied local database can contain the same numeric sequence counter on two PCs. Therefore a workstation must never expose a plain locally-generated sequence that could collide globally.

Prefixed externally-visible sequences are formatted as:

`<normal-prefix>-<workstation-code>-<local-sequence>`

Example:

`INV-A-2026-WS-A1B2C3D4-000042`

Cloud/non-workstation deployments keep the existing format unchanged.

When the LAN coordinator is healthy, a later optimization may lease non-overlapping number ranges to workstations. The workstation namespace remains the safety fallback if a lease is exhausted while isolated.

Workstation identity prevents identifier collisions; it does **not** make semantic conflicts impossible. The following still require version/ownership/conflict rules:

- two PCs allocating the same bed;
- two PCs editing the same patient/admission state from stale snapshots;
- duplicate real-world collection/payment entered independently;
- cancellation/refund racing a payment or finalization;
- signed clinical record changed on another node.

Those conflicts are fail-closed and go to reconciliation rather than last-write-wins overwrite.

## Storage

Each node owns a dedicated state directory. The runtime must always start with `--local --persist-to <node-state-dir>` and must never point to a shared network filesystem.

Recommended paths:

- Windows: `%LOCALAPPDATA%\\OzzylHMS\\workstation\\state`
- macOS: `~/Library/Application Support/OzzylHMS/workstation/state`
- Linux: `${XDG_STATE_HOME:-~/.local/state}/ozzyl-hms/workstation`

The browser PWA cache is only the UI cache. Clinical/financial source data lives in the workstation runtime state.

## Provisioning

First provisioning while online performs:

1. Generate immutable workstation UUID, readable workstation code, and local JWT secret.
2. Configure tenant ID/subdomain and cloud sync credentials.
3. Optionally configure LAN coordinator URL/credential.
4. Build/current static assets available locally.
5. Apply local schema migrations.
6. Persist workstation identity into the local database.
7. Pull an allowed tenant snapshot into the empty workstation DB.
8. Mark node ready only after schema + snapshot verification passes.

Subsequent launches do not require internet.

## Local write path

1. Browser submits to localhost.
2. The normal HMS route validates authorization/business rules.
3. Domain rows and outbox rows commit atomically where supported.
4. Externally-visible sequence numbers carry the workstation namespace when generated locally.
5. UI receives local success immediately.
6. Sync worker sees the durable outbox later.
7. Upstream sync applies supported entity types idempotently and records entity mappings.
8. Local outbox rows are marked delivered only after upstream acknowledgement.

## Upstream selection

Only one transactional upstream is primary for a workstation at a time.

1. Healthy, compatible LAN coordinator: prefer LAN coordination.
2. LAN coordinator unavailable and cloud reachable: direct cloud fallback.
3. Neither reachable: keep committing locally and retain outbox.

A workstation must not send the same unacknowledged mutation through two upstreams concurrently. Original workstation UUID/idempotency identity must survive any future LAN relay so cloud deduplication remains valid.

## Cloud pull path

A node pulls mutable tables only after its pending outbox has been safely flushed, except for immutable/reference tables explicitly classified as pull-safe. This prevents a fresh upstream snapshot from silently replacing unsynced local changes.

Cloud snapshots are tenant-scoped and table allowlisted. Signed clinical records and finalized/immutable financial data require conflict-specific handling.

## Connectivity

`navigator.onLine` is advisory only. The workstation sync process determines upstream availability through real HTTP calls with bounded connect/request timeouts. The UI should expose:

- local node healthy/unhealthy;
- workstation UUID/code;
- LAN coordinator online/offline/not configured;
- cloud online/offline;
- pending sync count;
- last successful push/pull;
- conflict/error count.

## Offline authentication

The workstation runtime has its own local JWT secret and local copy of permitted staff/tenant configuration. Offline authentication validates against local data; cloud refresh cookies are not the offline authority. Password/verifier synchronization must use the existing password hashing policy and never store plaintext credentials.

## Sync conflict rules

Default policy is fail closed:

- duplicate idempotency key + same payload: acknowledge as duplicate;
- duplicate key + different payload: conflict;
- cloud immutable/finalized state changed: conflict;
- signed clinical record changed: conflict;
- local entity requires upstream ID: resolve/persist mapping before dependent child events;
- dependency not mapped yet: retry later, do not poison immediately;
- unsupported entity type: retain event and report coverage gap;
- stale mutable row version: conflict/reconciliation, never silent overwrite.

## Performance

For provisioned workstations, routine reads/writes have loopback/local-disk latency rather than internet/D1 round-trip latency. LAN/cloud synchronization is decoupled from interactive response time.

## Security

- Bind workstation runtime to loopback by default (`127.0.0.1`), not `0.0.0.0`.
- Keep per-workstation secrets in a user-private config file.
- Do not expose the workstation runtime to LAN; only the coordinator is LAN-facing.
- Sync credentials are scoped to sync/coordination endpoints only.
- Browser persistent access tokens remain prohibited; local login issues local-runtime tokens.
- Local data at rest should ultimately be protected using OS disk encryption and/or application-level encrypted sensitive stores.

## Rollout guard

Do not enable full tenant 102 local-authoritative operation until sync coverage includes every write entity used by its production reception/IPD/billing workflow and an outage/reconnect rehearsal passes against a production clone. Workstation identity/number namespacing removes a major collision class, but it is not a substitute for complete entity sync and semantic conflict coverage.
