# HMS Maturity Assessment & Gap Analysis Report

**Date:** April 20, 2026  
**System:** Ozzyl HMS  
**Compared Against:** OpenEMR 7.x  
**Total Routes:** 203 | **Total Pages:** 177 | **Migrations:** 153

---

## Executive Summary

Overall maturity: **~75-80% of a production-grade HMS**. Significantly ahead of OpenEMR in hospital operations (IPD, pharmacy, accounting, HR, multi-department). Behind in clinical intelligence (CDS, drug DB, structured forms) and interoperability depth.

---

## 1. STRONG / MATURE Areas (Production-Ready)

| Module | Routes | Pages | Maturity |
|--------|--------|-------|----------|
| Billing & Finance | 19 | 12 | ★★★★★ — Provisional, handover, insurance, cancellation, deposits, settlements |
| Pharmacy | 3 | 27 | ★★★★★ — PO, GR, invoicing, narcotics, expiry, dispatch, tax |
| IPD / Operations | 15 | 14+ | ★★★★★ — OT, emergency, housekeeping, laundry, kitchen, CSSD, ambulance, mortuary, blood bank |
| Accounting | 5 | 9 | ★★★★ — Chart of accounts, journal, P&L, shareholders |
| HR / Staff | 6 | 6 | ★★★★ — Payroll, roster, biometric, leave, attendance |
| Patient Management | 7 | 9 | ★★★★ — MPI, duplicate detection, amendments, portal, timeline |
| Inventory | 12 | 4+ | ★★★★ — PO, RFQ, GR, dispatch, return, assets, write-off |
| Nursing | 12 | 1 | ★★★★ — MAR, IV drugs, I/O charts, wound care, handover (backend ready, frontend behind) |
| Multi-tenant / Branch | ✅ | ✅ | ★★★★ — Full tenant isolation, multi-branch dashboards |

---

## 2. PARTIALLY BUILT — Needs More Depth

| Module | What Exists | What's Missing |
|--------|------------|----------------|
| Clinical Forms | assessments, care-plans, ROS, SDOH, physical exam, eye exam, glucose, diet | PHQ-9/GAD-7 structured scoring, pain map, functional/cognitive status |
| Laboratory | 4 routes, 6 pages | HL7v2 LIS integration, auto-flagging abnormal results, cumulative result view, micro/sensitivity |
| Radiology | 5 routes, 1 page | PACS viewer in-app, DICOM worklist |
| Nursing UI | 12 backend routes, 1 frontend page | Dedicated pages for MAR, I/O charts, wound care, handover, monitoring |
| Interoperability | FHIR, C-CDA, bulk-FHIR routes | SMART on FHIR, Blue Button, Direct Messaging, HL7v2 |
| Reporting | 2 pages + 4 report routes | Report builder, MIS reports, government HMIS forms |

---

## 3. SIGNIFICANT GAPS

| # | Gap | Priority | Details |
|---|-----|----------|---------|
| 1 | Clinical Decision Support (CDS) | CRITICAL | Drug-drug interaction, allergy alerts, dose-range checking |
| 2 | Clinical Reminders | CRITICAL | Proactive screening/follow-up alerts |
| 3 | E-Prescribing with Drug DB | HIGH | Need Bangladesh DGDA or RxNorm drug database |
| 4 | Order Sets / Templates | HIGH | Pre-built order bundles for common scenarios |
| 5 | Consent Management | HIGH | Digital consent with e-signature |
| 6 | Document Management | HIGH | Scanned document upload, categorization, OCR |
| 7 | Referral Management | MEDIUM | Inbound/outbound referral tracking |
| 8 | Quality KPIs | MEDIUM | ALOS, readmission rate, mortality rate dashboards |
| 9 | Online Booking | MEDIUM | Patient self-booking from website/app |
| 10 | Field-level Audit Trail | MEDIUM | Compliance-grade change tracking |

---

## 4. HEAD-TO-HEAD: HMS vs OpenEMR

| Category | HMS | OpenEMR | Winner |
|----------|-----|---------|--------|
| OPD/Visit Management | ✅ Full | ✅ Full | Tie |
| IPD (Admission/Bed/Discharge) | ✅ Full | ❌ Minimal | **HMS** |
| Pharmacy + Supply Chain | ✅ 27 pages | ✅ Basic dispensing | **HMS** |
| Operations (OT, Kitchen, CSSD, etc.) | ✅ 15 depts | ❌ None | **HMS** |
| Accounting + Finance | ✅ Full GL | ❌ None | **HMS** |
| HR / Payroll | ✅ Full | ❌ None | **HMS** |
| Multi-tenant / Branch | ✅ Built-in | ❌ Single-instance | **HMS** |
| Telemedicine | ✅ With rooms | ❌ Plugin only | **HMS** |
| Clinical Decision Support | ❌ Missing | ✅ Drug interactions | **OpenEMR** |
| Structured Clinical Forms | Partial | ✅ 50+ forms | **OpenEMR** |
| Interoperability depth | Basic FHIR/CCDA | ✅ 30+ FHIR, SMART, HL7v2 | **OpenEMR** |
| E-Prescribing with Drug DB | Basic | ✅ RxNorm | **OpenEMR** |
| Document/Image Management | Clinical images | ✅ Full DMS | **OpenEMR** |
| Patient Portal depth | Basic | ✅ Blue Button, messaging | **OpenEMR** |

---

## 5. RECOMMENDED IMPLEMENTATION PHASES

### Phase 1 — Patient Safety (Immediate)
1. Drug interaction alerts (CDS) with Bangladesh drug database
2. Allergy cross-check on prescribing
3. Nursing frontend pages (backend already done)

### Phase 2 — Clinical Completeness
4. Structured scoring forms (PHQ-9, GAD-7 from danphe reference)
5. Order sets / templates
6. Lab cumulative results + auto-flagging abnormals

### Phase 3 — Compliance & Documents
7. Consent management with e-signature
8. Document management (upload/scan/OCR)
9. Quality KPI dashboards

### Phase 4 — Interoperability
10. HL7v2 for lab machine integration
11. SMART on FHIR
12. Blue Button patient download

---

## 6. UNIQUE STRENGTHS (Not in OpenEMR)

- Cross-hospital patient sharing (NID/MPI + consent + QR)
- Full IPD lifecycle with 15 operational departments
- Complete pharmacy supply chain (27 pages)
- Full accounting suite with shareholder management
- AI assistant + triage chatbot
- Push notifications + WhatsApp integration
- Telemedicine with video rooms
- Multi-branch management with consolidated dashboards
- Commission tracking for doctors
- Marketplace for doctor/hospital discovery

---

*Report generated: April 20, 2026*
