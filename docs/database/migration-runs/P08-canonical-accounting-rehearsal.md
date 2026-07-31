# P08 Canonical Accounting and Cash Custody Rehearsal

Date: 2026-07-14
Task: `CDB-081`
Worker branch: `task/cdb-081-canonical-accounting`
Migration: `0433_canonical_accounting_outbox.sql`

## Scope

CDB-081 adds canonical accounting as an immutable projection from exact typed domain events while keeping physical cash custody separate from revenue, expense, receivable, payable, inventory, and liability classification.

The implementation adds:

- canonical chart-of-account identities;
- explicit semantic posting-key mappings;
- open, closed, and explicitly reopened financial periods;
- outbox posting jobs with fingerprint, retry, dead-letter, and replay state;
- immutable balanced voucher headers;
- immutable debit and credit entries in integer minor units;
- immutable physical cash-custody movements;
- guarded cash-custody balance projections;
- an idempotent canonical accounting poster;
- explicit accounting reversal vouchers;
- an optional PHI-free bridge from the existing cash-ledger shadow writer.

Existing legacy accounting vouchers, posting events, journal lines, cash-ledger rows, routes, and reports remain unchanged. CDB-081 does not cut over reporting or production posting.

## Canonical authority

Canonical tables:

- `canonical_accounting_accounts`
- `canonical_accounting_mappings`
- `canonical_accounting_periods`
- `canonical_accounting_posting_jobs`
- `canonical_accounting_vouchers`
- `canonical_accounting_entries`
- `canonical_cash_custody_movements`
- `canonical_cash_custody_balances`

Rules:

1. Domain facts remain authoritative for invoice, payment, deposit, credit, refund, expense, payroll, practitioner settlement, and inventory receipt state.
2. Accounting consumes exact canonical outbox events; status fields and mutable caches are not accounting evidence.
3. Posted voucher debit and credit totals must match exactly in one currency.
4. Amounts use safe integer minor units.
5. Every entry contains exactly one non-zero debit or credit.
6. One outbox event may produce at most one voucher or one custody movement.
7. Duplicate delivery replays the original result.
8. Source evidence drift creates an explicit critical processing issue and cannot create a second voucher.
9. Preparation failures create retry or dead-letter job state without partial voucher or entries.
10. Stale job claims cause the whole posting batch to roll back.
11. Closed periods reject new posting. Reopening requires explicit actor, authorization, timestamp, and reason evidence.
12. Posted vouchers are corrected by an opposite immutable reversal voucher; the original voucher is unchanged.
13. Cash custody identifies where physical cash is held or moved. It does not classify revenue or expense.
14. A payment receipt posts allocated value to receivable and unallocated value to deposit liability.
15. `canonical.deposit.recorded` is derived from the payment receipt and is intentionally skipped to prevent duplicate liability.
16. Inventory movement without exact valuation does not create accounting authority.
17. Payroll approval, unpaid practitioner accrual, legacy voucher rows, and generic payout status do not become payment authority.
18. The existing cash shadow issue monitor remains non-blocking during transition.

## Event posting behavior

Supported canonical events include:

- invoice issued;
- payment receipt posted;
- deposit application;
- deposit refund;
- credit note posted;
- payment reversal;
- practitioner settlement;
- explicit expense paid;
- explicit payroll paid;
- explicitly valued inventory receipt;
- explicit manual balanced journal;
- cash-custody collection, refund, and shadow evidence.

Posting examples:

- Invoice: debit receivable, credit patient revenue.
- Payment: debit cash/bank; credit receivable and/or deposit liability.
- Deposit application: debit deposit liability, credit receivable.
- Deposit refund: debit deposit liability, credit cash/bank.
- Credit note: debit sales returns, credit receivable.
- Payment reversal: debit receivable, credit original settlement account.
- Expense payment: debit explicit expense account, credit cash/bank.
- Payroll payment: debit payroll payable, credit cash/bank.
- Practitioner settlement: debit practitioner payable, credit cash/bank.
- Valued inventory receipt: debit inventory asset, credit payable or explicit settlement account.

## RED and runtime verification

RED fixtures first confirmed migration `0433`, the canonical poster, accounting schema, and bridge did not exist.

Focused coverage includes:

- all eight typed canonical tables;
- SQL rejection of unbalanced vouchers;
- invoice posting and replay;
- mixed cash/non-cash payment tenders;
- allocated receivable and unallocated deposit liability;
- derived deposit skip;
- deposit application and refund;
- credit note;
- direct expense, payroll payment, practitioner settlement, and valued inventory receipt;
- missing mapping retry, repair, and success;
- unbalanced event dead-letter with zero partial entries;
- closed-period rejection and explicitly authorized reopening;
- cash custody separated from accounting classification;
- payment reversal;
- stale posting-job atomic rollback;
- immutable reversal voucher and replay;
- source drift conflict and issue creation;
- tenant and currency isolation;
- pending/retry scanning without duplicate vouchers;
- PHI-free cash-ledger bridge.

Focused verification:

- test files: `1`
- tests: `16`
- failures: `0`

Relevant expense integration verification:

- test files: `2`
- tests: `28`
- failures: `0`

Full pre-rehearsal verification:

- files: `29`
- tests: `238`
- failures: `0`
- canonical governance issues: `0`
- canonical tables registered: `56`
- migration manifest entries: `443`
- TypeScript errors: `0`

## Active cash-ledger bridge

The existing expense cash-out shadow path now supplies one optional canonical bridge only when exact execution evidence exists.

Bridge evidence is limited to:

- tenant and stable source identity;
- amount in integer minor units;
- currency and business date;
- payment method;
- counter and counter-session identifiers;
- stable source-evidence hash.

The bridge emits:

- `canonical.accounting.expense.paid`;
- `canonical.cash_custody.shadow_recorded`.

Free-text description, category label, payee, note, arbitrary metadata, patient identity, and other PHI are not copied into canonical payloads. Cash-ledger insert and both canonical outbox inserts occur in the same batch. Existing callers without a bridge retain their previous behavior.

## Protected exact-snapshot rehearsal

A fresh isolated copy of the protected post-CDB080 SQLite snapshot received migration `0433`. The original source was hash/size checked before and after and remained unchanged.

Canonical financial authority available in the snapshot:

- canonical outbox events: `0`
- canonical invoices: `0`
- canonical payment receipts: `0`
- canonical deposits/applications: `0`
- canonical credit notes: `0`
- canonical refunds: `0`
- canonical payment reversals: `0`
- canonical compensation settlements: `0`
- canonical inventory movements: `44`, but exact valuation authority: unavailable

Because no exact canonical financial outbox/facts existed, the poster scanned three legacy tenants twice and created no guessed authority.

First pass totals:

- scanned canonical events: `0`
- posted: `0`
- skipped: `0`
- retry: `0`
- dead letter: `0`

Second pass totals:

- scanned canonical events: `0`
- posted: `0`
- skipped: `0`
- retry: `0`
- dead letter: `0`

Final canonical aggregates:

- accounts: `0`
- mappings: `0`
- periods: `0`
- posting jobs: `0`
- vouchers: `0`
- entries: `0`
- custody movements: `0`
- custody balances: `0`
- accounting posting issues: `0`

Canonical integrity:

- voucher guard violations: `0`
- voucher/entry aggregate variances: `0`
- custody balance variances: `0`
- custody projection guard violations: `0`
- custody movement guard violations: `0`
- foreign-key violations: `0`

Protected source proof:

- file size: `44,019,712` bytes
- SHA-256: `05f7394e27d864053454354a4e760b5e51a155608986dc08b2f19fccf4086076`
- hash unchanged: yes
- size unchanged: yes

## Legacy comparison evidence

Legacy accounting and cash rows were inspected only as aggregate comparison evidence:

- posting events: `4,860`
- posted events: `4,858`
- failed events: `1`
- dead-letter events: `1`
- verified vouchers: `4,860`
- journal lines: `10,482`
- account mappings: `138`
- closed-period rows: `100`
- cash-ledger entries: `1,309`
- cash shadow issues: `0`

Legacy integrity:

- unbalanced vouchers: `0`
- non-cent journal lines: `0`
- duplicate source-event vouchers: `0`
- duplicate cash idempotency keys: `0`
- orphan cash-to-voucher links: `0`
- voucher without matching event: `4`
- posted event without matching voucher: `3`

Cash movement aggregates:

- incoming: `1,053` rows / `1,885,780.00`
- outgoing: `252` rows / `674,739.00`
- transfer: `4` rows / `2,030,250.00`

The seven event/voucher parity differences remain explicit legacy comparison evidence. They were not rewritten or inferred into canonical vouchers.

## Isolated D1 rehearsal clone

Target:

- database: `hms-canonical-rehearsal-20260713-b6036e`
- UUID: `6f9a17af-8e3e-4b26-85b7-08c653a706db`
- observed region: APAC

Pre-apply bookmark:

`00000021-00000000-000050a8-35c9985e7c12a5758a8144f86a96fec5`

Migration `0433` was applied through Wrangler migrations:

- migration commands: `22`
- exact `d1_migrations` rows: `1`
- data import bundle: not required

Remote read-only reconciliation exactly matched the local zero-authority result:

- accounts / mappings / periods: `0 / 0 / 0`
- jobs / vouchers / entries: `0 / 0 / 0`
- custody movements / balances: `0 / 0`
- foreign-key violations: `0`
- `changed_db`: `false`
- rows written: `0`

Post-apply bookmark:

`00000021-00000002-000050a8-3a09d7ded32bb4334da350fa57a086d7`

No Time Travel restore was required or attempted.

## Production read-only boundary

Production target:

- database: `hms-super-admin-production-apac`
- UUID: `c68a5360-a2c1-44cc-9e71-f21057bea102`

Exact read-only verification returned:

- canonical tables: `0`
- exact canonical migrations `0423` through `0433`: `0`
- exact migration `0433`: `0`
- latest migration ledger ID: `448`
- `changed_db`: `false`
- rows written: `0`

No production migration, accounting event, voucher, entry, custody balance, feature flag, route, deployment, Worker version, or setting was changed.

## Protected artifacts

The SQLite copy, migration copy, clone configuration, and aggregate runner remain outside Git in access-controlled rehearsal storage. No SQLite file, raw export, protected SQL, PHI, patient identity, signed URL, or operational bundle is committed.

## Result

CDB-081 rehearsal passed. Canonical accounting now has triggerless, balanced, idempotent, retryable, period-aware voucher authority and separate physical cash-custody authority. The protected snapshot correctly produced zero canonical postings because exact canonical source events were absent, legacy GL and cash rows remained comparison evidence, clone migration compatibility passed, and production remained untouched.

## Program integration

- implementation commit: `6f9ba009`
- worker evidence commit: `28c086f3`
- non-fast-forward program merge: `74c419c2397d0701a423d1eba643402dbfd864ec`
- integrated canonical verification: `29 files / 238 tests / 0 failures`
- integrated expense verification: `2 files / 28 tests / 0 failures`
- integrated governance issues: `0`
- integrated migration manifest entries: `443`
- integrated TypeScript errors: `0`
- next task: `CDB-090` canonical metric registry and reporting parity
