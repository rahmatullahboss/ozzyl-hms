# Workstation Local-First HMS Implementation Plan

Date: 2026-08-12

## Phase 0 — Safety and contracts

- [x] Freeze workstation-local architecture.
- [x] Keep central local-server deployment optional/independent.
- [x] Reuse durable local sync protocol rather than generic service-worker POST caching.
- [ ] Add explicit workstation launcher/config with unique node ID and loopback binding.
- [ ] Add workstation health/readiness command.
- [ ] Add startup auto-sync process.

## Phase 1 — Workstation runtime foundation

- [ ] Generate per-workstation private config and stable ID.
- [ ] Use dedicated persistent local state directory.
- [ ] Start HMS Worker locally on loopback only.
- [ ] Run schema migrations before serving normal traffic.
- [ ] Support first-online tenant snapshot bootstrap.
- [ ] Continue serving when cloud is unavailable.
- [ ] Restart-safe sync/outbox behavior.

## Phase 2 — Core sync coverage

Current cloud-apply coverage is not sufficient for complete reception/billing offline operation. Add mapping + apply + tests for:

- [ ] appointments
- [ ] visits
- [ ] queue entries
- [ ] admissions
- [ ] bills
- [ ] invoice items
- [ ] billing deposits
- [ ] payments

Each entity must have an idempotent cloud apply contract and dependency mapping where IDs differ.

## Phase 3 — UI routing and status

- [ ] Provisioned workstation opens localhost endpoint by desktop/startup shortcut.
- [ ] Static/PWA assets work without cloud.
- [ ] Offline/cloud status visible.
- [ ] Pending/conflict counts visible.
- [ ] Manual safe retry control.

## Phase 4 — Rehearsal

Use non-production/clone data first:

1. provision while online;
2. disconnect internet;
3. restart workstation;
4. perform patient/reception/admission/billing workflow;
5. restart again and verify persistence;
6. reconnect internet;
7. observe automatic outbox flush and pull;
8. verify cloud records exactly once;
9. inject conflicts and prove fail-closed behavior.

## Tenant 102 production gate

Tenant 102 may only be switched to workstation-local authoritative mode after all core write paths used in production have explicit outbox/cloud-apply coverage and the clone rehearsal passes. Until then the workstation runtime is development/readiness infrastructure, not a production cutover.
