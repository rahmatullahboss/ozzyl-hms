# Reception Family Member Flow and Mobile App Handoff

Date: 2026-05-17

## Context

In Bangladesh it is common for one mobile number to be used by a father, mother, child, or other dependent family member. The HMS must not treat mobile number as the only patient identity.

The system identity rule is:

- `patients.id` / PID is the real patient identity.
- `patients.mobile` is a lookup and contact field.
- One mobile number can belong to multiple patient profiles.
- Dues, advances, invoices, appointments, reports, and clinical records stay separate per patient/PID unless a future ledger design explicitly links them.

## Current Reception Flow

When reception opens the appointment/new patient modal and enters a mobile number:

1. The UI searches existing patients with the same normalized mobile number.
2. If matches exist, it shows a family profile list.
3. The operator can choose an existing profile when that person is the patient.
4. The operator can choose `+ Add New Family Member` when another person under the same mobile number needs a new profile.
5. In family-member mode, the mobile number stays the same, but the name, age, gender, and other patient fields are entered for the new patient.
6. Save creates a separate patient row with a new PID using the existing backend duplicate override path.

## Guardian Safety Invariant

Creating a family member must never overwrite, delete, or replace the original guardian patient profile.

Required behavior:

- Selecting `+ Add New Family Member` must create a new `patients` row.
- The original/guardian PID must remain unchanged.
- The original/guardian appointment, invoice, due, advance, report, and clinical history must remain attached to the original PID.
- The new family member must receive their own PID and must not reuse the guardian PID.
- The shared mobile number is only a grouping/search clue, not an ownership transfer.

Current implementation follows this by calling the patient create API with `duplicateOverrideReason` in family-member mode. That path inserts a new patient profile instead of updating the matching profile.

## Backend Notes

No migration was required for the current feature because:

- `patients.mobile` is not a unique key.
- Existing indexes support mobile lookup.
- The patient create schema already supports `duplicateOverrideReason`.
- The duplicate warning flow can be intentionally overridden for a clearly documented family-member case.

If a future feature needs a formal guardian/dependent relationship, add an explicit relationship table instead of overloading `mobile`.

Suggested future table concept:

```sql
CREATE TABLE patient_family_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL,
  guardian_patient_id INTEGER NOT NULL REFERENCES patients(id),
  member_patient_id INTEGER NOT NULL REFERENCES patients(id),
  relationship TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, guardian_patient_id, member_patient_id)
);
```

That future table should still keep money and clinical records PID-specific unless a separate family ledger feature is designed.

## Mobile App Handoff

For the patient mobile app, login by mobile number should not auto-open one patient record when multiple profiles share the same number.

Expected app behavior:

1. User enters mobile number and verifies OTP.
2. API returns all linked patient profiles for that mobile number.
3. App shows a profile picker, for example:
   - Abdur Rahman, Male, Age 35, PID-101
   - Karimul Islam, Male, Age 8, PID-102
   - Add / request link for another family member
4. User selects the patient profile they want to manage.
5. All bills, appointments, reports, prescriptions, and history are loaded by selected patient/PID.

Do not load reports, dues, or prescriptions using mobile number alone. Always scope patient data by selected PID after OTP verification.

## Accounting Rule

Current rule: accounting is separate per patient/PID.

Family grouping by mobile number must not combine dues or advance deposits automatically. A combined family wallet or combined due screen would need a separate product decision and ledger design.
