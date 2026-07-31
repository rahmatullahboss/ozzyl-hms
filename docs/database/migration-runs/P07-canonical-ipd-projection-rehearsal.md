# P07 Canonical IPD Projection Rehearsal

Date: 2026-07-14
Task: `CDB-071`
Worker branch: `task/cdb-071-ipd-projection`
Migration: none

## Scope

CDB-071 replaces independent IPD provisional and ledger authority with a read-only projection built from existing canonical encounter, admission, bed-stay, service-event, price, invoice, payment, deposit, credit, refund, reversal, and compensation facts.

The existing `/api/ip-billing` route remains active and unchanged. A separate `/api/canonical-ipd-billing` shadow route is registered but remains hidden unless the tenant setting `canonical_ipd_shadow_enabled` is explicitly enabled.

CDB-071 does not create a new financial table, migration, invoice, payment, adjustment, stock movement, accounting entry, outbox event, or feature-flag mutation.

## Projection authority

The projection requires one exact active canonical admission link to an inpatient encounter.

Admission and operational facts:

- `canonical_encounters` defines inpatient episode status and start/end timestamps;
- `canonical_encounter_admission_links` provides the exact legacy admission identity;
- `canonical_bed_stays` supplies bed occupancy intervals;
- posted `canonical_service_events` with delivered, completed, dispensed, or occupied event types supply chargeable service facts;
- cancelled, reversed, and merely accepted events do not contribute.

Pricing rules:

- product events prefer one effective `sale` price, then one `base` price;
- bed events prefer one effective `bed_rate` price, then one `base` price;
- other service events require one effective `base` price;
- missing or equally authoritative overlapping prices remain unpriced issues;
- no current-price fallback, legacy description match, proportional allocation, or guessed amount is allowed.

Invoice and balance rules:

- an event already claimed by one exact posted invoice line appears once as invoiced and is not projected again;
- an invoice is attributed to the admission only when every service line belongs to the same inpatient encounter;
- mixed-encounter invoices are excluded and classified;
- invoice header total, paid, credited, and net-due projections remain financial authority;
- active payment-allocation and deposit-application amounts explain invoice paid projections;
- posted credit notes explain credited projections;
- payment reversals and refunds are displayed separately;
- unapplied deposit liability is displayed separately and does not reduce authoritative admission balance;
- `potentialAfterAvailableDepositMinor` is a presentation-only scenario;
- practitioner compensation is displayed separately and never added to patient charge.

Authoritative admission balance:

```text
posted invoice net due + exact un-invoiced canonical service events
```

## Shadow route boundary

Endpoints:

- `GET /api/canonical-ipd-billing/admissions`
- `GET /api/canonical-ipd-billing/admissions/:admissionId`

Controls:

- allowed roles match the existing IPD billing read boundary;
- route permission registry declares `ipd:report:read`;
- the tenant setting is checked before projection;
- absent, false, or disabled setting returns `404`;
- detail and list cards consume the same projection function;
- SQL executed by the route is read-only;
- no active route or client page is switched.

## RED and runtime verification

RED fixtures first confirmed that the projection module and shadow route did not exist.

Final focused coverage includes:

- exact inpatient admission and bed-stay interval;
- doctor round, laboratory, radiology, procedure, medicine, and cancelled service events;
- un-invoiced exact-price projection;
- event-linked invoice de-duplication;
- posted invoice total, partial payment, deposit application, credit note, payment reversal, and refund;
- unapplied deposit liability kept separate from due;
- compensation earned, settled, and payable summaries kept separate from patient balance;
- missing and overlapping price classification;
- mixed-encounter invoice rejection;
- completed/discharged encounter interval;
- signed legacy ledger credit balance;
- cross-tenant and unknown admission rejection;
- list/detail parity;
- shadow flag absent, false, and enabled behavior;
- denied role behavior;
- read-only SQL contract;
- separate route registration without changing `/api/ip-billing`.

Focused verification:

- files: `2`
- tests: `15`
- failures: `0`

Full pre-rehearsal verification:

- canonical, migration-manifest, and shadow-route files: `27`
- tests: `200`
- failures: `0`
- canonical governance issues: `0`
- migration manifest entries: `441`
- TypeScript errors: `0`
- YAML assertions: passed
- diff check: passed

## Protected exact-snapshot comparison

The protected post-CDB070 SQLite snapshot was opened read-only. No copy, migration, backfill, transaction, or write command was executed.

Source aggregates:

- tenants with canonical admission links: `2`
- inpatient encounters: `46`
- active canonical admission links of all lifecycle states: `76`
- eligible in-progress/completed admissions: `42`
- active admissions: `15`
- completed admissions: `27`
- canonical active/completed bed stays: `44`
- bed stays linked to eligible projected admissions: `32`
- all posted chargeable service events: `63`
- posted chargeable events linked to eligible projected admissions: `32`
- event-linked canonical invoice lines: `0`
- posted canonical invoices: `0`
- legacy active provisional rows: `420`
- legacy unbilled bed rows: `20`
- legacy IPD ledger rows: `35`
- foreign-key violations: `0`

Projection result:

- projected admission items: `32`
- exact-priced projected items: `32`
- invoiced items: `0`
- unpriced items: `0`
- projection issue rows: `0`
- projection failures: `0`
- list/detail parity failures: `0`
- canonical un-invoiced service total: `6,350,000` minor units
- authoritative admission balance total: `6,350,000` minor units
- available canonical deposit liability: `0`
- invoiced, payment, credit, refund, and compensation totals: `0`

The zero invoice/payment/deposit/compensation values reflect the protected canonical snapshot, which safely contains no canonical invoices or compensation accruals. The projection does not fall back to legacy bills, payments, deposits, or practitioner payables.

Legacy comparison:

- admissions compared: `42`
- full matches: `21`
- classified differences: `21`
- provisional comparison matches: `25`
- ledger balance matches: `22`
- legacy provisional and unbilled-bed total: `45,000` minor units
- legacy ledger debit-minus-credit total: `-15,720,000` minor units

Difference classes:

- canonical-only charge evidence: `5`
- legacy-ledger-only evidence: `4`
- legacy-pending-only evidence: `1`
- multiple sources differ: `11`
- fully matched: `21`

These differences remain shadow comparison evidence. They do not mutate or promote legacy provisional or ledger rows into canonical authority.

Read-only proof:

- protected file size before and after: `43,704,320` bytes
- file size unchanged: yes
- SHA-256 before and after: `35e42b23310bda608d9bf6b13e4a423668e94c3af7d2e346b78585197492fdc6`
- file hash unchanged: yes

## Isolated D1 rehearsal clone

Target:

- database: `hms-canonical-rehearsal-20260713-b6036e`
- UUID: `6f9a17af-8e3e-4b26-85b7-08c653a706db`
- observed region: APAC

No migration, import, bundle, flag mutation, or write statement was used for CDB-071.

Read-only remote aggregates matched the protected local projection:

- eligible admissions: `42`
- active/completed: `15 / 27`
- posted chargeable events: `32`
- exact-priced events: `32`
- canonical projected total: `6,350,000` minor units
- event invoice lines: `0`
- posted invoices: `0`
- enabled canonical IPD shadow flags: `0`
- foreign-key violations: `0`

Remote comparison parity:

- compared: `42`
- matched/different: `21 / 21`
- pending matches: `25`
- ledger matches: `22`
- canonical total: `6,350,000`
- legacy pending total: `45,000`
- legacy ledger total: `-15,720,000`
- difference classes matched the local aggregate exactly.

Every remote command reported:

- `changed_db`: `false`
- rows written: `0`

Observed clone bookmark after read-only verification:

`0000001e-00000000-000050a8-46f43aa60fb22896a6a660cc35d169cf`

No Time Travel restore was required or attempted.

## Production read-only boundary

Production target:

- database: `hms-super-admin-production-apac`
- UUID: `c68a5360-a2c1-44cc-9e71-f21057bea102`

Exact read-only verification returned:

- canonical tables: `0`
- exact canonical migrations `0423` through `0431`: `0`
- latest migration ledger ID: `448`
- enabled `canonical_ipd_shadow_enabled` settings: `0`
- `changed_db`: `false`
- rows written: `0`

Production cannot serve the shadow projection until the canonical program is separately authorized and migrated. No production setting, route state, data, migration, deployment, or Worker version was changed.

## Protected artifacts

The aggregate-only runner and protected SQLite snapshot remain outside Git in access-controlled rehearsal storage. No raw SQL export, SQLite database, patient identifier, admission identifier, PHI, signed URL, or protected bundle is committed or included in this report.

## Program integration

- worker branch: `task/cdb-071-ipd-projection`
- implementation commit: `d6762a81`
- worker evidence commit: `a7ebe73f`
- program branch: `feature/hms-canonical-data-architecture`
- integration merge: `88512c52de7cd47fdfb637a3e0529d225c2bf2ba`
- merge method: non-fast-forward under the shared merge lock

Fresh post-merge verification:

- canonical, migration-manifest, and shadow-route tests: `27 files / 200 tests`
- failures: `0`
- canonical governance issues: `0`
- migration manifest: `441`
- TypeScript errors: `0`

The tracker and handoff artifacts now mark CDB-071 complete and CDB-080 ready. Integration touched only the canonical program branch. The existing active IPD route, production feature flags, `main`, deployment, push, Time Travel restore, local server, and original dirty workspace remained untouched.

## Result

CDB-071 rehearsal and program integration passed. Canonical IPD balance is rebuildable from typed canonical facts, list and detail use one result, legacy provisional and ledger data are comparison-only, and the hidden tenant-flagged endpoint remains disabled on both rehearsal and production databases.
