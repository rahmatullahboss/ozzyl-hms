# P01 Clinical Current-State Audit

**Program:** HMS Canonical Data Architecture

**Audit type:** Read-only support audit

**Date:** 2026-07-13

**Base branch:** `origin/feature/hms-canonical-data-architecture`

**Base commit:** `18d1b0b4c156d40a6bcdd84c54a7ca13ae00886a`

**Worker branch:** `support/cdb-clinical-current-state-audit`

**Worktree:** `.worktrees/cdb-clinical-current-state-audit`
**Scope:** doctor/practitioner identity, appointment, consultation, visit, encounter, prescription, admission, bed stay, IPD doctor round, IPD charges, provisional billing, and IPD ledger.

## 1. Audit boundary and method

This report inventories the repository current state only. It does not change application code, schema declarations, migrations, `task-progress.yaml`, `.ai-bridge/current-plan.md`, Cloudflare resources, or any database.

Evidence reviewed:

- `task-progress.yaml`;
- canonical architecture design, specification, master plan, and implementation plan;
- `src/db/schema/*.ts`;
- relevant SQL migrations;
- active route and library write paths under `src/routes/` and `src/lib/`;
- focused unit, route, integration, sync, and data-integrity tests under `test/`.

The runtime database was not queried. Therefore, statements about declared columns and constraints are repository facts; statements about actual row counts, actual live foreign keys, orphan prevalence, and historical mapping are staging-verification questions rather than assumed facts.

## 2. Executive conclusions

1. **There is no canonical practitioner identity today.** Internal clinicians are represented mainly by the migration-defined `doctors` table, authentication is split across `users` and `doctor_auth`, and external referrers live in `external_referring_doctors`. The main Drizzle schema does not export `doctors`, even though many application routes write it directly.
2. **`appointments` is the clearest planning authority, but it is contaminated with billing authority.** It stores schedule/token/status plus original fee, discount, final fee, and billing status, while a parallel consultation charge is written to `billing_provisional_items`.
3. **Actual care is split across four competing episode models:** `consultations`, `visits`, `doctor_visits`, and `encounters`. A completed OPD consultation now creates a signed `encounters` row, but large parts of clinical data still attach to `visit_id`, and telemedicine continues to write `consultations` independently.
4. **`encounters` is the strongest future actual-care authority but is not yet complete.** It has signed snapshots and addenda, yet lacks an admission link, explicit participant roles, practitioner foreign keys, and universal adoption by clinical writers.
5. **Prescription authority is internally coherent at header/item level but incompletely attached to the care episode.** `prescriptions` can point to appointment or admission but has no direct canonical encounter key; the doctor completion workflow separately links a prescription to a signed encounter.
6. **IPD episode and bed facts are duplicated.** `admissions.bed_id`, `beds.status`, and `patient_bed_infos` all express current occupancy. `patient_bed_infos` also stores charge calculations and billed status, mixing bed-stay history with financial projection.
7. **IPD charge truth is distributed across at least five writable structures:** `visit_services`, `billing_provisional_items`, `patient_bed_infos`, `ipd_doctor_rounds`, and final `invoice_items`. The legacy `ipd_charges` table remains declared but has no active `src/` reader or writer.
8. **`ipd_ledger_entries` is explicitly supplementary, not authoritative.** The discharge-bill route catches ledger failures after bill commitment and continues. Some ledger charge rows are matched to finalized bills by category, description, and rounded amount rather than a stable source key.
9. **Foreign-key and tenant enforcement are inconsistent.** Many business references have no declared FK, most declared FKs are not tenant-composite, and historical migrations used `tenant_id INTEGER` while current Drizzle declarations generally use `tenant_id TEXT`.
10. **The canonical redesign should promote practitioners, encounters, service events, invoices, allocations, compensation accruals, and projections—not attempt to reconcile the current model by adding more cross-links among legacy authorities.**

## 3. Current authority by fact

| Fact | Current operational authority | Duplicate or competing facts | Audit assessment |
|---|---|---|---|
| Internal clinician profile | `doctors` | `users`, `doctor_auth`, copied doctor names, role-bearing IDs | No single identity authority; transform into practitioner registry. |
| External referring clinician | `external_referring_doctors` | `admissions.referral_doctor` free text, referral names in finance/billing | Separate identity silo; merge into practitioners. |
| Appointment plan/token | `appointments` | `consultations.scheduled_at`, queue entries, portal/marketplace copies | Keep appointment as planning authority. |
| Appointment price/discount | `appointments` plus `doctor_appointment_fees` | `billing_provisional_items`, service catalog price, doctor consultation fee | Duplicate money authority; appointment should retain quoted context only, not invoice truth. |
| Actual OPD care episode | Signed `encounters` for completed doctor workflow | `visits`, `consultations`, `doctor_visits`, completion claim | Promote encounters; map the other records as sources/compatibility. |
| Clinical note/diagnosis | Visit-linked note/diagnosis tables and signed encounter snapshot | Prescription clinical text, consultation notes, visit notes | Encounter should become the common episode link; signed source text must remain immutable. |
| Prescription | `prescriptions` + `prescription_items` | consultation prescription text, encounter prescription link, pharmacy prescription structures | Transform and attach to encounter; preserve signed/finalized versions. |
| IPD episode | `admissions` | IPD-shaped `visits` fields, admission fields copied to prescriptions/services | Transform admission as an inpatient encounter extension. |
| Bed master/status | `beds` | `admissions.bed_id`, `patient_bed_infos`, reservations | Keep bed resource; occupancy must derive from bed stays/reservations. |
| Bed-stay history | `patient_bed_infos` | `admissions.bed_id`, `beds.status`, `bed_charge_logs` | Transform into canonical `bed_stays`; remove financial authority from stay rows. |
| IPD doctor round clinical fact | `ipd_doctor_rounds` | provisional item and local-sync payload | Transform into clinical event plus explicit participant and linked service event. |
| IPD doctor round fee | `ipd_doctor_rounds.round_fee_snapshot` and linked provisional row | doctor master fee, fee rules, invoice item, compensation rows | Snapshot is useful source evidence; canonical service event/invoice line becomes financial authority. |
| Unbilled service charge | `billing_provisional_items` | `visit_services`, bed-stay charge fields, IPD round row, inventory consumption | Current operational authority only; replace with projection from uninvoiced service events. |
| Posted bill | `bills` + `invoice_items` | provisional status/cache fields, appointment billing status | Keep as source for canonical invoice backfill, then transform to canonical invoice/lines. |
| Payment/deposit/credit | `payments`, `billing_deposits`, credit-note/refund tables | IPD ledger copies and bill paid/due caches | Source documents remain authoritative; ledger becomes projection. |
| Admission balance/ledger | Recalculated from final financial documents, despite current UI use of `ipd_ledger_entries` | `ipd_ledger_entries`, provisional totals, bed totals, bill due caches | Replace ledger table authority with deterministic projection. |
| Practitioner compensation | commission rules/accruals/reserves/settlements and fraction tables | provisional doctor payable fields and copied names | Merge into one role-explicit compensation accrual model. |

## 4. Relevant table inventory and disposition

Disposition vocabulary:

- **Keep** — retain the business concept and current table initially, with additive hardening.
- **Transform** — preserve source rows but backfill to a stronger canonical structure.
- **Merge** — consolidate multiple identity/fact silos into one canonical entity.
- **Replace** — stop treating the table as authority; generate the behavior from canonical facts.
- **Archive** — retain read-only for lineage/audit after cutover.

### 4.1 Practitioner, doctor, scheduling, and compensation

| Table | Current facts and risks | Recommendation | Proposed canonical target |
|---|---|---|---|
| `users` | Authentication actor and application role. `tenant_id` is nullable. A doctor user is not guaranteed to have one `doctors` row, and a doctor row is not guaranteed to have a user. | Keep + Transform | `users` remains auth identity; add tenant-scoped `practitioner_user_links`. |
| `doctors` | Internal doctor profile, specialty, contact, consultation/IPD-round fees, marketplace profile, BMDC/qualifications, optional `user_id`. Created in migration with `tenant_id INTEGER`; not exported by main Drizzle schema. | Merge | `practitioners`, identifiers, specialties, departments, practitioner-user and practitioner-employee links. |
| `doctor_auth` | Parallel doctor credentials, lockout state, and direct `doctor_id`; duplicates the `users` authentication domain. | Replace + Archive | Standard user auth plus practitioner-user link; retain historical auth linkage only as migration evidence. |
| `external_referring_doctors` | External referrer name/contact/specialty; no registration identifier or link to internal doctor identity. | Merge | Practitioner with external/referrer capability and source mapping. |
| `doctor_schedules` | Legacy schedule/fee display data. | Transform | Practitioner availability/schedule keyed by practitioner public ID. |
| `doctor_shifts` | Tenant-scoped day/shift times, but `doctor_id` has no declared FK. | Transform | Practitioner schedule assignments. |
| `doctor_availability` | Date availability override, no declared practitioner FK or uniqueness. | Transform | Practitioner availability exceptions. |
| `doctor_daily_status` | Reception-facing daily status; another availability state. | Merge | One effective availability/status model with date/time validity. |
| `doctor_appointment_fees` | Appointment-type fee authority; changed by appointment fee-setup route. | Transform | Service-catalog consultation item plus effective price history and practitioner applicability. |
| `ai_doctor_preferences` | Uses text `doctor_id`, unlike most integer doctor IDs. | Transform | Practitioner preference keyed by canonical public ID. |
| `doctor_commission_rules` | Role-like `incentive_type` exists, but doctor identity is generic and source/service links are partial. | Transform | Versioned practitioner compensation rules with explicit role and service-catalog scope. |
| `diagnostic_performer_payout_rules` | Service-level performer reserve rule; no practitioner assignment at rule level. | Keep + Transform | Canonical compensation rule version linked to service item. |
| `diagnostic_performer_reserves` | Invoice-unit reserve with nullable assigned doctor; REAL amounts and copied test facts. | Transform | Practitioner compensation accrual/reserve linked to canonical service event and invoice line. |
| `doctor_commission_accruals` | Mixed source IDs, mixed integer/REAL money, role in `incentive_type`, and generic doctor ID. | Merge | One compensation accrual per service line/practitioner/role/rule version. |
| `doctor_commission_settlements` | Settlement header against generic doctor ID. | Transform | Practitioner settlement/payment document. |
| `doctor_commission_settlement_items` | Links settlement to accrual; identity remains generic. | Transform | Canonical settlement allocations. |
| `fraction_percents` / `fraction_calculations` | Second doctor/hospital split authority parallel to commission accruals. | Merge + Archive | Fold valid rules/results into canonical compensation; archive superseded calculations. |
| `billing_provisional_items.doctor_id`, `doctor_name`, `doctor_payable_amount` | Copied doctor and payable data without a role discriminator. | Replace | Service-event participants plus canonical compensation accrual. |

### 4.2 Appointment, consultation, visit, encounter, and prescription

| Table | Current facts and risks | Recommendation | Proposed canonical target |
|---|---|---|---|
| `appointments` | Best planning authority. Also stores fee, discount, final fee, billing status, referrer ID, and check-in state. Patient FK exists in Drizzle; doctor/referrer FKs are not declared there. | Keep + Transform | Canonical appointment for intent/schedule; practitioner request/referral links; quoted price context; billing through service/invoice facts. |
| `consultations` | Telemedicine/session schedule plus notes and free-text prescription. Independent from appointment/visit/encounter. `doctor_id` required but no declared FK. | Merge + Archive | Appointment modality/session metadata plus encounter mapping; clinical content migrated to encounter-linked records. |
| `visits` | General OPD/IPD wrapper with doctor, appointment, admission flags/numbers/dates, diagnosis codes, and status. It is written by many workflows. | Merge + compatibility view | Canonical encounter plus legacy source mapping. IPD fields map to admission/encounter, not a second episode. |
| `doctor_visits` | Separate minimal care record in `src/db/schema/doctor.ts`; duplicates doctor/patient/date/type/diagnosis/notes. | Merge + Archive | Encounter source mapping and migrated note/diagnosis facts. |
| `encounters` | Strongest future care authority: visit/appointment links, status, provider, signed snapshot, hash, signed-by/time, and addendum count. Missing admission link and explicit participants. | Keep + Transform | Canonical encounters with public IDs, admission extension, encounter participants, UTC/business date, and immutable signatures. |
| `encounter_addenda` | Append-only correction concept with hashes; author is generic integer. | Keep + Transform | Canonical encounter addenda with practitioner/user authorship and tenant-safe FK. |
| `consultation_completion_claims` | Idempotency/lease orchestration joining appointment, visit, doctor, SOAP, diagnosis, prescription, and encounter; many IDs have no declared FKs. | Transform + Archive after observation | Canonical command idempotency record, source mapping, and processing issue trail. |
| `clinical_notes` | Patient/visit-linked notes, optional performer, signing fields; no encounter FK. | Transform | Encounter-linked clinical document; explicit author/performer practitioner and actor user. |
| `final_diagnosis` | Visit-linked diagnosis; no encounter relation. | Transform | Encounter diagnosis/condition link. |
| `prescriptions` | Header with patient, doctor, appointment, optional admission, clinical fields, lock state, reconciliation/completion provenance. No direct encounter ID. | Keep + Transform | Encounter-linked medication order/prescription document with prescriber participant and immutable finalization. |
| `prescription_items` | Child medication lines; FK to prescription, optional medicine ID. | Keep + Transform | Canonical prescription/medication order items. |
| `prescription_versions` | Historical versions created by lock/version migration. | Keep + Transform | Immutable document version history. |
| `prescription_overrides` | Safety/override decisions. | Keep + Transform | Encounter/prescription safety override event with actor and reason. |
| `prescription_safety_checks` | Safety-check results tied to prescription/patient. | Keep + Transform | Canonical safety evaluation records. |
| `prescription_refill_requests` | Patient request workflow. | Keep + Transform | Service/request workflow linked to canonical prescription and patient identity. |
| `pharmacy_prescriptions` / `pharmacy_prescription_items` | Pharmacy-local prescription representation can duplicate clinical prescription facts. | Merge or explicit fulfillment projection | Link fulfillment/dispense to canonical prescription; do not duplicate prescriber intent. |
| `visit_services` | Writable service/charge layer with doctor ID, amounts, status, bill ID, and generic `reference_type/reference_id`. | Replace + Archive | Canonical service requests/events and typed source mappings. |

### 4.3 Admission, beds, IPD services, provisional billing, and ledger

| Table | Current facts and risks | Recommendation | Proposed canonical target |
|---|---|---|---|
| `admissions` | Current IPD authority, but combines episode status, current bed, treating doctor, free-text referrer, clinical diagnoses, guardian data, workflow flags, admission fee, package/billing mode, and discharge financial status. Most references lack declared FKs. | Keep + Transform | Admission as an extension of an inpatient encounter; explicit participants, typed referral, and separate financial workflow. |
| `beds` | Bed resource plus mutable status and current rate. No table-level uniqueness is declared in Drizzle. | Keep + Transform | Bed/location resource; effective bed pricing separate; occupancy derived from stays/reservations. |
| `patient_bed_infos` | Bed-stay history plus copied ward/bed/type/rate, calculated days/charge, and billed flags. No declared FKs. | Transform | Canonical `bed_stays`; copied labels/rate remain historical snapshots, charge/billed state moves to service/invoice facts. |
| `bed_charge_logs` | Manual recalculation audit with old/new days and amounts; no declared FKs. | Transform + Archive | Bed-stay adjustment/audit event; not a financial source of truth. |
| `bed_reservations` | Future allocation state. | Keep + Transform | Typed reservation linked to bed, patient/admission/appointment, and tenant. |
| `bed_features`, `bed_feature_map`, `bed_equipment_map` | Bed configuration/assignment support. | Keep | Canonical bed/resource metadata with tenant-safe references. |
| `ipd_doctor_rounds` | Clinical round and billing snapshot in one row; linked to provisional item, note/signature, and local sync. Missing declared FKs. | Transform | Clinical round event on inpatient encounter plus practitioner participant and linked service event. |
| `ipd_charges` | Generic amount/type/description table using REAL money. No active application reader/writer found in `src/`. | Replace + Archive | Backfill identifiable rows to service events; unresolved rows become migration exceptions. |
| `billing_provisional_items` | Current unbilled charge store; mutable status/cancel/bill link, copied names/prices/payables, generic `reference_id`, REAL money. Written by many domains. | Replace + Archive after cutover | Projection of uninvoiced canonical service events; historical source mappings retained. |
| `billing_service_items` / price-category map | Current service and price definitions, both with REAL money and potential competing prices. | Transform | Unified service catalog and effective price history in minor units. |
| `bills` | Posted bill header and cached totals/status. | Transform | Canonical invoice header derived from typed lines. |
| `invoice_items` | Posted lines with legacy category/reference semantics. | Transform | Typed canonical invoice lines linked to service events/adjustments. |
| `payments` | Payment records, but allocation semantics are limited/legacy. | Transform | Receipt/tender/allocation facts. |
| `billing_deposits` | Deposit receipt/application/refund/adjustment workflow. | Transform | Deposit liability and explicit applications/refunds. |
| `billing_credit_notes` / `billing_credit_note_items` | Credit documents and returned lines. | Keep + Transform | Immutable canonical credit note and allocations. |
| Refund/reversal support tables | Cash holds, approvals, and reversal workflows support financial corrections. | Keep + Transform | Typed reversal/refund documents linked to original allocations. |
| `ipd_ledger_entries` | Manually persisted debit/credit projection. Discharge route treats write failure as non-blocking. Linkage can use descriptive matching. | Replace + Archive | Deterministic admission ledger projection from service events, invoices, allocations, deposits, credits, and refunds. |

## 5. Active write-path inventory

The inventory below lists repository writers found by direct table mutation search. Read/report-only paths are omitted unless they also repair or mutate state.

### 5.1 Practitioner/doctor identity and configuration

| Writer | Mutation |
|---|---|
| `src/routes/doctor-auth.ts` | Registration inserts `doctors` and `doctor_auth`; login updates lockout counters. This creates a credential path separate from `users`. |
| `src/routes/public-invite.ts` | Links a doctor row to a user via `doctors.user_id`. |
| `src/routes/tenant/doctors.ts` | `POST /`, `PUT /:id`, publish/activate/deactivate, and invite flows insert/update `doctors`; dashboard workflows also mutate clinical episode tables. |
| `src/routes/marketplace-admin.ts` | Updates marketplace visibility and appointment status. |
| `src/routes/tenant/externalReferringDoctors.ts` | CRUD for `external_referring_doctors`. |
| `src/routes/tenant/appointments.ts` | `PUT /fee-setup/:doctorId` writes doctor appointment fee configuration. |
| doctor schedule/status routes | Maintain schedule, availability, and reception-facing doctor status in separate tables. |
| commission, reception payout, settlement, fraction, and billing-finalization services | Write commission rules/accruals/reserves/settlements/fraction rows using generic doctor IDs and role conventions. |

### 5.2 Appointments

| Writer | Mutation |
|---|---|
| `src/routes/tenant/appointments.ts` | `POST /` inserts appointment and then ensures a consultation provisional charge; failure triggers compensating hard delete. `PUT /:id`, check-in, delete/cancel, pay-now, due approval, and send-to-counter update appointment and/or provisional-billing state. |
| `src/routes/marketplace-patient.ts` | Creates marketplace appointment; cancel updates both appointment and billing status; telemedicine booking also creates `consultations`. |
| `src/routes/marketplace-admin.ts` | Updates appointment status. |
| `src/routes/tenant/patientPortal.ts` | Creates and cancels patient-portal appointments. |
| `src/routes/tenant/queue.ts` | Updates appointment and visit lifecycle statuses. |
| `src/routes/tenant/doctors.ts` | Completion, status, reassignment, and report-show review update appointment and visit; completion can create a signed encounter and prescription. |
| `src/routes/tenant/reception.ts` | Reception workflow creates walk-in visits/admissions and participates in appointment-related service creation. |
| local synchronization | `appointments` is a default cloud-pull table, so local replacement/upsert behavior is another effective state path outside normal domain commands. |

### 5.3 Consultations, visits, and encounters

| Writer | Mutation |
|---|---|
| `src/routes/tenant/consultations.ts` | `POST /`, `PUT /:id`, `PUT /:id/end`, and delete/cancel directly create/update `consultations`. |
| `src/routes/marketplace-patient.ts` | Inserts telemedicine `consultations` independently of the normal encounter lifecycle. |
| `src/routes/tenant/visits.ts` | Creates/updates/discharges `visits`; creation may insert `visit_services`. |
| `src/routes/tenant/appointments.ts` | Check-in creates or engages a visit and synchronizes appointment status. |
| `src/routes/tenant/doctors.ts` | Dashboard completion/status/reassignment updates visits; signed completion inserts an `encounters` row and marks appointment/visit complete. |
| `src/routes/tenant/queue.ts` | Mutates visit lifecycle (`engaged`, `concluded`, etc.) and appointment status. |
| `src/routes/tenant/nursing/opd.ts` | Creates walk-in visits and updates check-in/status/doctor/notes. |
| `src/routes/tenant/emergency.ts` | Inserts emergency visits. |
| `src/routes/tenant/reception.ts` | Inserts walk-in visits and visit service rows. |
| `src/routes/tenant/fhir.ts` | Imports/inserts visits, creating an interoperability write path. |
| `src/routes/tenant/clinical/encounters.ts` | Creates, updates, completes, soft-deletes encounters, and appends encounter addenda. |
| local synchronization | `visits` is in the default cloud-pull set; signed-round conflict protection does not establish equivalent signed-encounter command protection for every synced clinical table. |

### 5.4 Prescriptions

| Writer | Mutation |
|---|---|
| `src/routes/tenant/prescriptions.ts` | Creates prescription header/items; updates drafts, auto-save, finalization/lock, dispensing and related workflow state. |
| `src/routes/tenant/doctors.ts` | Doctor dashboard save/complete paths create/update prescriptions and items and connect the resulting prescription to the signed encounter snapshot. |
| `src/routes/tenant/orderSets.ts` | Creates prescription headers/items from order sets. |
| reconciliation and fulfillment routes/services | Link discharge medication reconciliation, refill, safety, fulfillment, and dispense states to prescription records. |

### 5.5 Admissions, beds, and bed stays

| Writer | Mutation |
|---|---|
| `src/routes/tenant/admissions.ts` | Bed CRUD/status; admission create/update/cancel; transfer/undo/receive; provisional, billing, credit, and normal discharge; doctor/procedure/police-case updates. Admission creation/transfer/discharge also inserts/closes `patient_bed_infos` and creates admission-fee provisional items. |
| `src/routes/tenant/reception.ts` | Quick admit inserts `admissions`, updates `beds`, inserts `patient_bed_infos`, and creates provisional/service rows. |
| `src/routes/tenant/dischargePlanning.ts` | Updates admission discharge workflow, closes current bed stay, and marks bed cleaning. |
| `src/routes/tenant/ipBilling.ts` | Final discharge updates admission and bed; closes/bills bed stays; can manually adjust/delete an unbilled bed charge projection. |
| `src/routes/tenant/deathRecords.ts` | Discharges admission, closes bed stay, and marks bed cleaning. |
| `src/routes/tenant/nursing/assignments.ts` | Assigns nurse on admission. |
| `src/lib/bed-allocation.ts` | Reserves, locks, releases, and occupies beds. |
| `src/lib/bed-charges.ts` | Recalculates `patient_bed_infos` days and charge amount in place. |
| local synchronization | `beds` and `admissions` are default cloud-pull tables; generic replacement can bypass a single admission/bed-stay command boundary. |

### 5.6 IPD doctor rounds

| Writer | Mutation |
|---|---|
| `src/routes/tenant/ipdDoctorRounds.ts` | `POST /`, `POST /clinical`, and `POST /:id/cancel` call the doctor-round service. |
| `src/lib/ipd-doctor-rounds.ts` | In one D1 batch inserts `ipd_doctor_rounds`, inserts linked `billing_provisional_items`, back-links `provisional_item_id`, writes audit, and optionally writes local outbox records. Cancellation updates both round and provisional item. Clinical signing updates round/note state. |
| `src/routes/sync.ts` | Custom cloud/local upsert and repair path for rounds and linked provisional items; protects signed rounds from overwrite, but remains a second writer. |

### 5.7 Service charges, provisional billing, and finalization

| Writer | Mutation |
|---|---|
| `src/routes/tenant/billingProvisional.ts` | Single/batch provisional item create, cancel, and pay/finalize flow. This is the explicit general provisional-billing command surface. |
| `src/routes/tenant/appointments.ts` | Creates/updates/cancels consultation-fee provisional items alongside appointment changes. |
| `src/routes/tenant/admissions.ts` and `src/routes/tenant/reception.ts` | Create admission fee and other IPD provisional rows. |
| `src/routes/tenant/ipBilling.ts` | Adds manual IPD provisional service, finalizes rows into bill/invoice items, adjusts bed-charge projections, and marks rows/beds billed. |
| `src/lib/ipd-doctor-rounds.ts` and `src/routes/sync.ts` | Create/repair/cancel doctor-round provisional rows. |
| `src/lib/inventory-issue-atomic.ts` | Creates a provisional billing line as part of chargeable stock issue. |
| `src/routes/tenant/inventory/returns.ts` | Updates provisional billing on return. |
| `src/routes/tenant/billingCancellation.ts` | Cancels provisional items. |
| `src/routes/tenant/lab.ts`, `src/routes/tenant/ot.ts`, `src/routes/tenant/reception.ts`, `src/routes/tenant/visits.ts`, and `src/lib/lab-cancellation-operation.ts` | Insert/update/cancel `visit_services`, a second service-charge fact layer. |
| final billing routes/services | Convert provisional/service facts into `bills` and `invoice_items`, then create payments/deposit/credit/accounting side effects. |
| local synchronization | `billing_provisional_items`, service catalogs, bills, invoice items, payments, and deposits are in the cloud-pull set; provisional items also have custom round repair logic. |

### 5.8 IPD ledger

| Writer | Mutation |
|---|---|
| `src/routes/tenant/ipBilling.ts::createIpdLedgerEntry` | Inserts a charge ledger row when a manual IPD provisional item is added. |
| `src/routes/tenant/ipBilling.ts` discharge-bill flow | Updates pre-existing charge rows to attach the bill by matching admission/patient/category/description/rounded amount, then inserts bed-charge, discount, payment, deposit-deduction, and deposit-refund ledger rows. |
| Error behavior | Ledger finalization is inside a separate `try/catch`; failure is logged but does not roll back the committed discharge bill. This proves the table is a best-effort projection, not financial authority. |

### 5.9 Legacy `ipd_charges`

No active `INSERT`, `UPDATE`, `DELETE`, or read reference was found under `src/`. The table exists in migration and Drizzle declarations only. Staging must determine whether it is empty, historical, or populated by an external/disabled integration before archival.

## 6. Doctor-role ambiguity

The recurring `doctor_id` field does not answer four separate questions: which person, which identity system, which role in the event, and which actor performed the database action.

| Location | Current meaning | Ambiguity/risk | Canonical treatment |
|---|---|---|---|
| `appointments.doctor_id` | Scheduled/consulting doctor | Not necessarily ordering, performing, or billing beneficiary. | Appointment requested practitioner role. |
| `appointments.external_referring_doctor_id` | External referrer | Separate table and no declared FK in Drizzle. | Practitioner participant with `referring` role. |
| `consultations.doctor_id` | Telemedicine consultant | Independent from appointment/encounter and `created_by` is text. | Encounter participant `consulting/treating`. |
| `visits.doctor_id` | Visit doctor | Could mean assigned, treating, or last reassigned doctor. | Encounter participant history with effective interval/role. |
| `encounters.provider_id` | Provider | Generic name, no practitioner FK; signed-by is a different generic integer. | Explicit practitioner participant plus actor user for signature. |
| `prescriptions.doctor_id` | Prescriber | No direct encounter key; `created_by` can differ. | Encounter participant `prescribing`; actor user separately recorded. |
| `admissions.doctor_id` | Current doctor | Does not distinguish admitting vs attending vs consultant; reassignment overwrites history. | Admission/encounter participants with roles and effective intervals. |
| `admissions.referral_doctor` | Referrer free text | Cannot safely map to internal/external doctor without staging evidence. | Practitioner referrer link or unresolved migration issue. |
| `ipd_doctor_rounds.doctor_id` | Round-performing doctor | Stronger role semantics, but copied name and provisional payable are separate. | Service-event participant `performing` and encounter participant `consulting/treating` as configured. |
| `clinical_notes.performer_id`, `signed_by`, `created_by` | Performer/author/signer | IDs may refer to doctor or user depending on field convention. | Typed practitioner and actor-user links. |
| procedure/order fields such as `ordered_by` and `performed_by` | Ordering/performing person | Generic integers and inconsistent identity namespace. | Explicit `ordering` and `performing` practitioner roles. |
| provisional/visit service `doctor_id` | Doctor attached to charge | Role not stored; copied name/payable can be stale. | Service-event participant with required role. |
| commission accrual `doctor_id` + `incentive_type` | Payee and role | Role exists but source identity/service link can be incomplete. | Compensation accrual keyed to canonical service line, practitioner, role, and rule version. |
| diagnostic performer reserve `assigned_doctor_id` | Payee selected later | Nullable performer can be mistaken for referrer in reporting. | Missing performer remains unassigned/exception; never infer from referrer. |
| `doctor_auth.doctor_id`, `doctors.user_id`, and `users.role='doctor'` | Identity/auth links | Can be missing, duplicated, or inconsistent. | One practitioner registry with explicit one-to-many/temporal links and uniqueness rules. |

Required rule for the redesign: **never infer a missing performer, prescriber, or treating practitioner from a referrer or from the actor user.** Missing roles must remain null/unassigned and surface as reconciliation issues.

## 7. Foreign-key, tenant, time, money, and integrity risks

### 7.1 Foreign keys and source identity

- Many core references have no declared FK in the current Drizzle schema: doctor IDs, admission links, current bed links, round links, provisional source links, and ledger source links.
- Where FKs exist, they usually target only `id`, not `(tenant_id, id)`. A child can therefore carry tenant A while pointing to a valid row ID owned by tenant B unless every writer validates ownership.
- `billing_provisional_items.reference_id` is untyped. Its meaning changes by `item_category`.
- `visit_services.reference_type/reference_id` is only conventionally typed and not constrained to a target table.
- `ipd_ledger_entries` has nullable payment/bill/deposit/credit-note IDs without declared FKs or uniqueness/idempotency.
- `consultation_completion_claims` joins many lifecycle records with no declared referential actions.
- Table-rebuild migrations for `appointments`, `visits`, and `ipd_doctor_rounds` may not preserve every historical FK/index exactly. Runtime `sqlite_master` and `PRAGMA foreign_key_list` are required before trusting repository declarations.

### 7.2 Tenant ownership

- Historical migrations created several tables with `tenant_id INTEGER`, while current canonical policy and Drizzle declarations use `TEXT`.
- `users.tenant_id` is nullable, which is valid for platform users but unsafe as an implicit practitioner-tenant link.
- Many indexes are single-column or omit tenant ID; uniqueness often does not prove tenant-local ownership.
- Copied `patient_id`, `admission_id`, `visit_id`, and `doctor_id` on the same row can disagree even if each ID exists.
- Generic sync can replace rows in default cloud-pull tables outside normal domain commands. Tenant checks exist in parts of sync code, but canonical public IDs and source mappings are still required.

### 7.3 Time and business date

- Timestamps mix `CURRENT_TIMESTAMP`, `datetime('now', '+6 hours')`, date-only values, numeric timestamps, and application-generated ISO UTC.
- Operational business date is often inferred from local timestamps rather than persisted explicitly.
- Canonical rows need UTC occurrence time plus tenant-derived business date; migration must not rewrite signed historical timestamps.

### 7.4 Money and units

- Money uses a mixture of INTEGER and REAL.
- Historical comments conflict: the `doctors.consultation_fee` migration describes paisa, while the appointment migration describes fee as taka. Application behavior frequently treats values as display currency amounts.
- Appointment price, doctor fee setup, service catalog price, provisional price, bed-stay charge, round fee, invoice line, commission base, and ledger amount can each become a separate numeric authority.
- Canonical posted money must use integer minor units plus `currency_code`; every source table requires an explicit unit-conversion rule and reconciliation report.

### 7.5 Idempotency and atomicity

- Appointment create uses request idempotency but performs a compensating hard delete if provisional-charge creation fails rather than one atomic command batch.
- Doctor completion has a strong claim/lease pattern, but SOAP, diagnosis, prescription, encounter, appointment, and visit are coordinated through a long orchestration path rather than one general canonical command framework.
- Doctor-round create/cancel is comparatively strong because round and provisional row are in one D1 batch, but sync is an additional writer.
- IPD ledger writes are intentionally non-blocking after bill commitment, so they cannot be used for correctness or financial reconciliation.
- Descriptive matching used to attach ledger charge rows to a bill can collide when two equal charges share category/name/amount.

## 8. Proposed canonical mappings

### 8.1 Practitioner identity

| Current source | Canonical mapping |
|---|---|
| `doctors` | `practitioners` base row; BMDC and other registrations to `practitioner_identifiers`; specialty/department to typed links; profile/contact snapshots retained. |
| `doctors.user_id` and role-bearing `users` | `practitioner_user_links` with tenant, validity, source row, and conflict status. |
| HR employee/person records when present | `practitioner_employee_links`; do not assume user ID equals employee ID. |
| `doctor_auth` | Map credential owner to existing user where deterministic; ambiguous/duplicate credentials become processing issues; archive the source after auth cutover. |
| `external_referring_doctors` | Practitioner row with external/referrer capability and source mapping. |
| free-text doctor/referrer names | Deterministic match only with approved identifiers/tenant evidence; otherwise unresolved issue, never name-only auto-merge. |

### 8.2 Appointment and encounter

| Current source | Canonical mapping |
|---|---|
| `appointments` | Canonical appointment as planned intent; preserve source ID, token, schedule, status history, modality, and quoted price context. |
| `consultations` | Telemedicine session/modality metadata plus encounter source mapping; clinical notes/prescription text migrate to encounter-linked documents where deterministic. |
| `visits` | Canonical encounter source mapping; status/type/time become encounter fields; duplicate admission fields map to admission evidence, not a second authority. |
| `doctor_visits` | Merge to encounter/note/diagnosis if deterministically unique; otherwise archive with issue. |
| existing `encounters` | Promote to canonical encounter; retain signed snapshot/hash/addenda; add participants and admission link. |
| `consultation_completion_claims` | Migrate completed source links to mapping/idempotency evidence; incomplete/failed claims become processing issues. |
| appointment/visit doctor fields | Encounter/appointment practitioner participants with explicit role and source provenance. |

Grouping rules must explicitly handle appointment no-show, appointment without visit, walk-in visit, telemedicine consultation, multiple visits for one appointment, and already-signed encounter. Ambiguous many-to-many episodes must not be guessed.

### 8.3 Prescription and clinical documents

| Current source | Canonical mapping |
|---|---|
| `prescriptions` + items | Encounter-linked prescription/medication order; prescriber participant; preserve lock/finalization/version provenance. |
| appointment/admission links | Resolve to encounter through deterministic source mappings; retain original link as provenance. |
| free-text `lab_tests` or consultation prescription text | Preserve as historical document text; do not treat as structured order without deterministic parsed source evidence. |
| clinical notes/diagnosis | Re-key to canonical encounter; preserve signed content and addenda unchanged. |

### 8.4 Admission and bed stay

| Current source | Canonical mapping |
|---|---|
| `admissions` | Canonical admission extending an inpatient encounter; admission/discharge state, source, type, and care-team participants are separated from billing state. |
| `admissions.bed_id` | Transitional current-bed cache only; canonical current bed is the open bed stay. |
| `beds` | Canonical bed/resource linked to ward/location; rate moves to service price history. |
| `patient_bed_infos` | Canonical `bed_stays` with start/end, bed, admission, patient, and historical snapshots. |
| `days`, `charge_amount`, `is_billed`, `billed_bill_id` | Do not migrate as bed-stay authority; reconcile to service events/invoice lines and retain source values for audit. |
| `bed_charge_logs` | Bed-stay adjustment/audit history or migration exception evidence. |

### 8.5 IPD services, billing, and ledger

| Current source | Canonical mapping |
|---|---|
| `ipd_doctor_rounds` | Clinical round event on inpatient encounter; practitioner participant; one linked billable service event when policy/rule says chargeable. |
| `visit_services` | Service request/event source mapping, using typed source identity. |
| `billing_provisional_items` | Backfill each deterministic row to a service event and source mapping; after cutover, render provisional billing as uninvoiced service-event projection. |
| `ipd_charges` | Map identifiable rows to service events; unresolved generic rows become exceptions; archive table. |
| bed-stay charge fields | Generate daily/periodic bed service events according to approved pricing policy, not by mutating stay balance fields. |
| `bills`/`invoice_items` | Canonical invoices and typed lines linked to service events/adjustments. |
| payments/deposits/credits/refunds | Canonical receipts, tenders, allocations, deposit applications, credits, and reversals. |
| `ipd_ledger_entries` | Do not backfill as independent financial truth. Rebuild admission ledger from canonical facts, compare to legacy, classify variance, then archive legacy rows. |
| commission/fraction/provisional payable fields | Canonical practitioner compensation accruals linked to service line, practitioner, participant role, and rule version. |

## 9. Keep / Transform / Merge / Replace / Archive summary

| Recommendation | Tables/concepts |
|---|---|
| **Keep** | `users` auth role, appointment planning concept, existing signed encounter/addendum evidence, prescription header/items/version evidence, bed resource, final bills/invoice lines/payment/deposit/credit source documents. |
| **Transform** | `doctors`, schedules/availability/fees, appointments, existing encounters, prescriptions, admissions, beds, patient bed stays, IPD rounds, service catalog/prices, bills/payments/credits, compensation settlements. |
| **Merge** | `doctors` + external referrers + user/employee links into practitioners; consultations + visits + doctor visits into encounters/source mappings; commission/fraction/reserve models into compensation. |
| **Replace** | `doctor_auth` as a separate credential authority; `visit_services` and `billing_provisional_items` as service authority; bed charge fields as financial authority; `ipd_ledger_entries` as balance authority. |
| **Archive** | Legacy consultations/visits/doctor visits after compatibility period; `ipd_charges`; superseded provisional/service rows; legacy ledger; unmapped or ambiguous source rows with documented exception IDs. |

## 10. Staging-data verification questions

All staging checks must return IDs and aggregates only. They must not emit names, phone numbers, diagnoses, notes, prescription text, or other PHI.

### 10.1 Runtime schema and constraints

1. What are the exact `sqlite_master` definitions and `PRAGMA table_info`, `foreign_key_list`, and `index_list` outputs for every table in sections 4.1–4.3?
2. Which tables have `tenant_id` stored as integer values, text values, mixed SQLite storage classes, null, or empty string?
3. Did rebuild migrations preserve the intended FKs and partial unique indexes for appointments, visits, and IPD rounds?
4. Are foreign keys enabled on all D1 execution paths, and are there existing `foreign_key_check` violations?

### 10.2 Practitioner identity

1. Count internal doctors by tenant, active state, presence of `user_id`, BMDC/registration, and auth record.
2. Identify duplicate `(tenant_id, user_id)`, duplicate registrations within tenant, and registrations shared across tenants.
3. Count `users.role='doctor'` without a doctor row, doctors linked to non-doctor users, and doctor/user tenant mismatches.
4. Count `doctor_auth` rows with missing doctor, tenant mismatch, duplicate email/phone ownership, or no equivalent user.
5. Determine whether any `external_referring_doctors` deterministically match internal doctors by approved identifier; name-only similarity must be reported, not merged.
6. For every generic doctor/provider field, determine empirically whether values resolve to `doctors.id`, `users.id`, both, or neither.

### 10.3 Appointment-to-encounter grouping

1. Count appointments with zero, one, or multiple visits.
2. Count visits with no appointment, multiple visits sharing one appointment, and visit/appointment patient or tenant mismatch.
3. Count consultations with no matching appointment/visit/encounter and multiple consultations for the same patient/doctor/time window.
4. Count signed encounters with no visit, no appointment, no completion claim, no prescription where one is expected, or mismatched patient/doctor/tenant.
5. Count appointments marked completed without a signed encounter and signed encounters whose appointment/visit is not completed.
6. Count duplicate candidate episodes across `doctor_visits`, `visits`, `consultations`, and `encounters` by tenant/patient/doctor/date, returning only source IDs.
7. Verify whether encounter uniqueness on `(tenant_id, appointment_id)` holds for all historical data, including null appointment IDs.

### 10.4 Prescription linkage

1. Count prescriptions by linkage shape: appointment only, admission only, both, neither, completion claim, and signed encounter reference through encounter.
2. Detect patient/tenant/doctor mismatch among prescription, appointment, admission, visit, encounter, and completion claim.
3. Count multiple active/final prescriptions per appointment/encounter and determine approved business semantics.
4. Identify orphan prescription items, invalid medicine IDs, duplicate source reconciliation IDs, and completion-claim collisions.
5. Determine whether consultation free-text prescription or `prescriptions.lab_tests` contains historical facts not represented in structured items/orders; preserve as text if not deterministic.

### 10.5 Admission and bed stays

1. Count active admissions with no open bed stay, multiple open bed stays, or current `admissions.bed_id` different from the open stay.
2. Count beds marked occupied without an open stay and open stays whose bed is not occupied.
3. Detect overlapping stays for the same bed and tenant, overlapping stays for one admission, end-before-start rows, and cross-tenant references.
4. Compare patient/admission/bed IDs on every stay to the parent records.
5. Recalculate days/amount using the approved policy and compare with stored `days`/`charge_amount`; classify package-included days and manual adjustments separately.
6. Count stay rows marked billed without a valid bill and valid finalized bed invoice lines without a linked stay/source mapping.

### 10.6 IPD rounds and provisional service facts

1. Count active rounds with no provisional item, cancelled rounds with active provisional item, and provisional doctor-round rows with no round.
2. Detect multiple provisional rows for one round, multiple rounds linked to one provisional row, and mismatched tenant/admission/patient/doctor/amount/status.
3. Profile `billing_provisional_items.item_category` and the target meaning/distribution of `reference_id`; identify collisions where the same number refers to different source tables.
4. Profile `visit_services.reference_type/reference_id` and identify duplicate service facts also represented in provisional items or invoice lines.
5. Count provisional rows with invalid patient/admission/visit/appointment/doctor/bill IDs or cross-tenant parents.
6. Count finalized/billed provisional rows without invoice lines and invoice lines whose legacy reference cannot be resolved.
7. Determine whether `ipd_charges` has rows, who created them, and whether any row can be deterministically matched to provisional, visit-service, or invoice facts.
8. For chargeable inventory issues/returns, confirm one stock-out and one service event/invoice path, with no duplicate provisional line.

### 10.7 Financial and ledger reconciliation

1. Rebuild each active and recently discharged admission balance from source documents:
   - service/invoice debit;
   - payment allocations;
   - deposit applications/refunds;
   - credit notes/reversals/refunds.
2. Compare that balance to bill header caches, current UI totals, and `ipd_ledger_entries` totals. Every variance needs a stable exception ID.
3. Detect duplicate ledger rows created by equal category/description/amount matching and ledger rows linked to the wrong bill.
4. Count committed bills whose ledger finalization failed or produced no expected rows; logs may be needed because ledger failure is non-blocking.
5. Verify that provisional charges are not counted again when finalized and that bed charges are not counted from both stay projections and invoice lines.
6. Reconcile doctor-round fee snapshots, provisional line totals, invoice line totals, reserve/accrual amounts, settlements, waivers, credits, and reversals.
7. Determine the actual currency unit of every legacy integer and REAL amount using controlled sample aggregates and known configured prices; do not infer from column comments alone.

### 10.8 Local synchronization

1. Compare cloud/local schema versions and row ownership for default pull tables in this scope.
2. Detect primary-key collisions across origins and rows replaced without canonical public/source IDs.
3. Count signed clinical records protected from overwrite versus other clinical records still subject to generic replacement.
4. Reconcile round/provisional outbox messages against cloud rows and identify duplicate delivery, missing linkage, or divergent status.

## 11. Suggested aggregate-only staging checks

The staging audit implementation may use equivalent queries generated from metadata. These examples intentionally return IDs/counts only.

```sql
-- Runtime type profile for tenant ownership.
SELECT typeof(tenant_id) AS storage_type, COUNT(*) AS row_count
FROM appointments
GROUP BY typeof(tenant_id);
```

```sql
-- Appointment-to-visit cardinality.
SELECT a.tenant_id, a.id AS appointment_id, COUNT(v.id) AS visit_count
FROM appointments a
LEFT JOIN visits v
  ON v.tenant_id = a.tenant_id AND v.appointment_id = a.id
GROUP BY a.tenant_id, a.id
HAVING COUNT(v.id) <> 1;
```

```sql
-- Active admission/open-stay mismatch.
SELECT a.tenant_id, a.id AS admission_id,
       a.bed_id AS admission_bed_id,
       COUNT(pbi.id) AS open_stay_count,
       MAX(pbi.bed_id) AS open_stay_bed_id
FROM admissions a
LEFT JOIN patient_bed_infos pbi
  ON pbi.tenant_id = a.tenant_id
 AND pbi.admission_id = a.id
 AND pbi.ended_on IS NULL
WHERE a.status = 'admitted'
GROUP BY a.tenant_id, a.id, a.bed_id
HAVING COUNT(pbi.id) <> 1
    OR MAX(pbi.bed_id) IS NOT a.bed_id;
```

```sql
-- Round/provisional one-to-one reconciliation.
SELECT r.tenant_id, r.id AS round_id, r.provisional_item_id,
       COUNT(pi.id) AS matching_items
FROM ipd_doctor_rounds r
LEFT JOIN billing_provisional_items pi
  ON pi.tenant_id = r.tenant_id
 AND pi.item_category = 'doctor_round'
 AND pi.reference_id = r.id
GROUP BY r.tenant_id, r.id, r.provisional_item_id
HAVING COUNT(pi.id) <> 1
    OR MAX(pi.id) IS NOT r.provisional_item_id;
```

```sql
-- Legacy ledger aggregate versus linked source dimensions; no PHI fields.
SELECT tenant_id, admission_id,
       ROUND(SUM(debit_amount), 2) AS debit_total,
       ROUND(SUM(credit_amount), 2) AS credit_total,
       ROUND(SUM(debit_amount) - SUM(credit_amount), 2) AS legacy_balance,
       COUNT(*) AS entry_count
FROM ipd_ledger_entries
GROUP BY tenant_id, admission_id;
```

## 12. Existing test coverage and gaps

Observed coverage includes:

- appointment token/fee/idempotency and provisional-charge failure cleanup;
- doctor lifecycle and consultation completion claims;
- signed encounter CRUD/addenda and clinical route validation;
- prescription finalization, allergy/safety, reconciliation, and read permissions;
- IPD doctor-round schema, idempotency, cancellation, clinical signing, and local-sync conflict protection;
- IP billing calculations, provisional add/finalization, bed-charge adjustment, package cases, and discharge billing;
- local sync route behavior and selected signed-round protection.

Gaps relevant to the canonical program:

1. No one test fixture proves deterministic grouping across appointment, consultation, visit, doctor visit, signed encounter, prescription, and admission.
2. No one test proves tenant-composite referential integrity for the full clinical/IPD graph.
3. No staging-backed test proves every generic doctor ID’s identity namespace and role.
4. No one invariant proves exactly one service event/charge across `visit_services`, provisional rows, bed charges, rounds, inventory, and invoice lines.
5. No one test rebuilds an admission ledger solely from source documents and proves zero variance against all active admissions.
6. Existing source-contract tests cannot establish the actual live D1 FK/index shape after table rebuilds.
7. Local-sync tests protect signed IPD rounds specifically, but the broader clinical cutover still requires canonical public IDs, replay-safe commands, and conflict policy for all signed/posted records.

## 13. Recommended migration order for this scope

1. Establish canonical practitioner registry, identifiers, and user/employee/external-referrer links.
2. Promote canonical encounters and participant roles; map appointments, consultations, visits, doctor visits, and admissions without changing production reads.
3. Attach clinical notes, diagnoses, prescriptions, signed snapshots, and addenda to canonical encounters while preserving original content.
4. Transform `patient_bed_infos` into bed stays and separate resource occupancy from bed service pricing.
5. Create service catalog, requests, and service events; backfill rounds, bed services, visit services, provisional rows, and other IPD activities with typed source mappings.
6. Create canonical invoices, payment allocations, deposits, credits/refunds, and practitioner compensation.
7. Shadow-render provisional billing and IPD ledger from canonical facts; compare every active staging admission.
8. Cut over writes by domain flag only after zero unexplained clinical cardinality and financial variance.
9. Freeze legacy writers, retain compatibility views/adapters, observe, then archive legacy authorities. No first-cutover drop is recommended.

## 14. Final audit decision

The repository is ready for the next **staging-data verification and canonical mapping design tasks**, but not for direct destructive consolidation.

The supported target is:

- `appointments` for planned intent;
- `practitioners` plus explicit links and roles for clinician identity;
- `encounters` plus admission extension and bed stays for care episodes;
- service requests/events for performed work;
- canonical invoices, allocations, deposits, credits/refunds for financial truth;
- role-explicit practitioner compensation;
- provisional billing and IPD ledger as projections.

All ambiguous historical identity, episode, performer, service, and ledger mappings must be emitted as staging reconciliation issues rather than guessed.
