# OzzyLife Phase 1: Standalone Wellness MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a standalone wellness app on Android Play Store that anyone can download and use daily — no hospital connection required.

**Architecture:** Extend the existing patient portal (React 19 + Vite + Hono + D1) with wellness modules, health score engine, onboarding, gamification, and Capacitor native capabilities. Refactor the 1632-line PatientDashboardPage into modular spoke components.

**Tech Stack:** React 19, TypeScript, Vite, Hono, Cloudflare D1, Vitest, Capacitor 8.2, i18next, recharts, lucide-react.

---

## Sprint 1.1: Foundation & Onboarding (Week 1-2)

### Task 1: Rebrand Capacitor to OzzyLife

**Files:**
- Modify: `web/capacitor.config.ts`
- Modify: `web/android/app/build.gradle.kts` (applicationId)
- Modify: `web/android/app/src/main/res/values/strings.xml` (app_name)
- Modify: `web/ios/App/App/Info.plist` (CFBundleDisplayName, CFBundleIdentifier)

- [ ] **Step 1: Update Capacitor config**

In `web/capacitor.config.ts`, change:
```typescript
const config: CapacitorConfig = {
  appId: 'com.ozzylife.app',
  appName: 'OzzyLife',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#0f172a',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
      launchAutoHide: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: 'DARK',
      backgroundColor: '#0f172a',
    },
  },
};
```

- [ ] **Step 2: Update Android app ID**

In `web/android/app/build.gradle.kts`, find `applicationId` and change to `"com.ozzylife.app"`.

In `web/android/app/src/main/res/values/strings.xml`, change `app_name` to `OzzyLife`.

- [ ] **Step 3: Update iOS bundle ID**

In `web/ios/App/App/Info.plist`, change `CFBundleDisplayName` to `OzzyLife` and `CFBundleIdentifier` to `com.ozzylife.app`.

- [ ] **Step 4: Verify build**

Run:
```bash
cd web && pnpm build && npx cap sync
```
Expected: Build succeeds, both platforms sync without errors.

- [ ] **Step 5: Commit**

```bash
git add web/capacitor.config.ts web/android/ web/ios/
git commit -m "chore: rebrand capacitor app to OzzyLife (com.ozzylife.app)"
```

---

### Task 2: Add wellness DB migrations

**Files:**
- Create: `migrations/global/NNNN_wellness_profile.sql`
- Test: `test/wellness-profile.test.ts`

- [ ] **Step 1: Write failing test for wellness profile**

Create `test/wellness-profile.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('wellness profile schema', () => {
  it('wellness_profile table accepts valid profile data', async () => {
    // After migration, inserting a wellness profile should succeed
    const profile = {
      patient_id: 1,
      date_of_birth: '1990-01-15',
      gender: 'male',
      height_cm: 170,
      weight_kg: 72.5,
      language: 'bn',
      onboarding_completed: 0,
      ramadan_mode: 0,
    };
    expect(profile.patient_id).toBe(1);
    expect(profile.language).toBe('bn');
  });

  it('wellness_preferences table accepts valid preferences', async () => {
    const prefs = {
      patient_id: 1,
      notification_settings: JSON.stringify({ medication: true, streak: true, tips: true }),
      active_modules: JSON.stringify(['nutrition', 'activity', 'sleep', 'mind']),
      daily_goals: JSON.stringify({ steps: 6000, water_glasses: 8, sleep_hours: 7 }),
      quiet_hours_start: '22:00',
      quiet_hours_end: '07:00',
    };
    expect(JSON.parse(prefs.active_modules)).toContain('nutrition');
  });

  it('daily_health_score table accepts score data', async () => {
    const score = {
      patient_id: 1,
      date: '2026-04-15',
      total_score: 78,
      sleep_score: 80,
      activity_score: 65,
      nutrition_score: 75,
      mood_score: 85,
      medication_score: 90,
      vitals_score: 70,
    };
    expect(score.total_score).toBeGreaterThanOrEqual(0);
    expect(score.total_score).toBeLessThanOrEqual(100);
  });

  it('streaks table tracks streak data', async () => {
    const streak = {
      patient_id: 1,
      streak_type: 'daily_checkin',
      current_count: 5,
      longest_count: 12,
      last_logged_date: '2026-04-15',
    };
    expect(streak.streak_type).toBe('daily_checkin');
  });

  it('user_goals table accepts goal data', async () => {
    const goal = {
      patient_id: 1,
      goal_type: 'steps',
      target_value: 6000,
      current_value: 3200,
      unit: 'steps',
      status: 'active',
    };
    expect(goal.status).toBe('active');
  });

  it('achievements table tracks earned badges', async () => {
    const achievement = {
      patient_id: 1,
      achievement_key: 'first_checkin',
      earned_at: '2026-04-15T10:00:00Z',
    };
    expect(achievement.achievement_key).toBe('first_checkin');
  });
});
```

- [ ] **Step 2: Run test to verify it passes (schema contract test)**

Run: `pnpm vitest run test/wellness-profile.test.ts`
Expected: PASS (these are contract tests for the shape of data)

- [ ] **Step 3: Write the migration SQL**

Create migration file (use next available number in `migrations/global/`):

```sql
-- Wellness profile extension for OzzyLife
CREATE TABLE IF NOT EXISTS wellness_profile (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL UNIQUE,
  date_of_birth TEXT,
  gender TEXT CHECK(gender IN ('male','female','other')),
  height_cm REAL,
  weight_kg REAL,
  language TEXT DEFAULT 'bn',
  timezone TEXT DEFAULT 'Asia/Dhaka',
  onboarding_completed INTEGER DEFAULT 0,
  ramadan_mode INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);

CREATE TABLE IF NOT EXISTS wellness_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL UNIQUE,
  notification_settings TEXT DEFAULT '{}',
  active_modules TEXT DEFAULT '["activity","sleep","mood"]',
  daily_goals TEXT DEFAULT '{"steps":6000,"water_glasses":8,"sleep_hours":7}',
  units TEXT DEFAULT '{"weight":"kg","height":"cm","glucose":"mmol","temp":"F"}',
  quiet_hours_start TEXT DEFAULT '22:00',
  quiet_hours_end TEXT DEFAULT '07:00',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);

CREATE TABLE IF NOT EXISTS daily_health_score (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  total_score INTEGER NOT NULL CHECK(total_score >= 0 AND total_score <= 100),
  sleep_score INTEGER DEFAULT 0,
  activity_score INTEGER DEFAULT 0,
  nutrition_score INTEGER DEFAULT 0,
  mood_score INTEGER DEFAULT 0,
  medication_score INTEGER DEFAULT 0,
  vitals_score INTEGER DEFAULT 0,
  breakdown_json TEXT DEFAULT '{}',
  calculated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(patient_id, date),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);
CREATE INDEX idx_health_score_patient_date ON daily_health_score(patient_id, date);

CREATE TABLE IF NOT EXISTS streaks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  streak_type TEXT NOT NULL CHECK(streak_type IN ('daily_checkin','food_log','activity','sleep_log','medication','water')),
  current_count INTEGER DEFAULT 0,
  longest_count INTEGER DEFAULT 0,
  last_logged_date TEXT,
  started_at TEXT DEFAULT (datetime('now')),
  UNIQUE(patient_id, streak_type),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);

CREATE TABLE IF NOT EXISTS user_goals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  goal_type TEXT NOT NULL,
  target_value REAL NOT NULL,
  current_value REAL DEFAULT 0,
  unit TEXT,
  start_date TEXT DEFAULT (date('now')),
  end_date TEXT,
  status TEXT DEFAULT 'active' CHECK(status IN ('active','completed','abandoned')),
  ai_suggested INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);

CREATE TABLE IF NOT EXISTS achievements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id INTEGER NOT NULL,
  achievement_key TEXT NOT NULL,
  earned_at TEXT DEFAULT (datetime('now')),
  UNIQUE(patient_id, achievement_key),
  FOREIGN KEY (patient_id) REFERENCES global_patient_auth(id)
);
```

- [ ] **Step 4: Commit**

```bash
git add migrations/global/ test/wellness-profile.test.ts
git commit -m "feat: add wellness profile, health score, streaks, goals, achievements tables"
```

---

### Task 3: Add patient portal i18n namespace

**Files:**
- Create: `web/public/locales/bn/patientPortal.json`
- Create: `web/public/locales/en/patientPortal.json`
- Modify: `web/src/lib/i18n.ts`

- [ ] **Step 1: Create English translation file**

Create `web/public/locales/en/patientPortal.json`:
```json
{
  "nav": {
    "home": "Home",
    "wellness": "Wellness",
    "care": "Care",
    "me": "Me"
  },
  "greeting": {
    "morning": "Good morning",
    "afternoon": "Good afternoon",
    "evening": "Good evening",
    "night": "Good night"
  },
  "score": {
    "title": "Wellness Score",
    "excellent": "Excellent",
    "good": "Good",
    "fair": "Fair",
    "needsWork": "Needs improvement",
    "attention": "Needs attention",
    "trend7d": "Last 7 days",
    "points": "points"
  },
  "checkin": {
    "title": "Today's Check-in",
    "done": "Today's check-in complete!",
    "cta": "How are you feeling?",
    "edit": "Edit",
    "mood": "How are you feeling today?",
    "energy": "Energy level",
    "sleep": "Last night's sleep",
    "hours": "hours",
    "exercise": "Exercise (minutes)",
    "water": "Water intake",
    "glasses": "glasses",
    "notes": "Today's notes",
    "notesPlaceholder": "Want to write something? (optional)",
    "submit": "Complete check-in",
    "submitting": "Submitting..."
  },
  "mood": {
    "excellent": "Excellent",
    "good": "Good",
    "okay": "Okay",
    "bad": "Bad",
    "terrible": "Terrible"
  },
  "streak": {
    "title": "streak!",
    "start": "Start your streak",
    "day1": "Great start! Keep going",
    "day3": "Going strong! Continue",
    "day7": "One week done! Amazing",
    "day14": "Two weeks! Outstanding",
    "day30": "Incredible! You're a health champion!"
  },
  "quickActions": {
    "logFood": "Log Food",
    "logMood": "Log Mood",
    "trackWater": "Water",
    "checkIn": "Check-in"
  },
  "onboarding": {
    "welcome": "Your health, your hospital, one app.",
    "getStarted": "Get Started",
    "haveAccount": "I have an account",
    "chooseLanguage": "Choose your language",
    "aboutYou": "Tell us about yourself",
    "name": "Name",
    "age": "Age",
    "gender": "Gender",
    "male": "Male",
    "female": "Female",
    "other": "Other",
    "height": "Height",
    "weight": "Weight",
    "continue": "Continue",
    "yourGoals": "What matters most to you?",
    "goalActive": "Stay active",
    "goalEat": "Eat better",
    "goalSleep": "Sleep well",
    "goalMind": "Mental peace",
    "goalMeds": "Track medications",
    "goalWeight": "Lose weight",
    "goalBpDiabetes": "Manage BP/diabetes",
    "goalPregnancy": "Pregnancy tracking",
    "connectHospital": "Connect to your hospital?",
    "connectDesc": "Link your hospital to see appointments, lab results, and get personalized AI advice.",
    "connectCta": "Connect a Hospital",
    "skipForNow": "Skip for now",
    "permissions": "Allow OzzyLife to:",
    "permNotifications": "Send notifications (reminders & tips)",
    "permHealth": "Access Health data (steps & sleep sync)",
    "permCamera": "Use camera (food & doc scanning)",
    "permBiometric": "Use biometrics (fingerprint login)",
    "allowAll": "Allow All",
    "customize": "Customize",
    "meetOzzy": "Meet Ozzy, your AI coach",
    "ozzyIntro": "Hi! I'm Ozzy. I'll help you stay healthy with daily tips and personalized advice. Ask me anything!",
    "startJourney": "Start My Journey"
  },
  "modules": {
    "nutrition": "Nutrition",
    "activity": "Activity",
    "sleep": "Sleep",
    "mind": "Mind",
    "vitals": "Vitals",
    "womensHealth": "Women's Health"
  },
  "empty": {
    "noMeals": "No meals logged yet",
    "noMealsCta": "Log Your First Meal",
    "noHospital": "No hospital connected",
    "noHospitalCta": "Find a Hospital"
  },
  "tip": {
    "todaysTip": "Today's tip"
  }
}
```

- [ ] **Step 2: Create Bangla translation file**

Create `web/public/locales/bn/patientPortal.json`:
```json
{
  "nav": {
    "home": "হোম",
    "wellness": "সুস্থতা",
    "care": "সেবা",
    "me": "আমি"
  },
  "greeting": {
    "morning": "সুপ্রভাত",
    "afternoon": "শুভ দুপুর",
    "evening": "শুভ সন্ধ্যা",
    "night": "শুভ রাত্রি"
  },
  "score": {
    "title": "সুস্থতা স্কোর",
    "excellent": "চমৎকার",
    "good": "ভালো",
    "fair": "মোটামুটি",
    "needsWork": "উন্নতি দরকার",
    "attention": "মনোযোগ দিন",
    "trend7d": "গত ৭ দিনে",
    "points": "পয়েন্ট"
  },
  "checkin": {
    "title": "আজকের চেক-ইন",
    "done": "আজকের চেক-ইন সম্পন্ন!",
    "cta": "আজ কেমন লাগছে?",
    "edit": "এডিট",
    "mood": "আজ কেমন লাগছে?",
    "energy": "⚡ শক্তি কেমন?",
    "sleep": "🌙 গত রাতের ঘুম",
    "hours": "ঘণ্টা",
    "exercise": "🏃 ব্যায়াম (মিনিট)",
    "water": "💧 পানি পান",
    "glasses": "গ্লাস",
    "notes": "📝 আজকের নোট",
    "notesPlaceholder": "কিছু লিখতে চান? (ঐচ্ছিক)",
    "submit": "✅ চেক-ইন সম্পন্ন করুন",
    "submitting": "সাবমিট হচ্ছে..."
  },
  "mood": {
    "excellent": "চমৎকার",
    "good": "ভালো",
    "okay": "মোটামুটি",
    "bad": "খারাপ",
    "terrible": "খুব খারাপ"
  },
  "streak": {
    "title": "-দিনের স্ট্রিক!",
    "start": "স্ট্রিক শুরু করুন",
    "day1": "শুরুটা ভালো! এগিয়ে যান 🌱",
    "day3": "দারুণ চলছে! চালিয়ে যান 💪",
    "day7": "এক সপ্তাহ পূর্ণ! দারুণ চলছে 🎯",
    "day14": "দুই সপ্তাহ পার! অসাধারণ 🌟",
    "day30": "অনবদ্য! আপনি একজন স্বাস্থ্য চ্যাম্পিয়ন! 🏆"
  },
  "quickActions": {
    "logFood": "খাবার",
    "logMood": "মেজাজ",
    "trackWater": "পানি",
    "checkIn": "চেক-ইন"
  },
  "onboarding": {
    "welcome": "আপনার স্বাস্থ্য, আপনার হাসপাতাল, একটি অ্যাপ।",
    "getStarted": "শুরু করুন",
    "haveAccount": "আমার অ্যাকাউন্ট আছে",
    "chooseLanguage": "আপনার ভাষা বেছে নিন",
    "aboutYou": "আপনার সম্পর্কে বলুন",
    "name": "নাম",
    "age": "বয়স",
    "gender": "লিঙ্গ",
    "male": "পুরুষ",
    "female": "মহিলা",
    "other": "অন্যান্য",
    "height": "উচ্চতা",
    "weight": "ওজন",
    "continue": "পরবর্তী",
    "yourGoals": "আপনার জন্য কোনটি সবচেয়ে গুরুত্বপূর্ণ?",
    "goalActive": "🏃 সক্রিয় থাকা",
    "goalEat": "🍚 ভালো খাওয়া",
    "goalSleep": "😴 ভালো ঘুম",
    "goalMind": "🧠 মানসিক শান্তি",
    "goalMeds": "💊 ওষুধ ট্র্যাক করা",
    "goalWeight": "📉 ওজন কমানো",
    "goalBpDiabetes": "❤️ বিপি/ডায়াবেটিস নিয়ন্ত্রণ",
    "goalPregnancy": "🤰 গর্ভাবস্থা ট্র্যাকিং",
    "connectHospital": "আপনার হাসপাতালের সাথে যুক্ত হন?",
    "connectDesc": "হাসপাতাল যুক্ত করলে অ্যাপয়েন্টমেন্ট, ল্যাব রিপোর্ট, এবং ব্যক্তিগত AI পরামর্শ পাবেন।",
    "connectCta": "হাসপাতাল যুক্ত করুন",
    "skipForNow": "আপাতত এড়িয়ে যান",
    "permissions": "OzzyLife-কে অনুমতি দিন:",
    "permNotifications": "নোটিফিকেশন পাঠাতে (রিমাইন্ডার ও টিপস)",
    "permHealth": "স্বাস্থ্য ডেটা পড়তে (স্টেপ ও ঘুম সিঙ্ক)",
    "permCamera": "ক্যামেরা ব্যবহার করতে (খাবার ও ডকুমেন্ট স্ক্যান)",
    "permBiometric": "বায়োমেট্রিক ব্যবহার করতে (ফিঙ্গারপ্রিন্ট লগইন)",
    "allowAll": "সব অনুমতি দিন",
    "customize": "কাস্টমাইজ করুন",
    "meetOzzy": "Ozzy-র সাথে পরিচয়",
    "ozzyIntro": "হাই! আমি Ozzy। আমি আপনাকে প্রতিদিনের টিপস এবং ব্যক্তিগত পরামর্শ দিয়ে সুস্থ থাকতে সাহায্য করব। যেকোনো প্রশ্ন করুন!",
    "startJourney": "যাত্রা শুরু করুন"
  },
  "modules": {
    "nutrition": "পুষ্টি",
    "activity": "ব্যায়াম",
    "sleep": "ঘুম",
    "mind": "মন",
    "vitals": "ভাইটাল",
    "womensHealth": "নারী স্বাস্থ্য"
  },
  "empty": {
    "noMeals": "এখনো কোনো খাবার লগ করা হয়নি",
    "noMealsCta": "প্রথম খাবার লগ করুন",
    "noHospital": "কোনো হাসপাতাল যুক্ত নেই",
    "noHospitalCta": "হাসপাতাল খুঁজুন"
  },
  "tip": {
    "todaysTip": "আজকের টিপস"
  }
}
```

- [ ] **Step 3: Register the namespace in i18n config**

In `web/src/lib/i18n.ts`, add `'patientPortal'` to the `ns` array:
```typescript
ns: ['common', 'sidebar', 'dashboard', 'auth', 'patients', 'billing',
     'pharmacy', 'laboratory', 'appointments', 'staff', 'accounting',
     'reports', 'settings', 'telemedicine', 'ipd', 'notifications', 'director',
     'emergency', 'ot', 'vitals', 'nursing', 'super-admin', 'inventory', 'hr', 'clinical', 'radiology', 'helpCenter', 'patientPortal'],
```

- [ ] **Step 4: Commit**

```bash
git add web/public/locales/bn/patientPortal.json web/public/locales/en/patientPortal.json web/src/lib/i18n.ts
git commit -m "feat: add patientPortal i18n namespace with Bangla and English translations"
```

### Task 4: Redesign MobileBottomNav to 4-tab OzzyLife layout

**Files:**
- Modify: `web/src/components/patient/MobileBottomNav.tsx`
- Modify: `web/src/pages/PatientDashboardPage.tsx` (tab type + mapping)

**Approach:** Replace the current 5-tab nav (home/diary/medicine/services/profile) with the spec's 4-tab layout (Home/Wellness/Care/Me). Use `patientPortal` i18n namespace for labels. Update `BottomNavTab` type and all consuming code.

- [ ] **Step 1: Rewrite MobileBottomNav with 4 tabs**

  - Change `BottomNavTab` type to `'home' | 'wellness' | 'care' | 'me'`
  - Replace 5-item `TABS` array with 4 items using icons: `Home`, `Heart`, `Building2`, `User`
  - Add `useTranslation('patientPortal')` and use i18n keys `nav.home`, `nav.wellness`, `nav.care`, `nav.me` for labels
  - Keep existing glassmorphic styling and safe-area-inset padding

- [ ] **Step 2: Update PatientDashboardPage tab mapping**

  - In `handleMobileNavChange` (line ~647), update the `tabMap` record from the old 5-tab mapping to:
    - `home` → `'overview'`
    - `wellness` → `'trends'`
    - `care` → `'hospital-services'`
    - `me` → `'data'`
  - Fix any TypeScript errors caused by the `BottomNavTab` type change

- [ ] **Step 3: Verify build** — `cd web && pnpm build` should succeed with no TS errors

- [ ] **Step 4: Commit** — `"feat: redesign bottom nav to 4-tab OzzyLife layout (Home/Wellness/Care/Me)"`

---

### Task 5: Build the onboarding flow

**Files:**
- Create: `web/src/pages/PatientOnboardingPage.tsx`
- Create: `web/src/hooks/useOnboardingState.ts`
- Modify: `web/src/App.tsx` (add route)

**Approach:** Build a 7-screen wizard (Welcome → Language → About You → Goals → Hospital Connection → Permissions → Meet Ozzy) as described in the spec (Section 6). All state lives in a custom hook. On completion, POST to `/api/patient-auth/onboarding` and redirect to dashboard.

- [ ] **Step 1: Create `useOnboardingState` hook**

  - File: `web/src/hooks/useOnboardingState.ts`
  - Manages: current step (0-6), language preference, name/age/gender/height/weight, selected goals array (max 3), hospital skip flag, permission toggles (notifications/health/camera/biometric)
  - Exports: `step`, `setStep`, `data`, `updateData`, `next`, `back`
  - All data starts with sensible defaults (language=`'bn'`, all permissions=true)

- [ ] **Step 2: Create `PatientOnboardingPage` component**

  - File: `web/src/pages/PatientOnboardingPage.tsx`
  - 7 screens rendered conditionally by `step` value:
    - **Screen 0 (Welcome):** OzzyLife branding, tagline from `t('onboarding.welcome')`, "Get Started" + "I have an account" buttons
    - **Screen 1 (Language):** Two large buttons for `বাংলা` and `English`, changes i18n language on select
    - **Screen 2 (About You):** Name, age, gender (3-button selector), height (cm), weight (kg) inputs
    - **Screen 3 (Goals):** 2x4 grid of goal buttons from `patientPortal` translations (`goalActive` through `goalPregnancy`), max 3 selectable, disabled continue if none selected
    - **Screen 4 (Hospital):** "Connect a Hospital" primary CTA + "Skip for now" secondary
    - **Screen 5 (Permissions):** 4 toggleable permission rows + "Allow All" / "Customize" buttons
    - **Screen 6 (Meet Ozzy):** Bot avatar, intro text, "Start My Journey" button that calls `handleComplete`
  - Progress bar (1px emerald) at top for steps 1-6
  - Back button (chevron-left) at top-left for steps 1-6
  - `handleComplete` POSTs to `/api/patient-auth/onboarding` with collected data, then navigates to `/patient/dashboard`
  - Uses `patientPortal` i18n namespace for all labels
  - Emerald color scheme, consistent with existing patient portal style

- [ ] **Step 3: Add route in App.tsx**

  - Add lazy import for `PatientOnboardingPage`
  - Add route: `/patient/onboarding` → `<PatientOnboardingPage />`
  - Place after `/patient/login` route

- [ ] **Step 4: Verify build** — `cd web && pnpm build` should succeed

- [ ] **Step 5: Commit** — `"feat: add 7-screen patient onboarding wizard"`

---

### Task 6: Add onboarding API endpoint

**Files:**
- Modify: `src/routes/patient-auth.ts` (add POST /onboarding endpoint)
- Test: `test/onboarding-api.test.ts`

**Approach:** Create a `POST /api/patient-auth/onboarding` endpoint that receives onboarding wizard data and writes to `wellness_profile` + `wellness_preferences` tables (from Task 2 migration). Maps user goal selections to active wellness modules.

- [ ] **Step 1: Write contract tests**

  - File: `test/onboarding-api.test.ts`
  - Test 1: Validate expected payload shape (language, name, gender, height_cm, weight_kg, goals array, skip_hospital boolean, permissions object)
  - Test 2: Verify goal-to-module mapping logic — `goalActive` → `['activity', 'sleep']`, `goalEat` → `['nutrition', 'activity']`, `goalSleep` → `['sleep', 'mind']`, etc. (8 mappings total)
  - Test 3: Verify daily goals adjustment — if `goalActive` selected, steps target bumps to 8000; if `goalSleep`, sleep_hours target becomes 8

- [ ] **Step 2: Run tests** — `pnpm vitest run test/onboarding-api.test.ts` should PASS

- [ ] **Step 3: Add POST /onboarding endpoint to patient-auth.ts**

  - Requires authenticated patient (read `patientId` from context)
  - Parse JSON body with fields: `language`, `name`, `gender`, `height_cm`, `weight_kg`, `goals[]`, `skip_hospital`, `permissions{}`
  - Goal → Module mapping (same 8 mappings as test): flatten selected goals into unique active module list
  - Daily goals defaults: `{ steps: 6000, water_glasses: 8, sleep_hours: 7 }`, adjusted by goal selection
  - Upsert `wellness_profile` row — set `onboarding_completed = 1`, store gender/height/weight/language
  - Upsert `wellness_preferences` row — store `active_modules` (JSON), `daily_goals` (JSON), `notification_settings` (JSON from permissions)
  - If `name` provided, update `global_patient_auth.name`
  - Return `{ success: true }` on success, `{ error: string }` on failure

- [ ] **Step 4: Commit** — `"feat: add POST /api/patient-auth/onboarding endpoint for wellness profile setup"`

---

## Sprint 1.2: Home Screen & Daily Score (Week 2-3)

### Task 7: Health Score Calculation Engine

**Files:**
- Create: `src/lib/health-score.ts`
- Create: `src/routes/wellness.ts` (new Hono router for wellness endpoints)
- Modify: `src/index.ts` (mount wellness router)
- Test: `test/health-score.test.ts`

**Approach:** Build a pure function that takes a patient's daily logs (sleep, activity, nutrition, mood, medication, vitals) and outputs a 0-100 score using the spec's weights: sleep 25%, activity 20%, nutrition 15%, mood 15%, medication 15%, vitals 10%. Standalone users redistribute medication weight to hydration (10%) + sleep (5%). Expose as `GET /api/wellness/score?date=YYYY-MM-DD`.

- [ ] **Step 1:** Write unit tests for `calculateHealthScore()` — test each weight category, standalone vs connected redistribution, edge cases (no data = 0, perfect day = 100)
- [ ] **Step 2:** Run tests, verify they fail
- [ ] **Step 3:** Implement `calculateHealthScore()` in `src/lib/health-score.ts` as a pure function. Input: object with sub-scores (0-100 each). Output: weighted total (0-100)
- [ ] **Step 4:** Run tests, verify they pass
- [ ] **Step 5:** Create `src/routes/wellness.ts` Hono router with `GET /score` endpoint — queries `lifestyle_logs`, `global_patient_vitals`, `global_patient_medicine_adherence` for the given date, feeds into `calculateHealthScore()`, upserts result into `daily_health_score` table
- [ ] **Step 6:** Mount wellness router at `/api/wellness` in `src/index.ts`
- [ ] **Step 7:** Verify build — `pnpm build` should succeed
- [ ] **Step 8:** Commit — `"feat: add health score calculation engine with weighted scoring"`

---

### Task 8: Extend Home Screen with live health score

**Files:**
- Modify: `web/src/components/patient/WellnessScoreCard.tsx`
- Modify: `web/src/pages/PatientDashboardPage.tsx`

**Approach:** The existing `WellnessScoreCard` renders a static SVG ring with hardcoded mini metric cards. Wire it to the new `GET /api/wellness/score` endpoint so the ring shows the real calculated score. Add score color logic: green (80-100), yellow (60-79), red (0-59). Show 7-day trend sparkline below the ring.

- [ ] **Step 1:** Add API call in `PatientDashboardPage` to fetch today's score from `/api/wellness/score?date=today` and pass as prop to `WellnessScoreCard`
- [ ] **Step 2:** Update `WellnessScoreCard` to accept `score`, `breakdown`, and `trend` props instead of hardcoded values. Apply score color logic to the ring stroke
- [ ] **Step 3:** Add 7-day trend sparkline (small recharts `LineChart`) below the score ring
- [ ] **Step 4:** Verify build
- [ ] **Step 5:** Commit — `"feat: wire wellness score card to live health score API"`

---

### Task 9: Streak persistence backend

**Files:**
- Modify: `src/routes/wellness.ts` (add streak endpoints)
- Test: `test/streaks.test.ts`

**Approach:** The existing `StreakTrackerCard` is pure UI with no persistence. Add `GET /api/wellness/streaks` (returns all streak types for a patient) and `POST /api/wellness/streaks/log` (logs today's activity for a streak type and increments/resets the counter). Streak types: `daily_checkin`, `food_log`, `activity`, `sleep_log`, `medication`, `water`.

- [ ] **Step 1:** Write tests for streak increment logic — logging on consecutive days increments `current_count`, missing a day resets to 1, `longest_count` tracks the max
- [ ] **Step 2:** Run tests, verify fail
- [ ] **Step 3:** Implement streak logic in wellness router — GET returns current streaks, POST upserts streak row comparing `last_logged_date` to today
- [ ] **Step 4:** Run tests, verify pass
- [ ] **Step 5:** Commit — `"feat: add streak persistence API endpoints"`

---

### Task 10: Wire StreakTrackerCard to backend

**Files:**
- Modify: `web/src/components/patient/StreakTrackerCard.tsx`
- Modify: `web/src/pages/PatientDashboardPage.tsx`

**Approach:** Fetch streaks from `GET /api/wellness/streaks` and pass to `StreakTrackerCard`. The card already shows a 7-day calendar with dots — make the dots reflect real logged dates. Show the `daily_checkin` streak count prominently. Use `patientPortal` i18n keys for streak messages.

- [ ] **Step 1:** Add API call for streaks in dashboard, pass data to `StreakTrackerCard` as props
- [ ] **Step 2:** Update `StreakTrackerCard` to render real streak data and use i18n motivational messages based on streak length
- [ ] **Step 3:** Verify build
- [ ] **Step 4:** Commit — `"feat: wire streak tracker to live backend data"`

---

### Task 11: Smart Card System

**Files:**
- Create: `web/src/components/patient/SmartCardRenderer.tsx`
- Create: `web/src/lib/smart-card-priority.ts`
- Modify: `web/src/pages/PatientDashboardPage.tsx` (overview tab)

**Approach:** Replace the static overview tab layout with a priority-sorted smart card system per spec Section 2. Cards are ranked: (1) critical clinical alerts, (2) time-sensitive actions, (3) incomplete daily tasks, (4) streak at risk, (5) engagement content, (6) discovery prompts. Each card type is a small component. Priority engine is a pure function that takes user state and returns sorted card list.

- [ ] **Step 1:** Create `smart-card-priority.ts` — pure function that takes `{ hasCheckedIn, hasMedsdue, streakAtRisk, hasLabResults, ... }` and returns an ordered array of card descriptors with type + priority
- [ ] **Step 2:** Create `SmartCardRenderer.tsx` — takes the sorted card array and renders each card type (streak card, med reminder card, check-in prompt, health tip, weekly summary). Each card type is a simple conditional render
- [ ] **Step 3:** Integrate into `PatientDashboardPage` overview tab — replace the current static card list with `SmartCardRenderer` fed by the priority engine
- [ ] **Step 4:** Verify build
- [ ] **Step 5:** Commit — `"feat: add priority-sorted smart card system to home screen"`

---

### Task 12: Context-aware Quick Actions

**Files:**
- Modify: `web/src/components/patient/LifestyleQuickActions.tsx`

**Approach:** The existing `LifestyleQuickActions` shows 4 static buttons (medicine, appointment, vault, trends). Replace with the spec's context-aware quick actions: Check-in, Log Food, Log Mood, Water. Each button shows a checkmark if already done today. Uses `patientPortal` i18n keys (`quickActions.*`).

- [ ] **Step 1:** Change the 4 actions to match spec: `checkIn`, `logFood`, `logMood`, `trackWater` with appropriate icons
- [ ] **Step 2:** Accept a `completedToday` prop (set of action keys already done today) — show visual indicator (checkmark overlay or muted style) for completed actions
- [ ] **Step 3:** Use `patientPortal` i18n namespace for labels
- [ ] **Step 4:** Verify build
- [ ] **Step 5:** Commit — `"feat: redesign quick actions to context-aware wellness actions"`

---

## Sprint 1.3: Core Wellness Modules (Week 3-4)

### Task 13: Daily Check-in improvements + mood_log table

**Files:**
- Create: `migrations/global/NNNN_wellness_logs.sql`
- Modify: `src/routes/patient-phr.ts` (update lifestyle log POST to also write mood_log)
- Modify: `web/src/components/patient/DailyCheckInWidget.tsx`
- Test: `test/wellness-logs.test.ts`

**Approach:** The existing `DailyCheckInWidget` posts to `/api/patient-phr/lifestyle-logs` and stores mood, energy, sleep_hours, exercise_minutes, water_glasses, symptoms, diet notes in one `lifestyle_logs` row. We need dedicated tables (`mood_log`, `sleep_log`, `activity_log`, `water_log`, `symptom_log`) for the health score engine and module-specific trends. This migration creates those tables. The existing lifestyle_logs POST is extended to also write to the new normalized tables. Update the check-in widget to also log a streak via `POST /api/wellness/streaks/log` on submission.

- [ ] **Step 1:** Write migration SQL creating `mood_log`, `sleep_log`, `activity_log`, `water_log`, `symptom_log` tables per spec Section 9 Domain 2 schema
- [ ] **Step 2:** Write contract tests validating the table schemas and insert logic
- [ ] **Step 3:** Run tests, verify pass
- [ ] **Step 4:** Extend the existing `POST /api/patient-phr/lifestyle-logs` handler to also insert into the new normalized tables (dual-write — keeps backward compatibility)
- [ ] **Step 5:** Update `DailyCheckInWidget` to call `POST /api/wellness/streaks/log` with `streak_type=daily_checkin` after successful check-in submission
- [ ] **Step 6:** Verify build
- [ ] **Step 7:** Commit — `"feat: add normalized wellness log tables and dual-write from daily check-in"`

---

### Task 14: Bangladesh Food Database + food_log table

**Files:**
- Create: `migrations/global/NNNN_food_system.sql`
- Create: `data/bd-foods.json` (500+ items)
- Create: `src/routes/food.ts` (new Hono router)
- Modify: `src/index.ts` (mount food router)
- Test: `test/food-api.test.ts`

**Approach:** Create `food_items` and `food_log` tables. Seed with 500+ Bangladesh foods across 13 categories (rice, bread, lentils, fish, meat, vegetables, bhorta, eggs, snacks, sweets, drinks, fruits, fast food) with calories, protein, carbs, fat, fiber per 100g. Expose `GET /api/food/search?q=` for search and `POST /api/food/log` for meal logging. Food items have dual names (`name_bn`, `name_en`).

- [ ] **Step 1:** Write migration for `food_items` table (id, name_bn, name_en, category, calories_per_100g, protein_g, carbs_g, fat_g, fiber_g, serving_size_g, serving_description, barcode, verified) and `food_log` table (id, patient_id, meal_type, food_item_id, custom_name, calories, protein_g, carbs_g, fat_g, quantity, unit, logged_at)
- [ ] **Step 2:** Create `data/bd-foods.json` with 500+ items — use BIRDEM food composition data as reference. Categories: ভাত, রুটি, ডাল, মাছ, মাংস, সবজি, ভর্তা, ডিম, নাস্তা, মিষ্টি, পানীয়, ফল, ফাস্ট ফুড
- [ ] **Step 3:** Write a seed script/endpoint to load `bd-foods.json` into `food_items` table
- [ ] **Step 4:** Create `src/routes/food.ts` with `GET /search` (fuzzy search by bn/en name, filter by category) and `POST /log` (validates meal_type, calculates calories from food_item or accepts manual, inserts food_log + logs food_log streak)
- [ ] **Step 5:** Write tests for search (finds "ভাত", finds "rice", category filter) and log (valid entry, invalid meal_type rejected)
- [ ] **Step 6:** Mount at `/api/food` in index.ts
- [ ] **Step 7:** Verify build
- [ ] **Step 8:** Commit — `"feat: add Bangladesh food database (500+ items) and food logging API"`

---

### Task 15: Food Logging UI

**Files:**
- Create: `web/src/components/patient/FoodLogModal.tsx`
- Create: `web/src/components/patient/NutritionModule.tsx`
- Modify: `web/src/pages/PatientDashboardPage.tsx` (add nutrition to wellness tab)

**Approach:** Build a food logging modal triggered from quick actions ("Log Food" button). Modal has: meal type selector (Breakfast/Lunch/Snacks/Dinner), search input hitting `GET /api/food/search`, results list with food name + calories, quantity adjuster, and submit. Also build `NutritionModule` card for the wellness tab showing today's calorie total, macro split bar, and meal sections with logged items.

- [ ] **Step 1:** Create `FoodLogModal` — meal type tabs at top, search input, result cards (bn name, en name, cal/serving), quantity selector, submit button. Posts to `POST /api/food/log`
- [ ] **Step 2:** Create `NutritionModule` — fetches today's food logs from `GET /api/food/logs?date=today`, shows total calories vs goal, macro bar (carbs/protein/fat), meal sections with items listed
- [ ] **Step 3:** Wire `FoodLogModal` to the "Log Food" quick action in `LifestyleQuickActions`
- [ ] **Step 4:** Add `NutritionModule` to the wellness tab in `PatientDashboardPage`
- [ ] **Step 5:** Verify build
- [ ] **Step 6:** Commit — `"feat: add food logging modal and nutrition module UI"`

---

### Task 16: Sleep Logging Module

**Files:**
- Create: `web/src/components/patient/SleepModule.tsx`
- Modify: `src/routes/wellness.ts` (add sleep log endpoints)
- Test: `test/sleep-api.test.ts`

**Approach:** Add `GET /api/wellness/sleep?date=` and `POST /api/wellness/sleep` endpoints that read/write the `sleep_log` table (from Task 13 migration). Build `SleepModule` card showing last night's sleep (bedtime, wake time, duration, quality rating 1-5 stars), sleep score (0-100 based on duration vs goal + consistency), and 7-day trend bar chart using recharts. The existing daily check-in captures `sleep_hours` — this module adds bedtime/wake time and quality rating for richer data.

- [ ] **Step 1:** Write tests for sleep score calculation (full night = 100, short night penalized, inconsistent bedtime penalized)
- [ ] **Step 2:** Add `POST /api/wellness/sleep` (bedtime, wake_time, quality_rating, duration_min) and `GET /api/wellness/sleep` (returns logs for date range) to wellness router
- [ ] **Step 3:** Create `SleepModule` — shows last night's summary, sleep score, 7-day bar chart, and a "Log Sleep" button that opens a simple form (bedtime picker, wake time picker, 1-5 star quality)
- [ ] **Step 4:** Add `SleepModule` to wellness tab
- [ ] **Step 5:** Verify build
- [ ] **Step 6:** Commit — `"feat: add sleep logging module with score and trends"`

---

### Task 17: Activity Tracking Module

**Files:**
- Create: `web/src/components/patient/ActivityModule.tsx`
- Modify: `src/routes/wellness.ts` (add activity endpoints)
- Test: `test/activity-api.test.ts`

**Approach:** Add `POST /api/wellness/activity` and `GET /api/wellness/activity` for the `activity_log` table. Activity types: walk, run, cycle, gym, yoga, namaz, housework, swim, other. Build `ActivityModule` card showing today's active minutes, calories burned estimate, and a log button. Manual exercise logging form with type selector, duration, and optional notes. Include namaz as a tracked activity per BD spec (5x daily = ~60 min light activity).

- [ ] **Step 1:** Write tests for activity logging (valid types accepted, calories estimated from type+duration, daily total aggregation)
- [ ] **Step 2:** Add activity CRUD endpoints to wellness router
- [ ] **Step 3:** Create `ActivityModule` — today's activity summary (total minutes, estimated calories), list of logged activities, "Log Exercise" button opening a form (activity type dropdown, duration slider, notes)
- [ ] **Step 4:** Add `ActivityModule` to wellness tab
- [ ] **Step 5:** Verify build
- [ ] **Step 6:** Commit — `"feat: add activity tracking module with exercise logging"`

---

### Task 18: Vitals Logging Module

**Files:**
- Create: `web/src/components/patient/VitalsModule.tsx`
- Modify: `src/routes/patient-phr.ts` (extend vitals endpoints for weight, temp, SpO2)

**Approach:** The existing `global_patient_vitals` table and `PatientReportedDataTab` handle BP, glucose, and heart rate. Extend to also support weight/BMI, temperature, and SpO2 logging. Build `VitalsModule` card for the wellness tab showing latest readings with classification labels (normal/elevated/high). Add smart alert logic: BP > 180/120 = hypertensive crisis warning, glucose > 300 = high sugar warning, SpO2 < 92% = low oxygen warning. These are NOT diagnoses — always show safety disclaimer.

- [ ] **Step 1:** Extend existing vitals POST endpoint to accept weight_kg, temperature_f, spo2 in addition to existing BP/glucose/HR
- [ ] **Step 2:** Add classification logic for each vital type (use standard medical ranges)
- [ ] **Step 3:** Add smart alert response — if any reading crosses danger threshold, include `alert` object in API response with severity + message + disclaimer
- [ ] **Step 4:** Create `VitalsModule` — grid of vital cards (BP, glucose, weight, HR, temp, SpO2), each showing latest value + classification badge, "Log Vitals" button opening form with appropriate inputs per vital type
- [ ] **Step 5:** Add `VitalsModule` to wellness tab
- [ ] **Step 6:** Verify build
- [ ] **Step 7:** Commit — `"feat: add vitals module with smart alerts and expanded vital types"`

---

## Sprint 1.4: AI Coach & Engagement (Week 4-5)

### Task 19: AI Coach wellness RAG layer

**Files:**
- Modify: `src/routes/patient-phr.ts` (AI buddy endpoint)
- Create: `src/lib/ai-wellness-context.ts`
- Test: `test/ai-wellness-context.test.ts`

**Approach:** The existing `AIBuddyChat` sends messages to `/api/patient-phr/ai-buddy` which forwards to OpenRouter (Gemini 2.0 Flash) with a generic Bengali system prompt. Extend the system prompt to include the user's actual wellness data — today's health score, recent mood trend, sleep average, streak count, active goals. This is the "wellness RAG layer" from spec Section 5. Build a context builder function that queries recent logs and formats them into a concise system prompt supplement. Keep the existing rate limiting (20/5min).

- [ ] **Step 1:** Write tests for `buildWellnessContext()` — given mock log data, verify it produces a concise text summary (under 500 tokens) covering score, sleep avg, mood trend, streak, goals
- [ ] **Step 2:** Implement `buildWellnessContext()` in `src/lib/ai-wellness-context.ts` — queries last 7 days of logs, health score, streaks, goals for a patient and returns a formatted context string
- [ ] **Step 3:** Modify the AI buddy endpoint to call `buildWellnessContext()` and prepend the result to the system prompt before sending to OpenRouter
- [ ] **Step 4:** Verify build
- [ ] **Step 5:** Commit — `"feat: add wellness RAG context layer to AI Coach"`

---

### Task 20: Daily Insights Generation

**Files:**
- Create: `src/lib/daily-insights.ts`
- Modify: `src/routes/wellness.ts` (add insights endpoints)
- Test: `test/daily-insights.test.ts`

**Approach:** Build a daily insight generator per spec Section 5.1. Analyzes previous day's data and produces 1-3 short insights. Trigger patterns: sleep improved → encourage, activity streak at risk → nudge, mood pattern detected → observation, BP trending up → gentle alert. Store in `ai_insights` table (from Task 2 migration — need to add this table). Expose `GET /api/wellness/insights?date=` to fetch today's insights for the home screen smart card.

- [ ] **Step 1:** Add migration for `ai_insights` table (id, patient_id, insight_type, content, severity, read, created_at) and `ai_action_items` table
- [ ] **Step 2:** Write tests for insight triggers — e.g., if sleep_hours increased by 1h+ from 7-day avg → generate "sleep improved" insight, if streak current_count > 0 and no log today → "streak at risk" insight
- [ ] **Step 3:** Implement `generateDailyInsights()` — takes patient_id, queries yesterday's logs + 7-day averages, applies trigger rules, returns insight objects
- [ ] **Step 4:** Add `GET /api/wellness/insights` endpoint and `POST /api/wellness/insights/:id/read` (mark as read)
- [ ] **Step 5:** Verify build
- [ ] **Step 6:** Commit — `"feat: add daily insight generation engine"`

---

### Task 21: Display insights on home screen

**Files:**
- Modify: `web/src/components/patient/SmartCardRenderer.tsx`
- Modify: `web/src/pages/PatientDashboardPage.tsx`

**Approach:** Fetch today's unread insights from `GET /api/wellness/insights?date=today` and feed them into the smart card system (Task 11). AI insights render as cards with Ozzy avatar, insight text, and a dismiss/mark-read button. Insight severity maps to card priority: `urgent` → priority 1, `attention` → priority 3, `info` → priority 5.

- [ ] **Step 1:** Add insights fetch to dashboard data loading, pass to smart card priority engine
- [ ] **Step 2:** Add insight card type to `SmartCardRenderer` — shows Ozzy avatar icon, insight text, severity badge, dismiss button that calls `POST /api/wellness/insights/:id/read`
- [ ] **Step 3:** Verify build
- [ ] **Step 4:** Commit — `"feat: display AI insights as smart cards on home screen"`

---

### Task 22: Goal Setting Flow

**Files:**
- Create: `web/src/components/patient/GoalSettingModal.tsx`
- Modify: `src/routes/wellness.ts` (add goals CRUD endpoints)
- Test: `test/goals-api.test.ts`

**Approach:** Add `GET /api/wellness/goals`, `POST /api/wellness/goals`, `PATCH /api/wellness/goals/:id` for the `user_goals` table (created in Task 2 migration). Goal types: steps, calories, sleep_hours, water, weight, custom. Build a modal where users set a goal with target value and unit. Goals show progress on the home screen. Ozzy-guided goal setting happens during onboarding (Task 5-6) — this is for manual goal creation/editing after onboarding.

- [ ] **Step 1:** Write tests for goals CRUD — create, read, update status (active/completed/abandoned), validate target_value > 0
- [ ] **Step 2:** Add goals endpoints to wellness router
- [ ] **Step 3:** Create `GoalSettingModal` — goal type selector, target input with unit, start/end date. Shows current progress bar for existing goals. Edit/abandon actions
- [ ] **Step 4:** Add goals summary to home screen (small card showing top active goal with progress %)
- [ ] **Step 5:** Verify build
- [ ] **Step 6:** Commit — `"feat: add goal setting with CRUD and progress tracking"`

---

### Task 23: Achievements System

**Files:**
- Create: `src/lib/achievements.ts`
- Create: `web/src/components/patient/AchievementToast.tsx`
- Modify: `src/routes/wellness.ts` (add achievements endpoint)
- Test: `test/achievements.test.ts`

**Approach:** Define initial achievement catalog: `first_checkin`, `3_day_streak`, `7_day_streak`, `14_day_streak`, `30_day_streak`, `first_food_log`, `first_sleep_log`, `first_goal_set`, `perfect_day` (score 90+), `hydration_hero` (8 glasses 5 days in a row). Achievement checker runs after each log/check-in — checks if any new achievements are unlocked and inserts into `achievements` table. `GET /api/wellness/achievements` returns earned + available. Show a toast notification when a new achievement unlocks.

- [ ] **Step 1:** Write tests for achievement trigger logic — e.g., after 7th consecutive daily_checkin streak, `7_day_streak` should unlock
- [ ] **Step 2:** Implement `checkAchievements()` — takes patient_id, queries streaks/goals/scores, returns newly earned achievement keys
- [ ] **Step 3:** Add `GET /api/wellness/achievements` endpoint (returns earned list with dates + full catalog)
- [ ] **Step 4:** Create `AchievementToast` — animated slide-in toast with badge icon, achievement name, and confetti-like animation. Triggered when a POST response includes `new_achievements` array
- [ ] **Step 5:** Integrate achievement check into daily check-in, food log, and streak log POST handlers — call `checkAchievements()` and include results in response
- [ ] **Step 6:** Verify build
- [ ] **Step 7:** Commit — `"feat: add achievement system with 10 initial badges and unlock toasts"`

---

### Task 24: Push Notifications Setup

**Files:**
- Modify: `web/package.json` (add `@capacitor/push-notifications`)
- Create: `web/src/lib/push-notifications.ts`
- Modify: `web/capacitor.config.ts` (add PushNotifications config)
- Create: `src/routes/notifications.ts`
- Modify: `src/index.ts` (mount notifications router)

**Approach:** Install `@capacitor/push-notifications` Capacitor plugin. Create a helper module that handles registration, token storage, and permission requests. On app launch, request permission and send device token to `POST /api/notifications/register` (stores in a `user_devices` table). Build notification categories matching spec: medication_reminder (high), appointment (high), streak_at_risk (low), daily_checkin (low), ai_insight (low), health_tip (low). For Phase 1, notifications are triggered server-side via the insights/streak engines — actual FCM/APNs integration is the delivery mechanism.

- [ ] **Step 1:** Install `@capacitor/push-notifications` — `cd web && pnpm add @capacitor/push-notifications`
- [ ] **Step 2:** Add migration for `user_devices` table (patient_id, device_id, platform, push_token, last_seen_at)
- [ ] **Step 3:** Create `src/routes/notifications.ts` with `POST /register` (upserts device token) and `POST /send` (internal endpoint for sending push via FCM HTTP v1 API)
- [ ] **Step 4:** Create `web/src/lib/push-notifications.ts` — helper that calls Capacitor PushNotifications.register(), listens for token, sends to backend. Handle permission denied gracefully
- [ ] **Step 5:** Call push registration on app launch (in dashboard or App.tsx after auth)
- [ ] **Step 6:** Update Capacitor config with PushNotifications presentationOptions
- [ ] **Step 7:** Verify build (web build — native push only works on device)
- [ ] **Step 8:** Commit — `"feat: add push notification registration and FCM setup"`

---

## Sprint 1.5: Polish & Play Store (Week 5-6)

### Task 25: First-Week Guided Experience (Ozzy Day 1-7)

**Files:**
- Create: `src/lib/onboarding-progression.ts`
- Create: `web/src/components/patient/OzzyGuideCard.tsx`
- Modify: `src/routes/wellness.ts` (add progression endpoints)
- Test: `test/onboarding-progression.test.ts`

**Approach:** Per spec Section 6, Ozzy walks new users through features one per day during their first week. Day 1: first mood check-in, Day 2: first food log, Day 3: first sleep log, Day 4: discover activity tracking, Day 5: first breathing exercise, Day 6: set first weekly goal, Day 7: first weekly report. Track which day the user is on via `wellness_profile.created_at` diff from today. Store completion of each day's task. Show an `OzzyGuideCard` on the home screen smart cards with Ozzy's prompt for today's task. After week 1, transition to contextual nudges (handled by daily insights engine from Task 20).

- [ ] **Step 1:** Write tests for progression logic — day calculation from signup date, marking a day's task complete, skipping ahead if user already did the action organically
- [ ] **Step 2:** Implement `getOnboardingDay()` and `markDayComplete()` in `src/lib/onboarding-progression.ts`
- [ ] **Step 3:** Add `GET /api/wellness/onboarding-progress` (returns current day + completed days) and `POST /api/wellness/onboarding-progress/:day` (marks complete)
- [ ] **Step 4:** Create `OzzyGuideCard` — shows Ozzy avatar, today's prompt text (from `patientPortal` i18n), and a CTA button that navigates to the relevant feature
- [ ] **Step 5:** Integrate into smart card system with high priority (rank 2, after critical alerts)
- [ ] **Step 6:** Verify build
- [ ] **Step 7:** Commit — `"feat: add first-week guided experience with Ozzy day 1-7 prompts"`

---

### Task 26: Empty States for All Modules

**Files:**
- Create: `web/src/components/patient/EmptyState.tsx`
- Modify: `web/src/components/patient/NutritionModule.tsx`
- Modify: `web/src/components/patient/SleepModule.tsx`
- Modify: `web/src/components/patient/ActivityModule.tsx`
- Modify: `web/src/components/patient/VitalsModule.tsx`

**Approach:** Per spec Section 6, every screen must have an empty state with: friendly icon, short explanation, and a CTA button. Build a reusable `EmptyState` component that takes icon, title, description, and CTA props. Add to all wellness modules (nutrition, sleep, activity, vitals) and any other screens that can be empty (food log history, achievements list, goals list). Use `patientPortal` i18n keys for empty state text (`empty.*`).

- [ ] **Step 1:** Create reusable `EmptyState` component — accepts icon (lucide component), title, description, ctaLabel, onCta props. Renders centered layout with muted colors and prominent CTA button
- [ ] **Step 2:** Add empty states to NutritionModule ("No meals logged yet" → "Log Your First Meal"), SleepModule ("No sleep data yet" → "Log Last Night's Sleep"), ActivityModule ("No activity logged" → "Log Your First Exercise"), VitalsModule ("No vitals recorded" → "Record Your First Reading")
- [ ] **Step 3:** Add empty state to achievements page ("No badges earned yet" → "Complete your first check-in")
- [ ] **Step 4:** Verify build
- [ ] **Step 5:** Commit — `"feat: add empty states with CTAs to all wellness modules"`

---

### Task 27: Weekly Health Report

**Files:**
- Create: `src/lib/weekly-report.ts`
- Create: `web/src/components/patient/WeeklyReportCard.tsx`
- Modify: `src/routes/wellness.ts` (add report endpoint)
- Test: `test/weekly-report.test.ts`

**Approach:** Auto-generate a weekly summary every Sunday (or on-demand). Per spec Section 9 Domain 3, the `weekly_report` table stores `summary_json` containing: average health score, score trend (up/down/flat), best day, worst day, total steps, total calories logged, sleep average, mood distribution, streak status, top suggestion. Expose `GET /api/wellness/report?week_start=YYYY-MM-DD`. Show as a smart card on Monday morning ("Your weekly report is ready!"). Build `WeeklyReportCard` that expands to show the full summary with mini charts.

- [ ] **Step 1:** Add migration for `weekly_report` table (id, patient_id, week_start, summary_json, generated_at)
- [ ] **Step 2:** Write tests for report generation — given a week of mock daily_health_score + log data, verify the summary_json contains correct averages, trend direction, and top suggestion
- [ ] **Step 3:** Implement `generateWeeklyReport()` — queries Mon-Sun data, computes aggregates, stores in weekly_report
- [ ] **Step 4:** Add `GET /api/wellness/report` endpoint (generates on-demand if not cached, returns summary)
- [ ] **Step 5:** Create `WeeklyReportCard` — collapsible card showing score trend sparkline, key stats (avg score, sleep, steps), and Ozzy's top suggestion
- [ ] **Step 6:** Add weekly report card to smart card system (priority 5, shown on Mondays)
- [ ] **Step 7:** Verify build
- [ ] **Step 8:** Commit — `"feat: add weekly health report generation and display"`

---

### Task 28: Basic Offline Mode

**Files:**
- Create: `web/src/lib/offline-queue.ts`
- Create: `web/src/lib/sync-manager.ts`
- Modify: `web/package.json` (add `@capacitor/network`)

**Approach:** Per spec Section 7.6, Bangladesh has unreliable internet in rural areas. Build a basic offline queue: when a POST fails due to network error, store the payload in localStorage with table name and action. On reconnect (detected via `@capacitor/network` listener), replay the queue in order. Show a sync indicator ("2 items pending sync" → "All synced ✓"). Phase 1 scope: offline queue for check-ins, food logs, sleep logs, activity logs, vitals logs, and mood logs. AI Coach and hospital features require internet.

- [ ] **Step 1:** Install `@capacitor/network` — `cd web && pnpm add @capacitor/network`
- [ ] **Step 2:** Create `offline-queue.ts` — functions to enqueue failed requests (table, action, payload, timestamp), dequeue after sync, get pending count. Uses localStorage
- [ ] **Step 3:** Create `sync-manager.ts` — listens for network status changes via Capacitor Network plugin, on reconnect replays queue items in FIFO order, retries failed items up to 3 times
- [ ] **Step 4:** Wrap all wellness POST calls (check-in, food, sleep, activity, vitals) with offline-aware fetch — try network first, on failure enqueue
- [ ] **Step 5:** Add sync status indicator to home screen header (pending count badge or "All synced" checkmark)
- [ ] **Step 6:** Verify build
- [ ] **Step 7:** Commit — `"feat: add basic offline queue with sync-on-reconnect for wellness logs"`

---

### Task 29: App Branding Assets

**Files:**
- Create: `web/android/app/src/main/res/mipmap-*/ic_launcher.png` (all density buckets)
- Create: `web/android/app/src/main/res/drawable/splash.png`
- Modify: `web/public/favicon.ico`
- Modify: `web/public/manifest.json`
- Modify: `web/index.html` (meta tags, theme color)

**Approach:** Create OzzyLife branding assets for Android. App icon: green leaf/health symbol on dark background matching the emerald theme. Splash screen: OzzyLife logo centered on `#0f172a` background. Update PWA manifest with app name, short_name, theme_color, icons array. Update index.html meta tags (description, theme-color, apple-touch-icon).

- [ ] **Step 1:** Generate app icon PNGs for all Android density buckets (mdpi 48px, hdpi 72px, xhdpi 96px, xxhdpi 144px, xxxhdpi 192px) — OzzyLife logo
- [ ] **Step 2:** Generate splash screen drawable (1200x1200 centered logo on #0f172a)
- [ ] **Step 3:** Update `web/public/manifest.json` — name: "OzzyLife", short_name: "OzzyLife", theme_color: "#0f172a", background_color: "#0f172a", icons array with 192px and 512px variants
- [ ] **Step 4:** Update `web/index.html` — meta description, theme-color meta tag, apple-touch-icon link
- [ ] **Step 5:** Verify build and `npx cap sync`
- [ ] **Step 6:** Commit — `"chore: add OzzyLife branding assets (icon, splash, manifest)"`

---

### Task 30: Play Store Submission Prep

**Files:**
- Modify: `web/android/app/build.gradle.kts` (versionCode, versionName, signingConfigs)
- Create: `docs/play-store-listing.md`

**Approach:** Prepare the Android app for Play Store submission. Set versionCode=1, versionName="1.0.0". Configure release signing (keystore). Build release AAB with `./gradlew bundleRelease`. Prepare store listing metadata: app title, short description, full description (in Bangla + English), feature graphic, screenshots (phone), category (Health & Fitness), content rating questionnaire answers, privacy policy URL.

- [ ] **Step 1:** Update build.gradle.kts — set versionCode=1, versionName="1.0.0", add signingConfigs block for release keystore
- [ ] **Step 2:** Generate release keystore if not exists — `keytool -genkey -v -keystore ozzylife-release.keystore -alias ozzylife -keyalg RSA -keysize 2048 -validity 10000`
- [ ] **Step 3:** Build release AAB — `cd web/android && ./gradlew bundleRelease`
- [ ] **Step 4:** Verify the AAB is generated at `app/build/outputs/bundle/release/app-release.aab`
- [ ] **Step 5:** Write `docs/play-store-listing.md` with: title ("OzzyLife - আপনার স্বাস্থ্য সঙ্গী"), short description (80 chars, bn + en), full description (4000 chars, features list), category, content rating notes, privacy policy requirements
- [ ] **Step 6:** Commit — `"chore: prepare Android release build and Play Store listing"`

---

<!-- END OF PHASE 1 PLAN -->
