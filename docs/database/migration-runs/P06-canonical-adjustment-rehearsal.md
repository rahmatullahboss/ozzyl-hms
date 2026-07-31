# P06 Canonical Adjustment Rehearsal

Date: 2026-07-14
Task: `CDB-061`
Worker branch: `task/cdb-061-canonical-adjustments`
Migration: `0430_canonical_adjustments.sql`

## Scope

CDB-061 adds explicit canonical authority for patient deposit liabilities, immutable deposit applications, posted credit notes and credit-note lines, outbound refunds, and payment/allocation reversal facts. Original invoices, receipts, tenders, allocations, and deposit receipts remain historical authorities; only guarded derived projections change.

Practitioner compensation consolidation and IPD projections remain outside this task in CDB-070 and CDB-071.

## Authority model

- A deposit is a patient liability linked to one fully unallocated canonical receipt.
- A deposit application is an immutable fact that reduces deposit availability and increases exact invoice paid projections.
- A credit note is a posted reduction document with exact typed lines; it reduces `net_due_minor` without rewriting invoice total or payment history.
- A refund is an outbound settlement document. Cash refunds require same-batch cash-custody outbox evidence.
- A payment reversal preserves the original receipt, tender, allocation, and invoice amounts while recording cumulative reversed/refunded projections and restoring invoice due.
- Paid diagnostic performer reserves or paid doctor commission accruals block automatic credit or payment reversal.
- Legacy statuses, free-text references, report-time proportions, paid/due caches, and names are not adjustment authority.

## Triggerless D1 guard design

Migration `0430` is triggerless for remote Wrangler compatibility. Cross-row financial correctness is preserved through:

- row-local SQL money, lifecycle, safe-integer, and tenant-FK constraints;
- invoice `credited_minor`, `net_due_minor`, and `adjustment_projection_guard`;
- receipt `refunded_minor`, `net_received_minor`, and `refund_projection_guard`;
- tender/allocation `reversed_minor`, `remaining_minor`, and `reversal_projection_guard`;
- persisted before/after balances on deposit applications, credit notes, refunds, and payment reversals;
- conditional source projection updates using exact previous values;
- named guard columns that fail the entire atomic D1 batch when stale state or reconciliation mismatch is detected.

## Implemented canonical tables

- `canonical_deposits`
- `canonical_deposit_applications`
- `canonical_credit_notes`
- `canonical_credit_note_lines`
- `canonical_refunds`
- `canonical_payment_reversals`

The canonical source registry now contains `35` tables.

## Runtime verification

Adversarial RED fixtures first proved the absence of migration, commands, lifecycle authority, stale-state guards, compensation safety, and deterministic backfill.

Final runtime and backfill coverage includes:

- deposit recording from one fully unallocated posted receipt;
- partial deposit application across multiple invoices;
- over-application rejection;
- stale deposit/invoice state rollback;
- cross-tenant application rejection;
- partial credit-note projection without invoice-total mutation;
- exact credit-note header/line reconciliation;
- paid performer-reserve/commission block;
- cash deposit refund with custody linkage;
- custody-event conflict rollback;
- partial and full payment/allocation reversal;
- invoice paid/due/net-due restoration;
- exact replay and semantic idempotency conflict;
- no cash-custody event for non-cash reversal;
- checkpoint stop/resume and failed-batch rollback;
- source-evidence drift and terminal-run reuse rejection;
- deterministic unresolved-source classification without guessed authority.

Final worker verification before rehearsal:

- canonical and migration-manifest files: `23`
- tests: `169`
- failures: `0`
- canonical governance issues: `0`
- migration manifest entries: `440`
- TypeScript errors: `0`
- diff check: passed

## Synthetic valid-path proof

The synthetic command fixtures proved:

- one `7,000` minor-unit deposit remained an immutable receipt-backed liability;
- applications of `3,000` and `2,000` minor units reduced available liability to `2,000`;
- invoice paid/due/net-due projections changed atomically while the original receipt total and unallocated amount remained unchanged;
- one `2,000` minor-unit credit note reduced invoice net due from `8,000` to `6,000` without changing invoice total;
- one `6,000` minor-unit card payment was reversed in `2,000` and `4,000` steps, restoring invoice paid/due/net-due to `0 / 10,000 / 10,000` and marking the source receipt, tender, and allocation reversed only when remaining balances reached zero.

## Deterministic legacy backfill rules

A legacy deposit creates canonical liability only when an exact canonical receipt mapping exists and patient, currency, amount, posted lifecycle, unallocated amount, and refund projection match exactly.

A legacy credit note creates canonical authority only when:

- the credit note is active and approved;
- one exact canonical invoice mapping exists;
- every credit-note item has one exact canonical invoice-line mapping on the same invoice;
- header total equals exact line totals in minor units;
- credit does not exceed invoice net due;
- no paid performer reserve or paid doctor commission liability exists.

Legacy refund cash holds do not expose exact receipt, tender, and allocation identities. They are therefore classified with null canonical refund/reversal mappings and explicit issues instead of reconstructed or proportional reversals.

## Protected exact-snapshot rehearsal

A fresh copy of the protected post-CDB060 snapshot received only migration `0430`. The original protected snapshot was not modified.

Source aggregates:

- tenants: `2`
- legacy deposits: `90`
- legacy credit notes: `1`
- legacy credit-note lines: `1`
- legacy refund cash holds: `0`
- total scanned adjustment documents: `91`

First pass:

- deposits created: `0`
- deposit applications created: `0`
- credit notes created: `0`
- credit lines created: `0`
- refunds created: `0`
- payment reversals created: `0`
- mappings created: `92`
- processing issues created: `91`

Second pass:

- source documents scanned: `91`
- all canonical created counts: `0`
- mappings created: `0`
- issues created: `0`

Final classification:

- deposit mappings: `90`
- credit-note mappings: `1`
- credit-note-line mappings: `1`
- refund mappings: `0`
- payment-reversal mappings: `0`
- mapped adjustment entities: `0`
- ambiguous adjustment entities: `92`
- issue rows / occurrences: `91 / 91`

Issue aggregates:

- `DEPOSIT_RECEIPT_UNRESOLVED`: `64`
- `DEPOSIT_TRANSACTION_TYPE_UNSUPPORTED`: `26`
- `CREDIT_NOTE_INVOICE_UNRESOLVED`: `1`

The zero canonical-row result is intentional. The protected snapshot contains no exact canonical receipt or invoice authority for these legacy adjustment sources.

Integrity results:

- source aggregates unchanged: yes
- mappings without evidence: `0`
- ambiguous/rejected mappings with canonical IDs: `0`
- deposit guard violations: `0`
- deposit-application guard violations: `0`
- credit-note guard violations: `0`
- refund guard violations: `0`
- reversal guard violations: `0`
- invoice projection variances: `0`
- receipt projection variances: `0`
- tender projection variances: `0`
- allocation projection variances: `0`
- foreign-key violations: `0`

## Isolated D1 rehearsal clone

Target:

- database: `hms-canonical-rehearsal-20260713-b6036e`
- UUID: `6f9a17af-8e3e-4b26-85b7-08c653a706db`
- observed region: APAC

Preflight:

- adjustment tables: `0`
- migration `0430`: `0`
- migration `0429`: `1`
- source deposits / credit notes / credit lines / refund holds: `90 / 1 / 1 / 0`
- foreign-key violations: `0`

Pre-apply Time Travel bookmark:

`0000001c-00000000-000050a8-a22974a1478bcabb1a13e5d3eeaed82d`

A protected migration lock was acquired. Triggerless migration `0430` applied successfully as `37` remote commands.

A protected aggregate-equivalent bundle was generated outside Git:

- domain statements: `191`
- migration runs: `4`
- checkpoints: `4`
- source mappings: `92`
- processing issues: `91`
- canonical adjustment rows: `0`
- bundle size: `123,095` bytes
- SHA-256: `c7ff2031ac43793bf054958f3c00b74d628df016931fd6a87784b4dde3e7a3c7`

Wrangler processed `193` queries including two safety pragmas. Remote aggregates exactly matched the local protected result, including all source counts, mappings, issues, zero canonical adjustment rows, zero projection/guard variance, and zero FK violations.

Post-import Time Travel bookmark:

`0000001c-00000044-000050a8-f900f0f2d2063b42934095e25e8546e6`

The rehearsal lock was released. No restore was required or attempted.

## Production read-only boundary

Production target:

- database: `hms-super-admin-production-apac`
- UUID: `c68a5360-a2c1-44cc-9e71-f21057bea102`

Exact canonical filename verification returned:

- canonical tables: `0`
- exact canonical migrations `0423` through `0430`: `0`
- latest migration ledger ID: `448`
- `changed_db`: `false`
- rows written: `0`

Migration ID `448` remains the unrelated `0423_repair_clean_cash_handover_pending_approvals.sql` entry. No production migration, backfill, application write, deployment, push, or Time Travel restore was attempted.

## Protected artifacts

SQLite copies, aggregate-only runners, clone configuration, migration locks, bookmarks, and the data-bearing import bundle remain outside Git in access-controlled rehearsal storage. No raw SQL export, SQLite database, PHI, signed URL, or protected bundle is committed or included in this report.

## Program integration

- worker branch: `task/cdb-061-canonical-adjustments`
- implementation commit: `d09de963`
- worker evidence commit: `fa83829f`
- program branch: `feature/hms-canonical-data-architecture`
- integration merge: `32b488f7ec7e3bc860faf27031580fafb15a9ace`
- merge method: non-fast-forward under the shared merge lock

Fresh post-merge verification:

- canonical and migration-manifest tests: `23 files / 169 tests`
- failures: `0`
- canonical governance issues: `0`
- migration manifest: `440`
- TypeScript errors: `0`

The tracker and handoff artifacts now mark CDB-061 complete, P06 complete, and CDB-070 ready. The integration touched only the canonical program branch; `main`, production, deployment, push, Time Travel restore, the local server, and the original dirty workspace remained untouched.

## Result

CDB-061 rehearsal and program integration passed. Canonical deposits, applications, credit notes, refunds, and payment reversals are created only from exact typed authority and same-batch guarded projections. The current protected production snapshot safely creates no canonical adjustment rows and classifies every available legacy source without guessing financial authority.
