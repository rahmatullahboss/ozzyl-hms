# P09 Canonical Reporting Parity Rehearsal

Date: 2026-07-14
Task: `CDB-090`
Worker branch: `task/cdb-090-canonical-reporting`
Migration: none

## Scope

CDB-090 adds a governed metric registry and pure read-only canonical reporting modules. It does not create financial, clinical, stock, accounting, or cash-custody authority. It does not switch any active executive report route.

Created reporting modules:

- `src/lib/canonical/reporting/common.ts`
- `src/lib/canonical/reporting/doctor-performance.ts`
- `src/lib/canonical/reporting/test-performance.ts`
- `src/lib/canonical/reporting/collections.ts`
- `src/lib/canonical/reporting/ipd-finance.ts`

Metric registry:

- `docs/database/metric-registry.yaml`

Parity verification:

- `test/canonical/reporting-parity.test.ts`

## Metric registry contract

Every registered KPI declares:

- stable metric key;
- user-facing label and description;
- canonical fact source;
- date basis;
- lifecycle/status filter;
- tenant and currency scope;
- explicit practitioner-role semantics;
- quantity or amount expression;
- credit, refund, cancellation, and reversal rules;
- drill-down contract;
- reconciliation owner.

Registered metrics cover:

- performing-practitioner service performance;
- referring-practitioner service performance;
- diagnostic test volume;
- diagnostic billed amount;
- gross payment receipts;
- persisted service-line allocations;
- deposit applications;
- refunds;
- IPD admission balance.

## Read-only reporting authority

1. Reporting reads canonical facts and projections; it never writes canonical or legacy authority.
2. Summary cards and drill-down rows are produced from the same returned row set.
3. Operational event dates use `occurred_at_utc` converted to the caller-supplied IANA tenant time zone.
4. Persisted financial `business_date` remains the financial date authority.
5. Practitioner roles are explicit. Performing, referring, prescribing, reporting, approving, ordering, and treating roles are not interchangeable.
6. Diagnostic volume uses one latest eligible posted event per request/service identity or one standalone event.
7. Cancelled and reversed service events are excluded.
8. Posted invoice-line amount contributes only when the linked invoice is posted.
9. Mixed tenders remain one receipt and cannot duplicate receipt value.
10. Service-level collection is reported only when a persisted allocation has an exact `invoice_line_public_id`.
11. Invoice-only allocations remain a separate classified bucket.
12. Query-time proportional allocation is prohibited.
13. Deposit applications, credit notes, refunds, and payment reversals remain separate contribution types.
14. IPD finance reuses the established canonical IPD projection and reduces the same admission rows shown in drill-down.
15. Currency totals are never combined implicitly.
16. Safe-integer overflow is rejected.
17. Legacy report values are comparison evidence only and cannot become canonical fallback truth.
18. Active executive report routes remain unchanged until explicit parity-approved integration.

## RED-first verification

The focused suite first failed because the metric registry and reporting modules did not exist.

Focused coverage now proves:

- registry completeness;
- explicit performer/referrer separation;
- no practitioner-role inference;
- latest diagnostic lifecycle-event deduplication;
- exclusion of cancelled and next-business-day facts;
- tenant business-date filtering in `Asia/Dhaka`;
- posted-invoice-only billed amount;
- mixed-tender receipt identity;
- persisted allocation-only service collection;
- invoice-only allocation classification;
- deposit application, credit, refund, and payment-reversal components;
- no proportional allocation;
- tenant and currency isolation;
- safe-integer aggregate rejection;
- IPD card/drill-down identity;
- classified legacy difference;
- active report routes unchanged;
- zero database writes.

Focused result:

- files: `1`
- tests: `9`
- failures: `0`

Pre-rehearsal full verification:

- files: `30`
- tests: `247`
- failures: `0`
- TypeScript errors: `0`
- canonical governance issues: `0`
- migration manifest entries: `443`
- new migration: none

## Adversarial code review

The review found and fixed two correctness issues before commit:

1. An earlier completed event could remain reportable when the same request later received a cancelled or reversed lifecycle event. Runtime requests now use authoritative `last_event_public_id`; historical requests with a null last-event pointer use exact event chronology to select the latest lifecycle event deterministically.
2. One practitioner split across multiple currency rows could be counted multiple times. The summary now counts distinct practitioner public IDs while retaining separate currency rows and totals.

Both issues were reproduced with failing fixtures before the fixes. The final focused suite includes cancellation-after-completion, historical null last-event fallback, and multi-currency practitioner identity coverage.

## Protected exact-snapshot rehearsal

Source:

- protected post-CDB081 SQLite snapshot
- opened read-only
- `PRAGMA query_only=ON`
- no copied production row content was printed or committed

Aggregate source counts:

- canonical service events: `63`
- canonical service participants: `69`
- canonical payment receipts: `0`
- canonical payment allocations: `0`
- canonical admission links: `76`
- legacy payment rows: `1,311`
- legacy lab-order-item rows: `221`
- legacy commission accrual rows: `1,788`
- foreign-key violations: `0`

Tenant `100` canonical result:

- performing practitioners / events / quantity: `0 / 0 / 0`
- referring practitioners / events: `0 / 0`
- diagnostic events / quantity: `19 / 19`
- diagnostic billed currencies: none
- collection contribution rows / gross / service allocation: `0 / 0 / 0`
- IPD admissions: `15`
- IPD admission balance: `0`
- IPD legacy matched / different: `10 / 5`
- IPD issues: `0`

Tenant `100` legacy comparison:

- diagnostic item count: canonical `19`, legacy `65`, variance `46`, classification `different`
- collection rows: canonical `0`, legacy `205`, classification `different`
- collection amount: canonical `0`, legacy `599,257,900` minor units, classification `different`
- legacy commission doctors: `3`; classification `semantic_scope_different`

Tenant `102` canonical result:

- performing/referring practitioners and events: `0`
- diagnostic events / quantity: `0 / 0`
- collection contribution rows / gross / service allocation: `0 / 0 / 0`
- IPD admissions: `16`
- IPD admission balance: `6,350,000` minor units
- IPD legacy matched / different: `0 / 16`
- IPD issues: `0`

Tenant `102` legacy comparison:

- diagnostic item count: canonical `0`, legacy `156`, variance `156`, classification `different`
- collection rows: canonical `0`, legacy `1,106`, classification `different`
- collection amount: canonical `0`, legacy `97,293,000` minor units, classification `different`
- legacy commission doctors: `12`; classification `semantic_scope_different`

The protected snapshot contains only `ordering` and `approving` service participant roles:

- ordering: `67` rows / `3` practitioners
- approving: `2` rows / `1` practitioner

There are no performing or referring participant rows. Canonical doctor performance therefore correctly returns zero rather than inferring a practitioner role from legacy commission, ordering, or approving evidence.

Protected source proof:

- SHA-256: `7e2e94b23846dcc56e1ebfae835881e025e525f9f56e733d1ad4f59478aec65f`
- size: `44,183,552` bytes
- hash unchanged: yes
- size unchanged: yes
- query-only execution: yes

## Isolated D1 rehearsal-clone comparison

Read-only clone aggregates exactly matched the protected source shape:

- canonical service events: `63`
- canonical service participants: `69`
- canonical payment receipts: `0`
- canonical payment allocations: `0`
- canonical admission links: `76`
- legacy payments: `1,311`
- legacy lab-order items: `221`
- foreign-key violations: `0`

Remote diagnostic deduplication returned:

- tenant `100`: `19` diagnostic events / quantity `19`
- tenant `102`: `0`

Remote participant roles returned only:

- ordering: `67` rows / `3` practitioners
- approving: `2` rows / `1` practitioner

Every clone query reported:

- `changed_db`: `false`
- rows written: `0`

No migration, import bundle, bookmark change, feature flag, or restore was required for CDB-090.

## Production read-only boundary

Production exact read-only verification returned:

- canonical tables: `0`
- exact canonical migrations `0423` through `0433`: `0`
- latest migration ledger ID: `448`
- `changed_db`: `false`
- rows written: `0`

Canonical reporting is therefore unavailable on production until an explicitly authorized canonical domain cutover. CDB-090 does not fall back to legacy values and does not change any production report route.

## Active-route boundary

`src/routes/tenant/reports.ts` remains unchanged and does not import the new canonical reporting modules. The existing proportional legacy dashboard behavior is not used by these modules, but active route replacement is deferred until a later explicitly approved parity integration or cutover task.

## Result

CDB-090 reporting parity passed. The repository now has a governed metric registry and pure canonical doctor, diagnostic, collections, and IPD finance report functions. Card and drill-down outputs share one result set, practitioner roles and date bases are explicit, persisted allocations replace proportional reconstruction, protected and clone comparisons are read-only and classified, and production remains untouched.

## Program integration

- implementation commit: `ef3636fb`
- worker evidence commit: `9319e339`
- non-fast-forward program merge: `60036d9fa7ac40bac46fdcc0e96db6496f0f6382`
- integrated verification: `30 files / 247 tests / 0 failures`
- integrated governance issues: `0`
- integrated migration manifest entries: `443`
- integrated TypeScript errors: `0`
- active report routes switched: no
- next task: `CDB-100` cutover checker and two isolated-clone rehearsals
