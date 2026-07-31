# P04 Canonical Service Operations Rehearsal

**Task:** CDB-041 — Create service requests and service events

**Date:** 2026-07-14

## Delivered

Migration `0427_canonical_service_requests_events.sql` adds:

- `canonical_service_requests` for ordered or planned work;
- `canonical_service_events` for operationally accepted or delivered work;
- `canonical_service_participants` for explicit practitioner roles.

Requests and events use tenant-scoped public IDs, typed catalog and encounter links, integer quantities, UTC lifecycle times, evidence hashes, and restrictive foreign keys. Billing projections are not delivery authorities.

## Lifecycle rules

- Lab items create requests; only completed, verified, or validated evidence creates completed events.
- Radiology and procedure sources create events only after operational completion evidence.
- Consultation requires exactly one catalog candidate; multiple candidates remain ambiguous.
- Bed reservation is a request; bed stay is an occupied event.
- Prescription items require explicit medicine identity and valid quantity; dispensing supports partial fulfillment.
- Missing catalog, encounter, or practitioner evidence is never fabricated.
- Changed source evidence creates an issue instead of rewriting history.

## Runtime safety

`createServiceRequest()` atomically writes request, participant, mapping, idempotency claim, and PHI-free outbox data.

`recordServiceEvent()` atomically updates fulfillment and writes event, participant, mapping, and PHI-free outbox data. `last_event_public_id` prevents stale concurrent delivery. Fulfilled-request replay is returned before state-dependent rejection.

## Verification

- focused CDB-041 tests: `11` passed
- full suite: `17` files / `120` tests
- governance: `0` issues
- migration manifest: `437`
- TypeScript: `0` errors
- registered canonical tables: `24`

## Source audit

- lab items: `221`
- radiology requisitions: `2`
- consultations: `18`
- procedure orders: `2`
- bed reservations: `3`
- bed stays: `44`
- prescription items: `32`
- total: `322` rows across `3` tenants

Delivered evidence in the snapshot:

- lab events: `19`
- bed occupancy events: `44`
- radiology, procedure, and medicine-delivery events: `0`
- completed consultations existed, but none had a unique catalog candidate

No patient, practitioner, service name, code, or clinical text is included here.

## Exact-snapshot result

First pass:

- requests: `228`
- events: `63`
- participants: `69`
- mappings: `341`
- issues: `206`

Second pass created `0` requests, events, participants, mappings, or issues.

Final integrity:

- request mappings: `278`
- event mappings: `63`
- mappings without evidence: `0`
- invalid event quantities: `0`
- FK violations: `0`
- active requests: `209`
- fulfilled requests: `19`
- completed events: `19`
- occupied events: `44`

Issue classes:

- catalog ambiguous: `12`
- catalog unresolved: `6`
- practitioner unresolved: `156`
- quantity invalid: `32`

These are explained source limitations, not unexplained reconciliation variance.

## Rehearsal clone

Pre-apply bookmark:

`00000017-00000000-000050a7-8c6517bd25de6a8d3e495376d296438f`

Only `0427` was pending. The migration applied successfully. The protected backfill imported `955` canonical inserts and reconciled exactly to the local snapshot.

Initial bundle SHA-256:

`ce1cb2001c066d43918a26f707c1e49a516bd4cf788bd11dab6cc33410a85c57`

The concurrency guard column was then reconciled schema-only. All `228` historical guard values remained `NULL`; business counts and FK integrity were unchanged.

Final-code bundle SHA-256:

`f60b6634c04877af2e60e4c533f84769458e63901a951e68caa6335463fe5360`

Final bookmark:

`00000018-00000006-000050a8-843c8b2a48c7b6ceca739cff2f6b8e31`

## Production boundary

Production read-only verification:

- canonical tables: `0`
- migrations `0423` through `0427`: `0`
- latest migration ID: `447`
- rows written: `0`

No production mutation, deployment, push, `main` merge, restore, or local-server activation occurred.
