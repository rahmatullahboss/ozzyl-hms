# P06 Canonical Payment Rehearsal

Date: 2026-07-14
Task: `CDB-060`
Worker branch: `task/cdb-060-canonical-payments`
Migration: `0429_canonical_payments.sql`

## Scope

This rehearsal verified additive canonical collection authority for receipts, typed tenders, persisted invoice allocations, invoice paid/due projections, deterministic legacy classification, exact integer-minor-unit reconciliation, atomic runtime collection, replay safety, cash-custody outbox linkage, and the production no-write boundary.

Deposits, credits, refunds, and payment-reversal commands remain outside this task and are reserved for `CDB-061`.

## Implemented authority boundary

- `canonical_payment_receipts` owns one collection document, its exact total, allocated amount, explicit unallocated balance, patient, currency, lifecycle, and source evidence.
- `canonical_payment_tenders` owns the actual payment instruments and gateway or cash states.
- `canonical_payment_allocations` owns exact minor-unit applications to canonical invoices and optional typed invoice lines.
- Invoice `paid_minor` and `due_minor` are guarded projections; receipts, tenders, and allocations remain collection authority.
- Receipt total must equal tender total.
- Receipt total must equal active allocation total plus explicit unallocated balance.
- One allocation must remain inside one tenant and reference one posted canonical invoice with matching patient and currency.
- Captured cash creates a PHI-free cash-custody outbox event in the same atomic batch.
- Pending or failed tenders cannot create active allocations.
- Legacy invoice status, paid/due caches, generic references, names, and proportional reconstruction are not collection authority.
- Deposit, credit, refund, reversal, and advance-like payment rows receive explicit CDB-061 deferral issues rather than CDB-060 allocation authority.

## Remote-D1 migration compatibility decision

The first rehearsal-clone migration attempt used SQL triggers for cross-row finalization and was atomically rejected by remote Wrangler/D1 with `incomplete input`. Read-only verification immediately after the failure confirmed:

- payment tables: `0`
- migration `0429` ledger rows: `0`
- foreign-key violations: `0`

The clone remained at the original pre-apply state. This matched a previously documented repository limitation where a trigger-containing historical migration was accepted by SQLite but rejected by remote Wrangler parsing.

Migration `0429` was therefore rewritten as a triggerless D1 contract without weakening authority:

- row-local lifecycle, money, safe-integer, and tenant-FK rules remain SQL `CHECK` and FK constraints;
- every allocation persists expected invoice due-before and due-after values;
- invoice balances update conditionally on exact prior values;
- a named `balance_guard = 1` constraint aborts the batch if the conditional update did not produce the expected balance;
- a named receipt `reconciliation_guard = 1` constraint aborts the batch unless tender sums, active allocation sums, status, and unallocated balance reconcile exactly;
- domain rows, guarded invoice updates, source mapping, idempotency claim, primary outbox, and cash-custody outbox remain in one atomic D1 batch.

Wrangler local D1/workerd then applied migrations `0423` through `0429` successfully before the remote retry.

## Adversarial verification

RED fixtures reproduced missing or unsafe behavior before implementation and hardening:

- absent payment migration, command, and backfill modules;
- invoice writers without initial paid/due balances;
- missing split-tender, allocation, and unallocated-balance authority;
- non-captured cash custody emission;
- duplicate tender and allocation IDs;
- mixed tender states;
- cross-tenant invoice allocation;
- stale concurrent invoice balances;
- duplicate legacy receipt identities;
- deposit/refund/credit/reversal scope leakage;
- trigger-containing remote migration incompatibility.

Focused final verification covered:

- files: `4`
- tests: `33`
- failures: `0`

Coverage includes split cash/card tender, partial and multi-invoice allocation, overpayment rejection, explicit unallocated balance, gateway verifying state, exact replay and semantic conflict, PHI-free outbox payloads, cash-custody linkage, stale-balance guard rollback, outbox-conflict rollback, deterministic backfill, duplicate identity groups, evidence drift, terminal run reuse, checkpoint restart, and invoice-writer compatibility.

## Synthetic valid-path proof

The runtime synthetic fixture posted one receipt with:

- receipt total: `15,000` minor units
- cash tender: `5,000` minor units
- card tender: `10,000` minor units
- allocation to invoice 1: `8,000` minor units
- allocation to invoice 2: `4,000` minor units
- explicit unallocated balance: `3,000` minor units
- tender variance: `0`
- allocation/unallocated variance: `0`

Resulting invoice projections were:

- invoice 1 paid/due: `8,000 / 2,000`
- invoice 2 paid/due: `4,000 / 6,000`

The fixture also proved exact idempotency replay, semantic conflict rejection, pending gateway receipts without allocations, no cash-custody authority for failed cash tenders, tenant isolation, stale-balance atomic rollback, and no partial source mapping or outbox state after failure.

## Protected exact-snapshot rehearsal

A fresh copy of the protected post-CDB050 snapshot received only revised migration `0429`. The original protected snapshot was not modified.

Source state:

- tenants with payments: `2`
- legacy payment rows: `1,311`
- canonical invoices available from CDB-050: `0`

Because the protected production snapshot safely created no canonical invoices in CDB-050, no payment row had one mapped canonical invoice allocation target. The deterministic safe result is therefore zero canonical collection rows.

First pass:

- payment rows scanned: `1,311`
- receipts created: `0`
- tenders created: `0`
- allocations created: `0`
- mappings created: `3,933`
- processing issues created: `1,311`

Second pass:

- payment rows scanned: `1,311`
- receipts created: `0`
- tenders created: `0`
- allocations created: `0`
- mappings created: `0`
- processing issues created: `0`

Final classification:

- receipt mappings: `1,311`
- tender mappings: `1,311`
- allocation mappings: `1,311`
- mapped payment entities: `0`
- ambiguous payment entities: `3,933`
- issue rows / occurrences: `1,311 / 1,311`

Issue aggregates:

- `PAYMENT_INVOICE_UNRESOLVED`: `1,311` rows / `1,311` occurrences

Integrity results:

- all source payments classified: yes
- source aggregates unchanged: yes
- mappings without evidence hash: `0`
- ambiguous mappings with canonical IDs: `0`
- receipt header variances: `0`
- tender variances: `0`
- allocation variances: `0`
- receipt guard violations: `0`
- allocation guard violations: `0`
- invoice paid/due variances: `0`
- foreign-key violations: `0`

No canonical payment authority was guessed from legacy invoice status, paid/due caches, receipt text, transaction text, or proportional allocation.

## Isolated D1 rehearsal clone

Target:

- database: `hms-canonical-rehearsal-20260713-b6036e`
- UUID: `6f9a17af-8e3e-4b26-85b7-08c653a706db`
- region observed: APAC

Preflight confirmed before the first attempt:

- payment canonical tables: `0`
- migration `0429`: `0`
- migrations `0423` through `0428`: present
- source payment rows: `1,311`
- canonical invoices: `0`
- foreign-key violations: `0`

Pre-apply Time Travel bookmark:

`0000001a-00000000-000050a8-66c9a218bf3d03ebc3c8da740f23c22c`

A rehearsal migration lock was acquired before mutation. The trigger-containing first attempt failed atomically and left the clone unchanged. After local Wrangler proof, the triggerless revision applied successfully as `18` remote commands.

A protected aggregate-equivalent bundle was generated outside Git:

- domain data statements: `5,252`
- migration runs: `4`
- checkpoints: `4`
- source mappings: `3,933`
- processing issues: `1,311`
- canonical receipts: `0`
- canonical tenders: `0`
- canonical allocations: `0`
- bundle size: `2,929,483` bytes
- SHA-256: `de3af361c96ec4783f14994dbb727a824b2edd7d882720b61ac922b88589d2fd`

Wrangler processed `5,254` queries including the two safety pragmas. Remote aggregate reconciliation exactly matched the protected local result:

- source payments: `1,311`
- receipt mappings: `1,311`
- tender mappings: `1,311`
- allocation mappings: `1,311`
- ambiguous payment entities: `3,933`
- issue rows / occurrences: `1,311 / 1,311`
- receipts / tenders / allocations: `0 / 0 / 0`
- evidence violations: `0`
- null-mapping violations: `0`
- receipt guard violations: `0`
- allocation guard violations: `0`
- invoice balance variances: `0`
- foreign-key violations: `0`
- migration `0429` ledger rows: `1`

Post-import Time Travel bookmark:

`0000001b-00000514-000050a8-ba082fd6a8ac77d96ff7df29ce03db43`

The rehearsal migration lock was released after successful verification. No restore was required or attempted.

## Production read-only boundary

Production target:

- database: `hms-super-admin-production-apac`
- UUID: `c68a5360-a2c1-44cc-9e71-f21057bea102`

A prefix-only exploratory query initially counted one `0423`-prefixed row. Read-only inspection identified it as the unrelated production repair migration:

- ID: `448`
- filename: `0423_repair_clean_cash_handover_pending_approvals.sql`

The final boundary query used exact canonical migration filenames rather than numeric prefixes and returned:

- canonical tables: `0`
- exact canonical migrations `0423` through `0429`: `0`
- latest migration ledger ID: `448`
- `changed_db`: `false`
- rows written: `0`

No production migration, payment backfill, application write, deployment, or Time Travel restore was attempted.

## Protected artifacts

The SQLite copies, aggregate-only runners, local Wrangler parser state, exact clone configuration, and data-bearing import bundle remain outside Git under access-controlled rehearsal storage. No raw SQL, SQLite database, PHI, signed URL, or protected bundle is committed or included in this report.

## Program integration

- worker branch: `task/cdb-060-canonical-payments`
- implementation commit: `c9375cb8`
- worker evidence commit: `3598663c`
- program branch: `feature/hms-canonical-data-architecture`
- integration merge: `5e66e6554ea475ab86f33ab96c877e9cedab83fa`
- merge method: non-fast-forward under the shared merge lock

Fresh post-merge verification:

- canonical and migration-manifest tests: `21 files / 153 tests`
- failures: `0`
- canonical governance issues: `0`
- migration manifest: `439`
- TypeScript errors: `0`

The tracker, current plan, agent status, and decisions now mark CDB-060 complete and CDB-061 ready. The integration touched only the program branch; `main`, production, deployment, push, Time Travel restore, the local server, and the original dirty workspace remained untouched.

## Result

CDB-060 rehearsal and program integration passed. Canonical payment authority is created only when one receipt, its typed tenders, explicit allocations, exact unallocated balance, and guarded invoice projections reconcile atomically. The current protected production snapshot safely produces no canonical collection rows and deterministically classifies every legacy payment without guessed invoice allocation.
