# HMS Canonical Data Architecture Specification

**Date:** 2026-07-13  
**Status:** Approved for implementation planning  
**Normative language:** MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY are requirements keywords  
**Companion design:** `docs/superpowers/specs/2026-07-13-hms-canonical-data-architecture-design.md`

## 1. Purpose

This specification defines the mandatory data contracts, lifecycle rules, transaction boundaries, migration requirements, reconciliation rules, and governance controls for bringing the complete HMS database into a consistent canonical architecture.

The specification applies to Cloudflare D1, Hono/TypeScript application code, Drizzle schema definitions, migrations, reports, dashboards, future local-server synchronization, and any new module added during or after the redesign.

## 2. Global data standards

### 2.1 Tenant ownership

1. Every tenant-owned canonical table MUST contain `tenant_id TEXT NOT NULL`.
2. Every tenant-owned unique constraint MUST include `tenant_id` unless the value is intentionally globally unique and documented.
3. Every command MUST validate that all referenced rows belong to the same tenant before mutation.
4. A route MUST NOT accept a tenant ID from the request body as the authority; the authenticated tenant context is authoritative.
5. Cross-tenant references MUST be rejected and audited.
6. Tenant-owned tables SHOULD use composite uniqueness such as `(tenant_id, public_id)` and `(tenant_id, source_type, source_public_id)`.

### 2.2 IDs

1. Canonical rows MUST retain an internal integer primary key where useful for D1 joins.
2. Sync-capable and externally referenced rows MUST have an application-generated `public_id TEXT NOT NULL`.
3. `public_id` SHOULD be a monotonic, sortable ULID or equivalent stable identifier generated before the database write.
4. Internal auto-increment IDs MUST NOT be used as cross-database sync identities.
5. Legacy source links MUST use an explicit mapping table or typed source fields; an untyped `reference_id` is prohibited.

### 2.3 Money

1. Authoritative posted money MUST be stored as `INTEGER` minor units.
2. Authoritative money column names MUST end in `_minor`.
3. Every posted financial document MUST store `currency_code TEXT NOT NULL`, default `BDT` where the tenant has not configured another currency.
4. `REAL` MUST NOT be introduced for posted monetary amounts.
5. Percentage rates requiring exact calculation MUST use integer basis points.
6. Historical `REAL` amounts MUST be migrated with a documented rounding rule and before/after totals.
7. Client-supplied totals MUST NOT be trusted; server-side commands recalculate all totals.

### 2.4 Time and business date

1. Event timestamps MUST be stored in UTC.
2. Database defaults MUST NOT add `+6 hours` or any fixed local offset.
3. Reporting-sensitive rows MUST store `business_date` derived from the tenant's configured hospital timezone.
4. `created_at` is an audit timestamp and MUST NOT substitute for service date, invoice date, payment date, or accounting date.
5. Backfill logic MUST preserve the best available historical semantic date and record its source.

### 2.5 Audit and correction

Canonical mutable records MUST include, where relevant:

- `created_at`, `created_by`;
- `updated_at`, `updated_by`;
- `cancelled_at`, `cancelled_by`, `cancel_reason`;
- `version` for optimistic or lifecycle versioning;
- `idempotency_key` for repeatable commands.

Posted clinical and financial records MUST NOT be hard-deleted. Corrections use addenda, cancellation, voiding, reversal, credit notes, refund, or adjustment movements.

### 2.6 Status contracts

1. Each status column MUST have a documented lifecycle.
2. Status values MUST be constrained using a database `CHECK` where D1 supports the required expression.
3. Clinical, billing, payment, settlement, result, and accounting statuses MUST remain separate.
4. A single status MUST NOT encode unrelated lifecycle dimensions.

## 3. Canonical entity contracts

## 3.1 Practitioners

### Required model

`practitioners` represents internal and external clinical providers.

Minimum fields:

- `id INTEGER PRIMARY KEY`;
- `public_id TEXT NOT NULL`;
- `tenant_id TEXT NOT NULL`;
- `practitioner_type TEXT NOT NULL` with values such as `internal`, `external`, `technician`, `nurse`, `other`;
- `display_name TEXT NOT NULL`;
- `registration_no TEXT`;
- `is_active INTEGER NOT NULL`;
- audit fields.

Supporting links:

- `practitioner_user_links`;
- `practitioner_employee_links`;
- `practitioner_specialties`;
- `practitioner_departments`;
- `practitioner_identifiers`.

Rules:

1. A practitioner MAY exist without a user account.
2. A user account MUST NOT be treated as a practitioner unless an explicit link exists.
3. External referral doctors MUST migrate into practitioner/referral-source semantics.
4. Historical name snapshots MAY be stored on signed documents and financial lines, but they are display snapshots, not identity authority.

## 3.2 Encounters and appointments

### `appointments`

Purpose: planned scheduling and queue reservation.

Rules:

1. An appointment MAY exist without an encounter.
2. A no-show or cancelled appointment MUST NOT automatically create a completed encounter.
3. Walk-in care MAY create an encounter without an appointment.
4. Appointment billing fields are transitional and MUST NOT remain authoritative after invoice cutover.

### `encounters`

Purpose: actual care episode.

Required fields include:

- `public_id`, `tenant_id`, `patient_id`;
- optional `appointment_id`;
- `encounter_type`;
- `status`;
- `started_at`, optional `ended_at`;
- `business_date`;
- department/location context;
- audit fields.

Allowed lifecycle:

```text
planned → in_progress → completed
planned → cancelled
in_progress → cancelled
completed → corrected_by_addendum_only
```

Rules:

1. `encounters` is the canonical actual-care episode.
2. `visits` and `consultations` MUST migrate to encounter mappings and later become compatibility/read-only structures.
3. Clinical notes, diagnoses, prescriptions, orders, service events, and admission extensions SHOULD reference the encounter.
4. Signed encounter content is immutable; correction requires an addendum.

### `encounter_participants`

Minimum fields:

- `encounter_id`;
- `practitioner_id`;
- `role`;
- `is_primary`;
- optional `started_at`, `ended_at`;
- audit fields.

The role MUST be explicit. Generic doctor fallback is prohibited.

## 3.3 Admission and IPD

`admissions` is a one-to-one or constrained extension of an inpatient encounter.

Required relationships:

- `encounter_id`;
- `patient_id` consistent with encounter;
- admission/discharge timestamps;
- admitting and treating participants through encounter participant links;
- status and discharge lifecycle.

Admission lifecycle:

```text
planned → admitted → discharge_initiated → discharged
planned → cancelled
admitted → cancelled_with_audit
```

Rules:

1. Free-text referral doctor MUST be replaced by practitioner/referral-source links where resolvable.
2. Bed assignment MUST be represented by `bed_stays`, not by only the current `bed_id` on admission.
3. `bed_stays` MUST store rate/service snapshots and start/end periods.
4. Doctor rounds, procedures, diagnostics, medicine issues, and chargeable nursing activities MUST create idempotent service events when billable.
5. IPD provisional billing MUST be derived from un-invoiced active service events.
6. IPD ledger data MUST be rebuildable and MUST NOT be independently authored as a financial authority.

## 3.4 Service catalog

### `service_catalog_items`

Minimum fields:

- `id`, `public_id`, `tenant_id`;
- `code`, `display_name`;
- `category`, `service_kind`;
- `department_id` where relevant;
- `is_billable`, `is_active`;
- tax/discount policy references;
- audit fields.

Rules:

1. Each billable service has one canonical catalog identity.
2. Lab, radiology, consultation, bed, procedure, and pharmacy domain tables MAY extend or map to the catalog item.
3. Domain extension tables MUST NOT become a second authoritative current-price source.
4. Catalog deactivation MUST NOT modify historical service or invoice snapshots.

### `service_catalog_prices`

Minimum fields:

- `service_catalog_item_id`;
- `price_category_id`;
- `amount_minor`;
- `currency_code`;
- `effective_from`;
- optional `effective_to`;
- status/audit fields.

Rules:

1. Effective periods for the same tenant, item, and price category MUST NOT overlap.
2. Price selection is server-side and based on service date/context.
3. Price changes create a new row; posted historical prices are not edited.

## 3.5 Service requests

### `service_requests`

Represents an order/referral header.

Minimum fields:

- patient, encounter/admission context;
- requester practitioner;
- intent, priority, status;
- requested timestamp/business date;
- clinical reason;
- audit fields.

### `service_request_items`

Represents one requested service.

Minimum fields:

- `service_request_id`;
- `service_catalog_item_id`;
- quantity;
- requested status;
- ordering/referring context through participant links or explicit typed FKs;
- cancellation metadata;
- source mapping/idempotency.

Lifecycle:

```text
requested → accepted → fulfilled
requested → cancelled
accepted → cancelled
accepted → fulfilled
```

Rules:

1. One row represents one requested catalog item; multiple tests require multiple items.
2. Lab/radiology workflow details are stored in extension tables.
3. Billing and result statuses MUST NOT be stored as the request status.
4. For the current no-LIS hospital policy, a non-cancelled diagnostic request item MAY create an operational service event immediately according to tenant configuration.
5. Future LIS workflows may delay fulfillment without changing billing identity semantics.

## 3.6 Service events

`service_events` is the canonical delivered/chargeable service fact.

Minimum fields:

- `id`, `public_id`, `tenant_id`;
- `patient_id`;
- optional `encounter_id`, `admission_id`, `service_request_item_id`;
- `service_catalog_item_id`;
- `service_kind`;
- `quantity`;
- `occurred_at`, `business_date`;
- `status` with `active`, `cancelled`, `reversed` as applicable;
- price/name/category snapshots;
- `gross_amount_minor`, `discount_amount_minor`, `net_amount_minor`, `currency_code`;
- `source_type`, `source_public_id`;
- `idempotency_key`;
- audit/cancellation fields.

Rules:

1. `(tenant_id, source_type, source_public_id)` MUST be unique where a single source can create only one event.
2. `(tenant_id, idempotency_key)` MUST be unique.
3. Event amount snapshots are server-computed.
4. Event quantity MUST be positive for active events.
5. Cancellation MUST preserve the original row and reason.
6. `visit_services` MAY be a migration source but MUST NOT remain an independent authority after cutover.
7. Direct invoice lines without a service event require an explicitly allowed non-clinical event type and still create a service event/charge fact.

### `service_event_participants`

Minimum fields:

- `service_event_id`;
- `practitioner_id`;
- `role`;
- `is_primary`;
- `commission_eligible`;
- audit fields.

Rules:

1. Role values MUST be explicit.
2. The same practitioner MAY hold multiple roles if each role row is unique.
3. A missing required performer enters an assignment exception queue; the system MUST NOT silently use the referrer as performer.

## 3.7 Invoices and lines

### `invoices`

Minimum fields:

- `id`, `public_id`, `tenant_id`;
- patient and optional encounter/admission context;
- invoice number and fiscal context;
- status;
- issue timestamp/business date;
- subtotal, discount, tax, net, paid, due cached totals in minor units;
- currency;
- creator/counter/session context;
- cancellation/void/reversal metadata.

Lifecycle:

```text
draft → issued → partially_paid → paid
issued → voided
partially_paid → paid
issued/partially_paid/paid → adjusted_by_credit_note
```

Rules:

1. Draft invoices MAY change; issued invoices MUST be immutable except through controlled lifecycle actions.
2. Header totals MUST equal active line totals and persisted allocations/credits.
3. Category summary columns are not authoritative.
4. Invoice numbers are tenant/fiscal-scope unique.

### `invoice_lines`

Minimum fields:

- `invoice_id`;
- `service_event_id`;
- `service_catalog_item_id`;
- quantity;
- description/name/category snapshots;
- unit price, gross, discount, tax, net in minor units;
- status and cancellation metadata.

Rules:

1. `reference_id` without type is prohibited.
2. Each line MUST link to a canonical service event or explicitly approved adjustment event.
3. Line total arithmetic MUST be deterministic and tested.
4. Discounts MUST be allocated to lines using a documented rounding algorithm.
5. Tax and discount treatment for commissions MUST be explicit in rule snapshots.

## 3.8 Payments and allocations

### `payment_receipts`

Represents the patient-facing receipt/collection document.

Minimum fields:

- patient, tenant, receipt number;
- received timestamp/business date;
- total amount in minor units;
- status;
- collector/counter/session context;
- idempotency and external transaction identifiers;
- reversal metadata.

### `payment_tenders`

Represents tender components:

- cash;
- card;
- mobile wallet;
- bank transfer;
- gateway;
- approved other methods.

Tender total MUST equal receipt total.

### `payment_allocations`

Links a receipt amount to invoice or invoice line.

Minimum fields:

- `payment_receipt_id`;
- `invoice_id`;
- optional `invoice_line_id`;
- `amount_minor`;
- allocation/reversal status;
- audit fields.

Rules:

1. Total active allocations MUST NOT exceed active receipt value.
2. Invoice allocation MUST NOT exceed outstanding balance.
3. Collection reports MUST use persisted net allocations, not proportional reconstruction.
4. Reversal creates reversing rows or status-linked reversal records; original allocation remains auditable.
5. The legacy `payments` table becomes a migration source and compatibility view after cutover.
6. The legacy `income` table MUST cease to be a financial authority.

## 3.9 Deposits, credits, and refunds

1. Patient deposits are liabilities until applied.
2. Deposit receipt, application, refund, and reversal MUST be separate auditable records.
3. Deposit application MUST create an allocation to an invoice or line.
4. Credit notes MUST reference the original invoice/line/service context.
5. Refunds MUST trace to the original tender and allocation where possible.
6. Cash refunds MUST update cash custody within the same bounded transaction/outbox contract.
7. A refund MUST NOT directly mutate historical receipt amounts.

## 3.10 Practitioner compensation

### `commission_rules`

Rule dimensions include:

- tenant/branch;
- catalog item/category;
- practitioner role;
- fixed amount or basis points;
- calculation basis (`gross`, `net_after_discount`, `remaining_after_performer`, `collected`, or another approved basis);
- effective period;
- caps/minimums where approved.

Rules:

1. Rule periods MUST NOT overlap for the same scope and priority.
2. Rule evaluation order MUST be deterministic.
3. Rule snapshots MUST be stored on accrual creation.

### `commission_accruals`

Minimum fields:

- service event and/or invoice line;
- practitioner and role;
- rule/version snapshot;
- basis, rate/fixed amount, earned amount in minor units;
- lifecycle status;
- cancellation/reversal links;
- audit/idempotency.

Rules:

1. One unique accrual exists per service line, practitioner, role, and rule version.
2. The performer reserve is represented as an accrual type/stage, not an unrelated balance.
3. Referrer, performer, and treating doctor MUST NOT be inferred from each other.
4. Settlements allocate to accruals.
5. Paid accruals cannot be cancelled without an explicit payout reversal workflow.

## 3.11 Inventory

1. Stock truth is the sum of immutable stock movements.
2. Every movement MUST identify item, location, quantity, unit, movement type, source document, event timestamp, business date, and actor.
3. Batch/lot and expiry MUST be stored where applicable.
4. Purchase receipt, transfer, issue, sale, return, waste, expiry, and adjustment MUST use distinct movement types.
5. Current-balance cache MAY exist but MUST reconcile to movements.
6. Pharmacy dispense and sale MUST use idempotent source links to prevent duplicate stock-out.
7. Inventory valuation and selling price are separate concepts.

## 3.12 Cash and accounting

1. Cash custody records physical control of cash and MUST remain separate from revenue recognition.
2. Operational documents MUST create an outbox/accounting event within the same D1 batch as the source mutation.
3. Accounting posting MUST be idempotent.
4. Posted vouchers and journal lines are immutable.
5. Every posted voucher MUST balance debits and credits exactly in minor units.
6. Posting failure MUST enter retry/dead-letter state with operator visibility.
7. Expense approval, payment execution, cash movement, and accounting posting are separate states.
8. Payroll payable and payroll payment are separate facts.

## 4. Transaction boundaries

The following operations MUST be atomic at the canonical application level.

### 4.1 Record service event

Atomic batch:

- validate source/idempotency;
- insert service event;
- insert participant rows;
- insert outbox event;
- optionally create draft/unbilled charge projection metadata.

No invoice or commission side effect may be silently skipped without a recorded retry contract.

### 4.2 Issue invoice

Atomic batch:

- validate service events and tenant ownership;
- create invoice;
- create invoice lines;
- mark service events invoiced through a typed link/state;
- create commission accruals where issue-time rules apply;
- insert accounting/outbox event;
- write idempotency claim.

### 4.3 Collect payment

Atomic batch:

- validate outstanding balance and tender context;
- create receipt;
- create tender rows;
- create allocations;
- update invoice cached state deterministically;
- create cash custody movement for cash tender;
- create accounting/outbox event;
- write idempotency claim.

### 4.4 Refund or reverse

Atomic batch:

- lock/claim the source action by idempotency;
- create reversal/refund document;
- reverse allocations;
- create credit/cash custody effects;
- create commission adjustment/reversal where required;
- create accounting/outbox event;
- update derived invoice state.

### 4.5 Stock movement

Atomic batch:

- validate source claim and availability policy;
- insert stock movement;
- update/recompute cache if used;
- create service/financial link if sale or chargeable use;
- create outbox event.

D1 batch size and statement limits MUST be considered. Large backfills are not business transactions and MUST use checkpointed chunks.

## 5. Migration contracts

### 5.1 Additive-first requirement

1. Initial migrations MUST only add canonical structures, indexes, views, registries, and safe nullable links.
2. Existing production columns/tables MUST NOT be dropped or renamed during the first cutover wave.
3. New required columns on populated tables MUST be introduced nullable or with safe defaults, then backfilled and constrained in a later migration.

### 5.2 Production clone and rehearsal

Before production migration:

1. Run `wrangler d1 export <production-name> --remote --output=<timestamped-file>.sql`.
2. Create/use an isolated staging D1 database.
3. Import the export into staging.
4. Run migration and backfill twice.
5. Verify the second run performs no duplicate business insertions.
6. Run row-count, FK, orphan, money, and lifecycle reconciliation.
7. Preserve the reports with the task run record.

### 5.3 Backfill

Every backfill MUST:

- be tenant-scoped;
- process bounded ranges;
- record checkpoint and run ID;
- use deterministic source mapping;
- be restartable;
- record ambiguous rows in an exception table;
- avoid guessing practitioner roles or financial links;
- publish counts for scanned, created, skipped, mapped, and exception rows.

### 5.4 Shadow mode

Shadow writes MUST:

- preserve the primary legacy flow until the canonical path is proven;
- record canonical write failures in an issue table;
- expose lag/error dashboards;
- use identical server-side amount calculations intended for cutover;
- never claim financial reconciliation success while failures remain unresolved.

Non-blocking shadow mode is allowed only before cutover. Canonical-only mode MUST fail the business command if its authoritative write fails.

### 5.5 Cutover

Cutover requires:

- maintenance/read-only mode;
- current Time Travel bookmark/timestamp recorded;
- fresh full export;
- final delta backfill;
- zero unexplained financial differences;
- accepted operational exception list;
- feature flags switched by domain;
- smoke tests for patient registration, appointment, OPD, diagnostic bill/payment, IPD deposit/payment, refund, and reporting;
- written go/no-go decision.

### 5.6 Legacy retirement

A legacy table progresses through:

```text
active_legacy → shadowed → backfilled → reconciled → read_only → compatibility_view → archived → removed
```

Removal requires a separate approved migration and evidence that no route, report, export, sync worker, or integration reads/writes the table.

## 6. Reconciliation invariants

The following invariants are mandatory.

### Invoice

```text
invoice.subtotal_minor = SUM(active line gross_minor)
invoice.discount_minor = SUM(active line discount_minor)
invoice.tax_minor = SUM(active line tax_minor)
invoice.net_minor = SUM(active line net_minor)
invoice.paid_minor = SUM(active net payment allocations)
invoice.due_minor = invoice.net_minor - invoice.paid_minor - active credit applications
```

### Receipt

```text
receipt.total_minor = SUM(active tender amount_minor)
receipt.total_minor = SUM(active allocations) + unallocated_minor
```

### Deposit

```text
deposit balance = receipts - applications - refunds - reversals
```

### Practitioner payable

```text
payable = active accruals + adjustments - settlement allocations - reversals
```

### Stock

```text
stock balance = opening/migration movements + all signed quantity movements
```

### Cash custody

```text
drawer expected balance = opening + cash in - cash out - handovers + accepted adjustments
```

### Accounting

```text
SUM(debit_minor) = SUM(credit_minor) for every posted voucher
```

### IPD

```text
admission balance = invoiced charges - payment allocations - deposit applications - credits/refunds
```

### Service identity

```text
one eligible legacy source fact → at most one active canonical service event
one active invoice line → exactly one valid service/adjustment event
```

Any invariant failure MUST produce a classified exception or block cutover.

## 7. Reporting contracts

Each metric definition MUST be registered with:

- `metric_key`;
- label and description;
- canonical fact source;
- date basis;
- status filter;
- tenant scope;
- practitioner role semantics;
- quantity/amount expression;
- refund/cancellation rules;
- drill-down query/view;
- reconciliation check owner.

Dashboard code MUST import or call the same query/view used by its drill-down. Duplicated metric SQL in separate route files is prohibited unless generated from a shared contract.

## 8. CI and architecture enforcement

The repository MUST add automated checks for:

1. migration filename collisions and manifest order;
2. canonical tables missing from Drizzle exports;
3. authoritative money columns using `REAL`;
4. tenant-owned canonical tables missing text `tenant_id`;
5. generic `reference_id` without an approved typed companion contract;
6. direct route writes to registered legacy tables;
7. destructive SQL in non-retirement migrations;
8. missing indexes for tenant/date/FK hot paths;
9. missing idempotency constraints for financial commands;
10. missing reconciliation tests for invoice, payment, deposit, commission, stock, cash, and accounting;
11. new metrics without metric registry entries;
12. UTC/business-date contract violations.

A governance allowlist MAY exist for legacy tables during migration, but every exception MUST include an owner, reason, and removal phase.

## 9. Feature flags

Domain cutover flags MUST be tenant-scoped and separately control:

- canonical writes;
- shadow writes;
- canonical reads;
- reconciliation logging;
- legacy fallback reads.

A single global `new_database=true` switch is prohibited.

Recommended flag keys:

- `canonical_identity_v1`;
- `canonical_encounters_v1`;
- `canonical_service_events_v1`;
- `canonical_invoicing_v1`;
- `canonical_payments_v1`;
- `canonical_ipd_projection_v1`;
- `canonical_compensation_v1`;
- `canonical_inventory_v1`;
- `canonical_accounting_v1`;
- `canonical_reporting_v1`.

## 10. Local-server synchronization contract

Local-server sync remains disabled until cloud cutover is stable.

Before reactivation:

1. synced entities MUST use stable public IDs;
2. local and cloud schemas MUST expose compatible schema versions;
3. every mutation MUST carry idempotency and origin metadata;
4. outbox/inbox processing MUST be replay-safe;
5. mappings MUST exist for legacy integer IDs;
6. signed clinical and posted financial conflicts MUST not use blind last-write-wins;
7. sync workers MUST reject unknown future schema versions;
8. a full local upgrade and clone rehearsal MUST pass before reconnecting production.

## 11. Security and privacy

1. Staging clones containing patient data MUST be access-restricted.
2. Exports MUST be encrypted at rest or stored in an access-controlled environment.
3. Test logs MUST avoid exposing patient names, phone numbers, diagnoses, or identifiers.
4. Reconciliation reports SHOULD use IDs and aggregate amounts rather than unnecessary PHI.
5. Temporary clones/exports MUST have a documented retention and deletion policy.
6. Audit logs MUST record operator, tenant, command, source IDs, and outcome.

## 12. Table disposition requirements

| Current model | Required end state |
|---|---|
| `appointments` | retained as scheduling authority |
| `consultations` | migrated into encounter/session semantics and retired as independent authority |
| `visits` | compatibility/mapping layer, then retired or narrowed |
| `encounters` | promoted to canonical actual-care episode |
| `prescriptions.lab_tests` | stopped as write target; legacy display only |
| `tests` | archived after mapping to structured diagnostic facts |
| `lab_orders` / `lab_order_items` | migrated to service request header/items with lab extensions |
| radiology requisitions | migrated to service request/items with radiology extensions |
| `billing_service_items` | evolved/mapped to canonical service catalog |
| `visit_services` | migrated into canonical service events |
| `ipd_charges` | frozen and replaced by service events |
| `billing_provisional_items` | replaced as authority by un-invoiced service-event projection |
| `patient_bed_infos` | transformed into bed stays |
| `ipd_ledger_entries` | rebuilt as projection |
| `bills` | transformed/compatibility-mapped to invoices |
| `invoice_items` | replaced by typed invoice lines |
| `payments` | transformed/compatibility-mapped to receipts/tenders/allocations |
| `income` | retired as financial authority |
| doctor accrual/reserve tables | consolidated into role-based compensation accruals and settlements |
| cash ledger | retained as custody candidate and aligned with canonical events |
| old journal entries | retired after canonical accounting cutover |

## 13. Program definition of done

The program is complete only after all of the following are true:

- production data is migrated with zero unexplained financial variance;
- canonical facts cover all active modules;
- legacy writes are disabled;
- source-of-truth and metric registries are current;
- schema and migration CI gates pass;
- all domain commands have TDD coverage, idempotency tests, tenant-isolation tests, and failure-path tests;
- cutover and rollback runbooks have been rehearsed;
- production monitoring shows no unresolved shadow/canonical divergence for the observation period;
- local sync is either safely re-enabled under this contract or remains explicitly disabled;
- `task-progress.yaml` marks every implementation and retirement task completed with evidence.