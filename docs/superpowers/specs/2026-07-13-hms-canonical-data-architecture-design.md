# HMS Canonical Data Architecture Redesign

**Date:** 2026-07-13  
**Status:** Approved architecture baseline; implementation has not started  
**Scope:** Full HMS database, application write paths, reporting facts, migration controls, and future local-server synchronization  
**Production topology:** One live hospital on Cloudflare D1; cloud-only operation today; one local server exists but is disabled; a nightly maintenance window is available

## 1. Executive decision

The HMS will be moved to a canonical, tenant-safe data architecture using an **expand → shadow/dual-write → backfill → reconcile → cut over → retire** migration strategy.

This is not a dashboard-only correction and not a one-night destructive rebuild. The full system remains in scope:

- patient identity and consent;
- users, employees, practitioners, doctors, and referral sources;
- appointments, OPD, emergency, encounters, prescriptions, clinical notes, and orders;
- admission, bed stays, IPD rounds, nursing, procedures, and discharge;
- lab, radiology, diagnostics, pharmacy, and inventory;
- service catalog, pricing, billing, deposits, payments, refunds, and credit notes;
- doctor commission, performer reserve, payable, and settlement;
- cash custody, expenses, payroll, accounting, and reporting;
- local-server synchronization after cloud stabilization.

The first production implementation wave establishes the common foundation and canonical service-to-cash chain. Later waves migrate the remaining modules into the same model. No module is allowed to invent a parallel source of truth while waiting for its migration wave.

## 2. Why redesign is required

The current system contains overlapping representations of the same business facts.

### Clinical episode overlap

- `appointments` schedules care.
- `consultations`, `visits`, and `encounters` all represent parts of actual care.
- `prescriptions`, `clinical_notes`, and completion claims independently repeat appointment, visit, patient, and doctor context.

Evidence: `src/db/schema/schema.ts:257-410`, `src/db/schema/schema.ts:3425-3453`, `src/db/schema/schema.ts:3541-3635`.

### IPD charge overlap

- `ipd_charges`
- `billing_provisional_items`
- `visit_services`
- `patient_bed_infos` and bed charge logs
- `invoice_items`
- `ipd_ledger_entries`

These tables can each carry amounts and billing state, so they can drift independently.

Evidence: `src/db/schema/schema.ts:511-564`, `src/db/schema/schema.ts:1186-1221`, `src/db/schema/schema.ts:2248-2273`, `src/db/schema/schema.ts:3653-3715`.

### Diagnostic overlap

- legacy `tests` rows;
- free-text `prescriptions.lab_tests`;
- structured lab orders/items;
- radiology requisitions;
- multiple pricing/catalog mappings.

Evidence: `src/db/schema/schema.ts:339-382`, `src/db/schema/schema.ts:2768-2781`, `migrations/0001_fix_schema_add_missing_tables.sql`, `migrations/0053_radiology.sql`, `migrations/0246_diagnostic_catalog_single_source.sql`.

### Financial overlap

- `bills` stores category totals, total, paid, and due;
- `invoice_items` stores lines but has an untyped `reference_id`;
- `payments` are bill-level only;
- `income` duplicates receipt-derived income;
- cash, IPD ledger, commission, and accounting each maintain additional financial state.

Evidence: `src/db/schema/schema.ts:2783-2931`.

### Inconsistent database contracts

- money is mixed between `REAL` BDT and integer minor units;
- tenant identifiers are mixed between text and integer across migrations;
- timestamps mix UTC-like values with database-side `+6 hours` conversion;
- important production tables exist only in migrations and are absent from the main Drizzle schema;
- migration history contains duplicate numbers, repeated alterations, and repair migrations.

The result is that route code must infer meaning, dashboards reconstruct facts with fallbacks, and the same transaction can produce different totals in different screens.

## 3. Research basis

The design follows these external reference principles without attempting to turn the internal database into a literal FHIR server.

### Cloudflare D1

- D1 `batch()` runs statements sequentially as a transaction and rolls the sequence back when one statement fails. Atomic operational writes and their outbox records will therefore be placed in one bounded batch.
- `wrangler d1 export` supports exporting schema and data for rehearsal and verification.
- D1 Time Travel provides point-in-time recovery, but restoration overwrites the database in place; it is a rollback tool, not the staging-clone strategy.

Official references:

- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/d1/best-practices/import-export-data/
- https://developers.cloudflare.com/d1/reference/time-travel/

### SQLite integrity

- foreign keys and composite constraints must be deliberately defined and verified;
- parent keys used by foreign keys must be primary or unique;
- tenant-safe relationships require composite tenant-aware uniqueness where cross-tenant ID confusion is possible.

Official reference: https://www.sqlite.org/foreignkeys.html

### Healthcare domain separation

HL7 FHIR distinguishes planned activity from actual care and service requests from chargeable provision:

- Appointment is a booking that may result in an Encounter.
- Encounter records actual patient/provider activity.
- ServiceRequest records an order or proposal for a diagnostic or other service.
- ChargeItem records provision details used for billing and cost allocation.
- Invoice contains charge items from an account.

Official references:

- https://hl7.org/fhir/R5/appointment.html
- https://hl7.org/fhir/R5/encounter.html
- https://hl7.org/fhir/R5/servicerequest.html
- https://hl7.org/fhir/R5/chargeitem.html
- https://hl7.org/fhir/R5/invoice.html

## 4. Architectural principles

### 4.1 One authoritative source per business fact

| Business fact | Canonical authority |
|---|---|
| Planned appointment | `appointments` |
| Actual care episode | `encounters` |
| IPD stay | `admissions` as an encounter extension |
| Ordered service/test | `service_request_items` |
| Delivered or operationally recognized service | `service_events` |
| Current catalog identity | `service_catalog_items` plus domain extension |
| Effective price | `service_catalog_prices` |
| Billed amount | `invoice_lines` |
| Receipt/tender | `payment_receipts` and `payment_tenders` |
| Applied collection | `payment_allocations` |
| Patient deposit liability | deposit ledger and applications |
| Doctor earning | `commission_accruals` |
| Stock quantity | immutable stock movements |
| Physical cash custody | cash custody ledger |
| Accounting balance | posted journal lines |
| IPD running balance | rebuildable projection from canonical finance facts |

### 4.2 Clinical facts and financial facts remain separate but linked

A test order is not an invoice line. A performed service is not a payment. The canonical chain is:

```text
Appointment (optional)
  → Encounter / Admission
  → Service Request Item (optional for direct services)
  → Service Event
  → Invoice Line
  → Payment Allocation
  → Accounting Event / Journal
```

This separation supports ordered-but-not-performed, performed-but-not-billed, billed-but-unpaid, partly paid, refunded, and reversed states without overloading one status column.

### 4.3 Role-explicit practitioner relationships

A generic `doctor_id` must not mean multiple things. Participant links carry explicit roles:

- treating;
- admitting;
- consulting;
- ordering;
- prescribing;
- referring;
- performing;
- reporting;
- approving.

Commission rules are role-scoped. A diagnostic performer reserve and a referral commission are separate accruals linked to the same service event or invoice line.

### 4.4 Posted clinical and financial history is immutable

- signed clinical records are corrected through addenda;
- invoices are corrected through void/reissue or credit notes;
- payments are corrected through reversals/refunds;
- posted vouchers are corrected through reversal vouchers;
- stock is corrected through adjustment movements;
- historical snapshots remain available even when master data later changes.

### 4.5 Tenant safety is structural

Every tenant-owned canonical record has `tenant_id TEXT NOT NULL`. Unique constraints, idempotency keys, source mappings, and reconciliation queries are tenant-scoped. Cross-tenant joins are rejected by application ownership checks and protected by composite uniqueness where feasible.

### 4.6 Money and time are explicit

- posted money uses integer minor units with `_minor` suffix;
- currency is stored explicitly, defaulting to BDT;
- percentage values use basis points where exactness is required;
- event timestamps are stored in UTC;
- business reporting dates are stored separately using the tenant/hospital timezone;
- old `REAL` values are converted only through audited, deterministic backfills.

## 5. Target domain model

### 5.1 Identity and organization

- `tenants`
- `branches`
- `users` for authentication and authorization only
- `employees` for HR/employment
- `practitioners` for clinical/provider identity
- practitioner-user and practitioner-employee links
- specialties, departments, credentials, identifiers, and referral-source classification

Internal and external doctors share practitioner semantics; an external referrer does not require a user account.

### 5.2 Patient and consent

- `patients` remains the canonical patient master;
- identifiers, contacts, addresses, and relationships move to supporting tables;
- patient merge is auditable and reversible by mapping, not destructive deletion;
- consent and privacy tables receive consistent tenant types and explicit resource links.

### 5.3 Scheduling and encounters

- `appointments` remains scheduling-only;
- `encounters` becomes the actual OPD, emergency, virtual, or inpatient episode;
- `admissions` extends an inpatient encounter;
- `encounter_participants` records practitioner roles and periods;
- `consultations` is merged into encounter/session semantics;
- `visits` becomes a compatibility layer and is retired or narrowed after migration;
- notes, diagnoses, vitals, prescriptions, documents, and orders reference the encounter.

### 5.4 Service catalog and pricing

- `billing_service_items` evolves into `service_catalog_items`;
- lab tests, radiology procedures, consultation services, beds, procedures, and pharmacy products use domain extension/mapping tables;
- one effective-dated price history controls current commercial pricing;
- service events and invoice lines preserve historical price/name snapshots.

### 5.5 Requests and service events

- `service_requests` groups an order/referral;
- `service_request_items` represents each requested service;
- lab, radiology, and other domain-specific details remain in extension tables;
- `service_events` records delivered or operationally accepted service facts;
- `service_event_participants` records role-specific practitioners;
- source mapping and idempotency prevent duplicate events.

For the hospital's current non-LIS diagnostic workflow, a non-cancelled ordered diagnostic item can create the operational service event under the approved business rule. Result workflow remains a separate clinical status for future LIS use.

### 5.6 Billing and accounts receivable

- `invoices` replaces the authoritative use of `bills`;
- `invoice_lines` references canonical service events/catalog items;
- `payment_receipts` records the receipt document;
- `payment_tenders` records cash/card/mobile/bank components;
- `payment_allocations` persists which invoice or line received each amount;
- deposits remain liabilities until applied;
- credit notes, refunds, and reversals are explicit immutable documents;
- invoice header totals are derived/cached from lines and reconciled, not independently maintained by unrelated routes.

### 5.7 IPD

- admission is an encounter extension;
- bed stays, doctor rounds, diagnostics, medicines, procedures, and nursing chargeable activities create idempotent service events;
- provisional billing is a query/read model over un-invoiced active service events;
- the IPD ledger is a deterministic projection of service events, invoices, payments, deposits, credit notes, and refunds;
- legacy `ipd_charges` and independent provisional amounts are migrated, frozen, and retired.

### 5.8 Commission and practitioner settlement

- effective-dated commission rules target catalog items/categories and practitioner roles;
- accruals store calculation-basis snapshots, rate/fixed amount, gross/base/earned values, and status;
- performer reserve becomes a recognized accrual stage/type instead of a parallel unexplained balance;
- settlements allocate to accruals; one accrual cannot be paid twice;
- cancellation and refund rules define whether accruals cancel, reduce, block, or require reversal.

### 5.9 Pharmacy and inventory

- prescription/order → dispense → stock movement → service event/invoice line;
- stock balance is derived from immutable movements;
- purchases, receipts, transfers, issues, sales, returns, expiry, damage, and adjustments have explicit movement types;
- batch, expiry, location, source document, unit conversion, and idempotency are preserved;
- financial posting occurs once per source event.

### 5.10 Cash, expense, payroll, and accounting

- cash ledger remains a custody ledger, not a generic income ledger;
- expense documents separate approval, execution, payment, custody, and accounting states;
- payroll run, employee payable, payment, and journal posting are separate linked facts;
- operational mutations write an outbox event in the same D1 batch;
- accounting posting is idempotent and uses immutable balanced vouchers/journal lines;
- failures enter a retry/dead-letter/reconciliation workflow and are not silently ignored.

## 6. Write architecture

Routes and UI endpoints must not independently orchestrate multiple financial tables. They call domain commands such as:

- `startEncounter`
- `requestService`
- `recordServiceEvent`
- `issueInvoice`
- `collectPayment`
- `applyDeposit`
- `issueCreditNote`
- `reversePayment`
- `accruePractitionerCompensation`
- `settlePractitionerPayables`
- `recordStockMovement`
- `postAccountingEvent`

Each command:

1. validates tenant ownership and lifecycle state;
2. validates idempotency;
3. computes trusted server-side amounts;
4. performs bounded canonical writes plus outbox entry in one D1 batch;
5. returns stable public IDs;
6. emits auditable failure information without creating partial success.

Legacy writes during migration use explicit adapters. New route code cannot write directly to deprecated tables.

## 7. Migration architecture

### Phase A — Audit and freeze

- export production schema/data using Wrangler;
- create an isolated staging D1 and import the export;
- capture row counts, money totals, FK checks, duplicate/orphan reports, and migration manifest;
- freeze unreviewed schema additions;
- create a table-by-table ownership and disposition registry.

### Phase B — Add canonical foundation

- additive tables only;
- no legacy table drop or rename;
- schema version, public IDs, source mappings, migration checkpoints, reconciliation runs, outbox, and exception queues;
- CI guards for money, tenant, generic references, schema drift, and destructive migrations.

### Phase C — Shadow and backfill

- build deterministic legacy resolvers;
- backfill by tenant and bounded primary-key ranges;
- use checkpoint/idempotency records;
- record exceptions rather than guessing;
- enable canonical shadow writes after replay tests pass.

### Phase D — Reconcile and cut over

- compare counts and monetary invariants by tenant/day/domain;
- shadow dashboards compare legacy and canonical facts;
- money differences must be zero before financial cutover;
- approved legacy exceptions must be individually classified;
- nightly maintenance window is used for final write freeze, export/bookmark, delta backfill, verification, feature-flag switch, and smoke testing.

### Phase E — Retire legacy truth

- stop legacy writes;
- retain compatibility views/read-only archives for an agreed observation period;
- remove old route adapters only after monitoring and rollback expiry;
- drop legacy structures in a separate later release, never in the first cutover migration.

## 8. Production safety and rollback

Before every production wave:

- fresh Wrangler export stored securely;
- D1 Time Travel bookmark/timestamp recorded;
- restore rehearsal performed on non-production data;
- staging migration run at least twice to prove idempotency;
- baseline and post-migration reconciliation artifacts stored;
- maintenance mode verified;
- rollback decision owner and time budget recorded.

Rollback differs by stage:

- before read cutover: disable shadow/dual writes and continue legacy reads;
- after read cutover but before new-only writes: restore feature flags and legacy reads;
- after canonical-only writes: replay/reverse through the migration ledger or perform approved point-in-time restore during the maintenance window.

Time Travel restoration is destructive and cancels in-flight operations, so it is the last-resort rollback, not the normal migration mechanism.

## 9. Reporting architecture

Every KPI has a metric contract declaring:

- fact table/view;
- date basis;
- inclusion/exclusion statuses;
- practitioner role;
- billed versus collected semantics;
- quantity semantics;
- cancellation/refund treatment;
- reconciliation invariant.

Examples:

- diagnostic volume: `service_events`, service business date, non-cancelled, diagnostic category, sum quantity;
- billed diagnostic amount: `invoice_lines` linked to diagnostic service events, invoice/service cohort documented;
- collected diagnostic amount: net payment allocations linked to diagnostic invoice lines, receipt date;
- doctor payable: active accruals minus settlement allocations and reversals.

Summary cards and drill-down details must use the same canonical view or query module.

## 10. Governance preventing future schema disorder

### Required design artifacts for every new module

- source-of-truth declaration;
- entity ownership and lifecycle;
- tenant, money, date, and ID contracts;
- write command and transaction boundary;
- clinical/billing/commission/accounting/reporting impact;
- migration, rollback, and reconciliation plan;
- local-sync compatibility statement.

### Automated CI rules

CI rejects:

- new posted-money `REAL` columns;
- tenant-owned tables without text `tenant_id`;
- untyped generic `reference_id` fields;
- missing ownership/index/constraint tests;
- direct writes to registered legacy tables;
- schema tables present only in migration SQL but missing from the canonical schema registry;
- destructive migrations without a separately approved retirement plan;
- new dashboard metrics without a metric contract;
- financial commands without idempotency and reconciliation tests.

### Living registries

- canonical entity registry;
- legacy disposition registry;
- metric registry;
- migration manifest;
- architecture decision records;
- task-progress YAML and agent handoff files.

## 11. Key decisions

1. Keep Cloudflare D1 for the redesign; do not combine logical cleanup with a database-engine migration.
2. Reconsider PostgreSQL only after canonical models and write paths are stable and measured.
3. Use stable application-generated public IDs for records that may later synchronize with a local server.
4. Preserve integer internal IDs where they benefit D1 performance, but never use them as cross-database sync identities.
5. Promote `encounters` rather than `visits` as the clinical episode authority.
6. Create a clean canonical `service_events` model rather than silently broadening legacy `visit_services` semantics.
7. Treat provisional IPD billing and IPD ledger as projections, not independent financial facts.
8. Persist payment allocations; do not reconstruct service collections proportionally at report time.
9. Keep diagnostic operational counting separate from LIS result workflow.
10. Run the program in independently testable waves with reconciliation and rollback gates.

## 12. Acceptance criteria for the architecture program

The redesign is complete only when:

- every active production write path maps to one documented domain command;
- all authoritative posted amounts use integer minor units;
- all authoritative tenant-owned records use consistent tenant IDs and ownership checks;
- patient, encounter, service, invoice, allocation, commission, stock, cash, and journal facts have one authority each;
- legacy sources are read-only or archived and no active route writes to them;
- zero unexplained difference exists for production financial reconciliation;
- operational counts reconcile to documented legacy mappings/exceptions;
- dashboards and drill-downs share canonical facts;
- production restore and rollback rehearsals have passed;
- local-server sync is re-enabled only through versioned public IDs, outbox/inbox, mappings, and conflict rules;
- CI prevents reintroduction of the identified anti-patterns.

## 13. Explicit non-goals for the first implementation wave

- no production migration while creating planning artifacts;
- no big-bang rewrite of every UI page;
- no immediate drop of legacy tables;
- no D1-to-PostgreSQL migration;
- no activation of the currently disabled local server;
- no silent automatic correction of ambiguous historical records.

Ambiguous records enter an exception queue for explicit mapping or approved classification.