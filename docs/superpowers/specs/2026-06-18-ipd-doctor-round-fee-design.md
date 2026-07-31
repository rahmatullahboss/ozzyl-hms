# IPD Doctor Round Fee Design

**Date:** 2026-06-18
**Status:** Approved design

## Problem

The HMS stores a doctor-specific outpatient consultation fee, but it has no
doctor-specific IPD round fee. Existing IPD charge entry supports only generic
room, nursing, and other charges and does not identify the doctor who performed
a round. As a result, reception cannot reliably charge the configured fee for
the actual visiting doctor, and a nurse-recorded doctor round cannot create a
traceable provisional billing item.

The existing Nurse Station "Vitals Round" is a separate clinical monitoring
workflow. Recording vitals must never create a doctor round charge.

## Goals

- Configure an IPD round fee for each doctor independently of consultation fees.
- Allow an unlimited number of doctor rounds for an active admission; every
  submitted round creates one charge.
- Allow nurses to record a doctor round with its actual date and time.
- Allow reception and other authorized billing users to add a doctor round from
  IPD Billing by selecting the visiting doctor.
- Automatically create exactly one IPD provisional billing item for each round.
- Preserve the doctor, fee snapshot, entry source, entering user, billing link,
  and cancellation history for reporting and audit.

## Non-goals

- Changing the existing Vitals Round or linking vitals submission to billing.
- Automatically scheduling rounds or limiting rounds per doctor or per day.
- Allowing users to type or override a doctor's round fee during entry.
- Automatically calculating doctor payouts or commissions in this change.
- Capturing clinical notes. Clinical documentation continues through the
  existing nursing and doctor note workflows and is not duplicated in billing.

## Data Model

### Doctor fee

Add `ipd_round_fee` to `doctors`. The value is stored in BDT using the same
normalized money convention as the current consultation fee. A missing or zero
fee means the doctor cannot be selected for a billable IPD round.

### Doctor round record

Add a dedicated `ipd_doctor_rounds` table rather than overloading generic
`ipd_charges`. Each row contains:

- tenant, admission, and patient identifiers
- visiting doctor identifier
- `rounded_at TEXT NOT NULL`, containing the selected round date and time in
  `YYYY-MM-DD HH:mm:ss` Asia/Dhaka wall-clock format
- immutable doctor name and round fee snapshots
- entry source: `nurse_station` or `ipd_billing`
- entered-by user identifier
- `idempotency_key TEXT NOT NULL`, generated once by the client for a deliberate
  round submission
- linked provisional billing item identifier
- status: `active` or `cancelled`
- cancellation reason, cancelled-by user, and cancellation timestamp
- created and updated timestamps

The table is tenant-scoped and indexed by admission/time and doctor/time. It has
`UNIQUE(tenant_id, idempotency_key)` and a unique partial index on the linked
provisional item when that value is present. Repeated HTTP delivery of one
submission returns the existing round and linked charge. A deliberate new
submission generates a new key and therefore creates another charge, including
on the same day for the same doctor and admission.

Because this table must work in cloud and local installations, the change adds
a numbered D1 migration and updates `tenant-schema.sql`. A local-server round
write also appends immutable outbox events for the round and linked provisional
item. The corresponding audited cloud ingest mappers are part of this change.
Their payloads contain only identifiers, timestamps, fee/name snapshots,
billing status, source, and idempotency data. There is no clinical-note field in
the round table, API contract, audit payload, billing item, or sync payload.

### Time convention

The UI collects a Bangladesh-local date and time. The server parses and
validates it explicitly in `Asia/Dhaka` using the shared date utilities, then
stores `rounded_at` as `YYYY-MM-DD HH:mm:ss` Bangladesh local time, matching the
existing HMS/D1 convention. The API and local/cloud sync preserve that exact
normalized value; neither the browser timezone nor Worker runtime timezone may
reinterpret it. Displays label the value as Bangladesh time where context is
not otherwise clear.

## Server Workflow

Use one shared round-creation service for Nurse Station and IPD Billing:

1. Authorize the role and tenant.
2. Validate that the admission is active and belongs to the supplied patient.
3. Validate that the selected doctor is active and belongs to the tenant.
4. Read `doctors.ipd_round_fee`; reject missing or zero fees.
5. Validate `rounded_at` and the client idempotency key.
6. Build one D1 atomic batch containing the round insert, provisional item
   insert, reciprocal linkage, audit insert, and, on a local server, both
   metadata-only outbox inserts.
7. Execute that batch as the sole write boundary for round creation. Every
   statement must succeed or the entire batch rolls back; none of these writes
   may be performed later with fire-and-forget helpers.
8. On an idempotency conflict, load and return the existing round and linked
   provisional item without issuing a second billing insert.
9. Return both identifiers and the captured fee.

The provisional item stores admission, patient, doctor, doctor name, quantity
one, captured unit price, and a readable item name such as
`IPD Round - Dr. Name`. Final invoices continue through the existing
provisional-to-final billing workflow.

The API never trusts a client-supplied doctor name or fee.

### Billing category integration

`doctor_round` remains the line-level category in provisional and final invoice
items so reports can distinguish IPD rounds from OPD consultation. Finalization
must add `doctor_round` to the discharge invoice category mapper instead of
falling back to `other`. The shared billing category total normalizer maps
`doctor_round` into `doctorVisitBill`, so its value contributes to
`bills.doctor_visit_bill` and is never omitted from category totals. IPD billing
filters, printable invoice labels, and category-based reports must recognize
and label `doctor_round` explicitly. Focused tests cover both the retained line
category and the doctor-bill aggregate.

## User Experience

### Doctor profile

Show `IPD Round Fee` beside the existing consultation fee in doctor create/edit
and self-profile forms. The value must be a non-negative whole BDT amount.

### Nurse Station

Add a distinct `Doctor Round` action for an admitted patient. The form contains:

- patient/admission context, read-only
- doctor search and selection, required
- round date, default today
- round time, default current local time and editable
- displayed configured fee, read-only

Submission shows one success result covering both the saved round and its
provisional charge. The existing bulk Vitals Round remains unchanged.

### IPD Billing

Add `Doctor Round` as a first-class charge action. The receptionist selects the
visiting doctor, date, and round time. The configured fee is displayed and
cannot be edited. Submission uses the same server workflow as Nurse Station.

The admission's billing view shows each round separately with doctor, round
date/time, fee, entry source, entered-by user, and billing status.

## Authorization And Cancellation

- Nurses may create doctor rounds from Nurse Station.
- Receptionists and existing authorized IPD billing roles may create doctor
  rounds from IPD Billing.
- Hospital admins, MDs, and directors may cancel an active round.
- Cancellation requires a reason and never deletes the round.
- If the linked provisional item is still provisional, cancellation atomically
  marks both the round and provisional item cancelled.
- If the linked item is finalized or paid, direct cancellation is rejected and
  the existing billing reversal/refund workflow must be used.

All create and cancel operations are audit logged. Audit payloads contain only
round/billing metadata and never clinical documentation.

## Error Handling

Reject creation with a clear user-facing error when the admission is inactive,
the patient/admission pair is invalid, the doctor is inactive, the round fee is
not configured, or the timestamp is invalid. A failed atomic batch leaves no
round, provisional item, linkage, audit row, or outbox event. Retrying the same
idempotency key returns the original successful result.

## Reporting

Round list responses expose the captured doctor name and fee, not mutable
current profile values. This supports accurate admission history and future
doctor-wise round revenue or payout reporting without changing historical fees.

## Testing

Focused backend tests cover:

- tenant, role, admission, patient, and doctor validation
- fee lookup and immutable snapshot behavior
- one round producing exactly one provisional item
- same-day repeated rounds producing separate charges
- idempotent retry not producing a duplicate charge
- tenant-scoped idempotency uniqueness under concurrent retry
- nurse and reception sources using the same creation rules
- cancellation of provisional items and rejection after finalization
- Vitals Round submission producing no doctor-round charge
- `doctor_round` retained on invoice lines and included in `doctorVisitBill`
- Asia/Dhaka normalization independent of browser/runtime timezone
- atomic rollback when linkage, audit, or outbox insertion fails

Frontend tests cover doctor fee editing, nurse round form defaults and payload,
IPD Billing doctor selection, read-only fee display, round time entry, success
state, and validation errors. Migration SQL is checked for SQLite/D1 syntax and
fresh local schema parity.

## Acceptance Criteria

1. A doctor can have a round fee different from the consultation fee.
2. Reception can add any number of rounds for an admitted patient by selecting
   the actual visiting doctor; every round appears as a separate provisional
   charge at that doctor's captured fee.
3. A nurse can submit Doctor Round with an editable round date/time and the same
   provisional charge is created automatically.
4. Submitting vitals alone never creates a bill.
5. Retrying one submission never duplicates its charge, while a deliberate new
   round always creates a new charge.
6. Historical round fees do not change when a doctor's configured fee changes.
7. Authorized cancellation preserves an audit trail and keeps round and billing
   statuses consistent.
