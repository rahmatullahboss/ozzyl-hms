# OzzyLife — Full-Featured Health & Wellness App Design

> Patient Portal reimagined as a consumer-grade health & wellness app.
> Built with React 19 + Capacitor for native iOS/Android experience.

## Design Decisions

| Aspect | Decision |
|--------|----------|
| **Identity** | True hybrid — wellness + clinical equal weight |
| **Target** | Open to everyone — B2C user base attracts hospitals to B2B HMS |
| **Native** | Wearable sync, push notifications, camera (scan/photo), biometric login |
| **Differentiator** | AI + Clinical Intelligence — no other wellness app has hospital data |
| **Market** | Bangladesh-first (Bangla UI, local food DB, local diseases, bKash) |
| **Scope** | Full vision spec, phased delivery |
| **Architecture** | Modular Hub-and-Spoke |

---

## Section 1: App Identity & Architecture

**App Name:** OzzyLife (consumer brand, separate from "HMS" or "Patient Portal")

**Tagline:** "Your health, your hospital, one app."

### Architecture: Modular Hub-and-Spoke

```
┌─────────────────────────────────────┐
│           SMART HOME HUB            │
│  Daily Score + Alerts + Quick Actions│
├─────────┬─────────┬─────────┬───────┤
│ Wellness│ Hospital│ AI Coach│Profile│
│  Spoke  │  Spoke  │  Spoke  │ Spoke │
└────┬────┴────┬────┴────┬────┴───┬───┘
     │         │         │        │
  ┌──┴──┐  ┌──┴──┐  ┌──┴──┐  ┌──┴──┐
  │Nutri│  │Appts│  │Chat │  │Settings│
  │Fitns│  │Labs │  │Plans│  │Family │
  │Sleep│  │Meds │  │Tips │  │Privacy│
  │Mind │  │Msg  │  │Goals│  │Data   │
  │Track│  │Bills│  │     │  │       │
  └─────┘  └─────┘  └─────┘  └───────┘
```

### Two User Modes, One App

| Mode | Who | What they see |
|------|-----|--------------|
| **Standalone** | Anyone who downloads the app | All wellness features — tracking, goals, AI coaching, content, streaks. No hospital section visible. |
| **Connected** | Users who link to a hospital | Everything above + Hospital spoke unlocks (appointments, labs, prescriptions, messaging, billing). AI Coach gets clinical intelligence. |

**Key principle:** The app must be **fully useful without a hospital connection**. A user who never visits a hospital should still love this app for daily wellness. The hospital connection is a bonus, not a requirement.

### Bottom Navigation (4 tabs)

| Tab | Icon | Purpose |
|-----|------|---------|
| **Home** | 🏠 | Smart dashboard hub — Daily Score + alerts + quick actions |
| **Wellness** | 💪 | All health tracking modules (nutrition, fitness, sleep, mental health) |
| **Care** | 🏥 | Hospital services. Hidden or shows "Find a Hospital" CTA if standalone mode |
| **Me** | 👤 | Profile, family, settings, privacy, data export |

---

## Section 2: Home Screen / Smart Dashboard

The home screen is the heart of the app. It must answer one question instantly: **"How am I doing today?"**

### Layout (top to bottom, scrollable)

```
┌─────────────────────────────┐
│  Good morning, Rahim        │  <- Personalized greeting
│  Tuesday, 15 April          │     (time-aware, name, weather)
├─────────────────────────────┤
│  ┌───────────────────────┐  │
│  │   DAILY HEALTH SCORE  │  │  <- The hero element
│  │       ╭───╮           │  │     Circular ring (0-100)
│  │      │ 78 │           │  │     Color: green/yellow/red
│  │       ╰───╯           │  │     Tappable -> detailed breakdown
│  │  Sleep 7.2h | Steps 4k│  │
│  │  Mood: Good | Meds: 2 │  │
│  └───────────────────────┘  │
├─────────────────────────────┤
│  QUICK ACTIONS (horizontal) │  <- 4-5 circular icons
│  [Check-in] [Log Food]      │     Context-aware: shows what
│  [Log Mood] [Track Water]   │     user hasn't done today
├─────────────────────────────┤
│  SMART CARDS (vertical)     │  <- Priority-sorted, contextual
│  ┌───────────────────────┐  │
│  │ 🔥 5-day streak!      │  │  <- Streak card (gamification)
│  │ Keep it going tomorrow │  │
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ 💊 Evening meds due   │  │  <- Medication reminder
│  │ Metformin 500mg       │  │     (connected users only)
│  │ [Mark taken] [Snooze] │  │
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ 🏥 Lab result ready   │  │  <- Clinical alert
│  │ CBC from 12 Apr       │  │     (connected users only)
│  │ [View result]         │  │
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ 💡 Today's tip        │  │  <- Health tip card
│  │ "Walking after meals  │  │     (localized content)
│  │  lowers blood sugar"  │  │
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ 📊 Weekly summary     │  │  <- Trend mini-chart
│  │ [chart: last 7 days]  │  │
│  └───────────────────────┘  │
├─────────────────────────────┤
│  🤖 AI Coach FAB button     │  <- Floating action button
│  (bottom-right, always      │     Opens AI buddy chat
│   accessible)               │
└─────────────────────────────┘
```

### Daily Health Score (0-100)

The single number that makes users open the app every morning. Synthesized from:

| Input | Weight | Source |
|-------|--------|--------|
| Sleep quality | 25% | Wearable sync or manual log |
| Physical activity | 20% | Steps/exercise from wearable or manual |
| Nutrition compliance | 15% | Food logging completeness |
| Mood / mental state | 15% | Daily mood check-in |
| Medication adherence | 15% | Marked meds as taken (connected only, otherwise hydration) |
| Vital signs trend | 10% | BP/glucose/weight trend direction |

**Standalone users:** Medication adherence weight redistributes to hydration (10%) and sleep (5%).

**Score colors:**
- 80-100: Green — "Great day!"
- 60-79: Yellow — "Room to improve"
- 0-59: Red — "Needs attention"

### Time-of-Day Context

The home screen adapts based on when the user opens it:

| Time | Greeting | Priority cards |
|------|----------|---------------|
| 5am-11am (Morning) | "Good morning" | Sleep summary from last night, today's medication schedule, daily goals preview, morning check-in prompt |
| 11am-5pm (Afternoon) | "Good afternoon" | Activity progress so far, hydration reminder, upcoming appointment (if any), lunch logging nudge |
| 5pm-9pm (Evening) | "Good evening" | Day summary so far, evening meds reminder, mood check-in prompt, dinner logging nudge |
| 9pm-5am (Night) | "Good night" | Day completion summary, tomorrow's preview, wind-down content suggestion, sleep prep tips |

### Smart Card Priority Rules

Cards are not static — they are **ranked by urgency and relevance**:

1. **Critical clinical alerts** — abnormal lab results, missed medications (connected only)
2. **Time-sensitive actions** — appointment in 2 hours, medication due now
3. **Incomplete daily tasks** — haven't checked in, haven't logged food
4. **Streak at risk** — "Log something today to keep your 5-day streak!"
5. **Engagement content** — health tips, weekly summary, challenges
6. **Discovery prompts** — "Try sleep tracking" (for features user hasn't used yet)

### Existing Components to Reuse

These existing components map directly to this design:
- `PersonalizedGreeting` -> Greeting header
- `WellnessScoreCard` -> Daily Health Score ring
- `QuickCheckInCard` -> Quick actions row
- `StreakTrackerCard` -> Streak smart card
- `HealthTipsFeed` -> Health tip card
- `DailyCheckInWidget` -> Morning/evening check-in flow
- `LifestyleQuickActions` -> Quick action icons
---

## Section 3: Wellness Spoke Modules

The Wellness tab is the second tab in the bottom nav. It shows a grid/list of module cards, each leading to its own deep experience. Users can reorder and hide modules they don't use.

### Wellness Tab Layout

```
┌─────────────────────────────┐
│  MY WELLNESS                │
│  ┌──────────┬──────────┐    │
│  │ 🍚       │ 🏃       │    │
│  │ Nutrition │ Activity │    │
│  │ 1,420cal │ 4.2k stp │    │
│  ├──────────┼──────────┤    │
│  │ 😴       │ 🧠       │    │
│  │ Sleep    │ Mind     │    │
│  │ 7.2h    │ Mood: 😊 │    │
│  ├──────────┼──────────┤    │
│  │ ❤️       │ 🩺       │    │
│  │ Vitals   │ Women's  │    │
│  │ BP: 120  │ Day 14   │    │
│  └──────────┴──────────┘    │
│                             │
│  [+ Add Module]             │
└─────────────────────────────┘
```

Each card shows: icon, label, today's key metric. Tapping opens the full module.

---

### Module 1: Nutrition & Food

**Why it matters:** Nutrition is the #1 daily engagement driver in wellness apps (MyFitnessPal has 200M+ users). For Bangladesh, this is huge — no app has a proper local food database.

**Features:**

| Feature | Description |
|---------|-------------|
| **Bangladesh food database** | Pre-loaded with 500+ local foods: rice (bhaat), dal, fish (ilish, rui, pangash), curry items, street food (fuchka, chotpoti, jhalmuri), sweets (roshogolla, mishti doi). Each with calories, protein, carbs, fat, fiber. |
| **Quick food logging** | 3 ways: (1) Search & select from DB, (2) Photo snap — AI identifies food from image, (3) Voice — "I had 2 roti and dal for lunch" |
| **Meal sections** | Breakfast (Shokaler nashta), Lunch (Dupur er khabar), Snacks (Hafka), Dinner (Rater khabar) |
| **Calorie & macro tracking** | Daily calorie goal with circular progress. Macro split: carbs / protein / fat bar chart |
| **Water tracking** | Glass counter with daily goal (8 glasses default). Quick-add from home screen |
| **Ramadan fasting mode** | Special mode during Ramadan: tracks Sehri and Iftar meals only, adjusts calorie distribution, hydration reminders between Iftar and Sehri, suppresses food nudges during fasting hours |
| **Weekly nutrition report** | Auto-generated: average calories, macro balance, most logged foods, improvement suggestions |

**Bangladesh food DB approach:** Start with curated 500 items covering 90% of daily meals. Allow user-submitted foods that get community-verified. Expand via crowdsourcing.

**Existing components:** `DiaryHistoryTab` for food log history, `LifestyleQuickActions` for quick-add buttons.

---

### Module 2: Fitness & Activity

**Why it matters:** Steps and exercise are the baseline engagement metric. Gamification (rings, streaks) keeps users coming back.

**Features:**

| Feature | Description |
|---------|-------------|
| **Step counter** | From wearable (Apple Health / Health Connect) or phone accelerometer. Daily goal with circular ring (Apple Health style) |
| **Activity rings** | 3 rings: Move (calories burned), Exercise (active minutes), Stand/Walk (hourly movement). Complete all 3 = perfect day |
| **Exercise logging** | Manual log: walking, running, cycling, swimming, gym, yoga, namaz (prayer — counts as light activity), housework. Duration + estimated calories |
| **Workout library** | Curated exercise videos/guides. Categorized: home workout, gym, yoga, stretching, post-surgery rehab (connected users). Bangladesh-friendly: no equipment needed options |
| **Walking challenges** | Weekly step challenges: personal goals, family challenges, community leaderboards. "Walk 50,000 steps this week" |
| **Activity history** | Calendar view showing daily activity. Heatmap for the month. Trends over weeks/months |
| **Integration** | Auto-sync from: Apple Watch, Samsung Galaxy Watch, Mi Band, Fitbit, Amazfit via HealthKit (iOS) and Health Connect (Android) |

**Bangladesh-specific:** Include namaz/salah as tracked activity (5 times daily = ~60 min light activity). Include rickshaw-riding awareness (not exercise). Walking is the dominant exercise form — optimize for walking challenges.

---

### Module 3: Sleep

**Why it matters:** Every top wellness app (Oura, WHOOP, Fitbit, Samsung Health) now treats sleep as a primary metric. Sleep quality drives the Daily Health Score significantly.

**Features:**

| Feature | Description |
|---------|-------------|
| **Sleep logging** | Auto from wearable OR manual: bedtime, wake time, quality rating (1-5 stars) |
| **Sleep score** | 0-100 score based on: duration vs goal, consistency (same bedtime), interruptions, self-rated quality |
| **Sleep stages** | If wearable provides: light, deep, REM, awake breakdown. Otherwise skip — don't fake data |
| **Bedtime reminder** | Push notification at configured time: "Time to wind down — your bedtime is in 30 minutes" |
| **Sleep trends** | Weekly/monthly charts: average duration, consistency score, bedtime drift |
| **Sleep hygiene tips** | Contextual tips based on user's data: "You slept 2 hours less on weekends — try to keep a consistent schedule" |
| **Sleep sounds** | Optional: white noise, rain, fan, nature sounds. Simple audio player. Not a full Calm clone — just basics |

**Bangladesh-specific:** Account for Fajr prayer (~4:30-5:00 AM) disrupting sleep — don't penalize users who wake for Fajr and go back to sleep. Adjust sleep scoring for cultural norms.

---

### Module 4: Mental Health & Mindfulness

**Why it matters:** This is where your app becomes clinically meaningful. Apple Health added mood logging + PHQ-9/GAD-7 style assessments. You already have PHQ-9 and GAD-7 in the danphe reference — this bridges consumer wellness with clinical screening.

**Features:**

| Feature | Description |
|---------|-------------|
| **Daily mood check-in** | Quick emoji selector: 😄 Great, 🙂 Good, 😐 Okay, 😔 Low, 😢 Struggling. Optional: add a note about what's affecting mood |
| **Mood trends** | Calendar heatmap + weekly line chart. Correlate mood with sleep, activity, and events |
| **PHQ-9 screening** | Validated depression screening questionnaire. Available on-demand and prompted monthly. Score with severity interpretation. **Connected users:** results flow to provider dashboard with patient consent |
| **GAD-7 screening** | Validated anxiety screening. Same flow as PHQ-9 |
| **Breathing exercises** | 3 guided patterns: Box breathing (4-4-4-4), 4-7-8 relaxation, deep belly breathing. Visual animation guide + haptic feedback |
| **Meditation timer** | Simple timer with optional ambient sound. No guided content needed initially — just a distraction-free timer with gentle bell |
| **Stress log** | Quick log: what caused stress, intensity (1-5), coping action taken. Helps AI Coach identify patterns |
| **Crisis safety net** | If PHQ-9 score is severe OR mood is "Struggling" for 3+ consecutive days: show Kaan Pete Roi helpline (1800-121-3820), nearest hospital emergency, "Talk to AI Coach" prompt. Never diagnose — always direct to help |

**Clinical bridge (connected users only):**
- PHQ-9/GAD-7 results appear in provider's patient chart (with consent toggle)
- Mood trends visible to care team during visits
- AI Coach can reference clinical context: "Your anxiety score has improved since starting the new medication"

**Danphe reference to port:** `Phq9Section.tsx`, `Gad7Section.tsx`, `usePHQ9.ts`, `useGAD7.ts` from danphe-next-cloudflare.

---

### Module 5: Vitals & Body Tracking

**Why it matters:** This is the Samsung Health / Apple Health core. Manual logging for most Bangladesh users (few have smart BP monitors), but wearable sync for those who do.

**Features:**

| Feature | Description |
|---------|-------------|
| **Blood pressure** | Log systolic/diastolic/pulse. Classify: normal / elevated / hypertension stage 1/2. Trend chart. Reminder to measure |
| **Blood glucose** | Log fasting and post-meal readings. Classify per ADA ranges. Critical for Bangladesh's huge diabetes population. Chart with meal correlation |
| **Weight & BMI** | Log weight, auto-calculate BMI. Goal setting (target weight). Trend line with weekly averages |
| **Temperature** | Simple log. Flag fever (>99.5F / >37.5C). Useful for dengue season awareness |
| **Heart rate** | From wearable (resting HR, active HR) or manual. Trend over days/weeks |
| **SpO2** | From wearable or manual pulse oximeter reading. Flag if below 95% |
| **Blood test results** | Connected users: auto-populated from hospital lab results. Standalone: manual entry for common tests (CBC, blood sugar, lipid panel, thyroid) |
| **Body measurements** | Optional: waist, hip, chest for body composition tracking |

**Smart alerts:**
- BP > 180/120: "This is a hypertensive crisis. Please seek immediate medical attention."
- Glucose > 300 mg/dL: "Your blood sugar is very high. Contact your doctor."
- SpO2 < 92%: "Low oxygen detected. If you feel breathless, seek emergency care."
- Temperature > 103F for 2+ days: "Persistent high fever. Please see a doctor. During dengue season, get a CBC test."

**These are NOT diagnoses** — always include the safety disclaimer and direct to professional care.

---

### Module 6: Women's Health

**Why it matters:** Apple, Samsung, Oura, and WHOOP all added cycle tracking. In Bangladesh, women's health is underserved digitally. This module needs cultural sensitivity — many women track privately.

**Features:**

| Feature | Description |
|---------|-------------|
| **Cycle tracking** | Log period start/end, flow intensity, symptoms (cramps, headache, mood changes, bloating). Predict next period and fertile window |
| **Cycle calendar** | Visual calendar with color-coded phases: menstrual, follicular, ovulation, luteal |
| **Symptom logging** | Track cycle-related symptoms daily. See patterns across cycles |
| **Pregnancy mode** | Switch to pregnancy tracking: week-by-week milestones, weight tracking, kick counter, appointment reminders, baby size comparisons |
| **Postpartum mode** | After delivery: recovery tracking, feeding log (breastfeeding/formula), baby milestone tracking, mood monitoring (postpartum depression screening via PHQ-9) |
| **Privacy lock** | Extra biometric lock on this module. Data is never shown on the home dashboard unless the user explicitly enables it. Not visible to family members with shared access |

**Bangladesh-specific:** Bangla terminology for all reproductive health terms. Educational content about menstrual health (still taboo — normalize it). Integration with OB/GYN appointments for connected users.

**Connected user bridge:** Cycle data available to OB/GYN provider (with explicit consent toggle, off by default). Pregnancy mode links to hospital maternity services.

---

### Module Summary

| Module | Daily Engagement Hook | Feeds Health Score | Bangladesh Angle |
|--------|----------------------|-------------------|-----------------|
| Nutrition | Meal logging, water | Yes (15%) | Local food DB, Ramadan mode |
| Activity | Steps, rings | Yes (20%) | Walking focus, namaz tracking |
| Sleep | Sleep score | Yes (25%) | Fajr-aware scoring |
| Mental Health | Mood check-in | Yes (15%) | PHQ-9/GAD-7, Kaan Pete Roi |
| Vitals | BP/glucose logging | Yes (10%) | Diabetes/hypertension focus |
| Women's Health | Cycle log | No (privacy) | Cultural sensitivity, privacy lock |
---

## Section 4: Hospital / Care Spoke

The Care tab (🏥) is the third tab in the bottom nav. It behaves completely differently based on user mode.

### What Standalone Users See

For users who haven't linked to any hospital, the Care tab is a **discovery and conversion funnel** — this is how you turn app users into hospital patients (B2C → B2B flywheel).

```
┌─────────────────────────────┐
│  CARE                       │
│                             │
│  ┌───────────────────────┐  │
│  │ 🏥 Find a Hospital    │  │  <- Search by location,
│  │ Search nearby...      │  │     specialty, name
│  └───────────────────────┘  │
│                             │
│  HOSPITALS NEAR YOU         │
│  ┌───────────────────────┐  │
│  │ ★ 4.3  City Hospital  │  │  <- Hospital cards with
│  │ 📍 2.1 km | Dhanmondi │  │     ratings, distance,
│  │ Cardiology, Medicine  │  │     specialties
│  │ [View] [Book Appt]    │  │
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ ★ 4.1  Green Life     │  │
│  │ 📍 3.5 km | Gulshan   │  │
│  │ Surgery, OB/GYN       │  │
│  │ [View] [Book Appt]    │  │
│  └───────────────────────┘  │
│                             │
│  HEALTH SERVICES            │
│  ┌──────────┬──────────┐    │
│  │ 🩺       │ 💬       │    │
│  │ Tele-    │ Symptom  │    │
│  │ medicine │ Checker  │    │
│  ├──────────┼──────────┤    │
│  │ 🚑       │ 💊       │    │
│  │ Emergency│ Medicine │    │
│  │ Nearby   │ Reminder │    │
│  └──────────┴──────────┘    │
│                             │
│  ┌───────────────────────┐  │
│  │ 💡 WHY CONNECT?       │  │  <- Conversion prompt
│  │ Link your hospital to │  │
│  │ unlock: lab results,  │  │
│  │ prescriptions, AI     │  │
│  │ clinical insights...  │  │
│  │ [Connect a Hospital]  │  │
│  └───────────────────────┘  │
└─────────────────────────────┘
```

**Hospital directory features:**
- Search by name, location (GPS), specialty, rating
- Hospital profile page: specialties, doctors, photos, ratings/reviews, operating hours, contact, map
- Direct appointment booking (if hospital uses HMS)
- Telemedicine availability indicator
- Distance from user (GPS-based)

**Health services (available to all):**
- **Symptom checker** — AI-guided questionnaire: "What are you feeling?" → suggests possible conditions → recommends which specialty to visit. Never diagnoses. Always ends with "See a doctor."
- **Emergency finder** — GPS-based nearest hospital emergency departments with distance and estimated travel time
- **Medicine reminder** — Basic medication reminder even without hospital connection. User manually adds their medicines.
- **Telemedicine** — If available: video consultation with doctors at partner hospitals

### What Connected Users See

When a user links to one or more hospitals, the Care tab transforms into a full hospital services dashboard.

```
┌─────────────────────────────┐
│  MY CARE                    │
│                             │
│  LINKED HOSPITALS           │
│  [City Hospital ▼]         │  <- Hospital selector dropdown
│                             │     (if linked to multiple)
│  ┌───────────────────────┐  │
│  │ 📅 APPOINTMENTS       │  │
│  │ Next: Dr. Karim       │  │
│  │ Cardiology | 18 Apr   │  │
│  │ [View all] [Book new] │  │
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ 🧪 LAB RESULTS        │  │
│  │ New: CBC (12 Apr)     │  │
│  │ [View] [All results]  │  │
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ 💊 PRESCRIPTIONS      │  │
│  │ Active: 3 medications │  │
│  │ [View] [Refill]       │  │
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ 💬 MESSAGES           │  │
│  │ 1 unread from nurse   │  │
│  │ [Open inbox]          │  │
│  └───────────────────────┘  │
│  ┌───────────────────────┐  │
│  │ 💰 BILLS & PAYMENTS   │  │
│  │ Due: ৳2,500 (20 Apr)  │  │
│  │ [Pay now] [History]   │  │
│  └───────────────────────┘  │
│                             │
│  MORE SERVICES              │
│  ┌──────────┬──────────┐    │
│  │ 📋       │ 🎫       │    │
│  │ Medical  │ Visit    │    │
│  │ Records  │ Pass     │    │
│  ├──────────┼──────────┤    │
│  │ 🆘       │ 📄       │    │
│  │ Emergency│ Document │    │
│  │ Pack     │ Vault    │    │
│  └──────────┴──────────┘    │
│                             │
│  [+ Link Another Hospital]  │
└─────────────────────────────┘
```

**Connected services (from existing HMS APIs):**

| Service | Description | Existing Component |
|---------|-------------|--------------------|
| **Appointments** | View upcoming, book new, cancel, reschedule. Pre-visit digital check-in and intake forms | `PatientHospitalServicesTab` |
| **Lab results** | View results with normal range indicators. Plain-language explanations. Push notification when new result arrives | `PatientHospitalServicesTab` |
| **Prescriptions** | Active medication list. Refill requests. Auto-populate medicine tracker with dosage and schedule | `PatientHospitalServicesTab` |
| **Secure messaging** | Chat with care team (doctor, nurse). Async — not real-time. Attach photos/documents | `PatientHospitalServicesTab` |
| **Bills & payments** | Outstanding bills, payment history. Online payment via bKash/Nagad/card. Cost estimates for upcoming procedures | `PatientHospitalServicesTab` |
| **Medical records** | Full timeline: visits, diagnoses, procedures, immunizations. Cross-hospital if linked to multiple | `PatientGlobalRecordsTab` |
| **Visit pass** | QR code for hospital visit check-in. Pre-filled with appointment and insurance info | Existing visit pass feature |
| **Emergency pack** | One-tap shareable emergency profile: blood group, allergies, medications, emergency contacts, conditions | Existing emergency pack |
| **Document vault** | Upload and store: prescriptions, reports, insurance cards, ID copies. Organized by category and date | `PatientVaultTab` |

### The Clinical → Wellness Bridge

This is the **killer feature** that no other app has. Clinical data from the hospital automatically enriches the wellness experience:

| Clinical Data | Wellness Impact |
|--------------|-----------------|
| Lab results (glucose, HbA1c, lipid panel) | Auto-populate Vitals module trends. AI Coach says: "Your HbA1c improved from 7.2 to 6.8 — your diet changes are working!" |
| Prescriptions | Auto-create medication reminders in Medicine Tracker. Feed medication adherence into Daily Health Score |
| Diagnoses (diabetes, hypertension) | AI Coach tailors all advice: nutrition goals adjust for diabetic diet, exercise recommendations account for cardiac conditions |
| Appointment notes | Post-visit: AI Coach summarizes "Your doctor recommended..." and creates follow-up action items |
| Immunization records | Show vaccination status, upcoming boosters, seasonal flu shot reminders |
| Discharge instructions | Post-discharge recovery module: daily check-ins, wound care reminders, rehab exercises, readmission warning signs |

### Hospital Linking Flow

How a standalone user becomes a connected user:

```
1. User taps "Connect a Hospital" or books appointment via directory
2. Search: enter hospital name or scan hospital QR code
3. Hospital found → Show hospital profile + "Link" button
4. User enters: patient ID (if known) OR NID → hospital verifies identity
5. If patient exists in HMS: instant link. Records sync.
6. If patient is new: create patient record at hospital. Link.
7. Confirmation: "You're now connected to City Hospital!"
8. Care tab transforms. Clinical data starts flowing.
```

**Multi-hospital support:** User can link to multiple hospitals. Hospital selector dropdown at top of Care tab. Cross-hospital records timeline shows unified view.

### Existing Components to Reuse

- `PatientHospitalServicesTab` → Core of connected Care tab
- `PatientFindCareTab` → Hospital directory for standalone users
- `PatientGlobalRecordsTab` → Cross-hospital medical records
- `PatientVaultTab` → Document vault
- `PatientPrivacyTab` → Consent and privacy management
- `MedicineTrackerTab` → Medication tracking (bridge between Care and Wellness)
- `FamilyHealthHub` → Family member management
---

## Section 5: AI Coach & Clinical Intelligence

This is the **core differentiator**. No fitness app knows your lab results. No patient portal has a wellness coach. OzzyLife has both — and the AI Coach sits at the intersection.

### Two Intelligence Layers

```
┌──────────────────────────────────────┐
│           AI COACH ("Ozzy")          │
│                                      │
│  ┌────────────────────────────────┐  │
│  │   CLINICAL LAYER (Connected)  │  │
│  │   Diagnoses, medications,     │  │
│  │   lab results, appointment    │  │
│  │   notes, discharge plans      │  │
│  ├────────────────────────────────┤  │
│  │   WELLNESS LAYER (Everyone)   │  │
│  │   Food logs, sleep, activity, │  │
│  │   mood, vitals, streaks,      │  │
│  │   goals, patterns             │  │
│  └────────────────────────────────┘  │
│                                      │
│  Output: Personalized, contextual,   │
│  safe, non-diagnostic guidance       │
└──────────────────────────────────────┘
```

**Standalone users** get a smart wellness coach that's already better than generic fitness apps because it sees ALL their tracked data (nutrition + sleep + activity + mood + vitals) holistically.

**Connected users** get a coach that also knows their clinical reality — it adjusts everything based on diagnoses, medications, and lab trends.

### AI Coach Personality

**Name:** Ozzy (matches app brand)

**Tone:** Friendly, encouraging, simple language. Like a knowledgeable friend who happens to understand health — not a clinical robot. Uses Bangla naturally when the user's language is set to Bangla.

**Example interactions:**

Standalone user:
> "Good morning! You slept 7.5 hours last night — nice improvement from yesterday's 5.8h. Your mood has been 'Good' for 3 days straight. Keep it up! Ready to log breakfast?"

Connected user:
> "Good morning! Your last HbA1c was 6.8 — down from 7.2 three months ago. Your food logs show you've been eating less rice and more vegetables. That's clearly working! Dr. Karim will be happy at your next visit on April 22. Keep going!"

### What the AI Coach Does

#### 1. Daily Insights (Proactive — Push Notification + Home Card)

Generated each morning based on previous day's data:

| Trigger | Example Insight |
|---------|----------------|
| Sleep improved | "You slept 7.5h — up from your 6.2h weekly average. What changed? Try to repeat it tonight." |
| Activity streak at risk | "You haven't logged any activity today. A 15-minute walk after dinner keeps your 5-day streak alive!" |
| Mood pattern detected | "I notice your mood tends to drop on Sundays. Would you like to plan something relaxing this weekend?" |
| BP trending up | "Your last 3 BP readings average 138/88 — that's creeping into Stage 1 hypertension range. Consider reducing salt this week." |
| Glucose + food correlation | "Your post-lunch glucose spikes on days you eat white rice. Try replacing one rice meal with roti this week." *(Connected: "This aligns with Dr. Karim's recommendation to reduce carbs.")* |
| Medication missed | "You missed your evening Metformin yesterday. Consistent timing helps keep blood sugar stable." |
| Lab result ready | "Your CBC results are in. Everything looks normal — white blood cells, hemoglobin, and platelets are all within range." *(Plain-language lab interpretation)* |

#### 2. Conversational Chat (On-demand — via FAB button)

Users can ask Ozzy questions anytime:

| Category | Example Questions |
|----------|------------------|
| **Nutrition** | "Is 2 cups of rice too much for dinner?" "What should I eat to lower cholesterol?" "How many calories in a plate of kacchi biryani?" |
| **Fitness** | "How many steps should I walk daily?" "Is it safe to exercise after eating?" "Suggest a 15-minute home workout" |
| **Medication** | "Can I take paracetamol with my blood pressure medicine?" "What happens if I miss a dose of Metformin?" "What are the side effects of Omeprazole?" |
| **Symptoms** | "I've had a headache for 3 days" "My blood sugar is 250 — what should I do?" "I feel chest pain" |
| **Lab results** | "What does high creatinine mean?" "Is my cholesterol level dangerous?" "Explain my CBC report" |
| **General** | "How much water should I drink?" "Is intermittent fasting safe?" "Tips for better sleep" |

**For symptom questions:** Ozzy asks structured follow-up questions (onset, duration, severity, associated symptoms), provides general information, and ALWAYS recommends seeing a doctor. Never diagnoses.

**For emergency keywords** (chest pain, breathing difficulty, severe bleeding, suicidal thoughts): Ozzy immediately shows emergency contacts, nearest hospital, and helpline numbers. No further questions — direct to help.

#### 3. Pre-Visit Preparation (Connected users, triggered 24h before appointment)

Push notification + chat message:

> "Your appointment with Dr. Karim (Cardiology) is tomorrow at 10:00 AM at City Hospital.
>
> **Here's what to discuss:**
> - Your BP has averaged 135/85 this month (slightly elevated)
> - You've been consistent with Amlodipine but missed 3 doses of Metformin this month
> - Your last cholesterol check was 3 months ago — ask if a repeat is needed
> - You logged knee pain twice this week — mention it
>
> **Don't forget:**
> - Your Visit Pass is ready (show QR at reception)
> - Bring your insurance card
> - Fast for 8 hours if bloodwork is expected"

#### 4. Post-Visit Follow-up (Connected users, triggered after appointment)

> "How was your visit with Dr. Karim today?
>
> **Based on your updated records:**
> - New prescription: Rosuvastatin 10mg (cholesterol) — I've added it to your medicine tracker
> - Dr. Karim wants a lipid panel in 3 months — I've set a reminder for July 15
> - Advice: reduce fried food intake — I'll adjust your nutrition goals to flag fried items
>
> **Your action items:**
> - [ ] Start Rosuvastatin tonight (added to evening meds)
> - [ ] Schedule follow-up lipid panel (July)
> - [ ] Try 3 fried-food-free days this week"

#### 5. Pattern Recognition (Weekly/Monthly analysis)

The AI Coach analyzes long-term patterns and surfaces insights:

| Pattern | Insight |
|---------|---------|
| Sleep ↔ Mood correlation | "Over the past month, your mood is 'Good' or 'Great' 80% of the time when you sleep 7+ hours, but only 30% when you sleep less than 6 hours." |
| Food ↔ Glucose | "Your post-meal glucose averages 160 after rice-heavy meals but 120 after roti-based meals." |
| Activity ↔ Sleep | "On days you walk 6,000+ steps, you fall asleep 20 minutes faster on average." |
| Medication ↔ Vitals | "Since starting Amlodipine 6 weeks ago, your average BP dropped from 145/92 to 132/84." |
| Seasonal | "Dengue season starts next month. Make sure to use mosquito nets and track any fever symptoms." |

#### 6. Goal Setting & Adjustment

Ozzy helps users set realistic goals and adjusts them based on progress:

> "Based on your first 2 weeks of tracking:
> - You average 3,200 steps/day. Let's target 4,500 for next week (not 10,000 — that's too aggressive).
> - You eat about 1,800 cal/day. For your weight goal, let's aim for 1,650.
> - Your sleep averages 5.8 hours. Let's push bedtime 30 minutes earlier."

Goals auto-adjust monthly based on actual performance — gradual progression, not fixed targets.

### Safety Boundaries (Non-Negotiable)

| Rule | Implementation |
|------|---------------|
| **Never diagnose** | "Based on your symptoms, you might want to see a doctor about..." NOT "You have diabetes" |
| **Never prescribe** | "Your doctor might consider..." NOT "You should take Metformin" |
| **Never contradict doctors** | If patient says "My doctor told me X" — support it, never undermine |
| **Emergency escalation** | Chest pain, suicidal ideation, severe symptoms → immediate emergency resources, no further Q&A |
| **Disclaimer on every session** | Footer: "Ozzy provides health information, not medical advice. Always consult your doctor for medical decisions." |
| **Clinical data attribution** | Always say "According to your hospital records..." not "I know that..." — transparency about data sources |
| **Consent-gated** | Clinical layer only activates if user explicitly consents to AI accessing their hospital data |

### Technical Architecture

```
┌─────────────────┐     ┌──────────────────┐
│ User sends msg  │────→│ Intent Classifier │
└─────────────────┘     └────────┬─────────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼             ▼
              ┌──────────┐ ┌─────────┐ ┌───────────┐
              │ Emergency│ │ General │ │ Clinical  │
              │ Handler  │ │ Wellness│ │ Context   │
              │(instant) │ │ RAG    │ │ RAG       │
              └──────────┘ └─────────┘ └───────────┘
                                 │             │
                                 ▼             ▼
                          ┌──────────────────────┐
                          │ Response Generator   │
                          │ (safety filter +     │
                          │  personality layer)  │
                          └──────────────────────┘
```

- **Intent classifier** — routes to emergency handler (instant response), general wellness RAG (nutrition/fitness/sleep knowledge base), or clinical context RAG (patient-specific hospital data)
- **RAG (Retrieval Augmented Generation)** — grounds responses in actual data (user's tracked data + clinical records + health knowledge base), not hallucinated medical advice
- **Safety filter** — final check before response: no diagnosis, no prescription, emergency keywords caught, disclaimer attached
- **Personality layer** — ensures Ozzy's friendly, simple tone regardless of underlying data complexity

### Existing Component

- `AIBuddyChat` → The chat interface. Extend with the intelligence layers above.
---

## Section 6: Onboarding & Progressive Disclosure

The app has 30+ features. Showing everything on day 1 kills retention. The goal: **useful in 60 seconds, powerful over 30 days.**

### Onboarding Flow (Under 2 minutes)

```
Screen 1: WELCOME
┌─────────────────────────────┐
│                             │
│      🌿 OzzyLife            │
│   Your health, your         │
│   hospital, one app.        │
│                             │
│   [Get Started]             │
│   [I have an account]       │
└─────────────────────────────┘

Screen 2: LANGUAGE
┌─────────────────────────────┐
│                             │
│   Choose your language      │
│                             │
│   [বাংলা]    [English]      │
│                             │
└─────────────────────────────┘

Screen 3: ABOUT YOU (quick profile)
┌─────────────────────────────┐
│                             │
│   Tell us about yourself    │
│                             │
│   Name: [          ]        │
│   Age:  [    ]              │
│   Gender: [M] [F] [Other]  │
│   Height: [    ]            │
│   Weight: [    ]            │
│                             │
│   [Continue]                │
└─────────────────────────────┘

Screen 4: YOUR GOALS (pick 1-3)
┌─────────────────────────────┐
│                             │
│   What matters most to you? │
│                             │
│   [🏃 Stay active]          │
│   [🍚 Eat better]           │
│   [😴 Sleep well]            │
│   [🧠 Mental peace]         │
│   [💊 Track medications]    │
│   [📉 Lose weight]          │
│   [❤️ Manage BP/diabetes]   │
│   [🤰 Pregnancy tracking]   │
│                             │
│   [Continue]                │
└─────────────────────────────┘

Screen 5: HOSPITAL CONNECTION (optional)
┌─────────────────────────────┐
│                             │
│   Connect to your hospital? │
│                             │
│   Link your hospital to     │
│   see appointments, lab     │
│   results, and get          │
│   personalized AI advice.   │
│                             │
│   [Connect a Hospital]      │
│   [Skip for now]            │
│                             │
└─────────────────────────────┘

Screen 6: PERMISSIONS
┌─────────────────────────────┐
│                             │
│   Allow OzzyLife to:        │
│                             │
│   ✅ Send notifications     │
│      (reminders & tips)     │
│   ✅ Access Health data     │
│      (steps & sleep sync)   │
│   ✅ Use camera             │
│      (food & doc scanning)  │
│   ✅ Use biometrics         │
│      (fingerprint login)    │
│                             │
│   [Allow All]  [Customize]  │
└─────────────────────────────┘

Screen 7: MEET OZZY
┌─────────────────────────────┐
│                             │
│   Meet Ozzy, your AI coach  │
│                             │
│   🤖 "Hi! I'm Ozzy. I'll   │
│   help you stay healthy     │
│   with daily tips and       │
│   personalized advice.      │
│   Ask me anything!"         │
│                             │
│   [Start My Journey]        │
└─────────────────────────────┘

→ Lands on HOME with personalized dashboard
```

**Total: 7 screens, ~90 seconds.** No lengthy questionnaires. Goals selected in Screen 4 determine which modules are active on the Wellness tab.

### Starter Modules (Based on Goal Selection)

The user's goal picks determine their initial active modules. Other modules are visible but collapsed with a "Try it" badge.

| Goal Selected | Active Modules | Inactive (Discoverable) |
|--------------|----------------|------------------------|
| Stay active | Activity, Sleep | Nutrition, Mind, Vitals, Women's |
| Eat better | Nutrition, Activity | Sleep, Mind, Vitals, Women's |
| Sleep well | Sleep, Mind | Nutrition, Activity, Vitals, Women's |
| Mental peace | Mind, Sleep | Nutrition, Activity, Vitals, Women's |
| Track medications | Medicine Tracker, Vitals | Nutrition, Activity, Sleep, Mind |
| Lose weight | Nutrition, Activity, Vitals | Sleep, Mind, Women's |
| Manage BP/diabetes | Vitals, Nutrition, Medicine Tracker | Activity, Sleep, Mind |
| Pregnancy tracking | Women's Health, Nutrition, Vitals | Activity, Sleep, Mind |

**Key rule:** Never hide modules — just de-prioritize. Inactive modules appear as collapsed cards at the bottom of the Wellness tab with a teaser: "Track your sleep → Tap to start."

### First-Week Guided Experience

Ozzy walks the user through features one per day during the first week. Each day introduces ONE new habit:

| Day | Ozzy's Prompt | Action |
|-----|---------------|--------|
| Day 1 | "Welcome! Let's start simple. How are you feeling right now?" | First mood check-in |
| Day 2 | "Good morning! What did you have for breakfast?" | First food log |
| Day 3 | "How did you sleep last night? Quick — just rate it 1-5 stars." | First sleep log |
| Day 4 | "Let's check your steps! You walked 2,300 steps yesterday." | Discover activity tracking |
| Day 5 | "Time for a 2-minute breathing exercise. Ready?" | First breathing exercise |
| Day 6 | "Let's set your first weekly goal together." | Goal setting with Ozzy |
| Day 7 | "Here's your first weekly report! 🎉" | Weekly summary reveal |

**After week 1:** Ozzy transitions from guided prompts to contextual nudges. The user now knows the core features.

### Progressive Feature Unlocking

Features reveal themselves based on user behavior, not arbitrary timelines:

| Trigger | Feature Revealed |
|---------|-----------------|
| User logs food for 3 days | "Want to see your calorie trends? → Nutrition trends unlocked" |
| User logs mood for 5 days | "I'm starting to see patterns in your mood. → Mood trends unlocked" |
| User completes 7-day streak | "You're on fire! 🔥 → Challenges & achievements section unlocked" |
| User logs BP 3 times | "Let's track your BP trend. → Vitals trend charts unlocked" |
| User asks Ozzy a clinical question | "I could give better advice if I knew your medical history. → Hospital connection prompt" |
| User linked to hospital | "Your doctor prescribed 3 medications. → Auto-populated medicine tracker" |
| User completes PHQ-9 | "Would you like to share this with your doctor? → Clinical bridge prompt" |
| 30 days of activity | "Ready for a challenge? → Walking challenges unlocked" |

### Empty States (Every screen must have one)

No blank screens. Every empty state has:
1. Friendly illustration or icon
2. Short explanation of what this feature does
3. Clear CTA button to get started

Examples:

```
┌───────────────────────────┐
│                           │
│     🍚                    │
│  No meals logged yet      │
│                           │
│  Track what you eat to    │
│  see calorie trends and   │
│  get nutrition advice     │
│  from Ozzy.               │
│                           │
│  [Log Your First Meal]    │
│                           │
└───────────────────────────┘

┌───────────────────────────┐
│                           │
│     🏥                    │
│  No hospital connected    │
│                           │
│  Link your hospital to    │
│  see appointments, lab    │
│  results, and unlock      │
│  clinical AI insights.    │
│                           │
│  [Find a Hospital]        │
│                           │
└───────────────────────────┘
```

### Re-Engagement (Lapsed Users)

If a user stops using the app:

| Days Inactive | Action |
|--------------|--------|
| 1 day | Nothing — normal |
| 2 days | Gentle push: "We miss you! Your streak is about to break 😢" |
| 3 days | Ozzy message: "Hey, everything okay? A quick check-in takes 10 seconds." |
| 7 days | Push: "Your weekly report is ready — see how your week went" |
| 14 days | Push: "You were doing great! Come back and pick up where you left off." |
| 30+ days | Monthly health tip push only. No guilt — respect the user's space |

**Rule:** Never spam. Max 1 push notification per day. Users can configure notification preferences granularly.
---

## Section 7: Native / Capacitor Capabilities

The app is built as a React web app wrapped with Capacitor for native iOS and Android. This section defines every native capability and the specific Capacitor plugins needed.

### Platform Strategy

```
┌─────────────────────────────────────────┐
│              React 19 + Vite            │
│           (shared codebase)             │
├──────────┬──────────┬───────────────────┤
│ Web PWA  │   iOS    │     Android       │
│ (browser)│(Capacitor│   (Capacitor      │
│          │ + Swift) │   + Kotlin)       │
└──────────┴──────────┴───────────────────┘
```

**One codebase, three targets:**
- **Web PWA** — for desktop/laptop access (patients who prefer browser)
- **iOS app** — App Store distribution via Capacitor
- **Android app** — Play Store distribution via Capacitor (primary market — Android dominates Bangladesh at 95%+)

### Native Capabilities & Plugins

#### 1. Biometric Authentication

| Aspect | Detail |
|--------|--------|
| **Purpose** | Quick secure login — fingerprint or Face ID. Critical for health data trust |
| **Plugin** | `@capacitor-community/biometric-auth` or `capacitor-native-biometric` |
| **Flow** | First login: email/phone + OTP → set up biometric. Subsequent: biometric only. Fallback: PIN code |
| **Where used** | App launch, Women's Health privacy lock, document vault access, payment confirmation |
| **Web fallback** | WebAuthn API for browsers that support it, otherwise standard login |

#### 2. Push Notifications

| Aspect | Detail |
|--------|--------|
| **Purpose** | Medication reminders, appointment alerts, streak nudges, health tips, AI Coach insights, lab result alerts |
| **Plugin** | `@capacitor/push-notifications` + Firebase Cloud Messaging (Android) + APNs (iOS) |
| **Notification types** | See table below |
| **User control** | Granular per-category toggle in Settings. Master quiet hours (e.g., 10pm-7am) |
| **Web fallback** | Web Push API (service worker) |

**Notification categories:**

| Category | Example | Default | Priority |
|----------|---------|---------|----------|
| Medication reminder | "Time to take Metformin 500mg" | ON | High (alarm-style, bypasses DND) |
| Appointment | "Appointment with Dr. Karim tomorrow at 10 AM" | ON | High |
| Lab result ready | "Your CBC results are in — tap to view" | ON | Medium |
| Streak at risk | "Log something today to keep your 5-day streak!" | ON | Low |
| Daily check-in | "Good morning! How are you feeling today?" | ON | Low |
| AI Coach insight | "Your sleep improved 23% this week!" | ON | Low |
| Health tip | "Walking after meals helps lower blood sugar" | ON | Low |
| Hospital message | "New message from Dr. Karim" | ON | High |
| Bill due | "Payment of ৳2,500 due on April 20" | ON | Medium |
| Re-engagement | "We miss you! Your weekly report is ready" | ON | Low |

#### 3. Camera & Image Processing

| Aspect | Detail |
|--------|--------|
| **Purpose** | Food photo logging, barcode scanning, prescription/document scanning, profile photos |
| **Plugin** | `@capacitor/camera` + `@capacitor-community/barcode-scanner` |
| **Food photo** | Capture → send to AI for food identification → suggest matching items from Bangladesh food DB → user confirms/edits → log meal |
| **Barcode scan** | Scan packaged food barcode → look up in food DB → auto-fill calories/macros |
| **Document scan** | Capture prescription/report → edge detection + perspective correction → save to document vault as PDF |
| **Profile photo** | Standard camera/gallery picker for profile picture |
| **Web fallback** | HTML5 `<input type="file" capture="camera">` for basic camera access |

#### 4. Wearable / Health Data Sync

| Aspect | Detail |
|--------|--------|
| **Purpose** | Auto-sync steps, heart rate, sleep, SpO2, calories from wearables and phone sensors |
| **Plugin** | `@nicovak/capacitor-health-connect` (Android) + `@nicovak/capacitor-healthkit` (iOS) |
| **iOS (HealthKit)** | Reads: steps, distance, heart rate, resting HR, sleep analysis, SpO2, active energy, workouts, body mass, blood pressure, blood glucose |
| **Android (Health Connect)** | Reads: steps, distance, heart rate, sleep session, SpO2, active calories, exercise session, weight, blood pressure, blood glucose |
| **Sync frequency** | Background sync every 15 minutes when app is active. On-demand sync when user opens relevant module |
| **Supported devices** | Apple Watch, Samsung Galaxy Watch, Fitbit, Mi Band/Amazfit (via Health Connect), Oura Ring, Garmin |
| **Data priority** | Wearable data takes precedence over manual entries. If both exist for same metric + same day, show wearable data with "manual override" option |
| **Web fallback** | Manual entry only. Show "Connect a wearable via the mobile app" prompt |

**Health data sync flow:**

```
Wearable (watch/band)
    │
    ▼
HealthKit (iOS) / Health Connect (Android)
    │
    ▼
Capacitor Plugin reads data
    │
    ▼
OzzyLife normalizes to internal format
    │
    ▼
Store locally + sync to server
    │
    ▼
Update Daily Health Score + module dashboards
```

#### 5. Additional Native Features

| Feature | Plugin | Purpose |
|---------|--------|---------|
| **GPS / Location** | `@capacitor/geolocation` | "Hospitals near me" in Care tab, emergency finder, walking/running route tracking |
| **Haptic feedback** | `@capacitor/haptics` | Subtle vibrations on: goal completion, streak milestone, breathing exercise rhythm, button presses |
| **Local notifications** | `@capacitor/local-notifications` | Offline medication reminders that work without internet (critical for rural Bangladesh) |
| **Share** | `@capacitor/share` | Share emergency pack QR, share weekly health report, invite family members |
| **App badge** | `@capacitor/badge` | Show unread count on app icon (unread messages, pending reminders) |
| **Splash screen** | `@capacitor/splash-screen` | Branded loading screen |
| **Status bar** | `@capacitor/status-bar` | Theme-aware status bar color |
| **Keyboard** | `@capacitor/keyboard` | Smooth keyboard handling in chat (AI Coach) and forms |
| **Network** | `@capacitor/network` | Detect offline → enable offline mode for logging (sync when back online) |
| **Filesystem** | `@capacitor/filesystem` | Store scanned documents, cached health data for offline access |
| **Device** | `@capacitor/device` | Device info for analytics, crash reporting |

#### 6. Offline Mode

Critical for Bangladesh where internet connectivity is unreliable in rural areas.

| What works offline | How |
|-------------------|-----|
| Medication reminders | Local notifications — no internet needed |
| Food logging | Log locally → sync when online |
| Mood check-in | Log locally → sync when online |
| Vitals logging | Log locally → sync when online |
| Sleep logging | Log locally → sync when online |
| Step counting | Phone accelerometer works offline |
| Emergency pack | Cached locally after first load |
| Cached health tips | Last 20 tips stored locally |

**What requires internet:** AI Coach chat, hospital data sync, wearable cloud sync, appointment booking, secure messaging, payment.

**Sync strategy:** Queue all offline actions. When connection returns, sync in background. Show sync indicator: "2 items pending sync" → "All synced ✓"

### Capacitor Project Structure

```
/
├── web/                    # Existing React app
│   ├── src/
│   ├── public/
│   └── index.html
├── ios/                    # Generated by Capacitor
│   └── App/
├── android/                # Generated by Capacitor
│   └── app/
├── capacitor.config.ts     # Capacitor configuration
└── package.json            # Capacitor deps added here
```

**Key config:**

```typescript
// capacitor.config.ts
const config: CapacitorConfig = {
  appId: 'com.ozzylife.app',
  appName: 'OzzyLife',
  webDir: 'dist',           // Vite build output
  server: {
    androidScheme: 'https',  // Required for secure cookies
  },
  plugins: {
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    SplashScreen: {
      launchAutoHide: false,  // Hide after auth check
    },
  },
};
```
---

## Section 8: Bangladesh Localization

This isn't just translation — it's building the app for the way Bangladesh lives, eats, prays, and manages health. This is the moat no international app can replicate.

### Language (i18n)

**Primary:** Bangla (বাংলা) — default for Bangladesh users
**Secondary:** English — available as alternative, also default for non-BD users

**Implementation:**
- i18n key-value files: `locales/bn.json` and `locales/en.json`
- User selects language during onboarding (Screen 2). Can change in Settings anytime
- AI Coach (Ozzy) responds in the user's selected language
- Medical/clinical terms show both Bangla and English: "রক্তচাপ (Blood Pressure)"
- Numbers: support both Bangla digits (১২৩) and English digits (123) — user preference toggle

**Translation scope:**
- All UI labels, buttons, navigation
- Health tips and educational content
- AI Coach system prompts and personality
- Notification text
- Empty states and error messages
- Food database item names (dual: "ভাত / Rice")

### Bangladesh Food Database

This is a competitive advantage — no international app has this.

**Initial curated database: 500+ items across categories:**

| Category | Example Items |
|----------|---------------|
| **ভাত / Rice** | সাদা ভাত (white rice), পোলাও (polao), খিচুড়ি (khichuri), বিরিয়ানি (biryani), fried rice |
| **রুটি / Bread** | আটার রুটি (atta roti), পরোটা (porota), লুচি (luchi), নান (naan) |
| **ডাল / Lentils** | মসুর ডাল (masoor), মুগ ডাল (mung), চোলার ডাল (cholar), ডাল ভর্তা (dal bhorta) |
| **মাছ / Fish** | ইলিশ (ilish), রুই (rui), পাঙ্গাশ (pangash), চিংড়ি (chingri), শিং মাছ (shing), মাছ ভর্তা |
| **মাংস / Meat** | মুরগি (chicken), গরু (beef), খাসি (mutton), কলিজা (liver), হাড্ডির ঝোল (bone broth) |
| **সবজি / Vegetables** | আলু ভর্তা, বেগুন ভাজি, শাক (shak), মিক্সড সবজি, ফুলকপি, ঢেঁড়স |
| **ভর্তা / Bhorta** | আলু ভর্তা, বেগুন ভর্তা, শুটকি ভর্তা, টমেটো ভর্তা, চিংড়ি ভর্তা |
| **ডিম / Eggs** | সেদ্ধ ডিম, ডিম ভুজি, ডিম পোচ, ডিম কারি, ওমলেট |
| **নাস্তা / Snacks** | ফুচকা (fuchka), চটপটি (chotpoti), ঝালমুড়ি (jhalmuri), সিঙ্গারা (shingara), সমুচা, পিঁয়াজু |
| **মিষ্টি / Sweets** | রসগোল্লা (roshogolla), মিষ্টি দই (mishti doi), সন্দেশ, জিলাপি, পায়েশ, সেমাই |
| **পানীয় / Drinks** | চা (cha), দুধ চা, কফি, লেবু পানি, ডাবের পানি, লাচ্ছি, বোরহানি |
| **ফল / Fruits** | আম (mango), কাঁঠাল (jackfruit), লিচু, কলা, পেয়ারা, জাম, তরমুজ |
| **ফাস্ট ফুড** | বার্গার, পিৎজা, ফ্রাইড চিকেন, নুডলস, চাউমিন, মোমো |

**Nutritional data sources:**
- BIRDEM (Bangladesh Institute of Research and Rehabilitation in Diabetes, Endocrine and Metabolic Disorders) food composition tables
- INFS (Institute of Nutrition and Food Science, DU) data
- Manual curation + community verification for common items

**Meal patterns — pre-set templates:**

| Meal Template | Contents | Approx Calories |
|--------------|----------|-----------------|
| Standard breakfast | 2 roti + egg bhuji + cha | ~350 cal |
| Rice lunch | 1 plate rice + dal + fish curry + shak | ~600 cal |
| Light dinner | Rice + mixed vegetables + dal | ~450 cal |
| Street snack | Fuchka (8 pcs) | ~200 cal |
| Eid feast | Biryani + beef rezala + firni | ~1,200 cal |
| Sehri (Ramadan) | Rice + chicken + dates + water | ~500 cal |
| Iftar (Ramadan) | Piaju + beguni + chotpoti + dates + juice | ~600 cal |

**Crowdsource expansion:** Users can submit foods not in the DB. Community moderators verify nutritional data before it goes live. Target: 2,000 items by year 1.

### Ramadan Mode

Special seasonal mode that activates during Ramadan (user can also manually enable/disable):

| Feature | Behavior During Ramadan |
|---------|------------------------|
| **Meal sections** | Change from Breakfast/Lunch/Dinner to **Sehri** and **Iftar** only |
| **Food nudges** | Suppress "Log your lunch" between Sehri and Iftar |
| **Water tracking** | Shift hydration reminders to Iftar→Sehri window only |
| **Sehri alarm** | Optional alarm 30 min before Sehri ends |
| **Iftar countdown** | Show countdown to Iftar time on home screen (based on GPS location for accurate local time) |
| **Nutrition goals** | Adjust daily calorie target for 2-meal pattern. Focus on balanced Sehri for sustained energy |
| **Activity goals** | Reduce step/exercise goals during fasting hours. Suggest light walking after Iftar |
| **AI Coach** | Ozzy gives Ramadan-aware advice: "Stay hydrated between Iftar and Sehri. Aim for 8 glasses tonight." |
| **Health tips** | Ramadan-specific: fasting with diabetes management, staying hydrated, balanced Sehri nutrition |

### Cultural Health Context

Health content and AI Coach awareness tailored to Bangladesh reality:

| Context | App Behavior |
|---------|-------------|
| **Diabetes epidemic** | Bangladesh has 13M+ diabetics. Glucose tracking is front-and-center. Food DB flags high-glycemic items. AI Coach gives diabetic-friendly alternatives: "Try red rice instead of white rice — lower glycemic index" |
| **Hypertension prevalence** | BP tracking prominent. Salt content warnings on food items. "Your bhorta has high salt — consider less salt next time" |
| **Dengue season** (Jun-Oct) | Seasonal banner: "Dengue season alert." Fever + body ache symptom logging triggers: "Get a CBC test to check platelet count." Nearest hospital with dengue testing shown |
| **Waterborne diseases** | During monsoon: tips about boiling water, avoiding street food, ORS for diarrhea |
| **TB awareness** | Persistent cough (2+ weeks logged) triggers: "A cough lasting more than 2 weeks should be checked for TB. Visit your nearest hospital." |
| **Arsenic in groundwater** | Regional awareness: "If you're in [affected districts], use filtered water and get periodic arsenic testing" |
| **Air pollution** | During winter smog (Nov-Feb): "Air quality is poor today. Wear a mask outdoors. Avoid heavy exercise outside." |
| **Maternal health** | Pregnancy mode includes Bangladesh-specific: government ANC visit schedule, iron/folic acid supplementation reminders, danger signs awareness (per DGHS guidelines) |
| **Mental health stigma** | Frame mental health as "mental peace" (মানসিক শান্তি). Normalize with gentle language. PHQ-9/GAD-7 framed as "wellness check-in" not "depression screening" |

### Payment Integration

| Method | Use Case | Integration |
|--------|----------|-------------|
| **bKash** | Hospital bill payment, premium features (future) | bKash Payment Gateway API |
| **Nagad** | Alternative mobile payment | Nagad Merchant API |
| **Rocket** | Alternative mobile payment | DBBL Rocket API |
| **Card (Visa/Mastercard)** | For users with bank cards | SSLCommerz or AmarPay gateway |
| **Cash receipt** | Hospital counter payment acknowledgment | Manual entry by hospital staff, reflected in app |

**Free tier:** All wellness features are free forever. Hospital features are free for connected patients (hospitals pay the B2B fee). No paywall for health tracking.

**Future premium (optional):** Advanced AI insights, family plan (5+ members), detailed nutrition coaching, workout programs. But core tracking is always free.

### Units & Formats

| Item | Bangladesh Standard |
|------|-------------------|
| **Weight** | kg (not lbs) |
| **Height** | feet + inches (common usage) AND cm |
| **Temperature** | Fahrenheit (common usage) AND Celsius |
| **Blood glucose** | mmol/L (BD standard), with mg/dL toggle |
| **Date format** | DD/MM/YYYY (not MM/DD) |
| **Currency** | ৳ (Taka / BDT) |
| **Time** | 12-hour with AM/PM (common in BD) |
| **Calendar** | Gregorian primary. Bangla calendar dates shown secondarily during cultural events |

### Localization Architecture

```
web/src/
├── locales/
│   ├── bn.json          # Bangla translations
│   ├── en.json          # English translations
│   └── index.ts         # i18n setup (react-i18next)
├── data/
│   ├── foods/
│   │   ├── bd-foods.json    # Bangladesh food database
│   │   └── intl-foods.json  # International foods (future)
│   ├── health-tips/
│   │   ├── bn/              # Bangla health tips
│   │   └── en/              # English health tips
│   └── seasonal/
│       ├── ramadan.json     # Ramadan mode config
│       ├── dengue.json      # Dengue season alerts
│       └── monsoon.json     # Monsoon health tips
```
---

## Section 9: Data Model

The app has two data worlds: **wellness data** (owned by user, stored globally) and **clinical data** (owned by hospital, accessed via APIs). The data model must handle high-volume daily logging, offline sync, and cross-hospital access.

### Data Architecture Overview

```
┌──────────────────────────────────────────────┐
│                  USER DEVICE                  │
│  ┌──────────────────────────────────────┐    │
│  │  Local SQLite (Capacitor SQLite)     │    │
│  │  - Offline queue (pending sync)      │    │
│  │  - Cached daily logs                 │    │
│  │  - Cached health score              │    │
│  │  - Food DB subset (favorites)       │    │
│  │  - Emergency pack (always available) │    │
│  └───────────────┬──────────────────────┘    │
└──────────────────┼───────────────────────────┘
                   │ sync
                   ▼
┌──────────────────────────────────────────────┐
│              GLOBAL DATABASE (D1)             │
│                                               │
│  User Accounts    Wellness Logs    AI Coach   │
│  Goals/Streaks    Food DB          Content    │
│  Hospital Links   Women's Health   Devices    │
│                                               │
└──────────────────┬───────────────────────────┘
                   │ API calls (tenant-scoped)
                   ▼
┌──────────────────────────────────────────────┐
│           HOSPITAL DATABASES (per tenant)      │
│                                               │
│  Appointments   Lab Results   Prescriptions   │
│  Diagnoses      Messages      Bills           │
│  Visit Records  Immunizations  Documents      │
│                                               │
└──────────────────────────────────────────────┘
```

**Key principle:** Wellness data lives in the global database. Clinical data stays in hospital tenant databases. The app joins them at the API layer, never at the DB layer.

### Domain 1: User Account & Profile

```
global_patient (existing) ──extends──→ wellness_profile
```

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `global_patient` | Existing patient auth/identity | id, name, phone, email, nid, password_hash, avatar_url |
| `wellness_profile` | Extended wellness-specific profile | patient_id (FK), date_of_birth, gender, height_cm, weight_kg, language, timezone, onboarding_completed, ramadan_mode, created_at |
| `wellness_preferences` | Per-user settings | patient_id, notification_settings (JSON), active_modules (JSON), daily_goals (JSON), units (JSON), quiet_hours_start, quiet_hours_end |
| `user_devices` | Registered devices for push/sync | patient_id, device_id, platform (ios/android/web), push_token, last_seen_at |

### Domain 2: Wellness Logs (High Volume)

These tables receive multiple writes per day per user. Designed for time-series queries.

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `food_log` | Meal entries | id, patient_id, meal_type (sehri/breakfast/lunch/snack/dinner/iftar), food_item_id (FK nullable), custom_name, calories, protein_g, carbs_g, fat_g, fiber_g, quantity, unit, photo_url, source (manual/photo_ai/barcode/voice), logged_at |
| `water_log` | Water intake | id, patient_id, amount_ml, logged_at |
| `activity_log` | Exercise and movement | id, patient_id, activity_type (walk/run/cycle/gym/yoga/namaz/housework/swim/other), duration_min, calories_burned, steps, distance_m, source (manual/wearable), started_at, ended_at |
| `sleep_log` | Sleep sessions | id, patient_id, bedtime, wake_time, duration_min, quality_rating (1-5), sleep_stages (JSON nullable — from wearable), source (manual/wearable), logged_at |
| `mood_log` | Mood check-ins | id, patient_id, mood (great/good/okay/low/struggling), note, tags (JSON — array of what affected mood), logged_at |
| `vital_log` | Vital sign readings | id, patient_id, vital_type (bp/glucose/weight/temperature/heart_rate/spo2), value_json (flexible: {systolic, diastolic, pulse} for BP, {fasting, value} for glucose, etc.), source (manual/wearable/hospital), logged_at |
| `stress_log` | Stress entries | id, patient_id, trigger, intensity (1-5), coping_action, logged_at |
| `medication_log` | Self-reported med adherence | id, patient_id, medication_id (FK), action (taken/skipped/snoozed), scheduled_at, acted_at |
| `symptom_log` | Symptom tracking | id, patient_id, symptom, severity (1-5), duration, notes, logged_at |

**Partitioning strategy:** These tables grow fast. Partition by `patient_id` + `month` for efficient queries. Archive logs older than 2 years to cold storage.

### Domain 3: Health Score & Trends

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `daily_health_score` | Calculated daily score | id, patient_id, date, total_score (0-100), sleep_score, activity_score, nutrition_score, mood_score, medication_score, vitals_score, breakdown_json, calculated_at |
| `weekly_report` | Auto-generated weekly summary | id, patient_id, week_start, summary_json (avg scores, trends, highlights, suggestions), generated_at |

**Score calculation:** Runs as a background job each night (or on-demand when user opens home screen). Uses the weights defined in Section 2.

### Domain 4: Goals, Streaks & Gamification

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `user_goals` | Active health goals | id, patient_id, goal_type (steps/calories/sleep_hours/water/weight/custom), target_value, current_value, unit, start_date, end_date, status (active/completed/abandoned), ai_suggested, created_at |
| `streaks` | Streak tracking | id, patient_id, streak_type (daily_checkin/food_log/activity/sleep_log/medication), current_count, longest_count, last_logged_date, started_at |
| `achievements` | Earned badges/milestones | id, patient_id, achievement_key (first_checkin/7_day_streak/30_day_streak/100k_steps_week/etc), earned_at |
| `challenges` | Active challenges | id, title, description, challenge_type (personal/family/community), goal_metric, goal_value, start_date, end_date, created_by |
| `challenge_participants` | Users in a challenge | challenge_id, patient_id, current_progress, rank, joined_at |

### Domain 5: AI Coach

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `ai_conversations` | Chat history | id, patient_id, role (user/assistant/system), message, intent (general/nutrition/fitness/medication/symptom/clinical), created_at |
| `ai_insights` | Generated insights | id, patient_id, insight_type (daily/pattern/alert/pre_visit/post_visit), content, data_sources (JSON — what data was used), severity (info/attention/urgent), read, created_at |
| `ai_action_items` | Follow-up actions from AI | id, patient_id, insight_id (FK), action_text, status (pending/done/dismissed), due_date, completed_at |

### Domain 6: Hospital Connections

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `hospital_links` | Linked hospitals | id, patient_id, tenant_id, hospital_name, patient_record_id (at hospital), linked_at, status (active/revoked) |
| `clinical_consents` | What data the user shares | id, patient_id, tenant_id, consent_type (ai_access/mood_sharing/phq9_sharing/cycle_sharing), granted, updated_at |
| `clinical_cache` | Cached hospital data for offline | id, patient_id, tenant_id, data_type (appointments/prescriptions/lab_results/diagnoses), data_json, cached_at, expires_at |

**Clinical data is NOT stored permanently in global DB.** It's cached for offline access with short TTL (24h). Source of truth is always the hospital tenant database.

### Domain 7: Women's Health (Privacy-Isolated)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `cycle_log` | Period tracking | id, patient_id, date, flow_intensity (light/medium/heavy/spotting), symptoms (JSON), notes |
| `cycle_predictions` | AI-predicted dates | id, patient_id, predicted_period_start, predicted_ovulation, cycle_length_avg, generated_at |
| `pregnancy_tracking` | Pregnancy milestones | id, patient_id, due_date, current_week, weight_log (JSON), kick_counts (JSON), appointments (JSON), mode (pregnant/postpartum), started_at |

**Privacy enforcement:** These tables have row-level security. API endpoints require biometric re-auth. Data excluded from family sharing, AI insights (unless explicitly opted in), and emergency pack.

### Domain 8: Reference Data

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `food_items` | Food database | id, name_bn, name_en, category, calories_per_100g, protein_g, carbs_g, fat_g, fiber_g, serving_size_g, serving_description, source (curated/community), verified, barcode |
| `meal_templates` | Pre-set meal combos | id, name_bn, name_en, items (JSON array of food_item_ids + quantities), total_calories, category (breakfast/lunch/dinner/sehri/iftar/snack) |
| `health_tips` | Health tip content | id, title_bn, title_en, body_bn, body_en, category, tags, seasonal (ramadan/dengue/monsoon/general), target_conditions (JSON), active |
| `achievements_catalog` | All possible achievements | key, name_bn, name_en, description_bn, description_en, icon, criteria_json |
| `medications_reference` | Common medications | id, name_generic, name_brand, dosage_forms, common_dosages, food_interaction, category |

### Domain 9: Medications (Self-Managed + Hospital-Synced)

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `user_medications` | User's active medications | id, patient_id, medication_name, dosage, frequency, times_of_day (JSON — ["08:00","20:00"]), start_date, end_date, source (self_added/hospital_synced), hospital_prescription_id (FK nullable), notes, active |
| `medication_reminders` | Scheduled reminders | id, medication_id (FK), patient_id, reminder_time, days_of_week (JSON), enabled, last_sent_at |

**Hospital sync:** When user connects to hospital, prescriptions auto-create entries in `user_medications` with `source=hospital_synced`. User can also manually add OTC or medications from other sources.

### Local Storage Schema (On-Device SQLite)

Minimal schema for offline operation:

```sql
-- Pending sync queue
CREATE TABLE sync_queue (
  id INTEGER PRIMARY KEY,
  table_name TEXT,       -- which server table
  action TEXT,           -- insert/update
  payload TEXT,          -- JSON of the record
  created_at TEXT,
  synced_at TEXT         -- null until synced
);

-- Cached daily data (today + yesterday)
CREATE TABLE local_daily_cache (
  key TEXT PRIMARY KEY,  -- e.g. "health_score_2026-04-15"
  data TEXT,             -- JSON
  cached_at TEXT
);

-- Emergency pack (always available offline)
CREATE TABLE emergency_pack (
  patient_id TEXT PRIMARY KEY,
  data TEXT,             -- JSON (blood group, allergies, meds, contacts)
  updated_at TEXT
);

-- Favorite foods (quick access offline)
CREATE TABLE favorite_foods (
  food_item_id TEXT PRIMARY KEY,
  data TEXT,             -- JSON of food item
  use_count INTEGER
);
```

### Data Flow Summary

```
User logs food ──→ Local SQLite (instant) ──→ Sync queue ──→ Server food_log
                                                              │
Wearable ──→ HealthKit/Health Connect ──→ Capacitor plugin ──→ Server activity_log/sleep_log
                                                              │
Hospital updates prescription ──→ Tenant DB ──→ API ──→ Server user_medications
                                                              │
Nightly job ──→ Read all logs for today ──→ Calculate ──→ Server daily_health_score
                                                              │
AI Coach ──→ Read score + logs + clinical cache ──→ Generate ──→ Server ai_insights
```
---

## Section 10: Phase / Sprint Breakdown

Five phases. Each delivers a usable product increment. Phase 1 is the launchable MVP.

### Phase 1: Standalone Wellness MVP (4-6 weeks)

**Goal:** A wellness app anyone can download and use daily — no hospital needed. Get to Play Store.

| Sprint | What to Build | Deliverable |
|--------|--------------|-------------|
| **1.1** (Week 1-2) | **Foundation & Onboarding** | |
| | Capacitor project setup (Android-first) | `com.ozzylife.app` building and running on Android |
| | Biometric auth (fingerprint login) | Secure launch with biometric fallback to PIN |
| | Onboarding flow (7 screens) | Language → Profile → Goals → Permissions → Meet Ozzy |
| | Bangla + English i18n setup | `locales/bn.json`, `locales/en.json`, language switcher |
| | Wellness profile + preferences tables | DB migrations for wellness_profile, wellness_preferences |
| | Bottom nav (Home / Wellness / Care / Me) | Shell navigation with placeholder screens |
| **1.2** (Week 2-3) | **Home Screen & Daily Score** | |
| | Personalized greeting (time-of-day aware) | Extend existing `PersonalizedGreeting` |
| | Daily Health Score ring (0-100) | Extend existing `WellnessScoreCard` with score calculation |
| | Quick actions row | Extend existing `QuickCheckInCard` |
| | Smart card system (priority-sorted) | Card renderer with priority engine |
| | Streak tracker | Extend existing `StreakTrackerCard` with streak persistence |
| **1.3** (Week 3-4) | **Core Wellness Modules** | |
| | Mood check-in (emoji + note) | Daily mood logger + mood_log table |
| | Food logging (search BD food DB) | Bangladesh food DB (500 items) + food_log table + search UI |
| | Water tracking (glass counter) | Water log + home screen quick-add |
| | Sleep logging (manual: bedtime/wake/rating) | Sleep logger + sleep_log table |
| | Activity tracking (manual exercise log + phone step counter) | Activity log + basic step reading from device |
| | Vitals logging (BP, glucose, weight — manual) | Vital log + classification (normal/elevated/high) + smart alerts |
| **1.4** (Week 4-5) | **AI Coach (Basic) & Engagement** | |
| | AI Coach chat interface | Extend existing `AIBuddyChat` with wellness RAG |
| | Daily insights generation (morning notification) | Nightly job → ai_insights table → push notification |
| | Goal setting (Ozzy-guided) | user_goals table + goal setting flow |
| | Basic achievements (first check-in, 3-day streak, 7-day streak) | achievements table + unlock triggers |
| | Health tips feed (BD-localized content) | Extend existing `HealthTipsFeed` with bn/en content |
| | Push notifications (reminders, nudges) | Firebase Cloud Messaging setup + notification categories |
| **1.5** (Week 5-6) | **Polish & Play Store** | |
| | First-week guided experience (Ozzy day 1-7 prompts) | Onboarding progression engine |
| | Empty states for all screens | Illustrations + CTA for every empty module |
| | Offline mode (basic — log locally, sync when online) | Local SQLite sync queue |
| | Weekly health report (auto-generated) | weekly_report table + summary generation |
| | App icon, splash screen, Play Store listing | Branding assets + store metadata |
| | **Android Play Store submission** | APK/AAB signed and submitted |

**Phase 1 output:** A fully functional wellness app on Android Play Store. Users can track food, sleep, activity, mood, vitals, water. AI Coach gives daily insights. Streaks and achievements keep them engaged. All in Bangla or English.

---

### Phase 2: Clinical Bridge (6-8 weeks)

**Goal:** Connect the wellness app to hospitals. Standalone users become connected patients. This is the B2B unlock.

| Sprint | What to Build | Deliverable |
|--------|--------------|-------------|
| **2.1** (Week 1-2) | **Hospital Discovery** | |
| | Hospital directory (search by name, location, specialty) | Extend existing `PatientFindCareTab` |
| | Hospital profile pages (specialties, doctors, ratings, map) | Hospital detail view |
| | GPS-based "near me" sorting | `@capacitor/geolocation` integration |
| | Emergency finder (nearest ER departments) | Emergency hospital list with distance |
| **2.2** (Week 3-4) | **Hospital Linking** | |
| | Hospital linking flow (search / QR scan / NID verify) | Link creation + identity verification |
| | Multi-hospital support (hospital selector dropdown) | hospital_links table + context switching |
| | Consent management (what data to share with hospital) | clinical_consents table + toggle UI |
| | Care tab transformation (standalone → connected) | Dynamic Care tab based on link status |
| **2.3** (Week 5-6) | **Clinical Data Display** | |
| | Appointments (view, book, cancel, digital check-in) | Extend existing `PatientHospitalServicesTab` |
| | Lab results (with normal range + plain-language explanation) | Lab result cards with interpretation |
| | Prescriptions (active list, refill request) | Prescription display + refill flow |
| | Secure messaging (async chat with care team) | Provider messaging UI |
| | Bills & payments (bKash/Nagad integration) | SSLCommerz/bKash payment gateway |
| | Visit pass, emergency pack, document vault | Wire existing components into Care tab |
| **2.4** (Week 7-8) | **Clinical → Wellness Bridge** | |
| | Lab results auto-populate vitals trends | Sync hospital labs → vital_log with source=hospital |
| | Prescriptions auto-create medication reminders | Sync prescriptions → user_medications + reminders |
| | AI Coach clinical layer (consent-gated) | Clinical RAG — read hospital data for AI responses |
| | Pre-visit preparation (24h before appointment push) | Pre-visit insight generation |
| | Post-visit follow-up (action items from appointment) | Post-visit insight + ai_action_items |
| | Medicine tracker (hospital-synced + self-managed) | Extend existing `MedicineTrackerTab` |

**Phase 2 output:** Users can link to hospitals, see their appointments/labs/prescriptions, pay bills via bKash, and the AI Coach now knows their clinical history. The app becomes truly unique.

---

### Phase 3: Advanced Wellness (4-6 weeks)

**Goal:** Add the features that make the app feel like Samsung Health / Apple Health quality.

| Sprint | What to Build | Deliverable |
|--------|--------------|-------------|
| **3.1** (Week 1-2) | **Camera & Scanning** | |
| | Food photo AI (snap → identify → log) | Camera capture → AI food recognition → food_log |
| | Barcode scanner (packaged food lookup) | `@capacitor-community/barcode-scanner` + food DB lookup |
| | Document/prescription scanner (edge detect → PDF) | Camera → crop → save to vault |
| **3.2** (Week 2-3) | **Wearable Integration** | |
| | HealthKit sync (iOS — steps, HR, sleep, SpO2) | `capacitor-healthkit` plugin + data normalization |
| | Health Connect sync (Android — same metrics) | `capacitor-health-connect` plugin + data normalization |
| | Auto-populate activity, sleep, vitals from wearable | Wearable data → existing log tables with source=wearable |
| | Activity rings (Move, Exercise, Stand) | 3-ring circular progress UI |
| **3.3** (Week 3-4) | **Mental Health & Women's Health** | |
| | PHQ-9 screening (port from danphe reference) | `Phq9Section.tsx` + `usePHQ9.ts` adapted |
| | GAD-7 screening (port from danphe reference) | `Gad7Section.tsx` + `useGAD7.ts` adapted |
| | Breathing exercises (3 patterns with animation) | Box breathing, 4-7-8, belly breathing UI |
| | Meditation timer (simple timer + bell) | Timer with ambient sound option |
| | Crisis safety net (Kaan Pete Roi helpline) | Emergency detection + helpline display |
| | Cycle tracking (log, predict, calendar) | cycle_log + cycle_predictions tables + UI |
| | Pregnancy mode (milestones, kick counter) | pregnancy_tracking table + week-by-week view |
| | Privacy lock (biometric re-auth for Women's Health) | Module-level biometric gate |
| **3.4** (Week 5-6) | **Ramadan & Seasonal** | |
| | Ramadan mode (Sehri/Iftar, countdown, adjusted goals) | Ramadan config + conditional UI + Iftar countdown |
| | Dengue season alerts (Jun-Oct awareness) | Seasonal content engine + fever symptom triggers |
| | Monsoon health tips | Waterborne disease awareness content |
| | Walking challenges (personal weekly goals) | challenges + challenge_participants tables |

**Phase 3 output:** The app now has camera-based food logging, wearable sync, clinical mental health screenings, women's health, Ramadan mode, and seasonal health intelligence. It's feature-rich and uniquely Bangladeshi.

---

### Phase 4: Engagement & App Store (4-6 weeks)

**Goal:** Retention, growth features, and iOS launch.

| Sprint | What to Build | Deliverable |
|--------|--------------|-------------|
| **4.1** (Week 1-2) | **AI Pattern Recognition** | |
| | Sleep ↔ mood correlation detection | Weekly pattern analysis job |
| | Food ↔ glucose correlation detection | Meal-glucose pattern matching |
| | Activity ↔ sleep correlation detection | Step count → sleep quality analysis |
| | Medication ↔ vitals trend detection | Pre/post medication vital trends |
| | Weekly AI insight report (push notification) | Pattern summary → ai_insights |
| **4.2** (Week 3-4) | **Social & Gamification** | |
| | Achievement system expansion (20+ badges) | Full achievement catalog |
| | Family challenges (step challenges with family members) | Family challenge creation + leaderboard |
| | Community leaderboards (opt-in, anonymized) | Aggregate leaderboard with privacy |
| | Symptom checker (AI-guided questionnaire) | Symptom → specialty recommendation flow |
| | Re-engagement system (graduated nudges) | Lapsed user detection + push schedule |
| **4.3** (Week 5-6) | **iOS & Polish** | |
| | iOS build + testing | Capacitor iOS build with all plugins |
| | iOS App Store submission | IPA signed and submitted |
| | Offline mode hardening | Full sync queue reliability + conflict resolution |
| | Performance optimization (lazy loading, caching) | Sub-2s load time on mid-range Android |
| | Accessibility pass (screen reader, contrast, font size) | WCAG AA compliance for core flows |

**Phase 4 output:** Available on both Play Store and App Store. AI gives weekly correlation insights. Social features drive retention. App is polished and performant.

---

### Phase 5: Scale & Iterate (Ongoing)

**Goal:** Continuous improvement based on real user feedback and data.

| Priority | Feature | Timeline |
|----------|---------|----------|
| High | Food DB expansion via crowdsourcing (target: 2,000 items) | Month 1-3 |
| High | Workout library (home workouts, yoga, post-surgery rehab) | Month 1-2 |
| High | Telemedicine integration (video consults) | Month 2-3 |
| Medium | Behavior change micro-lessons (Noom-style CBT daily lessons) | Month 3-4 |
| Medium | Sleep sounds (white noise, rain, nature — basic audio) | Month 3 |
| Medium | Postpartum features (feeding log, baby milestones, PPD screening) | Month 4 |
| Medium | Adaptive goal engine (AI auto-adjusts goals monthly) | Month 4-5 |
| Low | Premium tier exploration (advanced AI, family plan, nutrition coaching) | Month 6+ |
| Low | Wear OS / watchOS companion app | Month 6+ |
| Low | Web PWA feature parity (for desktop users) | Month 6+ |
| Low | Multi-region expansion (i18n for Hindi, Urdu — South Asia) | Month 8+ |

---

### Phase Summary

| Phase | Duration | Key Outcome | Users Can... |
|-------|----------|-------------|-------------|
| **Phase 1** | 4-6 weeks | Android MVP on Play Store | Track food, sleep, activity, mood, vitals. Get AI tips. Build streaks. |
| **Phase 2** | 6-8 weeks | Hospital connection live | Link hospital, see labs/appointments, pay via bKash, get clinical AI insights |
| **Phase 3** | 4-6 weeks | Advanced wellness features | Scan food, sync wearables, track mental health (PHQ-9), cycle tracking, Ramadan mode |
| **Phase 4** | 4-6 weeks | iOS + engagement | Get pattern insights, join challenges, use on iPhone |
| **Phase 5** | Ongoing | Scale & iterate | More content, more features based on real user feedback |

**Total to full vision: ~5-6 months.** Launchable MVP in 4-6 weeks.

---

## Appendix: Competitive Positioning

| Feature | Samsung Health | Apple Health | MyFitnessPal | MyChart | **OzzyLife** |
|---------|--------------|-------------|-------------|---------|------------|
| Activity tracking | Yes | Yes | Limited | No | Yes |
| Food logging | Basic | No | Best | No | Yes (BD food DB) |
| Sleep tracking | Yes | Yes | No | No | Yes |
| Mental health | Basic | PHQ-9 style | No | No | PHQ-9 + GAD-7 + mood |
| Wearable sync | Samsung only | Apple only | Multi | No | Multi (both platforms) |
| Hospital data | No | Limited (US) | No | Yes (US) | Yes (Bangladesh) |
| AI coaching | Basic | No | Premium | No | **Yes (clinical-aware)** |
| Medication tracking | Yes | No | No | Refills only | **Yes (hospital-synced)** |
| Local food database | No | No | US-centric | No | **Bangladesh-first** |
| Ramadan mode | No | No | No | No | **Yes** |
| Offline mode | Partial | Yes | No | No | **Yes** |
| Free | Mostly | Yes | Freemium | Yes | **Yes (core free forever)** |
| Language | Multi | Multi | English-first | English-first | **Bangla-first** |
