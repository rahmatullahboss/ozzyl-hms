# Patient Portal — Backend vs Frontend Feature Audit

## Problem
Backend has **80+ API endpoints** for health & wellness, but the patient portal frontend has **only 1 route** (`/patient/dashboard`). Many React components exist as files but are either not wired into the dashboard or have no routing.

---

## 🔴 Backend Features WITH NO Frontend UI

### 1. Wellness Core (31 endpoints in `wellness.ts`)

| Backend API | Status | UI Component Needed |
|---|---|---|
| `GET /score` — Health Score | ⚠️ Partial | Health Score Ring/Card on dashboard |
| `GET /score/trend` — Score trend | ❌ Missing | Weekly/Monthly trend chart |
| `GET /streaks` — Habit streaks | ❌ Missing | Streak display widget |
| `POST /streaks/log` — Log streak | ❌ Missing | Streak tap-to-log UI |
| `POST /logs/mood` — Mood logging | ⚠️ Component exists, not wired | Mood picker in Daily Check-in |
| `GET/POST /logs/sleep` — Sleep | ⚠️ Component exists, not wired | Sleep logger + history |
| `GET/POST /logs/activity` — Activity | ⚠️ Component exists, not wired | Activity rings + logger |
| `POST /logs/water` — Water intake | ⚠️ Partial | Water tracker widget |
| `POST /logs/symptom` — Symptoms | ❌ Missing | Symptom logger |
| `POST /logs/batch` — Daily check-in | ⚠️ Widget exists | Needs proper integration |
| `POST /vitals` — Vitals logging | ❌ Missing | BP, Heart Rate, SpO2, Weight, Temp, Blood Sugar form |
| `GET /insights` — AI Insights | ❌ Missing | Insights card/feed |
| `POST /insights/generate` — Generate | ❌ Missing | "Generate Insights" button |
| `GET /achievements` — Badges | ❌ Missing | Achievement gallery |
| `GET/POST/PATCH/DELETE /goals` — Goals | ❌ Missing | Goal setting & tracking UI |
| `POST /sync/wearable` — Wearable sync | ⚠️ Card exists | Needs proper sync flow |
| `GET /daily-totals` — Daily summary | ❌ Missing | Daily summary dashboard |
| `POST /screening` — Mental health (PHQ-9/GAD-7) | ⚠️ Component exists | Needs routing & integration |
| `GET /screenings` — History | ❌ Missing | Screening history page |
| `POST /cycle/log` — Cycle tracking | ⚠️ Component exists | Needs routing & integration |
| `GET /cycle/history` — Cycle history | ❌ Missing | Cycle calendar view |
| `POST /meditation/log` — Meditation | ⚠️ Timer exists | Needs integration |
| `POST /challenges` — Create challenge | ❌ Missing | Challenge creation UI |
| `POST /challenges/:id/join` — Join | ❌ Missing | Challenge join flow |
| `GET /challenges` — List challenges | ❌ Missing | Challenge feed |

### 2. Food & Nutrition (7 endpoints in `food.ts`)

| Backend API | Status | UI Component Needed |
|---|---|---|
| `GET /search` — Food search | ❌ Missing | Food search modal |
| `GET /categories` — Categories | ❌ Missing | Category browser |
| `POST /log` — Log food | ⚠️ FoodLogModal exists | Needs integration |
| `GET /logs` — Food diary | ❌ Missing | Food diary page |
| `POST /identify` — Photo AI | ⚠️ FoodCameraCapture exists | Needs integration |
| `GET /barcode/:code` — Scan | ❌ Missing | Barcode scanner UI |
| `POST /barcode/seed` — Seed data | N/A (admin) | — |

### 3. PHR & Medical Records (20+ endpoints in `patient-phr.ts`)

| Backend API | Status | UI Component Needed |
|---|---|---|
| `GET/POST /vault` — Document vault | ❌ Missing | Document upload & list |
| `POST /vault/upload` — File upload | ❌ Missing | File upload form |
| `GET /reported-data` — Self-reported | ❌ Missing | Reported data form |
| `GET/POST /adverse-reactions` — Allergies | ❌ Missing | Allergy/reaction tracker |
| `GET/POST /lifestyle-logs` — Lifestyle | ⚠️ Partial | Full lifestyle diary |
| `GET/POST /vitals` — Vitals history | ❌ Missing | Vitals dashboard |
| `GET /wellness-trends` — Trends | ❌ Missing | Trend charts page |
| `GET /health-tips` — Tips | ❌ Missing | Health tips feed |
| `GET/POST /medicine-reminders` — Meds | ❌ Missing | Medicine reminder system |
| `POST /:id/take` — Mark taken | ❌ Missing | Tap to mark taken |
| `GET /medicine-adherence/weekly` — Adherence | ❌ Missing | Weekly adherence chart |
| `POST /ai-buddy/chat` — AI Chat | ⚠️ AIBuddyChat exists | Needs integration |
| `GET /master-drugs/search` — Drug search | ❌ Missing | Drug search |

### 4. Global Portal (20+ endpoints in `global-portal.ts`)

| Backend API | Status | UI Component Needed |
|---|---|---|
| `GET /dashboard` — Portal dashboard | ⚠️ Partial | Full dashboard redesign |
| `GET /hospitals` — Linked hospitals | ❌ Missing | Hospital list |
| `GET/POST /ai-plans` — AI Health Plans | ❌ Missing | AI plan viewer |
| `GET/PUT /wellness-hub` — Wellness hub | ❌ Missing | Wellness hub page |
| `GET/POST /family` — Family health | ⚠️ FamilyHealthHub exists | Needs routing |
| `POST /family/proxy-invites` — Invites | ❌ Missing | Invite flow |
| `GET /visit-pass` — Visit pass | ❌ Missing | QR visit pass |

### 5. Notifications (3 endpoints in `notifications.ts`)

| Backend API | Status | UI Component Needed |
|---|---|---|
| `POST /register` — Push registration | ❌ Missing | Push permission UI |
| `POST /send` — Send notification | N/A (server) | — |
| `GET /devices` — List devices | ❌ Missing | Device management |

---

## 🟡 Components That EXIST But Are NOT Routed

These `.tsx` files exist in `web/src/components/patient/` but aren't visible in the live app:

| Component | File | What It Does |
|---|---|---|
| ActivityRings | `ActivityRings.tsx` | Apple Watch-style activity rings |
| BreathingExercise | `BreathingExercise.tsx` | Guided breathing animation |
| CycleTracker | `CycleTracker.tsx` | Period/cycle tracking calendar |
| DailyCheckInWidget | `DailyCheckInWidget.tsx` | Mood + sleep + water check-in |
| MentalHealthScreen | `MentalHealthScreen.tsx` | PHQ-9/GAD-7 screening flow |
| MeditationTimer | `MeditationTimer.tsx` | Meditation session timer |
| FoodCameraCapture | `FoodCameraCapture.tsx` | AI food photo identification |
| FoodLogModal | `FoodLogModal.tsx` | Manual food logging |
| WearableSyncCard | `WearableSyncCard.tsx` | Wearable device sync |
| AIBuddyChat | `AIBuddyChat.tsx` | AI health chatbot |
| FamilyHealthHub | `FamilyHealthHub.tsx` | Family member management |
| ConnectedCareTab | `ConnectedCareTab.tsx` | Hospital connections |
| DeviceSyncCard | `DeviceSyncCard.tsx` | Device management |
| SeasonalAlertsWidget | `SeasonalAlertsWidget.tsx` | Seasonal health alerts |

---

## 🟢 What's Currently LIVE in Patient Portal

Only **1 route**: `/patient/dashboard` → `PatientDashboardPage.tsx`

The dashboard page exists but likely shows a basic version without the Phase 1-3 widgets properly integrated.

---

## 📋 Recommended UI Work Plan

### Priority 1: Dashboard Redesign (Native App Feel)
- Redesign `/patient/dashboard` as a tab-based native-app experience
- **Home Tab**: Health score ring, daily check-in, quick actions, AI insights
- **Activity Tab**: Activity rings, sleep logger, water tracker, vitals
- **Health Tab**: Mental health screening, cycle tracking, meditation, breathing
- **Food Tab**: Food diary, camera capture, barcode scanner
- **Profile Tab**: Document vault, medicine reminders, family hub, linked hospitals

### Priority 2: Missing Pages (New Routes)
- `/patient/vitals` — Vitals logging & trend charts
- `/patient/food` — Food diary & nutrition tracking
- `/patient/mental-health` — Screening history & results
- `/patient/documents` — PHR document vault
- `/patient/medicines` — Medicine reminders & adherence
- `/patient/family` — Family health hub
- `/patient/challenges` — Social challenges

### Priority 3: Native App Polish
- Bottom navigation bar (mobile-first)
- Pull-to-refresh, swipe gestures
- Smooth page transitions & micro-animations
- Dark mode support
- PWA install prompt
