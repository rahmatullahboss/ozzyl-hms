# Doctor Module A–Z Review, Gap Tracker ও Implementation Report

**তারিখ:** ১০ জুলাই ২০২৬  
**রিভিউ স্কোপ:** Doctor dashboard, OPD consultation, quick/full prescription, clinical safety, lab/imaging orders, result review, follow-up/referral/certificate, IPD rounds, medication reconciliation, discharge continuity, audit ও data integrity।  
**স্ট্যাটাস চিহ্ন:** ✅ সম্পন্ন · 🟡 আংশিক/পরবর্তী hardening দরকার · ⛔ ইচ্ছাকৃতভাবে block/defer · 🔴 বাকি

---

## 1. রিভিউ পদ্ধতি

এই audit-এ চার ধরনের evidence মিলিয়ে দেখা হয়েছে:

1. বর্তমান HMS implementation ও automated tests।
2. Local `openemr-reference` encounter/sign-off/transition workflow।
3. Local `DanpheEMR reference` doctor dashboard, patient visit, provider reassignment ও order navigation workflow।
4. Current clinical safety guidance: ONC SAFER Guides, WHO Medication Without Harm / transitions of care এবং HL7 FHIR R4 workflow resources।

মূল নীতি ছিল existing stable flow rewrite না করে patient-safety, data-loss, closed-loop care এবং small/mid-size hospital speed-এর gap ঠিক করা।

---

## 2. Executive assessment

বর্তমান Doctor Module শূন্য থেকে বানানোর পর্যায়ে নেই। এটি ইতিমধ্যে production-grade foundation-এর বেশিরভাগ অংশ কভার করে:

- Today queue, call-next, status/reassign ও doctor ownership
- Patient header/identity/risk context
- Fast Rx এবং full prescription—দুই mode
- SOAP, advice, follow-up, admission request
- Lab/radiology order এবং billing-state feedback
- Allergy, interaction, duplicate therapy ও override audit safety
- Result inbox, critical result review/acknowledgement ও report-show workflow
- IPD round note, sign-off, optional billing round ও history
- Referral, certificate, chart/timeline এবং discharge workspace

এই pass-এ পাওয়া সবচেয়ে গুরুত্বপূর্ণ production gaps ছিল **unsaved clinical documentation loss** এবং **IPD transition medication reconciliation-এর UI/clinical continuity না থাকা**। দুটিই implement ও test করা হয়েছে।

---

## 3. A–Z capability matrix

| Area | বর্তমান অবস্থা | রিভিউ ফলাফল |
|---|---|---|
| Doctor identity ও tenant isolation | ✅ | Doctor-scoped routes, role checks ও tenant-bound queries বিদ্যমান। |
| Dashboard/queue/call-next | ✅ | Waiting/in-progress/report-show flow, missing appointment guard ও reassign flow আছে। |
| Patient identity banner | ✅ | Patient name/code/age/gender, allergy/risk context consultation-এর মধ্যে দৃশ্যমান। |
| Small-hospital quick consultation | ✅ | Drawer-based keyboard-friendly SOAP, order ও Fast Rx flow আছে। |
| Full consultation/prescription | ✅ | Full page, detailed medicine, advice, tests, follow-up ও print workflow আছে। |
| Unsaved OPD work protection | ✅ **এই pass-এ fixed** | SOAP, order input, follow-up/admission form বা unsaved Rx থাকলে Close/browser leave guard। |
| Prescription finalization integrity | ✅ | Draft/final state, appointment ownership, atomic completion ও failure হলে workspace open থাকে। |
| Allergy/interaction safety | ✅ | Blocking findings, override reason ও audit history আছে। |
| Dose/duration completeness | 🟡 | Missing dose/duration warning আছে; সব clinical scenario-তে hard block করা হয়নি—small-hospital speed বজায় রাখতে intentional warning। |
| Pediatric/renal/hepatic dose engine | 🔴 | Reliable age/weight/lab-linked validated dose rules ছাড়া automatic recommendation নিরাপদ নয়। আলাদা clinical validation project প্রয়োজন। |
| Coded diagnosis | ✅ **follow-up pass-এ fixed** | Quick drawer-এ optional ICD-10/ICD-11 search/attach, server canonical validation, visit ownership, verified ClinicalDiagnosis ও primary/secondary consistency আছে। Free-text assessmentও থাকে। |
| Lab order | ✅ | Doctor-authorized order, quick order, billing feedback ও patient-context navigation আছে। |
| Imaging/radiology order | ✅ | Structured order ও urgency/remarks flow আছে। |
| Closed-loop lab results | ✅ | Needs-review/critical inbox, review/acknowledge, result history/trend ও report review আছে। |
| Corrected/retracted result visibility | ✅ | Result revision/retraction handling ও review surface বিদ্যমান। |
| Follow-up/referral/certificate | ✅ | Follow-up scheduling, referral ও doctor certificate workflows বিদ্যমান। |
| Admission request | ✅ | OPD থেকে provisional diagnosis/notes সহ admission request করা যায়। |
| IPD patient workspace | ✅ | Vitals, trends, active meds, pending orders, progress notes, round history ও discharge readiness আছে। |
| IPD doctor round | ✅ | Structured SOAP round, condition, signed clinical note, idempotency ও optional billing round আছে। |
| IPD medication-order composer | ✅ **follow-up pass-এ fixed** | Admission-scoped CPOE composer, active/on-hold list, formulary prefill, atomic order+MAR creation, retry-safe idempotency, reasonসহ hold/resume/discontinue ও immutable order history আছে। |
| Admission/transfer/discharge medication reconciliation | ✅ **এই pass-এ fixed** | IPD screen থেকেই transition শুরু, imported medicine review, continue/modify/discontinue/add, reason, complete ও lock। |
| Reconciliation patient/visit integrity | ✅ **এই pass-এ fixed** | Visit-patient mismatch reject; duplicate open reconciliation prevent। |
| Reconciliation audit | ✅ **এই pass-এ fixed** | Create/item decision/complete audit; notes বা medication name audit payload-এ রাখা হয়নি। |
| Discharge checklist sync | ✅ **এই pass-এ fixed** | Discharge reconciliation complete হলে সংশ্লিষ্ট discharge checklist-এর `medications_reconciled` auto-complete। |
| IPD quick-action context | ✅ **এই pass-এ fixed** | Lab/Rx link patient ও admission context বহন করে। |
| Unified OPD encounter sign/addendum | ✅ **follow-up pass-এ fixed** | Save & Complete SOAP, coded diagnosis, prescription ও verified order refs-কে এক hashed signed envelope-এ lock করে; patient chart-এ read-only viewer ও hash-chained append-only addendum আছে। |
| Concurrent OPD completion idempotency | ✅ **follow-up pass-এ fixed** | Appointment-scoped claim/lease clinical write-এর আগে acquire হয়; active concurrent request reject, partial failure resume, claim-linked SOAP/diagnosis/prescription reuse এবং signed retry stale claim self-heal করে। |
| Medication decision → signed discharge prescription | ✅ **follow-up pass-এ fixed** | Completed discharge reconciliation থেকে reviewed prescription prefill, stopped-medicine advice, admission/reconciliation provenance, duplicate guard এবং existing draft reopen flow আছে। Active medicines silently mutate হয় না; doctor final করেন। |
| External LIS/RIS interoperability | 🟡 | Internal closed-loop workflow আছে; vendor-specific HL7/FHIR/LIS adapter আলাদা integration scope। |
| FHIR workflow/export | 🟡 | Internal resources Request/Order/Result semantics অনুসরণ করে; formal FHIR endpoint/mapping পূর্ণ নয়। |
| Offline clinical conflict resolution | 🟡 **partially hardened** | Browser queue ও hospital local-server sync আলাদা review surface; signed IPD round push/pull immutable guard; failed/poison outbox, cloud ingest ও pull-state visibility; manual local retry auditসহ আছে। Clinician-level conflict resolution action ও full core outbox coverage এখনও প্রয়োজন। |

---

## 4. এই pass-এ পাওয়া ও fixed gaps

### DOC-GAP-001 — SOAP/plan লিখে Close করলে silent data loss

- **Severity:** P0 patient-record integrity
- **আগের অবস্থা:** Prescription draft auto-save ছিল, কিন্তু SOAP, pending order input, follow-up বা admission form save না করে X চাপলে সরাসরি drawer বন্ধ হতো।
- **Fix:**
  - Initial patient-seeded SOAP-এর সঙ্গে current data compare।
  - Unsaved SOAP/order/follow-up/admission/Rx detect।
  - Close confirmation এবং browser `beforeunload` guard।
  - Successful Save & Complete-এর পর false warning হয় না।
- **Files:**
  - `web/src/components/doctor/DoctorWorkspaceDrawer.tsx`
  - `web/src/components/doctor/DoctorWorkspaceDrawer.test.tsx`
- **Verification:** DoctorWorkspaceDrawer test suite ১৫/১৫ pass।

### DOC-GAP-002 — Medication reconciliation backend ছিল, Doctor workflow-এ পাওয়া যেত না

- **Severity:** P0/P1 transitions-of-care safety
- **আগের অবস্থা:** Nursing namespace-এ backend tables/routes ছিল; IPD discharge checklist-এ item দেখা যেত, কিন্তু doctor একই workspace থেকে reconciliation করতে পারতেন না।
- **Fix:**
  - নতুন `MedicationReconciliationPanel` IPD doctor workspace-এ যোগ।
  - Admission/transfer/discharge transition নির্বাচন।
  - Existing home/inpatient medicine import।
  - `continue`, `modify`, `discontinue`, `add` decision ও reason।
  - New dose/route/frequency capture।
  - Complete করে immutable/locked state।
- **Files:**
  - `web/src/components/doctor/MedicationReconciliationPanel.tsx`
  - `web/src/pages/doctor/IPDWorkspace.tsx`
  - `src/routes/tenant/nursing/medication-reconciliation.ts`

### DOC-GAP-003 — Patient/visit mismatch ও duplicate transition

- **Severity:** P0 wrong-patient safety
- **Fix:**
  - Reconciliation create-এর আগে tenant-scoped visit ownership verify।
  - একই patient/visit/type-এর দ্বিতীয় `in_progress` record 409 conflict।
  - Admission detail-এ actual `ipd_visit_id` resolve; admission ID-কে visit ID হিসেবে ব্যবহার করা হয়নি।
- **Files:**
  - `src/routes/tenant/nursing/medication-reconciliation.ts`
  - `src/routes/tenant/admissions.ts`
  - `test/doctor-medication-reconciliation-workflow.test.ts`

### DOC-GAP-004 — Admission reconciliation ভুল source থেকে medicine import করত

- **Severity:** P1 medication-history accuracy
- **আগের অবস্থা:** Admission reconciliation inpatient medication order থেকে auto-populate করত।
- **Fix:**
  - Admission → `patient_active_medications`, source `home`।
  - Transfer/discharge → active inpatient medication orders, source `inpatient`।

### DOC-GAP-005 — Imported medication decision edit করা যেত না

- **Severity:** P1 workflow completeness
- **Fix:** Tenant/reconciliation-bound item update endpoint; completed record edit blocked; discontinue reason required; audit metadata PHI-minimized।

### DOC-GAP-006 — Discharge reconciliation ও checklist বিচ্ছিন্ন

- **Severity:** P1 closed-loop discharge
- **Fix:** Completed discharge reconciliation থেকে matching admission resolve করে `discharge_checklists.medications_reconciled = 1`।

### DOC-GAP-007 — IPD lab/Rx quick action patient context হারাত

- **Severity:** P1 wrong-patient/usability risk
- **Fix:** URL-এ `patient`, `admission`, এবং return context যোগ।

### DOC-GAP-008 — Completed reconciliation থেকে signed discharge prescription hand-off ছিল না

- **Severity:** P1 transitions-of-care continuity
- **Fix:**
  - Completed discharge reconciliation থেকে `continue`, `modify` ও `add` medicines prefill।
  - `discontinue` medicines prescription item না করে stopped-medicine advice section-এ রাখা।
  - Load/verification শেষ হওয়ার আগে draft/final/save-and-print block।
  - Prescription-এ immutable `admission_id` ও `source_reconciliation_id` provenance।
  - Tenant/patient/admission/completed-discharge ownership backend validation।
  - একই reconciliation থেকে duplicate prescription DB unique index ও API conflict দিয়ে block।
  - Existing draft/final prescription থাকলে নতুন Create না দেখিয়ে Open link।
  - Reconciliation নিজে active medicines silently mutate করে না; clinician review করে prescription final করেন।

### DOC-GAP-009 — Quick consultation-এ optional coded diagnosis ছিল না

- **Severity:** P1 clinical coding / encounter integrity
- **Fix:**
  - Quick drawer-এ ICD-10 ও ICD-11 catalog search।
  - Free-text assessment বাধ্যতামূলক না করে selected description দিয়ে empty assessment seed।
  - Save SOAP এবং Save & Complete—দুই workflow-তেই coded diagnosis persist।
  - Server catalog থেকে canonical code/title re-validation; client description trusted নয়।
  - Appointment-এর tenant/patient visit ownership ছাড়া coded diagnosis reject।
  - Visit-এর ICD fields এবং clinician-verified `ClinicalDiagnosis` এক batch-এ write।
  - Exact-code retry idempotent; existing অন্য primary diagnosis থাকলে নতুন code secondary হয় এবং visit primary field overwrite হয় না।
  - Selected code unsaved-clinical-work ও completion eligibility-তে গণ্য।

### DOC-GAP-010 — Doctor IPD workspace-এ direct medication CPOE/MAR hand-off ছিল না

- **Severity:** P1 inpatient medication safety / workflow continuity
- **Fix:**
  - IPD workspace-এ patient, visit ও admission-scoped compact medication-order composer।
  - Formulary search metadata দিয়ে medicine/generic/strength/form/frequency/duration/instruction prefill; `medicine_id`-কে ভুলভাবে `formulary_item_id` করা হয়নি।
  - Server tenant-scoped active IPD visit এবং optional formulary ownership validation।
  - `idempotency_key` migration ও unique index; retry একই order ফেরায়, different payload conflict।
  - Medication order ও initial MAR schedule একই D1 batch-এ atomic create।
  - Omitted start time retry-তে stored timestamp reuse।
  - Active/on-hold order list; reasonসহ hold/resume/discontinue।
  - Terminal order reopen block এবং generic status transition validation।
  - MAR-linked medication order DELETE block; status workflow ছাড়া clinical history লুকানো যায় না।
  - Create/status/hold/resume/discontinue/blocked-delete audit metadata PHI-minimized।

### DOC-GAP-011 — Quick consultation-এর clinical pieces unified signed encounter ছিল না

- **Severity:** P1 medico-legal integrity / encounter continuity
- **Fix:**
  - Save & Complete-এর lifecycle batch-এ signed encounter insert + appointment/visit/queue completion atomic।
  - SOAP, coded diagnosis, prescription এবং verified lab/imaging order references-এর immutable JSON snapshot।
  - SHA-256 snapshot hash, signer, signed time, signature version এবং appointment linkage।
  - Completion retry existing signed encounter ফেরায়; completed encounter-এ নতুন direct clinical write block।
  - Patient chart-এ signed metadata, immutable snapshot summary এবং addendum history viewer।
  - Correction শুধু hash-chained append-only addendum; original snapshot update/delete block।
  - Signing doctor ownership; hospital admin/MD addendum permission; other doctor reject।
  - Signed encounter direct update/delete block এবং blocked-delete audit।

### DOC-GAP-012 — Simultaneous first completion pre-sign duplicate লিখতে পারত

- **Severity:** P1 wrong-record duplication / retry integrity
- **Fix:**
  - SOAP/diagnosis/prescription write-এর আগে tenant + appointment-scoped completion claim acquire।
  - Unique appointment claim ও idempotency-key index; active lease থাকলে concurrent request 409 এবং কোনো clinical write শুরু হয় না।
  - Frontend একই failed Save & Complete retry-তে stable idempotency key পুনরায় পাঠায়।
  - Claim-linked SOAP, coded diagnosis ও prescription unique; failed/expired claim takeover existing partial record update/reuse করে।
  - Existing draft diagnosis/prescription completion claim-এর সঙ্গে safely attach হয়; duplicate final record হয় না।
  - প্রতিটি successful clinical write claim-এ checkpoint; lifecycle failure claim `failed` করে lease release করে।
  - Signed encounter authoritative; post-sign claim-finalize ব্যর্থ হলেও completed retry stale claim-কে self-heal করে।
  - Canonical JSON serialization দিয়ে object key order-independent request/snapshot SHA-256 hash।
  - Idempotency key অন্য appointment-এ collision করলে deterministic 409।

### DOC-GAP-013 — Offline sync signed IPD round overwrite করতে পারত

- **Severity:** P1 signed-record integrity / cross-server conflict
- **Fix:**
  - Cloud ingest-এর আগে existing round tenant + idempotency key দিয়ে load।
  - Exact signed replay এবং delayed pre-sign replay immutable no-op।
  - Signed summary, patient condition, signer, identity/billing snapshot বা cancellation বদলালে 409 sync conflict।
  - Conflict `cloud_sync_ingest_events.apply_status = failed` ও bounded error message-এ record হয়; original signed row update হয় না।
  - UPSERT-level `clinical_status <> signed` এবং `signed_at IS NULL` guard TOCTOU race-এও signed overwrite block করে।
  - Clinical-note lookup ও upsert conflict/no-op path-এ চালানো হয় না।
- **Remaining:** centralized metadata viewer এখন আছে; original signed record mutate না করে clinician addendum/reject-local/accept-new-version governance action এখনও প্রয়োজন।

### DOC-GAP-014 — Browser offline queue ও hospital local-server sync একসঙ্গে মিশে যাচ্ছিল এবং retry false-success দিতে পারত

- **Severity:** P1 data durability / operational visibility
- **Fix:**
  - Admin Offline Sync Review-এ browser encrypted queue এবং hospital local-server ↔ cloud channel আলাদা section।
  - Server-side tenant-scoped review API: local outbox, cloud ingest receipt ও cloud-to-local pull state; কোনো payload/PHI body ফেরত দেয় না।
  - Failed/poison local outbox manual retry শুধু local-server deployment ও authorized admin/manager; audit logসহ।
  - Failed cloud receipt একই idempotency key-তে verified re-apply; active/stale processing lease ও compare-and-swap concurrent retry protection।
  - Different event/payload দিয়ে idempotency key reuse 409; unsupported payload-bearing entity failed থাকে—metadata-only false success নয়।
  - Cloud pull signed IPD round semantic preflight: exact/stale replay no-op, changed signed row table-level failed review, `clinical_note_id` generic replace নয়।
  - Periodic worker connect/request timeout, startup jitter এবং sequential non-overlap।
  - Local outbox push ব্যর্থ হলে সেই cycle-এর cloud pull skip; unsynced local data পুরোনো cloud snapshot দিয়ে overwrite হয় না।
  - Internal processing marker review API-তে sanitized `processing` status; raw marker expose হয় না।
  - Coverage registry/CI guard explicit emitters, cloud mappers ও core outbox gaps drift ঠেকায়।
- **Known limitation:** এটি explicit outbox, automatic full-database replication নয়। Patient update, emergency patient creation, patient-portal registration, referral-acceptance patient creation এবং reception quick-admit এখন patient write-এর একই D1 batch-এ outbox রাখে। patients/link-global এবং referral-acceptance health-link এখন staged-durable ও retry-healing। তবে main patient create/global-link, marketplace/FHIR/health-record/settings import routes এবং appointment/visit/admission/queue/bill/invoice/payment/deposit write paths এখনও P1 backlog।

### DOC-GAP-015 — Local patient numeric ID cloud-এ অন্য tenant/identity-র সঙ্গে collide করতে পারত

- **Severity:** P1 patient identity corruption / cross-server namespace collision
- **Fix:**
  - Tenant-scoped patient `sync_key` এবং stable `(server, tenant, entity, local_id) → cloud_id` mapping table যোগ হয়েছে।
  - Local patient numeric ID cloud-এ blind copy হয় না; UHID/sync-key দিয়ে canonical cloud patient resolve/create হয় এবং mapping response local server-এ persist হয়।
  - Patient outbox event cloud mapping confirm না করা পর্যন্ত `exported` হয় না; mapping response invalid/missing হলে item failed থাকে।
  - Cloud pull mapped cloud patient ID-কে original local patient ID-তে translate করে; safe first import mapping তৈরি করে।
  - Patient health link local patient ID থেকে mapped cloud patient ID-তে translate হয়।
  - Same UHID/patient code multiple record, mapped identity mutation, cross-tenant occupied ID এবং unsafe pull collision review conflict হয়—silent overwrite নয়।
  - Already-applied legacy receipt mapping missing হলে canonical patient থেকে self-heal; UHIDবিহীন পুরোনো numeric row duplicate না বানিয়ে claim করা হয়।
  - Ingest response থেকে UHID-derived natural key বাদ; শুধু non-PHI mapping identifiers ফেরে।
  - Coverage registry-তে patient ID mapping আর gap নয়; Admin review এখন atomic patient write paths এবং remaining patient route gaps আলাদা দেখায়।
  - Patient update payload required guardian/address demographics preserve করে এবং patient update + outbox একই D1 batch-এ commit হয়।
  - Emergency, patient portal, referral acceptance ও reception quick-admit patient creation paths sequence-based patient code এবং patient + outbox atomic batch ব্যবহার করে।
  - Referral acceptance missing identity-তে accepted হয় না; patient/outbox/health-link/referral linkage একই batch-এ commit হয় এবং UHID-কে patient national ID হিসেবে ভুলভাবে লেখা হয় না।
- **Remaining:** main patient create/global identity/health-link outbox এখনও পুরো atomic নয়। patients/link-global ও referral-acceptance health-link staged-durable/retry-healing; marketplace/FHIR/health-record/settings patient imports এবং visit/appointment/admission/billing lifecycle coverage বাকি।

---

## 5. Remaining prioritized gaps

### P1 — Full core local-server outbox coverage

Hospital local-server থেকে cloud incremental push এখন explicit outbox-based এবং silent unsupported success block করা হয়েছে, কিন্তু সব write path covered নয়। পরবর্তী atomic expansion order:

1. Main patient create/global identity/link, referral health-link, marketplace/FHIR/health-record/settings import routes-এ atomic outbox coverage সম্পন্ন করা।
2. Appointment, visit, queue lifecycle + stable ID mapping।
3. Bill, invoice item, payment, deposit/refund + stable ID mapping।
4. Admission/transfer/discharge lifecycle + stable ID mapping।

প্রতিটি write-এর একই D1 batch/transaction-এ outbox statement, tenant-scoped cloud mapper, immutable/idempotent retry, delete/tombstone policy এবং push→pull conflict tests প্রয়োজন। Generic trigger বা blind last-write-wins দিয়ে signed/financial record sync করা যাবে না।

### P1 — Per-server sync credential binding

বর্তমান hospital local-server sync একটি configured bearer token ব্যবহার করে। Mapping ও payload server/tenant scoped হলেও credential নিজে নির্দিষ্ট hospital server-এর সঙ্গে cryptographically bound নয়। Broad multi-hospital rollout-এর আগে per-server credential, signed request বা equivalent server identity binding এবং credential rotation/revocation প্রয়োজন।

### P2 — Dose decision support

Automatic pediatric, renal, hepatic, pregnancy ও weight-based dosing কেবল validated formulary, current weight, kidney/liver function এবং local governance থাকলে চালু করা উচিত। বর্তমান warning/safety checks বজায় রেখে rule validation project আলাদা রাখতে হবে।

### P2 — Formal FHIR/HL7 interoperability

Internal order/result workflow শক্তিশালী হলেও external LIS/RIS, referral exchange ও longitudinal record-এর জন্য formal mappings প্রয়োজন:

- MedicationRequest
- ServiceRequest
- DiagnosticReport/Observation
- Encounter
- Task
- CarePlan/PlanDefinition

### P2 — Cross-server signed-record conflict review

Browser-local Offline Sync Review-এর পাশাপাশি cloud ingest failures এবং local-server poison outbox events tenant-scopedভাবে দেখার UI প্রয়োজন। Resolution action original signed record mutate করবে না; clinician addendum, reject-local বা accept-new-version policy governance সহ হবে।

---

## 6. Quick vs full workflow recommendation

### দ্রুত mode — ছোট/মাঝারি হাসপাতাল

1. Queue থেকে Call Next।
2. Patient identity/allergy banner সবসময় দৃশ্যমান।
3. Chief complaint/assessment বা medicine—যেকোনো meaningful documentation দিয়ে শুরু।
4. Frequent medicine, keyboard search, quick lab/radiology order।
5. Safety warning resolve/override reason।
6. Save & Complete; failure হলে workspace বন্ধ হবে না।

### Full mode — জটিল case

1. Full chart/timeline ও previous results/trends।
2. Structured SOAP/exam/diagnosis।
3. Detailed prescription/order set।
4. Referral/admission/follow-up।
5. Signed encounter এবং future addendum workflow।

### IPD mode

1. Patient/bed/diagnosis/vitals banner।
2. Round SOAP + condition + sign।
3. Pending order/result review।
4. Active inpatient medicines/MAR context।
5. Transition medication reconciliation।
6. Discharge prescription/summary/checklist।

---

## 7. Verification evidence

### Backend focused baseline

- `doctor-module.test.ts`
- `doctor-lab-inbox.test.ts`
- `ipd-doctor-rounds.test.ts`
- `prescription-finalization-integrity.test.ts`
- `prescription-allergy-safety.test.ts`
- `prescription-drug-interaction-safety.test.ts`
- **Result:** ৬ file, ২১৭ test pass।

### New medication reconciliation tests

- Patient/visit mismatch reject
- Duplicate open transition reject
- PHI-minimized create audit
- Imported medication decision update/audit
- Complete/audit/discharge-checklist sync
- Home-medication import schema/source validation
- Completed reconciliation immutability
- Modify-decision instruction validation
- Atomic duplicate-creation race protection
- Concurrent completion rejection
- Checklist-sync failure returns a locked success state with manual-review signal
- **Result:** ১১/১১ pass।

### Frontend focused tests

- DoctorWorkspaceDrawer: unsaved clinical work, coded diagnosis Save SOAP/Complete payload ও failed completion retry-তে stable idempotency keyসহ **১৮/১৮ pass**।
- QuickCodedDiagnosis: minimum search length, ICD-10/ICD-11 mapping ও remove flowসহ **৪/৪ pass**।
- MedicationReconciliationPanel: transition workflow, checklist warning, create/open discharge prescriptionসহ **৬/৬ pass**।
- IPDWorkspace: medication composer, reconciliation presence ও context-preserving lab/Rx linksসহ **১৩/১৩ pass**।
- IPDMedicationOrderComposer: missing-visit guard, create payload/idempotency, hold/discontinue reason ও formulary prefillসহ **৫/৫ pass**।
- Discharge prescription mapper: modify/continue/discontinue/patient ownershipসহ **৪/৪ pass**।
- DigitalPrescription hand-off: load blocking, prefill ও provenance payloadসহ **২/২ pass**।
- Doctor consultation coded diagnosis + signed completion: canonical ICD-10/ICD-11, visit ownership, hashed encounter envelope, claim-before-write, concurrent rejection, failed-claim release ও signed retry self-healসহ **১৫/১৫ pass**।
- Completion claim state machine: new ownership, active lease conflict, key collision, failed/expired takeover, partial checkpoints, failure release, stale-claim reconciliation ও finalizationসহ **৮/৮ pass**।
- Clinical signature serialization: nested canonical JSON ও key-order-independent SHA-256সহ **২/২ pass**।
- Signed encounter addenda backend: viewer payload, signing-doctor/admin ownership, hash chain, immutable update/deleteসহ **৭/৭ pass**।
- SignedEncounterPanel: signed metadata, immutable snapshot, addendum submit ও read-only roleসহ **৪/৪ pass**।
- Doctor IPD medication-order backend: active visit/formulary validation, atomic order+MAR, retry replay, reason/audit, terminal transition ও immutable deleteসহ **১৪/১৪ pass**।
- Local sync routes: signed push/pull immutability, failed-receipt verified retry, processing lease/CAS, patient mapping confirmation gate, legacy self-heal এবং snapshot safetyসহ **৩১/৩১ pass**।
- Stable patient mapping helpers: local↔cloud mapping immutability, sync-key retry, natural identity reuse, legacy no-UHID recovery, pull translation এবং health-link mappingসহ **২ file, ১৫ test pass**।
- Patient sync identity safety: different local/cloud ID mapping, mapped identity mutation, ambiguous natural identity, unmapped link, PHI-free response এবং mapped pull guard covered।
- Patient atomic outbox, staged-durable global linking, route coverage, mapping, ingest/pull safety ও IPD relevant regression: **১৫ file, ১১৭ test pass**।
- Local-server periodic worker: sequential push→pull, push-failure pull gate, timeout, jitter ও compose contractসহ **৫/৫ pass**।
- Server sync review API: tenant scoping, PHI-free metadata, schema drift, local-only audited retry ও state guardsসহ **৫/৫ pass**।
- Sync coverage registry: explicit/non-atomic emitter, atomic patient path, cloud mapper, ID-mapping ও core gap drift guardসহ **৬/৬ pass**।
- Local sync + IPD round combined relevant regression: **৬ file, ৬৭ test pass**।
- OfflineSyncReview: browser/server channel separation, server metadata, retry, partial-coverage warning ও failure isolationসহ **৭/৭ pass**।
- Combined focused backend: **১৫ file, ২৯৪ test pass**।
- Combined focused frontend: **৮ file, ৫৬ test pass**।
- Migration manifest build: pass; `0409`–`0413` clinical/sync migrations included, including `0413_sync_entity_mappings.sql`।
- TypeScript backend: pass।
- TypeScript web: pass।
- Web production build: pass।

---

## 8. Changed files in this pass

- `src/routes/tenant/admissions.ts`
- `src/routes/tenant/nursing/medication-reconciliation.ts`
- `test/doctor-medication-reconciliation-workflow.test.ts`
- `web/src/components/doctor/DoctorWorkspaceDrawer.tsx`
- `web/src/components/doctor/DoctorWorkspaceDrawer.test.tsx`
- `web/src/components/doctor/MedicationReconciliationPanel.tsx`
- `web/src/components/doctor/MedicationReconciliationPanel.test.tsx`
- `web/src/pages/doctor/IPDWorkspace.tsx`
- `web/src/pages/doctor/IPDWorkspace.test.tsx`
- `migrations/0409_prescription_reconciliation_provenance.sql`
- `src/db/schema/schema.ts`
- `src/schemas/clinical.ts`
- `src/routes/tenant/prescriptions.ts`
- `test/prescription-discharge-reconciliation-handoff.test.ts`
- `test/medication-reconciliation-linked-prescription.test.ts`
- `web/src/lib/dischargePrescriptionHandoff.ts`
- `web/src/lib/dischargePrescriptionHandoff.test.ts`
- `web/src/pages/DigitalPrescription.tsx`
- `web/src/pages/DigitalPrescription.discharge-handoff.test.tsx`
- `src/routes/tenant/doctors.ts`
- `test/doctor-consultation-complete.test.ts`
- `web/src/components/doctor/QuickCodedDiagnosis.tsx`
- `web/src/components/doctor/QuickCodedDiagnosis.test.tsx`
- `migrations/0410_ipd_medication_order_idempotency.sql`
- `src/db/schema/clinicalMar.ts`
- `src/schemas/nursing.ts`
- `src/routes/tenant/nursing/medication-orders.ts`
- `test/doctor-ipd-medication-orders.test.ts`
- `test/nursing-routes.test.ts`
- `test/e2e/api/nursing-api.spec.ts`
- `web/src/components/doctor/IPDMedicationOrderComposer.tsx`
- `web/src/components/doctor/IPDMedicationOrderComposer.test.tsx`
- `migrations/0411_signed_opd_encounters.sql`
- `src/lib/clinical-signatures.ts`
- `src/routes/tenant/clinical/encounters.ts`
- `src/routes/tenant/patients-chart.ts`
- `test/signed-opd-encounter-addenda.test.ts`
- `web/src/components/doctor/SignedEncounterPanel.tsx`
- `web/src/components/doctor/SignedEncounterPanel.test.tsx`
- `web/src/pages/PatientChartWorkspace.tsx`
- `migrations/0412_consultation_completion_claims.sql`
- `src/lib/consultation-completion-claims.ts`
- `test/consultation-completion-claims.test.ts`
- `test/clinical-signatures.test.ts`
- `migrations/0413_sync_entity_mappings.sql`
- `src/routes/sync.ts`
- `src/routes/tenant/audit.ts`
- `src/db/schema/schema.ts`
- `src/lib/local-sync-coverage.ts`
- `src/lib/local-sync-entity-mappings.ts`
- `src/lib/local-sync-patient-mapping.ts`
- `src/lib/local-sync-patient-safety.ts`
- `test/local-sync-routes.test.ts`
- `test/local-sync-entity-mappings.test.ts`
- `test/local-sync-patient-mapping.test.ts`
- `test/local-sync-patient-safety.test.ts`
- `test/local-sync-patient-route-safety.test.ts`
- `test/local-server-sync-worker.test.ts`
- `test/local-sync-coverage.test.ts`
- `test/integration/routes/audit-server-sync.test.ts`
- `scripts/local-server/sync-worker.sh`
- `deploy/local-server/compose.yml`
- `docs/operations/local-server-deployment.md`
- `web/src/pages/admin/OfflineSyncReview.tsx`
- `web/src/pages/admin/OfflineSyncReview.test.tsx`
- `docs/reports/2026-07-10-doctor-module-a-z-review.md`

---

## 9. Final status

Doctor Module-এর প্রধান OPD, prescription, order/result, report review, IPD round এবং transition safety flow এখন শক্তিশালী ও ব্যবহারযোগ্য। এই review-এ immediate production-risk gaps, reconciliation-to-discharge-prescription guided hand-off, quick ICD-10/ICD-11 diagnosis, admission-scoped IPD medication CPOE/MAR hand-off, unified signed OPD encounter with append-only addenda, concurrent/retry-safe consultation completion, signed IPD round push/pull protection, browser বনাম hospital local-server sync-এর পৃথক operational review এবং stable patient local↔cloud ID mapping implement করা হয়েছে। তবে local-server incremental push এখনও explicit partial outbox—full database replication নয়। পরবর্তী সর্বোচ্চ priority হলো **patient outbox atomicity ও remaining patient routes**, **per-server sync credential binding**, তারপর **appointment/billing/payment stable mapping + outbox coverage**, **clinician-governed signed conflict resolution**, **validated dose decision support**, এবং **formal FHIR/HL7 interoperability**।
