# OzzyLife — Current State vs Design Spec Gap Analysis

> Generated: 2026-04-15
> Compares existing patient portal against `docs/superpowers/specs/2026-04-15-ozzylife-health-wellness-app-design.md`

---

## Overall Assessment

The existing patient portal is **surprisingly advanced** — roughly **40-45% of the OzzyLife vision is already built**. The clinical/hospital side is nearly complete. The wellness/consumer side needs the most work. Capacitor and i18n foundations exist but need extension.

---

## Section 1: App Identity & Architecture

| Spec Requirement | Current State | Status |
|-----------------|---------------|--------|
| Hub-and-spoke modular architecture | Dashboard has 13+ tabs, but monolithic single file (1632 lines). Not modular spokes. | 🟡 Partial — tabs exist but need restructuring |
| 4-tab bottom nav (Home/Wellness/Care/Me) | `MobileBottomNav` exists with 5 tabs (home/diary/medicine/services/profile) | 🟡 Partial — needs redesign to match spec |
| Standalone mode (no hospital required) | App requires patient auth but all wellness features work without hospital link | 🟡 Partial — technically works standalone but UX assumes hospital context |
| Connected mode (hospital linked) | Full hospital linking + services working | ✅ Done |
| Consumer brand identity "OzzyLife" | Currently `com.hms.saas` / "Ozzyl HMS" — no consumer branding | ❌ Missing |

---

## Section 2: Home Screen / Smart Dashboard

| Spec Requirement | Current State | Status |
|-----------------|---------------|--------|
| Personalized time-of-day greeting | `PersonalizedGreeting` — has time-aware greeting (সুপ্রভাত/দুপুর/সন্ধ্যা/রাত্রি) with streak badge | ✅ Done |
| Daily Health Score ring (0-100) | `WellnessScoreCard` — SVG ring with 4 mini metric cards. Pure UI, no backend calculation | 🟡 Partial — UI done, score calculation engine missing |
| Quick actions row | `QuickCheckInCard` — mood emoji selector + CTA. `LifestyleQuickActions` — 4 action buttons | 🟡 Partial — exists but not context-aware (doesn't show what's incomplete today) |
| Smart cards (priority-sorted) | No smart card system. Overview tab is static layout | ❌ Missing |
| Streak tracker | `StreakTrackerCard` — 7-day calendar with dots + Bengali motivational text. Pure UI, no persistence | 🟡 Partial — UI done, streak persistence/calculation missing in backend |
| Time-of-day context adaptation | Greeting adapts, but card content doesn't change based on time | ❌ Missing |
| AI Coach FAB button | `AIBuddyChat` — floating chat FAB with unread badge, quick prompts, 10-msg history | ✅ Done |
| Health tips feed | `HealthTipsFeed` — category filter, API-driven personalized tips, bookmark toggle | ✅ Done |

---

## Section 3: Wellness Spoke Modules

### Module 1: Nutrition & Food

| Spec Requirement | Current State | Status |
|-----------------|---------------|--------|
| Bangladesh food database (500+ items) | No food database. No food_items table. No food logging. | ❌ Missing |
| Food logging (search/photo/voice) | No food logging at all. Diet is only a free-text note in daily check-in | ❌ Missing |
| Calorie & macro tracking | No calorie tracking | ❌ Missing |
| Water tracking | ✅ `water_glasses` field in lifestyle_logs + 8-glass grid UI in `DailyCheckInWidget` | ✅ Done |
| Ramadan fasting mode | No Ramadan awareness | ❌ Missing |
| Weekly nutrition report | No nutrition-specific report | ❌ Missing |

### Module 2: Fitness & Activity

| Spec Requirement | Current State | Status |
|-----------------|---------------|--------|
| Step counter (wearable/phone) | No step tracking. Exercise is only `exercise_minutes` in lifestyle_logs | ❌ Missing |
| Activity rings (Move/Exercise/Stand) | No ring UI for activity | ❌ Missing |
| Exercise logging (type/duration/calories) | Only `exercise_minutes` (number) in daily check-in. No activity type, no calories | 🟡 Minimal — needs full exercise logging |
| Workout library | `WellnessContentPlayer` — 6 hardcoded sessions (breathing, meditation, stretching). No video workouts | 🟡 Minimal — has basic content, needs expansion |
| Walking challenges | No challenges system | ❌ Missing |
| Wearable integration | No HealthKit/Health Connect integration. Capacitor plugins not installed | ❌ Missing |

### Module 3: Sleep

| Spec Requirement | Current State | Status |
|-----------------|---------------|--------|
| Sleep logging (bedtime/wake/quality) | `sleep_hours` + quality in daily check-in. No bedtime/wake time tracking | 🟡 Partial — duration logged, no detailed sleep data |
| Sleep score | No sleep score calculation | ❌ Missing |
| Bedtime reminder | No sleep-related push notifications | ❌ Missing |
| Sleep trends | `WellnessTrendsTab` has bar chart for sleep over 7/30/90 days | ✅ Done |
| Sleep hygiene tips | No sleep-specific tips | ❌ Missing |

### Module 4: Mental Health

| Spec Requirement | Current State | Status |
|-----------------|---------------|--------|
| Daily mood check-in (emoji) | `DailyCheckInWidget` — 5 mood options (😄😊😐😟😢) | ✅ Done |
| Mood trends | `WellnessTrendsTab` — area chart for mood over 7/30/90 days | ✅ Done |
| PHQ-9 screening | Not implemented (available in danphe reference to port) | ❌ Missing |
| GAD-7 screening | Not implemented (available in danphe reference to port) | ❌ Missing |
| Breathing exercises | `WellnessContentPlayer` — has 2 breathing sessions with animated SVG circle | 🟡 Partial — basic, needs expansion to 3 patterns |
| Meditation timer | `WellnessContentPlayer` — has meditation session. No standalone timer | 🟡 Partial |
| Stress log | Not implemented. Energy level (1-10) exists but not stress-specific | ❌ Missing |
| Crisis safety net | No crisis detection or helpline display | ❌ Missing |

### Module 5: Vitals & Body Tracking

| Spec Requirement | Current State | Status |
|-----------------|---------------|--------|
| Blood pressure logging | ✅ `global_patient_vitals` — systolic, diastolic logged. UI in PatientReportedDataTab | ✅ Done |
| Blood glucose logging | ✅ `blood_sugar` with fasting/post-prandial context | ✅ Done |
| Weight & BMI | Not tracked in vitals. Weight exists in patient profile but no logging/trends | ❌ Missing |
| Temperature | Not tracked | ❌ Missing |
| Heart rate | ✅ `heart_rate` in vitals table | ✅ Done |
| SpO2 | Not tracked | ❌ Missing |
| Smart alerts (hypertensive crisis, etc.) | No threshold-based alerts | ❌ Missing |
| Vital trend charts | `WellnessTrendsTab` shows trends but not vital-specific charts | 🟡 Partial |

### Module 6: Women's Health

| Spec Requirement | Current State | Status |
|-----------------|---------------|--------|
| Cycle tracking | Not implemented | ❌ Missing |
| Pregnancy mode | Not implemented | ❌ Missing |
| Postpartum mode | Not implemented | ❌ Missing |
| Privacy lock (biometric) | Not implemented | ❌ Missing |

---

## Section 4: Hospital / Care Spoke

| Spec Requirement | Current State | Status |
|-----------------|---------------|--------|
| Hospital directory (search/GPS) | `PatientFindCareTab` — doctor/hospital search + cards + booking | ✅ Done |
| Hospital profile pages | Basic card view. No full profile page | 🟡 Partial |
| Hospital linking flow | Marketplace connect (`/connect/:tenantId`) working | ✅ Done |
| Multi-hospital support | Hospital selector dropdown in `PatientHospitalServicesTab` | ✅ Done |
| Appointments (view/book/cancel) | ✅ Full CRUD + digital check-in + intake forms | ✅ Done |
| Lab results (with interpretation) | ✅ Lab results with normal ranges + explanations + PDF | ✅ Done |
| Prescriptions (list/refill) | ✅ Full list + items + refill request + PDF | ✅ Done |
| Secure messaging | ✅ Doctor messaging with conversation threads | ✅ Done |
| Bills & payments | ✅ Billing history displayed. ❌ No online payment (bKash/Nagad) | 🟡 Partial — display done, payment gateway missing |
| Visit pass (QR) | ✅ Wallet-encrypted QR visit pass with generate/revoke | ✅ Done |
| Emergency pack | ✅ Emergency health pack with public URL | ✅ Done |
| Document vault | ✅ Upload/download/edit/delete + OCR + image compression | ✅ Done |
| Medical records timeline | ✅ Unified chronological timeline | ✅ Done |
| Privacy/consent management | `PatientPrivacyTab` — block hospital/doctor + audit log | 🟡 Partial — basic, needs granular consent toggles per data type |
| Clinical → Wellness bridge | ❌ No auto-population of wellness modules from clinical data | ❌ Missing |
| Symptom checker | Not implemented | ❌ Missing |
| Emergency finder (GPS) | Not implemented | ❌ Missing |

---

## Section 5: AI Coach & Clinical Intelligence

| Spec Requirement | Current State | Status |
|-----------------|---------------|--------|
| Chat interface (FAB) | ✅ `AIBuddyChat` — floating FAB, 10-msg history, 6 quick prompts, Bengali system prompt | ✅ Done |
| Wellness layer (general health Q&A) | ✅ Using OpenRouter (Gemini 2.0 Flash), Bengali persona, rate limited (20/5min) | ✅ Done |
| Clinical layer (hospital data context) | ❌ AI has no access to clinical data. System prompt is generic | ❌ Missing |
| Daily insights (proactive push) | ❌ No insight generation engine. No proactive notifications from AI | ❌ Missing |
| Pre-visit preparation | ❌ Not implemented | ❌ Missing |
| Post-visit follow-up | ❌ Not implemented | ❌ Missing |
| Pattern recognition (correlations) | ❌ Not implemented | ❌ Missing |
| Goal setting via AI | ❌ Not implemented | ❌ Missing |
| Safety boundaries (emergency escalation) | ❌ No emergency keyword detection or helpline integration | ❌ Missing |
| Lab result interpretation | ❌ AI doesn't read lab results | ❌ Missing |

---

## Section 6: Onboarding & Progressive Disclosure

| Spec Requirement | Current State | Status |
|-----------------|---------------|--------|
| 7-screen onboarding flow | Login page has login/register/forgot-password. No wellness onboarding | ❌ Missing |
| Goal selection (determines starter modules) | No goal selection. All features shown equally | ❌ Missing |
| First-week guided experience (Ozzy day 1-7) | No guided onboarding | ❌ Missing |
| Progressive feature unlocking | All features visible from day 1 | ❌ Missing |
| Empty states (every screen) | Some empty states exist but inconsistent | 🟡 Partial |
| Re-engagement (lapsed user nudges) | No re-engagement system | ❌ Missing |

---

## Section 7: Native / Capacitor Capabilities

| Spec Requirement | Current State | Status |
|-----------------|---------------|--------|
| Capacitor project setup | ✅ Capacitor 8.2, iOS + Android directories, `com.hms.saas` | ✅ Done (needs rebrand to `com.ozzylife.app`) |
| Biometric auth | ❌ No biometric plugin installed | ❌ Missing |
| Push notifications | ❌ No push notification plugin. No FCM/APNs setup | ❌ Missing |
| Camera (food photo/barcode/doc scan) | ❌ No camera plugin (vault upload uses HTML file input) | ❌ Missing |
| Wearable sync (HealthKit/Health Connect) | ❌ No health data plugins | ❌ Missing |
| GPS/Location | ❌ No geolocation plugin | ❌ Missing |
| Haptic feedback | ❌ No haptics plugin | ❌ Missing |
| Local notifications (offline meds) | ❌ No local notification plugin | ❌ Missing |
| Offline mode | ❌ No offline storage/sync queue | ❌ Missing |
| Splash screen | ✅ `@capacitor/splash-screen` installed | ✅ Done |
| Status bar | ✅ `@capacitor/status-bar` installed | ✅ Done |

**Installed Capacitor plugins:** Only 4 of 15+ needed — core, app, splash-screen, status-bar.

---

## Section 8: Bangladesh Localization

| Spec Requirement | Current State | Status |
|-----------------|---------------|--------|
| i18n framework | ✅ i18next + react-i18next + HTTP backend + browser language detector | ✅ Done |
| Bangla translations | 🟡 27 namespaces defined but no patient-portal namespace. PHR routes use hardcoded Bengali strings | 🟡 Partial — framework ready, patient portal not translated properly |
| Bangladesh food database | ❌ No food database | ❌ Missing |
| Ramadan mode | ❌ Not implemented | ❌ Missing |
| Cultural health context (dengue/diabetes awareness) | 🟡 Health tips have some Bengali content (12 hardcoded tips with relevance scoring) | 🟡 Minimal |
| bKash/Nagad payment | ❌ No payment gateway | ❌ Missing |
| BD units (kg, mmol/L, ৳) | 🟡 Some Bengali number formatting (`bn-BD`). No unit system configuration | 🟡 Partial |

---

## Section 9: Data Model

| Spec Domain | Current Tables | Status |
|-------------|---------------|--------|
| User account & profile | `global_patient_auth`, `global_patient_identity` | 🟡 Partial — no `wellness_profile` or `wellness_preferences` tables |
| Food logs | ❌ No `food_log`, `food_items`, `meal_templates` tables | ❌ Missing |
| Activity logs | ❌ No `activity_log` table. Only `exercise_minutes` in lifestyle_logs | ❌ Missing |
| Sleep logs | 🟡 `sleep_hours` in lifestyle_logs. No dedicated `sleep_log` | 🟡 Partial |
| Mood logs | 🟡 `mood` in lifestyle_logs. No dedicated `mood_log` with tags | 🟡 Partial |
| Vital logs | ✅ `global_patient_vitals` (BP, HR, glucose) | 🟡 Partial — missing weight, temp, SpO2 |
| Medication tracking | ✅ `global_patient_medicine_reminders` + `global_patient_medicine_adherence` | ✅ Done |
| Stress logs | ❌ No `stress_log` table | ❌ Missing |
| Symptom logs | 🟡 `symptoms` text field in lifestyle_logs. No structured `symptom_log` | 🟡 Minimal |
| Health score | ❌ No `daily_health_score` table or calculation engine | ❌ Missing |
| Weekly reports | ❌ No `weekly_report` table or generation | ❌ Missing |
| Goals & streaks | ❌ No `user_goals`, `streaks`, `achievements` tables | ❌ Missing |
| Challenges | ❌ No `challenges` or `challenge_participants` tables | ❌ Missing |
| AI conversations | 🟡 AI chat works via API but no `ai_conversations` persistence. History passed client-side (10 msgs max) | 🟡 Partial |
| AI insights | ❌ No `ai_insights` or `ai_action_items` tables | ❌ Missing |
| Hospital links | ✅ `patient_health_links` + `health_record_consents` + marketplace connect | ✅ Done |
| Clinical consents | 🟡 `health_record_consents` exists but no AI-specific consent toggles | 🟡 Partial |
| Women's health | ❌ No `cycle_log`, `cycle_predictions`, `pregnancy_tracking` tables | ❌ Missing |
| Food reference DB | ❌ No `food_items` or `meal_templates` tables | ❌ Missing |
| Health tips reference | ✅ `health_tips` table + `patient_tip_feedback` + `patient_tip_engagement` + `patient_tip_scores` | ✅ Done |
| Medications reference | ✅ `master_drugs` + `master_generics` + Medex BD scraping | ✅ Done |

---

## Scoreboard Summary

| Section | Items Done | Items Partial | Items Missing | Completion |
|---------|-----------|--------------|---------------|------------|
| **Sec 1: Architecture** | 1 | 3 | 1 | ~40% |
| **Sec 2: Home Screen** | 3 | 3 | 2 | ~50% |
| **Sec 3: Nutrition** | 1 | 0 | 5 | ~15% |
| **Sec 3: Activity** | 0 | 2 | 4 | ~15% |
| **Sec 3: Sleep** | 1 | 1 | 3 | ~25% |
| **Sec 3: Mental Health** | 2 | 2 | 4 | ~35% |
| **Sec 3: Vitals** | 3 | 1 | 4 | ~40% |
| **Sec 3: Women's Health** | 0 | 0 | 4 | ~0% |
| **Sec 4: Hospital/Care** | 10 | 3 | 3 | ~75% |
| **Sec 5: AI Coach** | 2 | 0 | 8 | ~20% |
| **Sec 6: Onboarding** | 0 | 1 | 5 | ~5% |
| **Sec 7: Capacitor/Native** | 3 | 0 | 8 | ~25% |
| **Sec 8: Bangladesh** | 1 | 3 | 3 | ~25% |
| **Sec 9: Data Model** | 5 | 7 | 10 | ~35% |

### Overall: ~35-40% Complete

---

## What's Strong (Ready to Build On)

1. **Hospital services are nearly complete** — appointments, labs, prescriptions, messaging, visit pass, emergency pack, vault, timeline. This is 75% done.
2. **Auth system is solid** — PBKDF2, Google Sign-In, UHID generation, JWT, magic links
3. **Daily check-in exists** — mood, energy, sleep hours, exercise minutes, water, symptoms, diet notes
4. **Medicine tracker is full-featured** — reminders, adherence tracking, weekly chart, drug search (Medex BD)
5. **AI buddy chat works** — Gemini 2.0 Flash, Bengali persona, rate limited, FAB interface
6. **i18n framework is ready** — i18next fully configured, just needs patient portal namespace
7. **Capacitor is initialized** — iOS + Android directories, Capacitor 8.2
8. **Family hub exists** — dependents, proxy invites, risk insights

## Biggest Gaps (Most Work Needed)

1. **Nutrition/food system** — no food DB, no food logging, no calorie tracking (biggest single gap)
2. **Native capabilities** — only 4 of 15+ Capacitor plugins installed. No push, no biometric, no camera, no wearable sync
3. **AI intelligence layers** — chat works but no clinical awareness, no proactive insights, no pattern recognition, no pre/post visit
4. **Onboarding** — no wellness onboarding flow, no progressive disclosure, no guided first week
5. **Health Score engine** — UI exists but no backend calculation, no persistence, no scoring algorithm
6. **Women's health** — entirely missing
7. **Gamification system** — streaks UI exists but no backend persistence, no achievements, no challenges

## Bugs Found During Audit

1. **patient-phr.ts ~line 1213** — AI buddy rate limit has missing closing parenthesis on `c.env.KV.put()` call
2. **DiaryHistoryTab.tsx** — `sleepQuality` hardcoded as `'deep'` instead of reading from backend field
3. **PatientFindCareTab.tsx** — uses `VITE_API_URL` env var while all other components use relative paths
4. **MedicineTrackerTab.tsx** — fragile 4-level relative import path (`../../../../src/lib/...`)
5. **PatientDashboardPage.tsx** — 1632 lines in one file (should be split into modular spoke components)
