# Doctor Module A-Z Completion Design

**Date:** 2026-05-27
**Status:** Approved by supplied blueprint and direct implementation instruction
**Scope:** Doctor-facing OPD, EMR context, prescription safety, report review, IPD continuity, documents, and navigation across existing clinical capabilities.

## 1. Goal

Make the Doctor Module usable as one fast, safety-oriented workspace for a busy Bangladesh hospital:

- the doctor sees patient identity, risk context, queue validity, prior clinical information, and pending reports without losing the current workflow;
- prescription issuance stays a clinical act, immutable after finalisation except through audited controls;
- dispensing remains optional and separate from prescribing, because patients may buy medicines outside the hospital;
- existing IPD, order-set, dictation, referral, timeline, discharge, ICD/FHIR, and patient-portal capabilities are reachable from the doctor's workflow;
- new medical certificates are issued and cancelled with tenant scope, doctor ownership, and auditability.

This work does not claim that software alone can eliminate clinical risk. Clinical decisions remain the licensed doctor's responsibility, and production release still requires clinical UAT and operational sign-off.

## 2. Blueprint Coverage Review

### Existing or already hardened in this branch

| Blueprint area | Current implementation path |
| --- | --- |
| Today's queue, visit-type counts, validity badges | `web/src/pages/DoctorDashboard.tsx`, `web/src/components/doctor/QueueTable.tsx`, `src/routes/tenant/doctors.ts` |
| One-screen consultation, SOAP, labs, imaging, follow-up, admission advice | `web/src/components/doctor/DoctorWorkspaceDrawer.tsx` |
| Sticky identity/allergy header and save failure retention | `PatientHeader.tsx`, consultation drawer safety changes |
| Patient overview, clinical history, documents and timeline | `web/src/pages/doctor/PatientOverview.tsx`, `web/src/pages/PatientTimeline.tsx` |
| AI summary with source-verification warning, dictation, smart phrases | existing Doctor components/routes; AI remains assistive only |
| Diagnosis terminology/FHIR foundation | existing `terminology.ts` and `fhir.ts` routes |
| Medication safety/order sets | existing clinical-decision/order-set logic plus prescription lock/override work in this branch |
| Final prescription visible to patient portal | existing `patientPortal.ts`; final prescriptions only |
| Optional hospital pharmacy dispensing | separate fulfilment order route/migrations in this branch; no compulsory hospital purchase and no doctor commission |
| IPD workspace, progress notes, vitals, discharge summary | existing IPD/discharge modules; temperature display hardened to Fahrenheit in this branch |

### Missing or disconnected capability to implement

| Gap | Required completion |
| --- | --- |
| Doctor Report Show screen absent despite backend endpoint | Add a doctor-facing review page showing last prescription, completed/pending reports, validity, and a reviewed action. |
| Lab cumulative trend not present in consultation context | Add compact patient lab-trend panel using the existing cumulative-results API. |
| Doctor links point to inaccessible admin-only screens | Correct route ownership/navigation for discharge, lab orders, reports, and referrals. |
| Medical/Fitness/Sick Leave certificate workflow absent | Add audited certificate persistence, doctor routes, and a printable doctor UI. |
| Existing tools are hard to discover from the queue | Add a Doctor toolkit launcher for report review, timeline/chart, dictation, order sets, referral, certificates, IPD and settings entry points where authorised. |

## 3. Architecture

### Doctor workspace

`DoctorDashboard` remains the daily landing page. It provides:

- queue and start-consultation workflow;
- a visible toolkit launcher to existing clinical modules;
- a dedicated report-show review route for report-only visits.

`DoctorWorkspaceDrawer` remains the OPD consultation surface. It gains a compact, read-only lab trend panel backed by existing lab data. It must not use AI or browser state as clinical truth.

### Report-show review

Create `DoctorReportReview` under the doctor-authorised route group. It calls:

- `GET /api/doctors/dashboard/report-show-patients?date=YYYY-MM-DD`
- `POST /api/doctors/dashboard/report-show/:appointmentId/review`

Only the assigned doctor may mark a report-show appointment reviewed, as already enforced server-side. The screen exposes the prior prescription and report values; it does not automatically diagnose, prescribe, or close a visit without an explicit doctor action.

### Medical certificates

Create a separate `doctor_certificates` D1 table; it is not a prescription or patient document substitute.

Certificate types:

- `medical`
- `fitness`
- `sick_leave`
- `work_rest`

Rules:

- only a linked active doctor may create/finalise a certificate;
- `md` and `hospital_admin` may read records for governance, but do not issue on behalf of an unlinked doctor;
- final certificate content is not edited in place; a mistaken certificate is cancelled with reason and a new one is issued;
- create and cancel actions are audited using redacted audit metadata;
- the printed document shows issuer identity, BMDC number if configured, patient identity, issue date, certificate number, and signature block.

### Route ownership fixes

Doctor clinical actions must be placed under a route guard that includes `doctor`, rather than linking into admin-only pages. Existing server role checks remain authoritative. The following become doctor reachable:

- report-show review;
- discharge summary for the doctor's IPD workflow;
- lab-order screen because the API already includes `doctor` as an allowed clinical role;
- referral create/list screen with tightened API roles;
- certificates.

### Commercial medicine ordering boundary

Final prescription and medicine fulfilment remain separate. The Doctor Module does not rank partner products, select a seller, expose Ozzyl commercial agreements, or pay medicine-order commission to a doctor. A future patient-app ordering feature must separately implement provider licensing, patient choice/consent, alternative-product equivalence, payment, refund, delivery, fee disclosure, and settlement controls.

## 4. Security and Failure Handling

- All new health-data routes require tenant context and least-privilege role checks.
- Referral routes are tightened to clinical referral roles instead of relying only on authentication.
- Certificate queries bind tenant ID and issuer identity; audit metadata does not include free-text clinical content.
- Report review keeps the existing transactional lifecycle update.
- Lab trend is read-only and tenant-protected by the existing lab route.
- The UI must preserve unsaved consultation work when an API operation fails.

## 5. Testing and Completion Criteria

Implementation is considered complete for this repository scope when:

1. Route/navigation tests prove doctors can reach their linked clinical actions and cannot reach pharmacy/commercial controls as prescribing incentives.
2. Report-show UI tests prove reports and prior prescription context appear and review invokes the explicit endpoint.
3. Lab trend UI tests prove cumulative patient results appear without altering clinical state.
4. Certificate backend tests cover role enforcement, tenant scope, immutable final records, cancellation reason, and audit action; frontend tests cover create/print/cancel workflow.
5. Existing prescription safety/fulfilment tests remain green.
6. Typecheck, frontend tests, targeted backend tests, production build, and diff-scoped healthcare security review are run before PR.

## 6. Intentionally Deferred External/Validated Integrations

These blueprint items need reviewed data sources or commercial/legal contracts and must not be faked inside clinical code:

- validated drug-interaction and paediatric dose engines beyond existing safety controls;
- speech recognition quality assurance beyond the existing dictation/scribe support;
- national SHR exchange production registration/consent deployment beyond existing FHIR-ready foundations;
- patient-app partner medicine ordering, Ozzyl platform-fee settlement, refunds, and delivery.
