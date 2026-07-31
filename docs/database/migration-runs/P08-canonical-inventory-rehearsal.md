# P08 Canonical Inventory Movement Rehearsal

Date: 2026-07-14
Task: `CDB-080`
Worker branch: `task/cdb-080-canonical-inventory`
Migration: `0432_canonical_inventory_links.sql`

## Scope

CDB-080 establishes immutable stock movement authority across the general inventory, rich pharmacy, and legacy medicine ledgers. Mutable stock caches remain reconciliation evidence and are not promoted to movement truth.

The implementation adds:

- canonical item identity and one base unit;
- typed stock location identity;
- item lot/batch and expiry identity;
- item-specific rational unit conversions;
- explicit item/location negative-stock policy;
- guarded balance projection by tenant/item/location/lot;
- linked inter-location transfer headers;
- immutable typed stock movements;
- an atomic runtime stock-movement command;
- deterministic legacy movement backfill with source mappings, checkpoints, drift detection, and issue classification.

No existing pharmacy, inventory, billing, accounting, or cash route was switched. Runtime canonical dispense/sale linkage is available through the new command, while current production paths remain unchanged until a separately authorized cutover.

## Canonical authority

Canonical tables:

- `canonical_inventory_items`
- `canonical_inventory_locations`
- `canonical_inventory_lots`
- `canonical_inventory_unit_conversions`
- `canonical_inventory_stock_policies`
- `canonical_inventory_balances`
- `canonical_inventory_transfers`
- `canonical_inventory_movements`

Stock truth is the signed sum of immutable movements. `canonical_inventory_balances` is a guarded projection and must equal that sum.

Movement types:

- migration opening;
- purchase receipt;
- transfer out / transfer in;
- issue;
- dispense;
- sale;
- patient return;
- supplier return;
- waste;
- expiry;
- positive / negative adjustment;
- explicit reversal in / reversal out.

Rules:

1. Quantity is stored as an integer base-unit amount.
2. Non-base units require one exact active item-specific numerator/denominator conversion.
3. A conversion that does not produce an integral base quantity is rejected.
4. Negative stock is blocked unless one explicit item/location policy permits it.
5. Transfer is one header plus one outbound and one inbound leg in the same atomic batch.
6. Historical transfer/dispatch rows without an exact counterpart and location pair are classified; one leg is never guessed.
7. Runtime dispense requires one posted canonical `dispensed` service event matching the item service identity.
8. Runtime sale requires that service event plus one posted canonical invoice line linked to the event.
9. A service event or invoice line can claim at most one dispense/sale stock-out.
10. Historical sale/dispense rows may remain unlinked when exact canonical service/invoice evidence is unavailable; links are never fabricated.
11. Conditional balance-version updates and persisted before/after evidence enforce stale-balance rollback without triggers.
12. Original source rows and mutable cache amounts are not rewritten.

## RED and runtime verification

RED fixtures first confirmed that migration `0432`, the runtime command, schema module, and inventory backfill did not exist.

Focused coverage includes:

- all eight canonical tables and strict SQL movement math;
- purchase receipt and exact box-to-unit conversion;
- inter-location transfer pairing;
- issue, dispense, sale, patient return, supplier return, waste, expiry, and positive/negative adjustments;
- blocked and explicitly permitted negative stock;
- non-integral conversion rejection;
- identical replay and semantic idempotency conflict;
- duplicate dispense/sale service and invoice stock-out prevention;
- stale balance/version rollback with no movement, mapping, or outbox residue;
- cross-tenant reference rejection;
- PHI-free command and outbox payloads;
- three-ledger deterministic backfill;
- source-evidence drift;
- checkpoint pause/resume and terminal-run reuse;
- mutable-cache variance classification;
- unknown vocabulary and unresolved transfer classification.

Focused verification:

- test files: `1`
- tests: `22`
- failures: `0`

Full pre-rehearsal verification:

- files: `28`
- tests: `222`
- failures: `0`
- canonical governance issues: `0`
- canonical tables registered: `48`
- migration manifest entries: `442`
- TypeScript errors: `0`

## Protected exact-snapshot rehearsal

A fresh isolated copy of the protected post-CDB071 SQLite snapshot received migration `0432`. The source snapshot was opened only for hash/size proof and remained unchanged.

Source aggregates:

- tenants with inventory movement evidence: `1`
- general inventory movements: `4`
- rich pharmacy movements: `28`
- legacy medicine movements: `12`
- total source movements: `44`
- general stock cache rows: `4`
- rich pharmacy stock cache rows: `25`
- legacy medicine batch cache rows: `6`

First pass:

- scanned: `44`
- canonical items created: `33`
- canonical locations created: `3`
- canonical lots created: `35`
- canonical movements created: `44`
- canonical balances created: `35`
- source mappings created: `115`
- explicit issues created: `31`

Second pass:

- scanned: `44`
- new movements: `0`
- new issues: `0`

Final canonical aggregates:

- items: `33`
- locations: `3`
- lots: `35`
- unit conversions: `0`
- stock policies: `33`
- balances: `35`
- transfers: `0`
- movements: `44`
- mappings: `115`
- issues: `31`
- exact service-event links: `0`
- exact invoice-line links: `0`

All 44 source movement rows had exact typed movement vocabulary after adding the existing `lab-stock-in` reagent receipt vocabulary. No source movement was guessed or dropped.

All 31 issues are `INVENTORY_BALANCE_VARIANCE`: the legacy mutable cache differs from the immutable movement sum. These variances remain explicit reconciliation evidence and do not overwrite canonical movement truth.

Integrity checks:

- balance projection versus signed movement sum variances: `0`
- duplicate source claims: `0`
- duplicate service-event stock-outs: `0`
- movement balance-guard violations: `0`
- balance projection-guard violations: `0`
- foreign-key violations: `0`

Protected source proof:

- file size: `43,704,320` bytes
- SHA-256: `35e42b23310bda608d9bf6b13e4a423668e94c3af7d2e346b78585197492fdc6`
- hash unchanged: yes
- size unchanged: yes

## Isolated D1 rehearsal clone

Target:

- database: `hms-canonical-rehearsal-20260713-b6036e`
- UUID: `6f9a17af-8e3e-4b26-85b7-08c653a706db`
- observed region: APAC

Pre-apply bookmark:

`00000020-00000000-000050a8-88463c4b9dcb685915b08c3824e9861c`

Migration `0432` was applied through Wrangler migrations and recorded once in `d1_migrations`.

Protected import bundle:

- domain statements: `333`
- Wrangler processed queries including pragmas: `335`
- size: `211,581` bytes
- SHA-256: `a80ca82766f5c4dc9c0bded7950efb1b8553974720fceb85289a1f88fcfe5e80`
- bundle location: access-controlled rehearsal storage outside Git

Remote aggregate reconciliation exactly matched the protected local copy:

- items / locations / lots: `33 / 3 / 35`
- conversions / policies / balances: `0 / 33 / 35`
- transfers / movements: `0 / 44`
- mappings / issues: `115 / 31`
- exact migration `0432` ledger rows: `1`
- foreign-key violations: `0`
- balance projection variances: `0`
- duplicate source claims: `0`
- duplicate service stock-outs: `0`
- movement/balance guard violations: `0 / 0`
- balance-variance issues: `31`

Read-only reconciliation commands after import reported:

- `changed_db`: `false`
- rows written: `0`

Post-import bookmark:

`00000020-0000006e-000050a8-dbdac38ef196e54056f556371d5f9caf`

No Time Travel restore was required or attempted.

## Production read-only boundary

Production target:

- database: `hms-super-admin-production-apac`
- UUID: `c68a5360-a2c1-44cc-9e71-f21057bea102`

Exact read-only verification returned:

- canonical tables: `0`
- exact canonical migrations `0423` through `0432`: `0`
- exact migration `0432`: `0`
- latest migration ledger ID: `448`
- `changed_db`: `false`
- rows written: `0`

No production migration, data, inventory balance, feature flag, Worker version, route, deployment, or setting was changed.

## Protected artifacts

The SQLite copy, migration copy, clone configuration, bundle builder, aggregate runner, and generated SQL bundle remain outside Git in access-controlled rehearsal storage. No SQLite file, raw export, protected SQL, PHI, patient identity, signed URL, or bundle is committed.

## Program integration

- worker branch: `task/cdb-080-canonical-inventory`
- implementation commit: `7a20f5a3`
- worker evidence commit: `e0142a75`
- program branch: `feature/hms-canonical-data-architecture`
- integration merge: `c2cd6678838557c890291c44010fe68008b699e5`
- merge method: non-fast-forward under the shared merge lock

Fresh post-merge verification:

- canonical, migration-manifest, and shadow-route tests: `28 files / 222 tests`
- failures: `0`
- canonical governance issues: `0`
- migration manifest: `442`
- TypeScript errors: `0`

The tracker and handoff artifacts now mark CDB-080 complete and CDB-081 ready. Integration touched only the canonical program branch. Existing pharmacy and inventory routes, production, `main`, deployment, push, Time Travel restore, local server, and original dirty workspace remained untouched.

## Result

CDB-080 rehearsal and program integration passed. Immutable typed movements now provide canonical stock truth, transfers and runtime dispense/sale links are duplicate-safe, balances are guarded projections, all protected source movements were canonicalized deterministically, legacy cache drift remains explicit, and production remained untouched.
