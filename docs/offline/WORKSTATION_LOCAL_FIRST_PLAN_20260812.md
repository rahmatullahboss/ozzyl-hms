# Workstation Local-First HMS Implementation Plan

Date: 2026-08-12

## Phase 0 — Safety and contracts

- [x] Freeze workstation-local architecture.
- [x] Define three-tier topology: workstation -> preferred LAN coordinator -> cloud, with safe direct-cloud/local-only fallback.
- [x] Reuse durable local sync protocol rather than generic service-worker POST caching.
- [x] Add explicit workstation launcher/config with unique node ID and loopback binding.
- [x] Add workstation health/status command.
- [x] Add startup auto-sync process.
- [x] Define workstation UUID as sync/idempotency origin.
- [x] Define readable workstation code as local numbering namespace.

## Phase 1 — Workstation runtime foundation

- [x] Generate per-workstation private config and stable UUID.
- [x] Generate/persist readable `WS-XXXXXXXX` code.
- [x] Use dedicated persistent local state directory.
- [x] Start HMS Worker locally on loopback only.
- [x] Run local schema preparation before serving normal traffic.
- [x] Persist node identity into the local database.
- [x] Namespace prefixed locally-generated sequences by workstation code.
- [x] Add Windows autostart task and local HMS shortcut.
- [ ] Make first-online tenant snapshot bootstrap a single guarded command.
- [ ] Add bootstrap completeness/readiness proof before enabling local operations.
- [ ] Add explicit persisted outbox/conflict metrics to workstation status.

## Phase 2 — LAN coordinator

The LAN server is preferred when healthy, but it must not be a single point of failure.

- [x] Add optional LAN coordinator configuration to workstation provisioning.
- [ ] Add coordinator compatibility/health handshake.
- [ ] Add workstation registration and identity collision rejection.
- [ ] Add non-overlapping sequence-range lease contract.
- [ ] Add shared resource lock/lease contract for collision-prone resources such as beds.
- [ ] Preserve original workstation UUID/idempotency identity through any LAN relay.
- [ ] Prevent simultaneous direct-cloud and LAN forwarding of the same unacknowledged event.
- [ ] Define safe failover/failback acknowledgement reconciliation.

## Phase 3 — Core sync coverage

Current cloud-apply coverage is not sufficient for complete reception/billing offline operation. Add mapping + apply + tests for:

- [ ] appointments
- [ ] visits
- [ ] queue entries
- [ ] admissions
- [ ] bills
- [ ] invoice items
- [ ] billing deposits
- [ ] payments

Each entity must have an idempotent upstream apply contract and dependency mapping where local/upstream IDs differ.

## Phase 4 — Conflict and reconciliation

Workstation IDs remove identifier collisions but do not remove semantic conflicts.

- [ ] Persist conflict records rather than overwriting mutable/finalized data.
- [ ] Detect stale mutable row versions.
- [ ] Detect duplicate real-world payment/collection attempts.
- [ ] Fail closed on finalized financial mutation conflicts.
- [ ] Fail closed on signed clinical record conflicts.
- [ ] Add operator reconciliation queue with source workstation, timestamps and diffs.

## Phase 5 — UI routing and status

- [x] Provisioned Windows workstation gets a localhost desktop shortcut.
- [x] Static/PWA assets are served by the workstation runtime without cloud.
- [ ] Show workstation UUID/code in diagnostics.
- [ ] Show LAN coordinator online/offline/not-configured state.
- [ ] Show cloud online/offline state.
- [ ] Show pending/conflict counts and last successful push/pull.
- [ ] Add manual safe retry/reconciliation controls.

## Phase 6 — Rehearsal

Use non-production/clone data first:

1. provision while online;
2. verify tenant snapshot and staff login locally;
3. disconnect internet and LAN coordinator;
4. restart workstation;
5. perform patient/reception/admission/billing workflow;
6. restart again and verify persistence;
7. run the same workflow on a second isolated workstation and verify number uniqueness;
8. restore LAN coordinator and/or internet;
9. observe automatic outbox flush and pull;
10. verify cloud records exactly once;
11. inject bed/edit/payment/finalization conflicts and prove fail-closed reconciliation behavior.

## Tenant 102 production gate

Tenant 102 may only be switched to workstation-local authoritative mode after all core write paths used in production have explicit outbox/upstream-apply coverage, semantic conflict handling exists, and the two-workstation outage/reconnect clone rehearsal passes. Until then the workstation runtime foundation may be merged and tested, but it is not a production cutover switch.
