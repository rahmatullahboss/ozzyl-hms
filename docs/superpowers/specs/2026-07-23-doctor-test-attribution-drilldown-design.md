# Doctor Test Attribution and Drilldown Design

Date: 2026-07-23
Status: Approved for implementation

## Problem

The executive dashboard currently mixes three different concepts in doctor and test analytics:

1. referral attribution, which determines which doctor referred a test and may receive referral commission;
2. clinical ordering, which identifies the clinician who prescribed or ordered the test;
3. data entry, which identifies the user who entered the order in the software.

The current `Ordering Doctor` value is derived from `lab_orders.ordered_by`. That field stores a user ID, not a guaranteed doctor ID. Reception-created orders therefore show a receptionist as the ordering doctor, while users without a linked doctor profile may appear as unassigned. This makes the dashboard clinically misleading.

The Doctor Performance table also exposes earned, waiver and payable compensation without showing the existing `testCommission` amount as a separate column. The Test Performance drawer shows billed test lines but does not summarize which doctors referred or performed the selected test.

## Goals

- Show `Test Commission` immediately after `Test Collection` and before `Earned` in Doctor Performance.
- Keep referral, clinical-order and entry-user meanings separate.
- Prevent receptionist or other non-clinical users from appearing as an ordering doctor.
- Add separate doctor-wise referral and performer drilldowns for each test.
- Preserve the existing canonical/legacy reporting provider boundary and all current date, tenant, pagination and money-unit contracts.
- Avoid changing commission ownership or recalculating historical financial values merely to improve labels and drilldowns.

## Non-goals

- Do not promote canonical reads or change shadow/strict feature flags.
- Do not change commission percentages, waiver rules, performer reserve rules or settlement status.
- Do not rewrite historical bill or commission ownership.
- Do not treat the user who entered an order as a clinician.
- Do not merge referring and performing attribution into one ambiguous doctor field.

## Domain model

### Referring Doctor

The doctor to whom the test referral and referral commission are attributed. The existing resolved referral precedence remains the financial source of truth unless a separately reviewed attribution migration changes it.

### Ordering Clinician

The clinician who clinically prescribed or ordered the test. This value is valid only when the source user is linked to an active doctor/clinician profile or when another explicit clinical-order reference exists. A receptionist or generic staff account must never be displayed as an ordering clinician.

### Entered By

The authenticated user who entered or created the order in the software. This is operational audit information. It may be a receptionist, doctor, laboratory user or another authorized staff member.

### Performing Doctor

The doctor or practitioner credited with performing the test or receiving performer reserve/compensation. This is separate from referral attribution.

## Doctor Performance table

The compensation columns must appear in this order:

1. Test Collection
2. Test Commission
3. Earned
4. Doctor Waiver
5. Payable
6. Paid
7. Outstanding

`Test Commission` uses the existing `DoctorPerformanceRow.testCommission` major-unit BDT value. The first implementation does not add a new sort contract unless the backend already supports a safe `testCommission` doctor sort. If sorting is added, it must be implemented consistently in both legacy and canonical providers and covered by route contract tests.

The table subtitle must make the formula clear without implying that test commission alone equals payable. Earned remains the complete earned compensation amount; test commission is one component of the evidence.

## Doctor detail drawer

The doctor drawer will expose these tabs:

### Visits

Existing visit detail behavior remains unchanged.

### Referred Tests

Shows test lines attributed to the selected referring doctor. Columns:

- time;
- test;
- patient;
- referring doctor;
- ordering clinician;
- invoice;
- test collection;
- test commission;
- status/accession where available.

`Ordering Clinician` is blank or `Not recorded` when no valid clinician attribution exists. It must never fall back to a generic user name.

### Performed Tests

Shows test lines attributed to the selected performing doctor. Columns:

- time;
- test;
- patient;
- performing doctor;
- referring doctor;
- invoice;
- performer reserve/compensation;
- result or workflow status.

### Compensation Ledger

Existing ledger behavior remains, with labels aligned to test commission, performer reserve, earned, waiver, payable, paid and outstanding meanings.

### Audit detail

`Entered By` may appear as a secondary audit field or expandable metadata. It must not occupy the primary clinical doctor column and must not affect referral or performer totals.

## Test Performance drawer

Clicking a test opens a drawer with summary cards and three tabs.

### Summary

Show selected-period totals for:

- quantity;
- billed;
- collected;
- due;
- test commission;
- referring doctor count;
- performing doctor count.

### Referred By

Doctor-wise grouped rows for the selected test:

- referring doctor;
- referred quantity;
- billed amount;
- collected amount;
- due amount;
- test commission;
- discounted quantity/discount amount where available.

Unassigned referral attribution appears as an explicit `Unassigned Referring Doctor` row rather than being silently excluded.

### Performed By

Doctor-wise grouped rows for the selected test:

- performing doctor;
- performed quantity;
- performer reserve/compensation;
- completed/pending counts where available.

Unassigned performer attribution appears separately.

### All Test Lines

Retains line-level evidence and expands it to show:

- time;
- patient;
- referring doctor;
- ordering clinician;
- entered by as audit metadata;
- performing doctor where known;
- invoice;
- billed;
- collected;
- due;
- test commission;
- performer reserve;
- status/accession.

## Data resolution rules

### Referral attribution

Continue using the reviewed referral/commission attribution source. Do not substitute `ordered_by` for referral attribution.

### Ordering clinician resolution

Resolve in this order:

1. an explicit clinician/doctor reference attached to the clinical order, if present;
2. the doctor profile whose `user_id` equals `lab_orders.ordered_by`;
3. a reviewed visit/prescription doctor reference when the order is demonstrably generated from that clinical encounter;
4. otherwise null.

Do not fall back from doctor profile to the generic `users.name` value for the clinician label.

### Entered-by resolution

Resolve directly from `lab_orders.ordered_by` to the user record and label it `Entered By`. Existing records keep their audit user identity.

### Performing attribution

Use the reviewed performer accrual/reserve or explicit performed-by source. Referral commission rows must not be counted as performer attribution.

## Write-path correction

New order creation must preserve both concepts:

- the authenticated creator/user ID for audit;
- the clinical doctor ID or linked doctor identity when a clinician actually orders the test.

Where the current schema has only `ordered_by`, implementation must introduce the smallest backward-compatible schema extension needed to store explicit clinical attribution without repurposing or destroying the existing audit value. New columns must be additive and nullable during rollout.

Reception-created orders should record the receptionist as creator/entered-by and use the visit/referral doctor only in the appropriate referral or clinical field. A receptionist must never be copied into a doctor field.

## Historical backfill

Backfill must be conservative and evidence-based:

- map `ordered_by` to ordering clinician only when the user has an unambiguous doctor profile in the same tenant;
- use prescription/visit linkage only when the relationship is deterministic;
- leave ambiguous historical rows unassigned;
- never infer a doctor from a receptionist name;
- never change referral commission ownership, payment status or ledger amounts;
- produce aggregate before/after evidence and an unresolved-count report.

If a schema migration is required, it must be additive, rehearsed against a production export and compatible with both the current baseline Worker and the release candidate during staged rollout.

## API design

Existing endpoints remain compatible. New response fields must be additive.

Expected additions include explicit fields such as:

- `orderingClinicianId` and `orderingClinicianName`;
- `enteredByUserId` and `enteredByName`;
- `performingDoctorId` and `performingDoctorName`;
- doctor-grouped test detail responses for `referred`, `performed` and `lines` views.

The exact endpoint shape may use tabs on the existing detail endpoint or dedicated nested endpoints, but it must preserve tenant scoping, reporting-period filters, pagination, source contract metadata and major-unit BDT values.

## UI behavior

- All doctor/test names that open evidence remain keyboard-accessible buttons.
- Tabs expose loading, error and empty states independently.
- Wide tables remain horizontally scrollable with the identity column sticky.
- `Not recorded`, `Unassigned Referring Doctor` and `Unassigned Performing Doctor` must be semantically distinct.
- English and Bangla labels must be added together.
- The drawer must explain that referral, ordering, entry and performance are different roles.

## Testing

### Backend

- receptionist-created order does not resolve receptionist as ordering clinician;
- doctor-created prescription order resolves its linked doctor as ordering clinician and user as entered-by;
- referral attribution remains unchanged;
- performer attribution excludes referral-only commission rows;
- historical ambiguous rows remain unassigned;
- grouped referred/performed totals reconcile to line-level totals;
- legacy and canonical provider responses preserve contract parity where both are supported;
- tenant/date/pagination boundaries remain enforced.

### Frontend

- Doctor Performance renders `Test Commission` after `Test Collection` and before `Earned`;
- doctor drawer exposes `Referred Tests`, `Performed Tests` and `Compensation Ledger`;
- generic staff names never render under `Ordering Clinician`;
- Test Performance drawer exposes `Referred By`, `Performed By` and `All Test Lines`;
- grouped totals, empty states, pagination and accessibility controls are covered;
- English and Bangla locale files parse and render expected labels.

### Release

- focused analytics and reception/prescription tests;
- TypeScript and production builds;
- canonical governance checks;
- migration rehearsal and production ledger verification when applicable;
- candidate-bound authenticated smoke for admin/MD/director/reception roles;
- canonical reconciliation remains zero through staged deployment.

## Acceptance criteria

1. Doctor Performance visibly shows Test Commission between Test Collection and Earned.
2. No receptionist or generic staff user is displayed as an ordering doctor/clinician.
3. Referring Doctor, Ordering Clinician, Entered By and Performing Doctor have separate fields and labels.
4. A selected test provides doctor-wise `Referred By` and `Performed By` summaries plus complete line evidence.
5. A selected doctor provides separate referred and performed test tabs.
6. Doctor-wise grouped totals reconcile to line-level totals for the same tenant and period.
7. Existing compensation amounts and ownership are unchanged by the attribution-label correction.
8. Ambiguous historical attribution remains explicitly unassigned rather than guessed.
9. Any migration is additive, backward-compatible and verified before traffic promotion.
10. Canonical shadow/legacy authority settings remain unchanged by this feature.
