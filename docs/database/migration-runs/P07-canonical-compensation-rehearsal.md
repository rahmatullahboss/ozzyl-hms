# P07 Canonical Practitioner Compensation Rehearsal

Date: 2026-07-14
Task: `CDB-070`
Worker branch: `task/cdb-070-practitioner-compensation`
Migration: `0431_canonical_practitioner_compensation.sql`

## Scope

CDB-070 consolidates practitioner compensation calculation rules, immutable accrual snapshots, practitioner payout settlements, settlement allocations, and explicit credit/refund/cancellation/settlement-reversal facts.

IPD projections remain outside this task in CDB-071. Cash/accounting classification remains outside this task in CDB-081.

## Authority model

- A compensation rule is an effective-dated, versioned calculation rule scoped by service, category, or all services; it may also be scoped to one exact beneficiary practitioner.
- An accrual is an immutable rule snapshot linked to one canonical invoice line, optional service event, one practitioner role, one rule version, and explicit calculation inputs.
- Fixed performer reserve and basis-point commission are distinct rule/rate types.
- Discount, tax, performer-reserve, and collected-base treatment are explicit inputs; report-time proportional reconstruction is prohibited.
- An unassigned performer remains an unassigned accrual. Referrer, prescriber, treating doctor, or another practitioner is never inferred as performer.
- A settlement is a practitioner payout document. Settlement allocations are immutable applications to exact compensation accruals.
- Credit, refund, cancellation, recovery, and settlement reversal are explicit compensation adjustment facts.
- Paid or partially settled compensation blocks invoice credit or payment reversal until explicit compensation settlement reversal restores payable authority.

## Triggerless D1 guard design

Migration `0431` is triggerless for remote Wrangler compatibility. Cross-row authority is protected by:

- tenant-scoped foreign keys;
- safe-integer minor-unit checks;
- assigned and unassigned partial unique accrual indexes;
- persisted rule, rate, eligible-base, earned, adjusted, settled, and payable snapshots;
- `payable_projection_guard` on accruals;
- `settlement_projection_guard` on settlement headers;
- persisted before/after balances and `balance_guard` on settlement allocations and adjustments;
- conditional exact-state updates;
- PHI-free command idempotency and outbox events;
- atomic batch rollback on stale accruals or conflicting outbox identities.

## Implemented canonical tables

- `canonical_compensation_rules`
- `canonical_compensation_accruals`
- `canonical_compensation_adjustments`
- `canonical_compensation_settlements`
- `canonical_compensation_settlement_allocations`

The canonical source registry now contains `40` tables.

## Runtime verification

Adversarial RED fixtures first proved that migration, Drizzle schema, command APIs, rule authority, settlements, and deterministic backfill were absent.

Final runtime coverage includes:

- fixed performer reserve;
- percentage referral commission;
- remaining-base calculation after performer reserve;
- explicit discount and tax treatment;
- practitioner-specific rule beneficiary;
- unassigned performer without role inference;
- exact replay and semantic idempotency conflict;
- one-accrual uniqueness by line, practitioner, role, rule, and version;
- cross-tenant practitioner rejection;
- partial and full settlement;
- double-payment rejection;
- explicit settlement reversal before reducing paid compensation;
- canonical settled-liability block for invoice credit and payment reversal;
- stale accrual rollback;
- settlement outbox-conflict rollback;
- checkpoint stop/resume;
- failed source-batch rollback;
- source-evidence drift and terminal-run reuse rejection.

Final pre-rehearsal verification:

- canonical and migration-manifest files: `25`
- tests: `185`
- failures: `0`
- canonical governance issues: `0`
- migration manifest entries: `441`
- TypeScript errors: `0`
- YAML assertions: passed
- diff check: passed

## Synthetic valid-path proof

Synthetic fixtures proved:

- a fixed performer rule created a `2,000` minor-unit accrual;
- a `10%` referral rule used an explicit remaining base of `7,500` after a `1,000` discount, `2,000` performer reserve, and `500` included tax, producing `750` minor units;
- an unassigned performer stayed null and was not replaced by the referrer;
- `750` and `1,250` settlement allocations settled a `2,000` accrual exactly;
- a `500` settlement reversal restored payable before a `500` refund adjustment reduced it;
- stale state and duplicate outbox identity rolled back settlement headers, allocations, mappings, payable changes, and command events.

## Deterministic legacy backfill rules

Legacy performer payout rules create canonical rules only when an exact canonical service mapping exists and the legacy rate can be normalized exactly.

Legacy doctor commission rules create canonical rules only when:

- the doctor has one exact canonical practitioner mapping;
- the incentive type maps to one canonical practitioner role;
- service-specific rules have an exact canonical service mapping;
- flat or percentage rates normalize exactly;
- effective dates and active state are explicit.

Legacy performer reserves create canonical accruals only when:

- one exact posted canonical invoice line exists;
- the line has one canonical service event;
- one canonical performer rule exists;
- any assigned doctor has one exact practitioner mapping;
- gross, discount, net, rule, and reserved amounts reconcile exactly;
- the reserve is unpaid and active.

Legacy commission accruals create canonical accruals only when:

- one exact practitioner, rule, invoice line, and service-event authority exists;
- gross, eligible base, performer reserve, earned, waiver, payable, paid, and balance snapshots reconcile exactly;
- paid rows have exact settlement-item evidence.

Legacy settlements create canonical authority only when every item maps to an exact payable accrual for the same practitioner and currency and header/item totals reconcile without unresolved deductions or rounding.

All other rows receive stable null canonical mappings and explicit processing issues.

## Protected exact-snapshot rehearsal

A fresh copy of the protected post-CDB061 snapshot received only migration `0431`. The original snapshot was not modified.

Source aggregates:

- tenants: `2`
- performer payout rules: `9`
- doctor commission rules: `45`
- performer reserves: `2`
- doctor commission accruals: `1,788`
- doctor commission settlements: `69`
- settlement items: `1,187`
- scanned rule/reserve/accrual/settlement documents: `1,913`

First pass:

- compensation rules created: `54`
- compensation accruals created: `0`
- adjustments created: `0`
- settlements created: `0`
- settlement allocations created: `0`
- mappings created: `3,100`
- processing issues created: `1,859`

Second pass:

- source documents scanned: `1,913`
- all canonical created counts: `0`
- mappings created: `0`
- issues created: `0`

Final classification:

- canonical compensation rules: `54`
- canonical accruals: `0`
- canonical adjustments: `0`
- canonical settlements: `0`
- canonical settlement allocations: `0`
- rule mappings: `54`
- accrual mappings: `1,790`
- settlement mappings: `69`
- settlement-allocation mappings: `1,187`
- mapped compensation entities: `54`
- ambiguous compensation entities: `3,046`
- issue rows / occurrences: `1,859 / 1,859`

Issue aggregates:

- `COMPENSATION_INVOICE_LINE_UNRESOLVED`: `1,785`
- `COMPENSATION_SETTLEMENT_ACCRUAL_UNRESOLVED`: `69`
- `COMPENSATION_RULE_UNRESOLVED`: `2`
- `COMPENSATION_TERMINAL_SOURCE_UNRESOLVED`: `2`
- `COMPENSATION_RULE_MISMATCH`: `1`

The 54 rule rows are safe because they have exact service/practitioner scope. The zero accrual/settlement result is intentional because the protected snapshot lacks complete typed invoice-line authority for every linked compensation fact.

Integrity results:

- source aggregates unchanged: yes
- mappings without evidence: `0`
- ambiguous/rejected mappings with canonical IDs: `0`
- accrual projection violations: `0`
- settlement projection violations: `0`
- settlement-allocation guard violations: `0`
- adjustment guard violations: `0`
- assigned accrual duplicates: `0`
- unassigned accrual duplicates: `0`
- settlement-allocation variances: `0`
- accrual-settlement variances: `0`
- foreign-key violations: `0`

## Isolated D1 rehearsal clone

Target:

- database: `hms-canonical-rehearsal-20260713-b6036e`
- UUID: `6f9a17af-8e3e-4b26-85b7-08c653a706db`
- observed region: APAC

Preflight:

- compensation tables: `0`
- migration `0431`: `0`
- migration `0430`: `1`
- source rules / reserves / accruals / settlements / items: `9 / 45 / 2 / 1,788 / 69 / 1,187`
- foreign-key violations: `0`

Pre-apply Time Travel bookmark:

`0000001d-00000000-000050a8-376a8b810d70508fb0fd158a3fa9c5c3`

A protected migration lock was acquired. Triggerless migration `0431` applied successfully as `14` remote commands.

A protected aggregate-equivalent bundle was generated outside Git:

- domain statements: `5,021`
- migration runs: `4`
- checkpoints: `4`
- compensation rules: `54`
- compensation accruals/adjustments/settlements/allocations: `0`
- source mappings: `3,100`
- processing issues: `1,859`
- bundle size: `3,274,890` bytes
- SHA-256: `b94324ba464fbe24817f0d42b60de3cf638751fc468bbe2504cef36b2974b14f`

Wrangler processed `5,023` queries including two safety pragmas. Remote aggregates exactly matched the protected local result, including source counts, rules, mappings, issues, zero accrual/settlement authority, zero projection/guard variance, and zero FK violations.

Post-import Time Travel bookmark:

`0000001d-00000510-000050a8-727ca88bcae4a380418ffed079c8e1a6`

The rehearsal lock was released. No restore was required or attempted.

## Production read-only boundary

Production target:

- database: `hms-super-admin-production-apac`
- UUID: `c68a5360-a2c1-44cc-9e71-f21057bea102`

Exact canonical filename verification returned:

- canonical tables: `0`
- exact canonical migrations `0423` through `0431`: `0`
- latest migration ledger ID: `448`
- `changed_db`: `false`
- rows written: `0`

Migration ID `448` remains the unrelated `0423_repair_clean_cash_handover_pending_approvals.sql` entry. No production migration, backfill, application write, deployment, push, or Time Travel restore was attempted.

## Protected artifacts

SQLite copies, aggregate-only runners, clone configuration, migration locks, bookmarks, and the data-bearing import bundle remain outside Git in access-controlled rehearsal storage. No raw SQL export, SQLite database, PHI, signed URL, or protected bundle is committed or included in this report.

## Program integration

- worker branch: `task/cdb-070-practitioner-compensation`
- implementation commit: `6b080dfe`
- worker evidence commit: `96df1bd6`
- program branch: `feature/hms-canonical-data-architecture`
- integration merge: `8a49dc87fd011495a3f53f227efdc97ad9b81be4`
- merge method: non-fast-forward under the shared merge lock

Fresh post-merge verification:

- canonical and migration-manifest tests: `25 files / 185 tests`
- failures: `0`
- canonical governance issues: `0`
- migration manifest: `441`
- TypeScript errors: `0`

The tracker and handoff artifacts now mark CDB-070 complete and CDB-071 ready. Integration touched only the canonical program branch; `main`, production, deployment, push, Time Travel restore, the local server, and the original dirty workspace remained untouched.

## Result

CDB-070 rehearsal and program integration passed. Canonical compensation rules, accruals, settlements, allocations, and adjustments are created only from exact typed authority. The current protected production snapshot safely creates only 54 exact rule rows and classifies every reserve, accrual, and settlement without guessing practitioner payable authority.
