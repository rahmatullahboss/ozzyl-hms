# Ozzyl HMS — System Assessment & Strategic Direction

> **Date:** April 8, 2026 | **Updated:** April 10, 2026  
> **Purpose:** Honest assessment of current system vs. the architectural review report  
> **Summary:** "Lock the Foundations" phase completed + follow-on delivery for FHIR write APIs, health card lifecycle, ICD-11 diagnosis validation, severe drug-allergy blocking, global identity claim flow, and a unified patient portal hub. FHIR/Standards reached 60%, Patient Identity reached ~78%, and the ecosystem layer is now moving from "global card exists" toward "global card can be created by hospital, claimed later, and actually used from one patient-facing portal".

---

## Current Position (Updated April 10, 2026)

```
┌──────────────────────────────────────────────────────┐
│  System Position — Post "Deepen the Foundations"      │
├──────────────────────────────────────────────────────┤
│  ██████████████████████░░░░  Hospital Operations  85%  │
│  ████████████████░░░░░░░░░  Patient Identity      78%  │  was 40%
│  ███████████████░░░░░░░░░░  FHIR/Standards        60%  │  was 40%
│  ██████████████░░░░░░░░░░░  Consent & Privacy     55%  │  was 35%
│  ██████████████████████████  Multi-Tenancy         95%  │
│  █████████████████████░░░░  Security              80%  │
│  █████████████████░░░░░░░░  Ecosystem/HIE         68%  │  was 30%
│  █████████████████░░░░░░░░  Health Cards          70%  │  was 60%
│  ████████████████░░░░░░░░░  Terminology           55%  │  was 30%
└──────────────────────────────────────────────────────┘
```

---

## What Was Built in "Lock the Foundations" (Apr 8-9)

### MPI Hardening (40% → 65%)
- **Probabilistic matching** — 7-field weighted scoring engine (`src/lib/mpi-scoring.ts`)
  - NID exact=100, phone=40, name exact=30, name phonetic=20, DOB=25, gender=5, blood group=5
  - Auto-link threshold: 90, Review threshold: 50
- **South Asian phonetic normalizer** — Bengali romanization variants (sh/s, kh/k, dh/d, bh/b, gh/g, th/t, ch/c, ph/f, zh/z, oo/u, ee/i, ou/u), double-collapse, trailing vowel strip
- **Probabilistic scan-duplicates** — SQL candidate narrowing + JS scoring, replaces hardcoded confidence
- **Patient unmerge** — Admin-only endpoint, restores merged patient, temporal FK reversal (19 tables, only records created before merge), merge log tracking
- **Migration 0100** — `patient_merge_log` unmerge columns (is_unmerged, unmerged_by, unmerged_at, unmerge_reason)

### Consent V2 (35% → 55%)
- Sensitivity labels (psychiatric, STI, reproductive, substance, genetic, VIP)
- Break-glass emergency access with justification + 4-hour auto-expiry
- Safety-exception records (allergy/vaccination always visible regardless of consent)
- Purpose-based consent types (view_summary, view_full, emergency_access)
- Access logging with type tracking (nid_lookup, emergency_override)

### BD-Core FHIR (25% → 40%)
- Patient profile with NID extension (`bd-nid`), BRN extension (`bd-brn`)
- Address with upazila extension (`bd-upazila`)
- Terminology infrastructure tables (ICD-11, SNOMED CT, LOINC seeded)
- Concept mapping tables for cross-terminology translation

### Health Card Lifecycle (NEW → 60%)
- Versioned card model (active/revoked/expired/replaced/stale)
- Issue endpoint — generates token + card, version = max+1
- Revoke endpoint — deactivates token, optional replacement chain
- List endpoint — cards with token expiry/access info
- Staleness detection — auto-marks cards stale on critical data changes
- RBAC on all card endpoints (clinical staff only)
- UNIQUE constraint on (tenant_id, patient_id, version)
- Migration 0101 — `health_cards` table with full lifecycle columns

### Tech Debt Fixed
- **95 Drizzle schema tenant_id columns** normalized from `integer` to `text` (matching context middleware)
- **Route files cleaned** — removed `Number(tenantId)` wrapping in 5 route files
- **billing.ts / billingMaster.ts** — fixed `createdBy`/`receivedBy` casts
- **98 new tests** — all passing (mpi-scoring unit, unmerge integration, health card lifecycle, schema validation, staleness)
- **0 TypeScript errors** after full `tsc --noEmit`

### Code Review Fixes Applied
- Health card endpoints RBAC added (was missing)
- Card revocation SQL tenant_id scoping (defense-in-depth)
- Phonetic normalizer ordering fixed (digraphs before double-collapse)
- markCardsStale error handling (was fire-and-forget)
- tenant_id comparison type mismatch fixed in healthRecord.ts

---

## What Was Built in "Deepen the Foundations" (Apr 9)

### FHIR Write APIs (40% → 55%)
- **POST /fhir/Patient** — creates patient from FHIR resource, NID extraction, BD-Core compliance, returns FHIR Patient + Location header
- **POST /fhir/Observation** — creates vitals from LOINC-coded observations, BP panel support (systolic+diastolic components), reverse LOINC-to-column mapping
- **POST /fhir/Encounter** — creates visit from FHIR Encounter, AMB/IMP/EMER class mapping, ICD-10 extraction from reasonCode
- **CapabilityStatement updated** — Patient, Observation, Encounter now declare `create` interaction
- **Zod validation** — `src/schemas/fhir.ts` with strict FHIR resource validation

### Health Card Staleness Expanded (60% → 65%)
- **Allergy staleness hooks** — `markCardsStale()` now called on POST, PUT, and DELETE in `src/routes/tenant/allergies.ts`
- Cards go stale on allergy add, modify, or remove (not just blood group changes)

### Merge Safety (MPI Risk Mitigation)
- **Migration 0103** — `patient_merge_map` table for record-level FK tracking
- **Merge endpoint updated** — each moved record gets a row in `patient_merge_map` (table_name, record_id, original_patient_id, target_patient_id)
- Enables precise unmerge — query the map instead of guessing from timestamps

### Terminology Integration (30% → 40%)
- **Migration 0102** — `loinc_code` column added to `lab_test_catalog` table
- Index on loinc_code for fast lookup
- Groundwork for FHIR lab result interop

### Identity Claim Flow (NEW) (65% → 78%)
- **Global identity claim lifecycle schema** — `claim_status`, `claimed_auth_user_id`, `claimed_at`, `created_source`, `created_tenant_id`, and tenant patient linkage via `patients.global_identity_id`
- **Nullable global NID support** — hospital-created or self-signup identities can now exist before verified NID is known
- **Shared resolver service** — one place for `UHID -> NID -> BRN -> phone -> email` lookup and unclaimed identity creation
- **Tenant registration now resolves global identity first** — hospital patient creation links to existing global identity or creates one unclaimed record, then stores `uhid` + `global_identity_id` in patient row
- **Portal registration now claims existing identity** — if an unclaimed card already exists, self-signup attaches auth to the same identity instead of creating duplicate person records
- **Explicit `/patient-auth/claim-card` flow** — hospital-created cards can be claimed later by the patient
- **Claim hardening** — unverified cards with no stored phone/NID can no longer be claimed using UHID alone
- **Claim monitoring surface** — tenant admins can now review claim failures, successful claims, printable code issuance, and top failure reasons from one place
- **Public token abuse controls** — summary-link access now enforces KV-backed invalid-attempt lockout and valid-token throttling

### Drug Safety + Clinical Terminology (40% → 55%)
- **ICD-11 diagnosis validation** — diagnosis workflow now verifies codes against seeded terminology and stores canonical titles instead of arbitrary free text
- **Severe allergy contraindication blocking** — prescription create/update now blocks severe and life-threatening drug-allergy conflicts
- **Cross-reactivity logic** — includes family-level matching for common penicillin-class risks
- **Curated washout checks for recently discontinued high-risk medications** — recently stopped MAOI-family drugs and fluoxetine can now block unsafe prescribing during residual-risk windows

### Provenance Foundation (Vision Alignment)
- **Normalized provenance in portable summary** — allergies, medications, diagnoses, and vitals now expose structured `source`, `recorded_by`, and verification metadata
- **Verified-by-professional signal** — summary consumers can distinguish patient-reported medication entries from clinician-entered or clinician-verified records

---

## System Strengths (Report Match)

### 1. Hospital Operations — EXCELLENT (85%)
| Report Phase 1 Feature | Status | Notes |
|---|---|---|
| Registration/MPI | ✅ Built + Enhanced | Probabilistic matching, unmerge |
| Patient Login (reusable) | ✅ Built | Global UHID, Google SSO, PBKDF2, claim-aware portal auth |
| Appointment/Token | ✅ Built | appointments.ts, queue.ts, QR tokens |
| OPD EMR | ✅ Built | Consultations, SOAP, CAMOS, vitals, allergies |
| Orders | ✅ Built | Lab, procedure, pharmacy orders |
| Lab | ✅ Built | Full LIS, HL7 parsing, critical thresholds |
| Pharmacy | ✅ Built | Batch tracking, e-Prescribing |
| Billing | ✅ Built | Provisional, insurance, IP, cancellation |
| Discharge Summary | ✅ Built | Full discharge planning |
| Patient Portal | ✅ Built + Unified | One patient dashboard now surfaces global tools, hospital services, family graph, trust badges, guidance, visit pass, and emergency pack |
| Consent | ✅ Enhanced | V2 with sensitivity, break-glass, safety-exceptions |
| Audit | ✅ Built | System + patient portal audit |
| FHIR Gateway | ✅ Enhanced | BD-Core extensions + FHIR write APIs (POST Patient/Observation/Encounter) |
| Health Cards | ✅ NEW | Versioned, revocable, staleness detection, unclaimed→claimed lifecycle |

### 2. Multi-Tenancy — EXCELLENT (95%)
### 3. Security — STRONG (80%)
### 4. Patient Identity — STRONG (78%, was 40%)

---

## Remaining Gaps — What's Left

### Gap 1: MPI — Remaining Work (65% → target 90%)
| Item | Status | Priority |
|---|---|---|
| Probabilistic matching | ✅ Done | — |
| Unmerge with temporal FK | ✅ Done | — |
| Verification status tiers (unverified→self→staff→govt) | ✅ Done | — |
| Alias/name history | ✅ Done | — |
| Guardian/relationship model (minors with BRN) | ✅ Done | — |
| Merge map table (record-level, not JSON snapshot) | ✅ Done | — |
| Global patient resolution before tenant registration | ✅ Done | — |
| Unclaimed hospital card → later patient claim | ✅ Done | — |
| Cross-tenant duplicate scan (legacy/import cleanup safety net) | 🟡 Still useful | LOW |

### Gap 2: FHIR BD-Core — Remaining Work (60% → target 80%)
| Item | Status | Priority |
|---|---|---|
| BD-Core Patient profile (NID, BRN, upazila ext) | ✅ Done | — |
| Terminology tables (ICD-11, SNOMED, LOINC) | ✅ Seeded | — |
| FHIR write APIs (POST Patient, Observation, Encounter) | ✅ Done | — |
| CapabilityStatement BD-Core conformance | ✅ Done | — |
| LOINC codes linked to lab test catalog | ✅ Column added | — |
| ICD-11 MMS in diagnosis workflow | ✅ Done | — |
| FHIR Subscription for notifications | ❌ Missing | PHASE 3 |
| $everything operation | ❌ Missing | PHASE 3 |

### Gap 3: Health Cards — Remaining Work (75% → target 85%)
| Item | Status | Priority |
|---|---|---|
| Versioned cards with lifecycle | ✅ Done | — |
| Issue/revoke/replace workflow | ✅ Done | — |
| Staleness on blood group change | ✅ Done | — |
| Staleness on allergy/medication changes | ✅ Done | — |
| Hospital-created unclaimed card → patient claim | ✅ Done | — |
| Claim without any stored verifier blocked | ✅ Done | — |
| Printable one-time claim code fallback | ✅ Done | — |
| Token rate-limiting / lockout | ✅ Done | — |
| Claim-attempt rate limiting + abuse monitoring | ✅ Done | — |
| Staff-assisted activation fallback | ✅ Done | — |
| Claim review queue / admin monitoring surface | ✅ Done | — |
| SMART Health Card format | ❌ Missing | PHASE 3 |

### Gap 4: Consent — Remaining Work (55% → target 80%)
| Item | Status | Priority |
|---|---|---|
| Sensitivity labels | ✅ Done | — |
| Break-glass emergency | ✅ Done | — |
| Safety-exception records | ✅ Done | — |
| Doctor/org-level block list | ✅ Done | — |
| Patient-visible audit in portal | ✅ Done | — |
| Fine-grained clinical area scoping | ❌ Missing | MEDIUM |
| Default treatment-purpose access rules | ❌ Missing | MEDIUM |

### Gap 5: Terminology — Remaining Work (55% → target 70%)
| Item | Status | Priority |
|---|---|---|
| Terminology tables + concept mapping | ✅ Seeded | — |
| LOINC column on lab_test_catalog | ✅ Done | — |
| Drug-allergy interaction checking | ✅ Basic severe blocking done | — |
| ICD-11 codes in diagnosis workflow | ✅ Done | — |
| Drug interaction engine | ✅ Done | MEDIUM |

### Gap 6: Next-Generation Ecosystem & AI (New Vision) (20% → target 80%)
| Item | Status | Priority |
|---|---|---|
| **Dual-Layered Data Architecture** (Patient-sourced vs Doctor-verified) | 🟡 Very strong partial with chart/source/print provenance coverage | HIGH |
| **Patient-Reported Outcomes** (Lifestyle, sleep, diet, mood logs) | 🟡 Basic module done | HIGH |
| **Active ADR Tracker** (Patients logging own side effects) | 🟡 Basic module done | HIGH |
| **AI Physician Summary** (30-sec Gemini context snapshot) | 🟡 Strong partial with family-history weighting and explicit provenance flags | CRITICAL |
| **Family Health Graph** (Linked hereditary risk mapping) | 🟡 Strong partial with governed managed profiles, multi-manager controls, and hereditary watchlist analytics | MEDIUM |
| **Smart IoT/Wearable Integration** (Apple HealthKit/Google Fit) | ⏭️ Deferred intentionally to future Phase 3 | PHASE 3 |
| **Universal NFC Emergency Profile** (Zero-friction ER access) | 🟡 Strong partial with patient emergency pack packaging | PHASE 2 |
| **Patient Data Ownership & Temporary Consent Tokens** | 🟡 Strong partial via simple Visit Pass + patient UX | PHASE 2 |
| **Patient-Facing Guidance Layer** (plain-language next steps and trust summary) | 🟡 Strong partial | HIGH |
| **Unified Patient Portal Hub** (one patient-facing entry point) | 🟡 Strong partial with legacy portal retired into redirect | HIGH |

---

## Phase 2/3 Gaps (Unchanged)

| Gap | Status | Priority |
|---|---|---|
| Data provenance (patient vs doctor vs imported) | 🟡 Very strong partial | Phase 2 |
| IPS (International Patient Summary) export | ❌ Missing | Phase 3 |
| openEHR CDR evaluation | ❌ Not started | Phase 3 |
| SMART App Launch (OAuth for EHR apps) | ❌ Missing | Phase 3 |
| Zero Trust architecture | 🟡 Partial | Phase 2 |
| Developer portal / sandbox | ❌ Missing | Phase 3 |
| Provider registry (shared) | ❌ Missing | Phase 2 |
| NID checksum validation (17-digit smart NID) | ❌ Missing | Phase 2 |
| UHID format alignment with DGHS spec | ❌ Missing | Phase 2 |

---

## Next Action Plan

### Immediate (Next 2-3 days) — Production Hardening

```
Sprint 1: Card Claim Hardening + Safety
├── Claim-attempt rate limiting on `/patient-auth/claim-card` ✅
├── Reissue / invalidate printable claim codes cleanly ✅
├── Staff-assisted claim/activation flow for patients without phone OTP ✅
└── Claim review queue / admin monitoring surface ✅

Sprint 2: Consent Granularity
├── Fine-grained clinical area consent scoping
├── Default treatment-purpose access rules
└── Consent expiry auto-cleanup
```

### Short-term (Weeks 2-4) — Hospital Depth
```
Priority: Data Provenance
├── Source enum on remaining clinical data (hospital | patient | imported) 🟡 Most chart-critical surfaces now covered
├── Visual distinction in frontend/API surfaces 🟡 Doctor chart/source/print + patient key trust badges now live
└── Clinical review workflow for patient-submitted data ✅

Priority: Security Hardening
├── NID checksum validation (17-digit smart NID)
├── Claim review queue / suspicious activity dashboard
├── Service-to-service auth prep
└── Public token anomaly audit / alerting

Priority: Medication Safety
├── Drug-drug interaction engine ✅
├── Active-medication + same-order safety checks ✅
└── Historical-medication washout rules ✅ Curated high-risk support done

Priority: Patient-Generated Context
├── Patient ADR + lifestyle capture APIs ✅
├── Doctor chart/source-panel surfacing ✅
├── Timeline + citation-ready source graph for patient-reported data ✅
└── AI summary composition over Layer A + Layer B ✅ (hybrid deterministic + AI fallback)
```

### Medium-term (Months 2-3) — Core Ecosystem & AI Vision
```
Priority: Next-Gen Patient Ecosystem
├── Patient-reported lifestyle & ADR (side-effect) module ✅
├── "Verified by Doctor" data tagging and dual-layer architecture 🟡 Chart-critical surfaces now strongly covered
├── AI Physician Summary dashboard (Gemini integration) 🟡 Doctor-facing hybrid live with family-history weighting; patient-facing guidance live
├── Emergency QR/NFC profile backend 🟡 Patient emergency pack and print packaging live
├── Simple patient-controlled Visit Pass sharing 🟡 Wallet-style print/share packaging live
└── Unified patient portal hub 🟡 Global and hospital tools now surfaced from one dashboard, but native wallet export/NFC provisioning still future work

Priority: FHIR Maturity
├── FHIR Subscription for notifications
├── $everything operation
├── IPS export (WHO-compatible)
└── SMART App Launch
```

### Long-term (Months 4-6) — Advanced Ecosystem
```
Priority: Interoperability & Hardware
├── Universal NFC Emergency Profile 🟡
├── Patient Visit Pass UX/wallet packaging 🟡 Print/history done, wallet export pending
├── Wearable/IoT continuous data sync (HealthKit/Google Fit) ⏭️ Future only, intentionally deferred
└── Family Health Graph & Hereditary Risk Analysis 🟡 Managed graph + governance + doctor-facing hereditary analytics now live

Priority: Data Provenance
├── Source enum on remaining clinical data (hospital | patient | imported)
├── OpenAPI documentation
├── Sandbox environment
└── Conformance test suite
```

---

## Honest Comparison: Report Vision vs Current Reality (Updated)

| Report Recommendation | Status (Apr 8) | Status (Apr 9) | Gap Level |
|---|---|---|---|
| Hybrid health ecosystem platform | Good SaaS, not ecosystem | SaaS + identity + cards + consent v2 + FHIR write | 🟢 Strong |
| Registry-first approach | Per-tenant, basic global | Probabilistic MPI + unmerge + merge map | 🟢 Strong |
| Modular monolith | Monolith, modular code | Same (OK for now) | 🟢 Fine |
| Patient portal abstraction | Direct D1 queries | Same (OK for now) | 🟡 Fine |
| FHIR R4-first external APIs | Read-only facade | Read + Write (Patient/Obs/Encounter) + CapabilityStatement | 🟢 Good |
| Consent model with patient control | Basic consent | V2 + block list + audit visibility + break-glass | 🟢 Strong |
| ICD-11 MMS mandatory | ICD-10 only | ICD-11 tables seeded, not in workflow | 🟡 Tables ready |
| One-person-one-ID governance | UHID exists | + probabilistic matching + merge map + claim lifecycle | 🟢 Strong |
| Merge/unmerge workflow | Merge only | Full merge + unmerge + record-level merge map | ✅ Done |
| Health card lifecycle | Tokens only | Versioned cards + revocation + allergy staleness + claim gating | ✅ Done |

---

## Final Verdict (Updated)

> **Progress:** The platform now has a real global identity lifecycle: hospital-first creation, patient-later claim, and one permanent UHID across tenants. Combined with FHIR write APIs, ICD-11 validation, and basic severe drug-allergy blocking, the system has moved beyond "good hospital SaaS" into a credible ecosystem foundation.

> **What's still needed:** Core claim safety is now in place with claim codes, staff activation, throttling, monitoring, and public token access limits. The next depth items are consent granularity, Apple Wallet certificate-backed signing, real NFC hardware workflows, NID checksum validation, provider registry/shared directory work, and wearable sync as an explicitly deferred future Phase 3 capability.

> **Risk:** The UHID claim model is now structurally sound for low-cost rollout. Provenance now exists in portable summaries, chart payloads, source-detail views, chart print output, the clinical review inbox, the cross-hospital timeline, the patient-reported ADR/lifestyle module, the new hybrid physician summary, and key patient-portal surfaces such as self-reported data and health-vault documents. The remaining risk is no longer "missing provenance foundation" but "uneven long-tail adoption" in the smaller modules outside the doctor chart core.

> **New ecosystem progress:** Emergency cards can now expose a dedicated minimal public profile for QR/NFC-style scans, limited to lifesaving data such as blood group, important allergies, active medications, active conditions, and emergency contacts. On top of that, the patient portal can now issue a simple short-lived Visit Pass so a patient can hand one QR/code to a new hospital and automatically grant summary-only cross-hospital access without configuring granular permissions. The Visit Pass now also has patient-facing QR rendering, history/status, printable handoff cards, and a real Google Wallet save-link path when issuer credentials are configured. Emergency packs now use the same wallet-export contract, while Apple Wallet remains source-only until certificate signing is enabled. This is the right low-friction privacy boundary for Bangladesh-style operational reality, but full Apple signing and real NFC hardware workflows are still future work.

> **Patient guidance progress:** The patient dashboard now includes a plain-language guidance card that explains what changed, what needs attention, and which records are doctor-reviewed versus still pending review. This keeps the portal useful for low-literacy users without exposing risky diagnostic-style AI advice.

> **Packaging progress:** The Global Health Portal now lets the patient generate a compact emergency pack and print-ready Visit Pass / emergency handoff cards with QR payloads. It also restores active wallet actions from the portal later, so the patient does not lose the packaging after refresh. Google Wallet save links are now supported when issuer credentials are configured, while Apple Wallet remains an explicitly honest source-only fallback until certificate signing is enabled.

> **Portal unification progress:** The old tenant-specific patient portal UI is now retired into a redirect, and the main patient dashboard has become the real hub. From one place, the patient can now see profile completion, self-reported health data, health-vault documents, selected-hospital services such as appointments/messages/reviews, and global tools such as Visit Pass, emergency pack, linked hospitals, family graph, and access/privacy surfaces. This is much closer to the intended Bangladesh-friendly product shape because patients no longer need to understand separate "tenant portal" versus "global portal" concepts just to use core features.

> **Patient vault progress:** The patient vault is no longer only a link placeholder. Photos are now compressed in the browser before upload, supported files are stored in R2-backed vault storage, and the patient can open them again through protected vault routes. External secure links still work for cases where the document already lives somewhere else. The vault now also supports patient-side rename, replace, and delete actions, so this module is no longer just a capture surface; it is now a manageable personal record locker.

> **Family graph progress:** The patient portal now has a real global family graph instead of only loose tenant-level family links. A logged-in family member can create a managed child profile without forcing a second login, or link an existing hospital-created card using UHID plus positive proof such as claim code or a stored verifier. Adult dependent creation is now hardened so unverified phone/NID values cannot pre-bind another person's future record. Claimed adult accounts now use an explicit proxy-invite flow, so adults with their own portal login can accept or decline family-manager access from inside their own account. One profile can now have multiple active managers with a single primary manager, primary transfer, revoke, and automatic fallback promotion if the primary manager steps away. On top of that, the family graph computes a non-diagnostic hereditary watchlist from linked biologic relatives' recorded diagnoses, surfacing family patterns around diabetes, heart disease, stroke, hypertension, asthma, and kidney disease. Those same signals now feed into the doctor chart brief and source panel as cited family-history context, with chart-specific risk scoring and preventive screening prompts instead of only plain watch labels. This is now a credible Bangladesh-friendly family-management baseline for child accounts, caregiver-managed elderly accounts, adult family delegation, and doctor-facing preventive family-history review.

---

## Decision Points (Updated)

1. ~~FHIR write APIs~~ → Done (POST Patient/Observation/Encounter). **New:** FHIR PUT for updates?
2. ~~openEHR evaluation~~ → Deferred to Phase 3 (D1 is fine for now)
3. ~~Patient card staleness~~ → Done (blood group + allergy triggers). **New:** SMART Health Card format?
4. ~~Merge map~~ → Done (record-level). **New:** claim-code fallback before OTP?
5. **Pilot hospital:** Controlled pilot is reasonable only if card claim uses staff activation or printed claim code
6. ~~ICD-11 depth~~ → Core validation now wired. **New:** diagnosis UX/search quality and coding coverage depth
7. **Drug interactions:** Build custom engine or integrate external API (e.g., DrugBank)?

---

## Production Note: No-OTP Claim Options

If SMS OTP budget is not available yet, the minimum acceptable low-cost options are:

1. **Printed claim code** — hospital prints a one-time claim code on a separate activation slip or discharge/registration receipt; patient uses `UHID + claim code + password`
2. **Staff-assisted activation** — reception verifies ID physically and marks card as "ready to claim", then patient completes portal setup
3. **Manual approval queue** — patient submits claim request, hospital staff approves from dashboard, then claim link activates

**Do not print the claim code permanently on the health card itself.** If the card is lost or photographed, the claim channel is exposed for the whole validity window. The better pattern is: permanent card shows `UHID`; temporary slip shows `claim_code`.

**Do not ship broad public claiming with UHID-only knowledge.** Current code now blocks claim when no stored verifier exists, supports printable claim codes, throttles claim attempts, supports staff-assisted activation, provides claim monitoring, and rate-limits public summary token access. The next production-quality improvements are broader provenance coverage and anomaly alerting for unusual token access patterns.
