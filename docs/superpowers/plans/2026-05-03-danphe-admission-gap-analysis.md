# DanpheEMR Admission/Discharge Gap Analysis

**Date:** 2026-05-03
**Team:** admission-review
**Reference:** DanpheEMR ServerModel + HMS migrations 0012, 0015, 0035, 0181, 0182, 0188

---

## 1. BillStatusOnDischarge — Billing Integration Gap

| Aspect | DanpheEMR | HMS |
|--------|-----------|-----|
| Field | `BillStatusOnDischarge` (string, on AdmissionModel) | **MISSING** — no equivalent field on admissions table |
| Tracking | Stored on admission row; checked before discharge allowed | HMS has `billing_discharge_on/by` timestamps but no BillStatus enum |
| Clearance flow | Billing team marks status before discharge completes | Provisional discharge + billing-discharge endpoint exists but no BillStatus field |

**Recommendation:** Port from DanpheEMR. Add `bill_status_on_discharge TEXT` to admissions table with values `'pending'`, `'cleared'`, `'settled'`. Add a pre-discharge check endpoint that reads provisional items + settlements for the admission and returns whether billing is cleared. This is the single most important billing-ADT integration gap.

---

## 2. Secondary Doctor / Consulting Doctor Tracking

| Aspect | DanpheEMR | HMS |
|--------|-----------|-----|
| Primary doctor | `AdmittingDoctorId` on AdmissionModel | `doctor_id` on admissions |
| Secondary doctor | `SecondaryDoctorId` + `SecondaryDoctor` on `PatientBedInfoVM` | **MISSING** — only single doctor_id |
| Consultants list | `DischargeSummaryConsultants` (ADTDischargeSummaryConsultantModel) attached to discharge summary | Consultant attachment exists via `discharge_summary_consultants` table but only stores role; no name/ specialty tracked |

**Recommendation:** Hybrid approach. HMS already has `discharge_summary_consultants` — enhance it to store specialty and department, matching DanpheEMR's consultant role structure. For secondary doctor on admission, add `secondary_doctor_id` to `patient_bed_infos` (not admissions, since patient can transfer beds and each bed assignment can have a different attending).

---

## 3. Insurance Patient ClaimCode and Balance Tracking

| Aspect | DanpheEMR | HMS |
|--------|-----------|-----|
| ClaimCode | `Int64? ClaimCode` (incremental, max+1) on AdmissionModel `[NotMapped]` | **MISSING** — no claim code tracking |
| NSHI number | `Ins_NshiNumber` `[NotMapped]` on AdmissionModel | **MISSING** — patient has insurance policy/member IDs but not NSHI |
| Insurance balance | `Ins_InsuranceBalance` `[NotMapped]` — real-time balance check | **MISSING** — no real-time balance tracking on admission |
| IsInsurance flag | `IsInsurancePatient` (stored DB field) | Exists via `insurance_schemes` / `patient_insurance` joins |

**Recommendation:** Keep HMS approach for `IsInsurancePatient` (join-based is cleaner). Port `ClaimCode` — add `claim_code TEXT` to admissions and increment via sequence. Add `insurance_balance` computed field (read from patient_insurance.credit_limit minus provisional items) for display on admission slip.

---

## 4. AdmissionNotes / AdmissionOrders Field Separation

| Aspect | DanpheEMR | HMS |
|--------|-----------|-----|
| AdmissionNotes | Free-text nursing/doctor notes on AdmissionModel | `notes` column exists on admissions (free-text) |
| AdmissionOrders | **Separate** free-text field for doctor orders | **MISSING** — orders are co-mingled into `notes` or not captured separately |
| Display | Separate UI sections for notes vs. orders | Single notes field |

**Recommendation:** Low priority to port — HMS could add `admission_orders TEXT` column via migration if clinical workflow demands it. Currently `notes` serves both purposes. Only port if clinical staff specifically requests order tracking separate from general notes.

---

## 5. DischargeConditionId and Discharge Type Lookup Gaps

| Aspect | DanpheEMR | HMS |
|--------|-----------|-----|
| Condition ID | `DischargeConditionId` (int FK) on DischargeSummaryModel | `discharge_condition_id` on admissions — exists |
| Condition name | Looked up via `DischargeConditionId` JOIN | `discharge_condition_types` lookup table exists |
| Death types | `DeathTypeId` + `DeathPeriod` on DischargeSummaryModel | `death_types` table + `death_details` table — exists |
| Delivery types | `DeliveryTypeId` on DischargeSummaryModel | **MISSING** — delivery type not tracked in maternity flow |
| Baby birth conditions | `BabyBirthConditionId` on DischargeSummaryModel | `baby_birth_conditions` table exists — used in birth details |
| Discharge type | `DischargeTypeId` on DischargeSummaryModel | `discharge_type` text field exists |

**Recommendation:** HMS already has lookup tables for death_types, baby_birth_conditions. Add `delivery_type_id` + `delivery_type` to baby_birth_details and link to a `delivery_types` lookup table. This is a maternity-specific gap and lower priority.

---

## 6. PatientBedInfo — RequestingDepartmentId per Bed Assignment

| Aspect | DanpheEMR | HMS |
|--------|-----------|-----|
| Requesting dept | `RequestingDeptId` (int, `[NotMapped]`) on AdmissionModel — per bed info | **MISSING** — patient_bed_infos has no department_id field |
| Primary doctor | `PrimaryDoctor` on PatientBedInfoVM | `doctor_id` on admissions (only) |
| Bed info history | Full history via `PatientBedInfos` list on AdmissionModel | `patient_bed_infos` table exists — each row tracks started_on, ended_on, charge |

**Recommendation:** HMS already has rich bed info tracking. Add `department_id` + `department_name` to `patient_bed_infos` table. This enables department-aware bed billing and nursing workflow per bed assignment.

---

## 7. Care-of-Person — Relation Field on Admission

| Aspect | DanpheEMR | HMS |
|--------|-----------|-----|
| CareOfPersonName | `CareOfPersonName` on AdmissionModel | `care_of_name` on admissions |
| CareOfPersonPhoneNo | `CareOfPersonPhoneNo` — full phone | `care_of_phone` on admissions |
| CareOfPersonRelation | **Separate** relation field on AdmissionModel | `care_of_relation` on admissions — **MISSING migration** |

**Recommendation:** Port from DanpheEMR — add `care_of_relation` column to admissions table. This was already specified in schema but may be missing from the actual migration (check 0177_admission_guardian_fields.sql).

---

## 8. Provisional Discharge — Clearance Tracking

| Aspect | DanpheEMR | HMS |
|--------|-----------|-----|
| Provisional discharge flag | `IsProvisionalDischarge` + `IsProvisionalDischargeCleared` — both tracked separately | `is_provisional_discharge` — single flag |
| Clearance workflow | Doctor marks provisional, billing clears via separate step | `provisional_discharges` table + `clear_provisional` endpoint — equivalent |
| Billing integration | `BillStatusOnDischarge` gates final discharge | HMS provisional flow is more advanced with checklist |

**Recommendation:** HMS already has superior provisional discharge workflow. No changes needed — HMS tracks billing_status separately in `provisional_discharges` table.

---

## 9. DischargeSummary — Missing Clinical Fields

| Field | DanpheEMR | HMS |
|-------|-----------|-----|
| `ProcedureNotes` | `ProcedureNts` on DischargeSummaryModel | **MISSING** |
| `DiagnosisFreeText` | `DiagnosisFreeText` on DischargeSummaryModel | **MISSING** |
| `ProvisionalDiagnosis` | Separate from final diagnosis | `provisional_diagnosis` on admissions but NOT in discharge_summaries |
| `DischargeSummaryTemplateId` | `DischargeSummaryTemplateId` — dynamic templates | `template_id` column exists on discharge_summaries |
| `PastHistory` | `PastHistory` on DischargeSummaryModel | `past_history` column added via migration 0181 |
| `Consultants` list | `DischargeSummaryConsultants` (list) | Exists via `discharge_summary_consultants` table |

**Recommendation:** Add `procedure_notes TEXT` and `diagnosis_free_text TEXT` to discharge_summaries table via migration. HMS schema is already comprehensive for discharge summaries — these two fields are the main gaps.

---

## 10. Admission Source and Case Type Classification

| Aspect | DanpheEMR | HMS |
|--------|-----------|-----|
| Admission source | Part of `AdmitSource` enum on admission | `admit_source` field + `referral_doctor` column on admissions — exists |
| Admission case | `AdmissionCase` (string) on AdmissionModel | **MISSING** — case type not tracked |
| Procedure type | `ProcedureType` on AdmissionModel | `procedure_type` column on admissions (via 0188) — exists |
| Police case | `IsPoliceCase` (bool) on AdmissionModel | `is_police_case` column on admissions (via 0188) — exists |

**Recommendation:** Port `admission_case` — add `admission_case TEXT` column to admissions table (e.g., 'medical', 'surgical', 'trauma', 'maternity', 'psychiatric'). This enables case-type reporting without relying on department-based classification.

---

## Summary: Top 10 Gaps Ranked by Importance

| # | Gap | Priority | Action |
|---|-----|----------|--------|
| 1 | BillStatusOnDischarge + billing clearance gate | **Critical** | Port from DanpheEMR — add column + pre-discharge check endpoint |
| 2 | Secondary doctor / consultant specialty tracking | **High** | Enhance discharge_summary_consultants + add secondary_doctor_id to patient_bed_infos |
| 3 | Insurance ClaimCode tracking | **High** | Add claim_code column via sequence |
| 4 | Insurance balance (real-time) | **Medium** | Compute from patient_insurance.credit_limit minus provisional items |
| 5 | AdmissionOrders (separate from notes) | **Medium** | Add admission_orders column if clinical workflow demands it |
| 6 | RequestingDepartmentId per bed assignment | **Medium** | Add department columns to patient_bed_infos |
| 7 | CareOfPersonRelation field | **Low** | Verify column exists in admissions table |
| 8 | Delivery type lookup for maternity | **Low** | Add delivery_types lookup if maternity is in scope |
| 9 | ProcedureNotes + DiagnosisFreeText in discharge summary | **Low** | Add two columns to discharge_summaries |
| 10 | AdmissionCase classification | **Low** | Add admission_case column for reporting |

---

## Files Referenced

- DanpheEMR: `DanpheEMR.ServerModel/AdmissionModels/AdmissionModel.cs`
- DanpheEMR: `DanpheEMR.ServerModel/AdmissionModels/DischargeSummaryModel.cs`
- DanpheEMR: `DanpheEMR.ServerModel/AdmissionModels/AdmissionViewModel.cs`
- HMS: `src/routes/tenant/admissions.ts`
- HMS: `src/routes/tenant/discharge.ts`
- HMS: `src/routes/tenant/dischargePlanning.ts`
- HMS: `src/schemas/admission.ts`
- HMS: `migrations/0012_admissions_beds.sql`
- HMS: `migrations/0015_discharge_summaries.sql`
- HMS: `migrations/0035_advanced_billing.sql`
- HMS: `migrations/0181_enhanced_discharge_summary_fields.sql`
- HMS: `migrations/0182_provisional_discharge.sql`
- HMS: `migrations/0188_nursing_ipd_fullbuild.sql`
