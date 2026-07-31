# EHR Gap Analysis: HMS vs Danphe Reference

> Date: 2026-04-23
> Scope: Clinical / EHR module comparison and roadmap

---

## Current State — What HMS Already Has

### Schema (DB)

| Table | Purpose |
|-------|---------|
| `patients` | Demographics |
| `visits` | OPD/IPD with ICD-10/ICD-11 codes |
| `patientVitals` + `clinicalVitals` | Two vitals tables (patient-level + visit-level) |
| `patientAllergies` | Allergy tracking |
| `patientActiveMedications` | Active medication list |
| `prescriptionSafetyChecks` | Drug interaction / allergy contraindication checks |
| `medicalRecords` | Discharge records, operation info, referral |
| `finalDiagnosis` | ICD-10/ICD-11 linked diagnosis |
| `documentRecords` | File attachments per patient/medical record |
| `babyBirthDetails` / `deathDetails` | Vital statistics |
| `healthRecordConsents` | Cross-tenant consent management |
| `healthRecordBlockList` | Patient-controlled provider blocking |
| `healthRecordSensitivityLabels` | Resource-level sensitivity classification |
| `healthRecordConsentOverrides` | Emergency access override with audit |
| `consentPurposeDefaults` | Configurable consent policies per purpose |
| `icd10Codes` + `catalogIcd11Mms` | Diagnosis catalogs |
| `vitalAlertRules` + `vitalAlerts` | Configurable vital threshold alerting |

### API Routes — Clinical Module

| Route | Features |
|-------|----------|
| `/clinical/assessments` | PHQ-9, GAD-7 (with scoring + severity + trend), SOAP notes, treatment plans, social history |
| `/clinical/problems` | Problem list: CRUD, resolve, status tracking |
| `/clinical/history` | Family, social, surgical history |
| `/clinical/diagnosis` | ICD-10/ICD-11 search + CRUD + clinical review workflow |
| `/clinical/care-plans` | Full care plans: goals, interventions, tasks, team members, progress notes |
| `/clinical/forms` | Pain map, physical exam, aftercare plan, transfer summary, clinical instructions, observations, dictation, clinic notes, functional/cognitive status |
| `/clinical/sdoh` | SDOH screening with computed risk scoring |
| `/clinical/ros` | Review of Systems |
| `/clinical/eye-exam` | Ophthalmology: acuity, refraction, anterior segment, fundus, assessment |
| `/clinical/diet` | Diet/nutrition tracking |
| `/clinical/glucose` | Glucose monitoring with trend |
| `/clinical/vitals` | CRUD + trend + auto BMI + vital alert rule checks |
| `/clinical/allergies` | CRUD + duplicate detection + clinician verification |
| `/clinical/medications` | CRUD + discontinue + drug-allergy and drug-drug interaction safety checks |
| `/clinical/notes` | CRUD + pagination + note signing (locks from edits) + SOAP fields |
| `/clinical/images` | CRUD + R2 upload-url + body part tagging + type filtering |
| `/clinical/encounters` | CRUD + complete + full encounter summary aggregator |

---

## Gaps: Status After Phase 1+2 Fill (2026-04-23)

### COMPLETED — HIGH Priority

1. ~~**Vitals API**~~ — DONE: `/clinical/vitals` with trend, BMI auto-calc, vital alert integration
2. ~~**Allergies API**~~ — DONE: `/clinical/allergies` with duplicate prevention, clinician verification
3. ~~**Medications API**~~ — DONE: `/clinical/medications` with discontinue, drug interaction + allergy safety checks

### COMPLETED — MEDIUM Priority

4. ~~**Clinical Notes**~~ — DONE: `/clinical/notes` with SOAP fields, note signing, pagination
5. ~~**Clinical Images**~~ — DONE: `/clinical/images` with R2 upload, body part tagging, type filtering

### COMPLETED — Bonus (was LOW priority)

6. ~~**Encounters**~~ — DONE: `/clinical/encounters` with full summary aggregator pulling vitals, notes, allergies, meds, problems, images

### Remaining LOW Priority (deferred)

7. **Clinical Orders** — Danphe has lab/radiology orders from clinical context; HMS has separate radiology/lab modules
8. **I/O Charts (clinical-level)** — Danphe tracks from clinical; HMS only from nursing

---

## Where HMS Is Ahead of Danphe

| Feature | HMS | Danphe |
|---------|-----|--------|
| Consent management (block list, sensitivity labels, consent overrides, purpose defaults) | Full system | None |
| Drug interaction safety checks (`prescriptionSafetyChecks`) | Built | None |
| Vital alert rules + alerts | Configurable thresholds + alert tracking | None |
| Care plans hierarchy | Goals, interventions, tasks, team, progress notes | Basic CRUD only |
| Eye exam sub-modules | Acuity, refraction, anterior segment, fundus, assessment | Basic eye exam |
| SDOH with scoring algorithm | Computed risk score | Basic SDOH form |
| PHQ-9 / GAD-7 with severity + trend | Auto-scoring + severity classification + trend endpoint | Basic storage |

---

## Vision: Patient App + AI Doctor Overview

### Concept

- Patients use a separate app to track daily life (food, sleep, exercise, symptoms, medication adherence)
- All patient-reported data flows into the same health record
- When visiting a doctor, an AI-generated overview shows the doctor everything at a glance
- Consent system (already built) controls cross-hospital data sharing

### Phase 1: Fill Clinical API Gaps — DONE (2026-04-23)

1. `/clinical/vitals` — CRUD + trend + auto BMI + vital alert integration
2. `/clinical/allergies` — CRUD + duplicate prevention + clinician verification
3. `/clinical/medications` — CRUD + discontinue + drug interaction safety checks
4. `/clinical/notes` — CRUD + pagination + SOAP fields + note signing
5. `/clinical/images` — CRUD + R2 upload-url + body part tagging
6. `/clinical/encounters` — CRUD + complete + full encounter summary aggregator

### Phase 2+3: Patient-Facing — ALREADY BUILT (discovered during review)

Patient PHR system (`/api/patient-phr/*`) — 1,575 lines, 26+ endpoints:
- `/patient-phr/lifestyle-logs` — sleep, exercise, mood, energy, symptoms, diet, water
- `/patient-phr/vitals` — self-reported BP, heart rate, blood sugar
- `/patient-phr/adverse-reactions` — medication ADR reporting
- `/patient-phr/reported-data` — allergies, conditions, health issues, medications
- `/patient-phr/medicine-reminders` — CRUD + mark taken + weekly adherence
- `/patient-phr/wellness-trends` — 7/30/90 day computed trends
- `/patient-phr/health-tips` — personalized Bengali health tips
- `/patient-phr/ai-buddy/chat` — AI wellness buddy with crisis detection
- `/patient-phr/vault` — secure document upload/storage
- `/patient-phr/blue-button` — complete health record export
- `/patient-phr/master-drugs/search` — Bangladesh drug DB + Medex BD integration

Wellness system (`/api/wellness/*`) — 1,289 lines, 33+ endpoints:
- Mood/sleep/activity/water/symptom logging (individual + batch)
- Health score computation + trends
- Streaks + achievements (gamification)
- Personal health goals (CRUD)
- Wearable data sync
- AI-generated daily insights
- PHQ-9/GAD-7 self-screening
- Menstrual cycle tracking
- Meditation logging
- Community health challenges
- Guided onboarding

### Phase 4: AI Doctor Overview — ALREADY BUILT (discovered during review)

`GET /patients/:id/chart?includeAiSummary=1` — massive aggregated view including:
- Patient snapshot (allergies, active problems, current medications, risk flags)
- Clinical timeline (visits, prescriptions, labs, admissions, appointments, SOAP, radiology, docs)
- Vitals trend + vital alerts
- Care alerts (chronic care reminders, pending follow-ups, pending orders)
- Patient-reported summary (adverse reactions, lifestyle logs)
- Family risk overview
- Provenance tracking (clinical vs patient-reported data)
- AI chart brief (one-liner, active issues, recent changes, medication focus, abnormal findings, follow-up risks, cautions) — powered by OpenRouter
- NOW ALSO: clinical notes, clinical images, encounters (wired 2026-04-23)
