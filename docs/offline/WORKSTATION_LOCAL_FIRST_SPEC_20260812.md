# Workstation Local-First HMS Specification

Date: 2026-08-12
Status: Implementation baseline

## Goal

Make each hospital workstation independently operational during internet outages without depending on the central hospital LAN server. The workstation keeps a persistent local database and serves the HMS UI/API locally. When internet connectivity is available, local changes synchronize to the production Cloudflare/D1 authority automatically.

## User-visible contract

1. A receptionist can open HMS from the workstation even when the internet is unavailable, provided the workstation was provisioned while online at least once.
2. Normal local reads and writes must not wait for Cloudflare round-trips.
3. Local writes are committed to the workstation database before the UI reports success.
4. Every syncable local mutation produces a durable outbox event with tenant, workstation/node identity, entity identity, operation, payload hash and idempotency key.
5. Reconnect triggers automatic outbox flush and cloud pull. A failed sync never discards the local mutation.
6. Duplicate replay must be harmless. Conflicting or semantically unsafe replays must stop and surface for review rather than silently overwriting cloud state.
7. Cloud-only capabilities (online payment, SMS/email delivery, Workers AI/Vectorize, remote integrations) must degrade explicitly while offline.
8. Workstation storage is isolated per tenant/node and may not share credentials or queued writes across tenant/user boundaries.

## Architecture decision

This is NOT the existing central `local_server` deployment as an operational dependency. Each workstation runs an embedded/local runtime using the same HMS Worker code and persistent local D1-compatible Wrangler state. The existing local sync protocol is reused because it already provides server IDs, payload hashes, idempotency and entity mapping. The workstation runtime is provisioned with a unique `LOCAL_SERVER_ID` and its own state directory.

The browser-only PWA cache remains a secondary resilience layer for static UI assets. It is not the financial/clinical system of record because arbitrary POST replay in a service worker cannot safely reproduce invoice/admission/payment semantics.

## Initial production scope

Priority order:

1. Staff authentication/session continuity on the workstation.
2. Patient lookup/create/update.
3. Reception queue/visit/appointment flows.
4. Admission/IPD operational flows.
5. Billing headers, invoice items, deposits and payments.
6. Required reference/settings snapshots.
7. Printing from locally committed data.

Modules with external side effects remain online-only until their own outbox/acknowledgement contracts exist.

## Data safety invariants

- Tenant 102 production data must never be overwritten by a blind snapshot import.
- Pull must not run ahead of an unflushed local outbox when doing so could overwrite locally edited rows.
- Local IDs must be mapped to cloud IDs for entities whose cloud primary keys differ.
- Financial mutations require immutable/idempotent business keys, not only transport retry keys.
- Signed clinical records and finalized financial records are conflict-protected.
- Sync failures are retained with diagnostics and retry metadata.

## Acceptance criteria

A workstation passes outage readiness only when all of the following are demonstrated:

- cold start with internet unavailable after prior provisioning;
- login/session usable locally under the approved offline policy;
- patient + reception + admission + billing happy path executes against local state;
- browser/PC restart does not lose committed local records;
- internet restoration flushes queued writes automatically;
- cloud contains the expected records exactly once;
- reconnect/pull does not erase local unsynced data;
- conflict tests fail closed;
- explicit offline indicators show sync state and pending/error counts.
