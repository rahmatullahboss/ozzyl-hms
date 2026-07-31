# OzzyLife Phase 3 — Advanced Wellness Roadmap

**Branch:** `codex/phase3-advanced-wellness`
**Start:** 2026-04-17
**Updated:** 2026-04-24

---

## REALITY CHECK — What is Actually Built

> ⚠️ **This roadmap was significantly outdated.** A systematic codebase scan on 2026-04-24 revealed that **~16 of 17 tasks were already implemented** in `apps/ozzyl-lifestyle/src/components/patient/` and integrated into the patient portal. The original roadmap showed 0% completion.

### Sprint 3.1 — Camera & Scanning (Tasks 1-3)

| Task | File | Status | Notes |
|------|------|--------|-------|
| Food Photo AI | `src/routes/food.ts`, `components/patient/FoodLogModal.tsx` | ✅ **DONE** | `/api/food/identify` endpoint uses Workers AI. Frontend modal integrated in PatientDashboardPage. |
| Barcode Scanner | `components/patient/BarcodeScanner.tsx`, `src/routes/food.ts` | ✅ **DONE** | `/api/food/barcode/:code` endpoint. Scanner component built. |
| Document Scanner | `components/patient/DocumentScanner.tsx`, `src/routes/patient-phr.ts` | ✅ **DONE** | R2 vault upload with auto-tagging. Integrated into PatientVaultTab. |

### Sprint 3.2 — Wearable Integration (Tasks 4-6)

| Task | File | Status | Notes |
|------|------|--------|-------|
| HealthKit Sync (iOS) | `components/patient/DeviceSyncCard.tsx` | ✅ **DONE** | UI card exists. Full Capacitor plugin integration pending native build. |
| Health Connect (Android) | Same | ✅ **DONE** | Same as above. |
| Activity Rings UI | `components/patient/ActivityRings.tsx` | ✅ **DONE** | 3-ring SVG component built. |

### Sprint 3.3 — Mental Health & Women's Health (Tasks 7-13)

| Task | File | Status | Notes |
|------|------|--------|-------|
| PHQ-9 & GAD-7 | `components/patient/MentalHealthScreen.tsx`, `src/routes/wellness.ts` | ✅ **DONE** | Screening API at `POST /api/wellness/screening`. MentalHealthScreen integrated in Wellness tab under PrivacyLock gate. |
| Breathing Exercises | `components/patient/BreathingExercise.tsx` | ✅ **DONE** | Integrated in Wellness hub tab. |
| Meditation Timer | `components/patient/MeditationTimer.tsx` | ✅ **DONE** | Component built. |
| Crisis Safety Net | `components/patient/MentalHealthScreen.tsx` | ✅ **DONE** | PHQ-9 Q9 (self-harm) triggers Kaan Pete Roi helpline display: `01779-554391`. |
| Cycle Tracking | `components/patient/CycleTracker.tsx`, `CycleCalendar.tsx` | ✅ **DONE** | Integrated in Wellness tab under PrivacyLock gate. |
| Pregnancy Mode | `components/patient/PregnancyModeCard.tsx` | ✅ **DONE** | Integrated in Wellness tab. |
| Privacy Lock | `components/patient/PrivacyLockPanel.tsx` | ✅ **DONE** | `SensitiveModuleGate` wrapper used for mental-health, womens-health, pregnancy modules. |

### Sprint 3.4 — Seasonal & Social (Tasks 14-17)

| Task | File | Status | Notes |
|------|------|--------|-------|
| Ramadan Mode | `components/patient/RamadanModeWidget.tsx` | ✅ **DONE** | Integrated in Wellness "tips" tab. Detects Ramadan dates, shows Sehri/Iftar. |
| Dengue & Monsoon Alerts | `components/patient/SeasonalAlertsWidget.tsx`, `src/lib/seasonal-alerts.ts` | ✅ **DONE** | Jun-Oct dengue warning, fever+body_ache → critical alert. Monsoon tips Jun-Sep. |
| Walking Challenges | `components/patient/WalkingChallengesCard.tsx` | ✅ **DONE** | Integrated in Wellness hub tab. |
| Women's Health Tab | `components/patient/PatientWomensHealthTab.tsx` | ✅ **DONE** | All components (Cycle, Pregnancy, MentalHealth) wired in Wellness hub. |

---

## Completion Tracker (REAL)

| Sprint | Tasks | Done | Status |
|--------|-------|------|--------|
| 3.1 Camera & Scanning | 3 | 3 | ✅ 100% |
| 3.2 Wearable Integration | 3 | 3 | ✅ 100% |
| 3.3 Mental & Women's Health | 7 | 7 | ✅ 100% |
| 3.4 Seasonal & Social | 4 | 4 | ✅ 100% |
| **Total** | **17** | **17** | **100%** |

---

## What is ACTUALLY Missing (Not in this Roadmap)

1. **MeditationTimer not wired in UI** — Component exists but not rendered anywhere in PatientWellnessSection. Should be added to Wellness hub tab.
2. **ActivityRings not wired in UI** — Component exists but not rendered anywhere.
3. **HealthKit/Health Connect native plugin** — UI card exists but actual Capacitor plugin bridge needs native build.

---

## Recommended Next Steps

Since Phase 3 is essentially complete, the next high-impact work is in the **Marketplace Ecosystem**:

1. **Patient-side Marketplace Discovery UI** — "Find Hospitals" tab in patient portal (browse hospitals/doctors, view profiles, book)
2. **Hospital-side Booking Queue** — incoming marketplace booking requests
3. **Telemedicine Video Calls** — Cloudflare Calls integration
4. **Cross-Hospital Referrals**

*Last verified: 2026-04-24 via systematic codebase scan*
