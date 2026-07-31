# HMS Web Platform — Scope Clarification

> **Decision Date:** 2026-04-24
> **Decision:** Patient-facing mobile app (wellness, lifestyle, tracking) is being built as a **separate Flutter app**. The HMS web platform focuses purely on **hospital operations, admin dashboards, and backend APIs**.

---

## What is OUT of Scope (Flutter App Handles These)

The following features exist in the codebase but are **not required for web deployment** — they are part of the separate Flutter patient app:

| Feature | Location | Status |
|---------|----------|--------|
| Food Photo AI | `src/routes/food.ts` | Exists but for Flutter |
| Barcode Scanner | `components/patient/BarcodeScanner.tsx` | Flutter |
| Document Scanner | `components/patient/DocumentScanner.tsx` | Flutter |
| HealthKit/Health Connect | `components/patient/DeviceSyncCard.tsx` | Flutter |
| Activity Rings | `components/patient/ActivityRings.tsx` | Flutter |
| PHQ-9/GAD-7 Screening | `components/patient/MentalHealthScreen.tsx` | Flutter |
| Breathing Exercises | `components/patient/BreathingExercise.tsx` | Flutter |
| Meditation Timer | `components/patient/MeditationTimer.tsx` | Flutter |
| Crisis Safety Net | `components/patient/MentalHealthScreen.tsx` | Flutter |
| Cycle Tracking | `components/patient/CycleTracker.tsx` | Flutter |
| Pregnancy Mode | `components/patient/PregnancyModeCard.tsx` | Flutter |
| Privacy Lock | `components/patient/PrivacyLockPanel.tsx` | Flutter |
| Ramadan Mode | `components/patient/RamadanModeWidget.tsx` | Flutter |
| Dengue/Monsoon Alerts | `components/patient/SeasonalAlertsWidget.tsx` | Flutter |
| Walking Challenges | `components/patient/WalkingChallengesCard.tsx` | Flutter |
| Women's Health Tab | `components/patient/PatientWomensHealthTab.tsx` | Flutter |
| Food Diary | `components/patient/FoodDiary.tsx` | Flutter |
| Wellness Trends | `components/patient/WellnessTrendsTab.tsx` | Flutter |
| Sleep Module | `components/patient/SleepModule.tsx` | Flutter |
| Activity Module | `components/patient/ActivityModule.tsx` | Flutter |
| Vitals Module | `components/patient/VitalsModule.tsx` | Flutter |
| Patient AI Planner | `components/patient/PatientAIPlannerTab.tsx` | Flutter |
| Achievement Gallery | `components/patient/AchievementGallery.tsx` | Flutter |
| Daily Check-in | `components/patient/DailyCheckInWidget.tsx` | Flutter |
| Streak Tracker | `components/patient/StreakTrackerCard.tsx` | Flutter |
| Goal Setting | `components/patient/GoalSettingModal.tsx` | Flutter |
| Symptom Logger | `components/patient/SymptomLoggerModal.tsx` | Flutter |
| Medicine Tracker | `components/patient/MedicineTrackerTab.tsx` | Flutter |
| Water/Medicine reminders | `components/patient/MedicineReminders.tsx` | Flutter |
| Family Health | `components/patient/PatientFamilySection.tsx` | Flutter |
| Patient Vault/PHR | `components/patient/PatientVaultTab.tsx` | Flutter |
| Global Records | `components/patient/PatientRecordsSection.tsx` | Flutter |
| Health Tips Feed | `components/patient/HealthTipsFeed.tsx` | Flutter |
| Wellness Content Player | `components/patient/WellnessContentPlayer.tsx` | Flutter |
| AI Buddy Chat | `components/patient/AIBuddyChat.tsx` | Flutter |
| Notification Permission | `components/patient/NotificationPermission.tsx` | Flutter |
| Smart Cards | `components/patient/SmartCardRenderer.tsx` | Flutter |
| Personalized Greeting | `components/patient/PersonalizedGreeting.tsx` | Flutter |
| Insights Cards | `components/patient/InsightsCards.tsx` | Flutter |
| Score Trend Chart | `components/patient/ScoreTrendChart.tsx` | Flutter |
| Push Notifications | `src/lib/push-notifications.ts` | Flutter |

---

## What is IN Scope (Web Platform Only)

The web platform (`web/` and `apps/ozzyl-lifestyle/`) handles:

### Core Hospital Operations
- [x] Patient Management (CRUD, UHID, demographics)
- [x] OPD / Reception (appointments, queue, token system)
- [x] Doctor Consultation (prescriptions, clinical notes, vitals)
- [x] IPD / Admissions (beds, wards, discharges)
- [x] Billing & Payments (invoices, payments, insurance)
- [x] Laboratory (test orders, results, machines, signatories)
- [x] Pharmacy (inventory, dispensing, sales, stock)
- [x] Radiology (orders, reports, DICOM)
- [x] OT / Surgery (scheduling, checklists)
- [x] Emergency (triage, MLC, ambulance)
- [x] Dental (charts, procedures)
- [x] Maternity (ANC, delivery, newborn)
- [x] Nursing (vitals, IO chart, medication admin)
- [x] Ward Supply (requisitions, dispatches)
- [x] Inventory (stock, purchases, suppliers)
- [x] HR / Payroll (staff, attendance, leaves, salary)
- [x] Accounting (income, expense, journal, reports)
- [x] Reports & Analytics (KPIs, dashboards)

### Admin & Settings
- [x] Role-based Access Control (RBAC)
- [x] User Management
- [x] Department Management
- [x] Branch Management (multi-branch)
- [x] Settings (hospital profile, print templates)
- [x] Audit Logs
- [x] System Health (super admin)

### Marketplace (Web)
- [x] Hospital public directory
- [x] Doctor public profiles
- [x] Patient discovery UI (`PatientFindCareTab`)
- [x] Booking from marketplace
- [x] Review system + moderation
- [x] Location-based search
- [x] **Hospital booking queue** (just added source filter)
- [x] Hospital Setup Wizard (post-registration)
- [ ] Telemedicine video calls (Cloudflare Calls) — needs infra
- [ ] Cross-hospital referrals

### Compliance & Bangladesh-specific
- [x] SSF Insurance (Social Security Fund)
- [x] MLC (Medico-Legal Case) management
- [x] Biomedical waste tracking
- [x] Consent management
- [x] BMDC doctor registration
- [x] Bengali (BN) localization

---

## Remaining Web Platform Gaps

### High Priority
1. **Telemedicine Video Calls** — Cloudflare Calls or WebRTC integration
2. **Hospital Booking Queue** — Hospital staff can see incoming marketplace bookings (source filter added, needs dedicated queue page)
3. **Cross-Hospital Referrals** — Send/receive patient referrals between hospitals
4. **SMS Notifications** — Appointment reminders via SMS (bKash/Nagad provider)
5. **WhatsApp Integration** — Business API for reminders
6. **Subscription Tiers** — Free/Pro/Enterprise feature gating
7. **Payment Gateway** — bKash, Nagad, card integration
8. **Quality Metrics Dashboard** — Hospital ranking, quality scores

### Medium Priority
9. **Advanced Analytics** — Predictive analytics, cohort analysis
10. **AI Features for Doctors** — Clinical decision support, differential diagnosis
11. **Inventory Forecasting** — Auto-reorder suggestions
12. **Lab Integration (LIS)** — Machine interfacing, HL7/FHIR

### Low Priority
13. **Website Builder** — Public hospital website generator
14. **Blog/CMS** — Hospital content management
15. **Marketing Tools** — Campaigns, patient outreach

---

*Last updated: 2026-04-24*
