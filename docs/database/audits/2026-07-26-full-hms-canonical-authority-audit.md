# Full HMS Canonical Authority and Legacy-Cutover Audit

**Date:** 2026-07-26  
**Program:** HMS Canonical Data Architecture  
**Branch:** `program/cdb-main-continuous-20260725`  
**Audit class:** repository-only authority, duplication, writer, reader, backfill, reconciliation, cutover, and retirement audit  
**Production mutation:** not authorized and not performed  
**Destructive migration or legacy removal:** not authorized and not performed

## 1. Audit objective

The purpose of this audit is not to add another database beside the existing HMS database. The purpose is to establish one authoritative representation for each business fact so that future modules do not create another competing table, another independent balance, or another route-specific interpretation of the same record.

The governing rule is:

> One business fact has one canonical authority. Other persisted structures may exist only as domain extensions, immutable history, workflow documents, compatibility surfaces, audit evidence, or rebuildable projections.

This rule does not mean that the whole HMS must be placed in one giant table. It means, for example, that an invoice has one invoice authority, a payment has one receipt/tender/allocation authority, a stock quantity has one movement authority, and a clinician has one practitioner identity authority. A module may add its own metadata, but it must not create a second independent version of the shared fact.

## 2. Authoritative architecture decision

The only canonical implementation family is:

- `src/db/schema/canonical/**` for canonical schema declarations;
- `src/lib/canonical/**` for commands, projections, reporting, reconciliation, and compatibility logic;
- `scripts/canonical/**` for governed backfill, verification, reconciliation, and cutover tooling;
- `test/canonical/**` for canonical invariants and authority contracts.

`Canonical Finance` is not a separate database program. Billing, payment, deposit, refund, practitioner compensation, accounting, and cash custody are finance domains inside the single HMS canonical architecture.

The parallel review-only architecture under `src/lib/financial-reconciliation/**` is rejected as an authority. The branch `program/canonical-finance-continuous-execution-20260721` must not be used as a second canonical implementation source. Useful requirements may be reconsidered, but implementation must extend the existing canonical schema and command family.

## 3. Evidence reviewed

The audit consolidated current repository evidence from:

- `docs/database/canonical-source-of-truth.yaml`;
- `docs/database/legacy-table-disposition.yaml`;
- `docs/database/legacy-write-retirement-gates.yaml`;
- `docs/database/canonical-local-sync-entity-registry.yaml`;
- `docs/database/audits/P01-clinical-current-state-audit.md`;
- `docs/database/audits/P01-diagnostics-inventory-current-state-audit.md`;
- `docs/database/audits/P01-finance-current-state-audit.md`;
- `docs/architecture/2026-07-21-main-canonical-completion-gap-audit.md`;
- `docs/architecture/2026-07-22-canonical-tenant100-readiness-audit.md`;
- current canonical schema, command, reporting, and backfill paths;
- current operational routes, libraries, schema declarations, and migration-defined tables;
- active legacy financial, clinical, pharmacy, diagnostics, inventory, HR, and reporting readers and writers.

This is a static repository audit. It establishes declared authority and code-path risk. It does not claim that every historical production row has already been deterministically mapped. Production or protected-clone row-level evidence remains a separate authorization-gated phase.

## 4. Machine-readable authority matrix

The machine-readable registry is:

`docs/database/canonical-authority-matrix.yaml`

It is enforced by:

`test/canonical/canonical-authority-matrix.test.ts`

The matrix currently records:

| Measure | Count |
| --- | ---: |
| Business concepts classified | 46 |
| Implemented canonical concepts | 17 |
| Partial canonical concepts | 9 |
| Material canonical gaps | 18 |
| Externally governed concepts | 2 |
| Registered canonical tables with exactly one owner | 71 |
| Existing governed legacy tables covered | 5 |

All 71 tables in `canonical-source-of-truth.yaml` are assigned to exactly one implemented or partial canonical concept. No canonical table is owned by two concepts. Every registered legacy table in `legacy-table-disposition.yaml` appears in the matrix.

The existing retirement inventory contains only five table families—`bills`, `invoice_items`, `payments`, `doctor_commission_accruals`, and `InventoryStockTransaction`—with 65 direct-write allowances. That inventory is important, but it is not a complete HMS duplicate-table inventory. The broader matrix exposes many additional clinical, diagnostics, pharmacy, inventory, HR, insurance, and reporting authorities that still require governed classification and cutover work.

## 5. Current canonical spine

The current canonical implementation already provides a substantial shared spine.

### 5.1 Governance and migration evidence

Canonical schema versions, migration runs, backfill checkpoints, source mappings, processing issues, reconciliation runs, feature flags, idempotent outbox events, financial batch assertions, and synchronization evidence are implemented. These provide the controls required to migrate incrementally rather than perform an unsafe one-time rewrite.

CDB-113B also adds `canonical_tenant_patient_links` and `canonical_tenant_patient_link_events` as the explicit relationship authority between tenant patient records and the external-governed global/MPI identity. It does not copy demographics or replace `patients` or `global_patient_identity`. Exact-evidence linking, immutable events, resumable backfill, and persistent reconciliation are implemented in commit `4166cd67d`.

### 5.2 Practitioner identity

Canonical practitioner identity, user links, employee links, identifiers, specialties, and department links exist. The target model is correct, but operational reads and writes still substantially depend on `doctors`, `doctor_auth`, `external_referring_doctors`, copied doctor names, and generic integer doctor fields.

### 5.3 Encounters and inpatient structure

Canonical encounters, participant roles, admission links, encounter addenda, and bed stays exist. They provide the correct destination for care episodes. However, appointment, consultation, visit, doctor-visit, admission, bed-status, and patient-bed-info workflows are still active and not fully provider-switched to the canonical model.

### 5.4 Service catalog and delivered work

Canonical service catalog items, effective prices, service requests, service events, and service participants exist. This is the correct shared boundary for consultation, lab, radiology, procedures, bed services, stock-linked services, and other billable work. Operational diagnostic catalogs, provisional charges, `visit_services`, request/result tables, and module-specific price sources still compete with it.

### 5.5 Billing and financial corrections

Canonical invoice, invoice-line, receipt, tender, allocation, deposit, deposit-application, credit-note, refund, and payment-reversal structures exist. Canonical strict/shadow commands cover many major writer boundaries. Production cutover, complete canonical read promotion, and legacy retirement remain incomplete.

### 5.6 Practitioner compensation

Canonical compensation rules, accruals, reporting context, adjustments, refund reservations, adjustment reversals, settlements, and settlement allocations exist. The canonical model is role-explicit and line-linked. Legacy commission, performer reserve, provisional payable, and settlement paths remain active compatibility or authority paths.

### 5.7 Inventory and accounting

Canonical inventory items, locations, lots, unit conversions, policies, balances, transfers, and immutable movements exist. Canonical accounting accounts, mappings, periods, posting jobs, vouchers, entries, cash custody movements, and balances also exist. These are correct targets, but not all operational inventory/pharmacy/cash/accounting writers use them as the sole blocking authority.

## 6. Major duplicate-authority findings

### 6.1 Clinician identity

The same clinician can be represented by `users`, `doctors`, `doctor_auth`, `external_referring_doctors`, employee records, and copied IDs/names in clinical and finance rows. These records answer different questions but currently overlap identity authority.

Target rule:

- `users` remains authentication actor identity;
- canonical practitioners represent clinical professional identity;
- practitioner-user and practitioner-employee links join the identities explicitly;
- external referrers become practitioner-linked external identities;
- missing roles or links remain reconciliation issues and are never inferred by name alone.

### 6.2 Appointment and care episode

`appointments`, `consultations`, `visits`, `doctor_visits`, `encounters`, and `admissions` can represent overlapping parts of one patient episode. Appointment price and billing status also duplicate service and invoice state.

Target rule:

- appointment is planned intent and scheduling;
- encounter is actual care;
- admission is an inpatient extension of an encounter;
- clinical documents attach to the encounter;
- billing attaches to delivered/requested service facts according to policy;
- legacy episode rows become source mappings and compatibility surfaces after deterministic grouping.

### 6.3 Bed occupancy and bed charging

`admissions.bed_id`, `beds.status`, and `patient_bed_infos` all represent current occupancy. `patient_bed_infos` additionally stores calculated days, charge, and billed state.

Target rule:

- bed is a resource;
- the open canonical bed stay determines current occupancy;
- bed pricing belongs to service-price history;
- bed charges are service events and invoice lines;
- cached bed status may remain a projection but cannot remain independent truth.

### 6.4 Diagnostic catalog and lifecycle

Lab catalog, radiology catalog, billing service catalog, singular/plural price maps, legacy `tests`, free-text prescription requests, lab orders/items, radiology requisitions/reports, invoice lines, and `visit_services` overlap service identity, request, performance, result, and billing facts.

Target rule:

- canonical service catalog and effective prices own identity and commercial pricing;
- service request owns ordered intent;
- service event owns accepted/performed work;
- explicit participant rows own requester, prescriber, referrer, technician, performer, reporter, and verifier roles;
- lab/radiology result, specimen, acquisition, and report structures become domain extensions keyed to canonical request/event IDs;
- invoice lines reference typed canonical events rather than polymorphic numeric IDs.

### 6.5 Financial documents and balances

Legacy finance duplicates the same amount across bills, invoice items, payments, income mirrors, deposits, settlements, credit notes, employee cash, drawer movement, cash shadow rows, compensation rows, posting events, vouchers, and legacy journals.

Target rule:

- invoice net derives from active canonical lines and adjustments;
- paid amount derives from persisted allocations;
- receipt, tender, and allocation are separate facts;
- deposit is a liability with explicit receipt/application/refund/reversal lifecycle;
- cash custody is separate from revenue/account classification;
- accounting vouchers and entries are immutable and exactly balanced in minor units;
- direct income, expense, and payroll retain workflow documents but do not create a second accounting truth.

### 6.6 Inventory, pharmacy, and lab reagent stock

At least three active stock generations remain:

- enterprise `InventoryItem`, `InventoryStock`, and `InventoryStockTransaction`;
- rich pharmacy `pharmacy_items`, `pharmacy_stock`, transactions, invoices, and purchases;
- legacy `medicines`, batches, movements, and sales;
- lab consumable stock and movements add another conditional ledger.

Target rule:

- one canonical item identity and lot model;
- immutable canonical movement is quantity truth;
- canonical balance is a rebuildable projection;
- pharmacy product and lab reagent metadata are extensions, not separate quantity balances;
- dispense, issue, return, receipt, transfer, adjustment, count, waste, and write-off all use one posting engine;
- ongoing balance-copy bridges are retired after staged reconciliation.

## 7. Material canonical gaps

The matrix intentionally marks gaps instead of creating speculative tables during the audit. The following concepts do not yet have a complete canonical authority and command/read contract:

1. patient identity linkage between tenant patients and global/MPI identity;
2. appointment intent, availability, and lifecycle history;
3. prescription and medication-order authority linked to encounters;
4. broader clinical documents, diagnoses, allergies, problems, and signed note versions;
5. clinical observations/vitals authority across duplicate vital structures;
6. medication administration and reconciliation authority;
7. lab specimen, result, verification, and LIS lifecycle extensions;
8. radiology acquisition, result, report, and PACS lifecycle extensions;
9. emergency episode extensions;
10. operation-theatre/procedure episode extensions;
11. nursing care-plan, notes, administration, intake/output, wound, and handover authority;
12. insurance policy, authorization, claim, remittance, and patient-liability authority;
13. direct expense approval, payment, recovery, and reversal authority;
14. payroll run, payslip, payable, payment, expense, and accounting lifecycle authority;
15. direct non-patient income source documents;
16. procurement request, RFQ, purchase order, receipt, return, and supplier-invoice authority;
17. pharmacy dispense and OTC-sale event authority linked to canonical stock and billing;
18. lab reagent lot/QC/open-vial/analyser metadata linked to canonical inventory lots;
19. provider-selected canonical read promotion for all dashboards, reports, APIs, and operational screens.

The matrix contains 18 `canonical_gap` concepts because some related items above are grouped under one business concept. Gaps must be closed by extending the existing canonical architecture, not by declaring the current legacy table canonical without transformation.

## 8. Writer and reader findings

### 8.1 Writer surface

The repository still has many route-specific direct writers. Important clusters include:

- doctor registration/auth/profile and external referrer routes;
- appointment, consultation, visit, encounter, admission, reception, queue, and synchronization routes;
- lab, radiology, order-set, reception, provisional billing, IPD billing, pharmacy, and cancellation routes;
- billing, payment gateway, deposit, settlement, credit-note, refund approval, expense, income, commission, and cash-custody routes;
- enterprise inventory, pharmacy stock, legacy medicine, lab monitoring, bridge, import, transfer, return, count, adjustment, and write-off routes;
- payroll, scheduled expense, staff expense, accounting recovery, and journal workflows.

A future cutover checker must classify each writer as:

- canonical blocking writer;
- canonical command with temporary compatibility projection;
- explicitly blocked in canonical mode;
- protected fixture or migration tool;
- retirement candidate.

Unclassified writers must fail the cutover gate.

### 8.2 Reader surface

Canonical reporting routes and selected provider-switch mechanisms exist, including doctor analytics and action-centre receivables. However, dashboard, admin, scheduled summaries, global search, patient portal, public marketplace, operational lists, pharmacy reports, inventory reports, and many domain APIs still read legacy tables directly.

Canonical write completion is not enough. A domain cannot retire its legacy tables until its operational and analytical readers are provider-switched, shadow-compared, reconciled, and observed.

## 9. Backfill and reconciliation status

Existing canonical scripts provide strong backfill coverage for practitioners, encounters, service catalog, service operations, invoices, payments, deposits, compensation, inventory, accounting, and selected corrections. Source mappings, checkpoints, processing issues, and reconciliation runs provide the right migration mechanics.

The remaining work is not a single bulk import. Each domain requires:

1. deterministic identity classification;
2. source-unit and money normalization;
3. source-to-canonical public ID mapping;
4. idempotent chunked backfill;
5. exception capture instead of guessed joins;
6. second-pass zero-new-row proof;
7. aggregate and row-cardinality reconciliation;
8. read-provider comparison;
9. controlled canary cutover;
10. observation and rollback proof.

Current local verification proves the implementation contracts, but protected production evidence still contains unresolved historical issues and operational blockers. No audit document authorizes changing production flags or retiring a table.

## 10. Cutover order

The safest and fastest completion path is dependency-first rather than module-by-module table replacement.

### Wave 0 — Governance freeze

- make the authority matrix and checker mandatory;
- register all current direct writers and readers;
- reject new shared-fact tables without an authority decision;
- pause additional local-sync capability expansion;
- preserve the single canonical implementation root.

### Wave 1 — Identity and episode foundation

- finish practitioner operational adoption;
- design tenant-patient to MPI linkage;
- add appointment canonical intent/lifecycle;
- complete encounter/admission/bed-stay grouping and participants;
- provider-switch core clinical episode readers.

### Wave 2 — Service and clinical extensions

- converge service catalogs and effective prices;
- canonicalize diagnostic requests/events/participants;
- add lab and radiology result extensions;
- attach prescriptions and broader clinical documents to encounters;
- add ER, OT, nursing, observation, and MAR extensions without duplicating shared facts.

### Wave 3 — Financial completeness

- finish all financial writer classifications and strict boundaries;
- complete provider-selected invoice/payment/deposit/refund/compensation reads;
- add canonical direct-income, expense, payroll, and insurance lifecycle contracts;
- prove cash custody and accounting coverage.

### Wave 4 — Inventory and supply convergence

- route every quantity mutation through canonical movements;
- add procurement document authority;
- add canonical dispense/OTC events;
- merge pharmacy and lab reagent quantity authority into canonical inventory;
- replace ongoing bridges with reconciliation and compatibility views.

### Wave 5 — Read promotion and canary cutover

- run domain-specific shadow reads;
- require zero unexplained variance or approved exception IDs;
- activate one authorized tenant/domain at a time;
- observe and preserve immediate rollback.

### Wave 6 — Legacy retirement

- stop direct legacy writes;
- keep compatibility reads/views for a controlled period;
- verify no runtime readers or writers remain;
- archive historical tables;
- perform destructive removal only under a separate explicit authorization.

## 11. Immediate next implementation checkpoint

The next checkpoint must not expand synchronization and must not begin by dropping tables. It should establish the executable authority-governance layer around this matrix:

1. add a checker that validates concept uniqueness, canonical table ownership, registered legacy coverage, file-path evidence, and allowed status vocabulary;
2. classify all direct writer allowances beyond the current five-table retirement registry;
3. choose the earliest dependency foundation—patient/practitioner/appointment/encounter authority—and produce its implementation spec and migration contract;
4. require all new shared-domain development to reference the authority matrix before adding a table or raw SQL writer.

The earliest implementation wave should favour appointment and episode authority because it unlocks prescriptions, diagnostics, clinical documents, admissions, service events, billing attribution, and reporting without creating additional cross-links among legacy episode tables.

## 12. Stop conditions

Implementation must stop for an explicit decision when:

- a historical identity or source reference has multiple plausible canonical targets;
- money units cannot be deterministically classified;
- a service, invoice, payment, stock, compensation, or accounting amount has unexplained variance;
- a source and canonical mutation cannot share an atomic boundary or durable outbox guarantee;
- a paid, settled, signed, or legally relevant historical record would be destructively rewritten;
- production data, secrets, deployment, feature flags, traffic, backfill, observation, or table removal are required;
- a proposed module would create another authority for an already registered fact.

## 13. Final verdict

The canonical project is substantial and should continue; it should not be restarted. The existing 71-table canonical spine already covers governance, patient-identity relationships, practitioner identity, encounters, service operations, core billing, compensation, inventory, accounting, cash custody, and synchronization evidence.

The system is not yet fully canonical because operational authority remains split across many legacy and module-specific tables, 18 material business concepts still lack a complete canonical authority, and most legacy retirement gates remain blocked.

The correct program is one **Full HMS Canonical Authority and Legacy Cutover Program**. Finance is one domain inside it. The fastest safe path is to enforce the authority matrix, close dependency gaps in waves, promote reads and writes domain by domain, reconcile on a protected snapshot, canary one tenant at a time, and retire legacy structures only after observation evidence passes.
