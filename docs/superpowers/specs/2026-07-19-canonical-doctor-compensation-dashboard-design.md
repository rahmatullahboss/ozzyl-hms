# Canonical-aligned Doctor Compensation Dashboard Design

**Date:** 2026-07-19

## Goal

Make the executive doctor-performance table show percentage referral/prescriber commission and fixed performer reserve as separate facts, while preserving one total test-compensation value and a stable API contract that can later be populated directly from canonical compensation tables.

## Business semantics

1. `referrerCommission` is the percentage/flat commission earned by the referring or prescribing practitioner. Performer rows must never be included in this amount or used to infer the referring practitioner.
2. `performerReserveCount` is the number of active diagnostic performer-reserve facts assigned to the practitioner.
3. `performerReserve` is the sum of active fixed performer reserves, including full-discount tests and both paid and unpaid reserves.
4. `testCommission` remains the backward-compatible total test compensation: `referrerCommission + performerReserve`.
5. `totalCommission` is `visitCommission + testCommission + otherCommission`.
6. An unassigned performer reserve remains under `Unassigned Doctor`; it is never inferred from the referrer, ordering doctor, or visit doctor.
7. Historical reserve facts are read from `diagnostic_performer_reserves`, not only from linked commission-accrual rows, so the 0505 backfill is visible even before payout linkage is created.

## Data model and query design

The existing legacy tables remain the production source until canonical cutover. The analytics query normalizes them into canonical semantics:

- Referrer/prescriber compensation: `doctor_commission_accruals` excluding `incentive_type = 'performer'`.
- Performer compensation: `diagnostic_performer_reserves` grouped by `assigned_doctor_id`.
- Referrer/prescriber entitlement: the legacy adapter normalizes each non-performer accrual from its persisted calculation inputs (`commission base × rate − doctor waiver`, or its persisted flat amount). It never reconstructs commission from report-time collection. After canonical cutover, the same response field is read directly from canonical earned/adjusted snapshots.
- Full-discount performer reserve: included in performer amount even when test collection is zero; any referrer entitlement remains whatever the persisted accrual inputs produce (normally zero for a fully discounted test).
- Attribution CTEs must ignore performer accruals when resolving test/referrer doctors.

The response contract maps directly to future canonical fields:

- `referrerCommission` ← referring/prescribing canonical compensation accrual entitlement.
- `performerReserveCount` and `performerReserve` ← performing-role fixed-reserve canonical accruals.
- `testCommission` ← sum of the two role-specific entitlements.

No production schema migration is required for this dashboard change.

## UI

The doctor-performance table will display:

- Doctor
- Visits
- Visit Collection
- Visit Commission
- Tests
- Test Collection
- Referrer Commission
- Performer Tests
- Performer Reserve
- Test Total
- Other Commission
- Total Commission

The table remains horizontally scrollable on small screens. Existing sorting remains unchanged. The drill-down uses the same role contract: test details label non-performer amounts as referrer commission, while the commission tab shows a Role column and reads performer reserve facts directly from the reserve ledger so reserve-only and unassigned items remain visible without duplicating linked performer accruals.

## Compatibility

`testCommission` is retained in the API and continues to represent total test-related compensation, preventing existing consumers from breaking. New consumers should use the role-specific fields for explanation and reconciliation.

## Verification

Regression coverage must prove:

- A performer reserve is not counted as referrer commission.
- Full-discount assigned reserve remains visible.
- Unassigned reserve stays unassigned.
- Reserve amount is subtracted once from the percentage commission base.
- Total test and total commission reconcile exactly.
- The UI renders all separate columns and values.
