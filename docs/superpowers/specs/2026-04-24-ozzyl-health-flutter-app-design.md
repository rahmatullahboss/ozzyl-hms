# Ozzyl Health — Flutter Mobile App Design Spec

## Overview

**Ozzyl Health** is a wellness-first mobile app that also connects users to hospitals on the Ozzyl HMS platform. Anyone can use it for daily health and wellness tracking — no hospital account required. Users who link a hospital account unlock patient features (appointments, prescriptions, lab results, health records).

**Identity:** Health & wellness companion (primary) + hospital portal (secondary)

**Companion app (future):** Ozzyl HMS — a separate Flutter app for hospital staff/admin, sharing a core Dart package with Ozzyl Health.

---

## Monorepo Structure

```
hms/
├── src/                          # Backend API (Cloudflare Workers, existing)
├── web/                          # Web admin dashboard (React, existing)
├── apps/
│   ├── ozzyl-lifestyle/          # React+Capacitor patient app (existing, superseded)
│   ├── ozzyl_health/             # Flutter patient/wellness app (NEW)
│   └── ozzyl_hms/                # Flutter staff app (FUTURE)
├── packages/
│   ├── shared/                   # TypeScript shared utils (existing)
│   └── ozzyl_core/               # Dart shared package (NEW)
│       ├── lib/
│       │   ├── api/              # Dio API client, interceptors, endpoint definitions
│       │   ├── models/           # Shared data models (Patient, Appointment, etc.)
│       │   ├── repositories/     # Repository interfaces (abstract classes)
│       │   ├── auth/             # Auth logic, token storage, biometric helpers
│       │   └── theme/            # Shared Ozzyl brand theming (colors, typography)
│       └── pubspec.yaml
```

- `ozzyl_core` is a local Dart package referenced via `path: ../../packages/ozzyl_core`
- Flutter apps use underscore naming (Dart convention)
- `ozzyl-lifestyle` stays untouched — Ozzyl Health replaces it over time

---

## Architecture: Clean Architecture + BLoC

Each feature follows three layers:

```
lib/
├── core/
│   ├── di/                        # get_it dependency injection setup
│   ├── router/                    # GoRouter navigation config
│   ├── constants/                 # API URLs, keys, durations
│   └── utils/                     # Formatters, validators, extensions
│
├── features/
│   ├── <feature_name>/
│   │   ├── data/
│   │   │   ├── datasources/       # Remote (Dio API) + Local (Drift DB)
│   │   │   ├── models/            # JSON-serializable DTOs (Freezed)
│   │   │   └── repositories/      # Concrete repository implementations
│   │   ├── domain/
│   │   │   ├── entities/          # Clean entities (no JSON annotations)
│   │   │   ├── repositories/      # Abstract repository interfaces
│   │   │   └── usecases/          # Single-responsibility business logic
│   │   └── presentation/
│   │       ├── bloc/              # BLoC + Events + States
│   │       ├── pages/             # Full-screen page widgets
│   │       └── widgets/           # Feature-specific reusable widgets
│   │
│   ├── auth/
│   ├── wellness_dashboard/
│   ├── mood_tracker/
│   ├── water_intake/
│   ├── health_assessments/        # PHQ-9, GAD-7, BMI, heart risk
│   ├── symptom_checker/           # AI-powered symptom flow
│   ├── medication_reminders/
│   ├── fitness/                   # Exercise log, step counter
│   ├── womens_health/             # Period tracker, pregnancy milestones
│   ├── mental_wellness/           # Breathing, meditation, journal
│   ├── health_goals/
│   ├── emergency/                 # SOS, emergency contacts, allergy card
│   ├── appointments/              # Browse doctors, book/cancel
│   ├── prescriptions/             # View Rx, refill, PDF
│   ├── lab_results/               # View results, download PDF
│   ├── health_records/            # Allergies, meds, diagnoses, vaccines
│   ├── hospital_discovery/        # Nearby hospitals, search, profiles
│   ├── family/                    # Family linking, proxy access
│   ├── notifications/             # Push notifications
│   ├── profile/                   # Personal info, settings, language
│   └── health_articles/           # Tips, preventive care content
│
├── l10n/                          # Localization (bn, en)
└── main.dart
```

**Layer rules:**
- Features talk to each other only through BLoCs or shared usecases in `ozzyl_core`
- Wellness features use Drift (local SQLite) as primary datasource — sync to server when online
- Hospital features use API as primary with Drift cache for offline reading
- Domain layer has zero dependencies on Flutter or external packages

---

## Local Database (Drift/SQLite)

Two separate databases:

### Wellness DB (offline-first)

| Table | Key Columns |
|---|---|
| `mood_entries` | timestamp, mood_level (1-5), notes, tags |
| `water_logs` | timestamp, amount_ml |
| `sleep_logs` | date, bedtime, wake_time, quality |
| `exercise_logs` | timestamp, type, duration_min, calories |
| `health_goals` | title, target, current, unit, deadline |
| `medication_reminders` | name, dosage, frequency, times, active |
| `period_tracking` | date, flow_level, symptoms, notes |
| `journal_entries` | timestamp, content, mood_tag |
| `assessment_results` | type (PHQ9/GAD7/BMI), score, date, answers_json |
| `daily_steps` | date, count, source |
| `sync_queue` | table_name, row_id, action, synced_at |

### Cache DB (offline-read for hospital data)

| Table | Key Columns |
|---|---|
| `cached_appointments` | mirrors API response, expires_at |
| `cached_prescriptions` | mirrors API response, expires_at |
| `cached_lab_results` | mirrors API response, expires_at |
| `cached_health_records` | allergies, meds, diagnoses, expires_at |
| `cached_doctors` | doctor profiles for booking, expires_at |
| `cached_hospitals` | nearby hospital profiles, expires_at |
| `cached_articles` | health tips content |
| `cached_profile` | user profile + family members |

### Sync Strategy

- `sync_queue` tracks all offline wellness writes (table, row_id, action)
- On connectivity restored: bulk POST to `/api/v1/wellness/sync`
- Cache DB entries have TTL (default 24h) — stale data shows "last updated" badge
- Drift DAOs generate type-safe queries

---

## API Client & Networking

Built in `packages/ozzyl_core`, shared by both apps.

### Dio Interceptor Stack

1. **AuthInterceptor** — Injects `Authorization: Bearer <token>` from flutter_secure_storage
2. **TenantInterceptor** — Adds `X-Tenant-ID` header (resolved from linked hospital)
3. **ConnectivityInterceptor** — Detects offline state, routes GET requests to cache DB
4. **RetryInterceptor** — Auto-retry on 5xx/timeout (3 attempts, exponential backoff)
5. **CacheInterceptor** — Stores GET responses in cache.db with TTL
6. **LogInterceptor** — Debug logging (dev builds only)

### Base URL

- Production: `https://hms-saas-production.rahmatullahzisan.workers.dev/api/v1/`
- Wellness-only users (no hospital linked): wellness data stays local, no API calls needed
- Hospital-linked users: tenant resolved from their linked hospital

### Auth Flow

1. Login (email+password) → `POST /api/auth/login` → JWT token
2. Token stored in `flutter_secure_storage` (encrypted keychain/keystore)
3. MFA required? → TOTP screen → `POST /api/auth/mfa/verify`
4. Biometric login → decrypt stored token from secure storage
5. Token refresh → on 401, attempt refresh or redirect to login
6. Logout → `POST /api/auth/logout` (blacklists token server-side) + clear local storage

### Key API Endpoints

| Feature | Endpoint | Method |
|---|---|---|
| Auth | `/api/auth/login`, `/api/auth/register` | POST |
| Appointments | `/api/v1/appointments` | GET/POST/PATCH |
| Prescriptions | `/api/v1/prescriptions` | GET |
| Lab Results | `/api/v1/lab/results` | GET |
| Health Records | `/api/v1/patient-phr/*` | GET |
| Wellness Sync | `/api/v1/wellness/sync` | POST |
| Doctors | `/api/v1/doctors` | GET |
| Hospitals | `/api/v1/public/hospitals` | GET |
| Family | `/api/v1/patients/family` | GET/POST |
| Notifications | `/api/v1/push-notifications` | GET/POST |
| Profile | `/api/v1/patients/me` | GET/PATCH |
| Articles | `/api/v1/public/health-articles` | GET |

### Offline Behavior

- **GET requests:** Check cache first → return cached if offline → fetch fresh if online
- **POST/PUT/DELETE:** Queue in `sync_queue` if offline → execute on reconnect
- **Connectivity:** Monitored via `connectivity_plus` package

---

## Navigation & UI Structure

### Bottom Navigation (5 tabs)

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│   Home   │ Wellness │ Hospital │ Articles │ Profile  │
│    🏠    │    💪    │    🏥    │    📖    │    👤    │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

### Tab 1: Home (Wellness Dashboard)

- Greeting + motivational quote of the day
- Wellness rings (steps, water, mood — Apple Watch style)
- Quick-add buttons (log mood, log water, log exercise)
- Upcoming appointment card (if hospital-linked)
- Health goals progress bars
- Streak counter (consecutive days tracked)
- Weekly wellness score

### Tab 2: Wellness

- Mood tracker (log + trend chart)
- Water intake (visual glass fill animation)
- Sleep log
- Exercise log
- Mental wellness (breathing exercises, meditation timer, stress journal)
- Women's health (period tracker, pregnancy milestones)
- Health assessments (PHQ-9, GAD-7, BMI, heart risk score)
- Symptom checker (AI-powered via existing `/api/v1/ai` endpoint)
- Medication reminders (OTC + prescription)
- Health goals (set + track)

### Tab 3: Hospital

**Always visible** — serves as hospital discovery + patient portal.

```
Hospital Tab
├── Nearby Hospitals (location-based)
│   ├── Hospital card: name, distance, rating, specialties
│   ├── Tap → Hospital profile (about, departments, doctors, photos)
│   │   ├── "Book Appointment" button
│   │   └── "Link as My Hospital" → unlocks patient features
│   └── Search + filter (specialty, distance, rating)
│
├── My Hospitals (linked accounts)
│   ├── Appointments (upcoming, history)
│   ├── Prescriptions (active, refill)
│   ├── Lab Results
│   ├── Health Records
│   └── Family members
│
└── States:
    ├── No hospital linked → Shows nearby hospitals + "Find a hospital"
    ├── Hospital linked → "My Hospitals" at top + nearby below
    └── No location permission → Manual city/area search
```

### Tab 4: Articles

- Daily health tips
- Seasonal wellness advice
- Preventive care reminders
- Categories: nutrition, fitness, mental health, women's health

### Tab 5: Profile

- Personal info + avatar
- Emergency info (SOS contacts, blood type, allergy card)
- Hospital linking (connect/disconnect hospital accounts)
- Notification settings
- Language toggle (BN/EN)
- App theme settings
- About + help

### Onboarding Flow

1. Name → 2. Age/Gender → 3. Health goals selection → 4. Optional hospital link → 5. Dashboard

### Gamification

- Daily streaks
- Achievement badges (7-day streak, first assessment, 10k steps)
- Weekly wellness score
- Confetti animation on goals met

---

## Visual Theme: Vibrant & Motivational

- **Primary color:** Teal
- **Accent color:** Coral
- **Style:** Warm gradients, progress ring animations, bold typography
- **Inspiration:** Fitbit, Strava — energizing, motivational
- **Loading states:** Shimmer skeletons
- **Animations:** Lottie for wellness illustrations, confetti on achievements
- **Dark mode:** Supported (user toggle in profile)

---

## Dependencies

### Core
| Package | Version | Purpose |
|---|---|---|
| `flutter_bloc` | ^9.1.0 | State management |
| `bloc` | ^9.0.0 | Core bloc library |
| `get_it` | ^8.0.0 | Dependency injection |
| `go_router` | ^17.2.2 | Navigation |
| `dio` | ^5.0.0 | HTTP client |
| `flutter_secure_storage` | ^9.0.0 | Encrypted token storage |

### Database & Offline
| Package | Version | Purpose |
|---|---|---|
| `drift` | ^2.32.1 | SQLite ORM |
| `drift_flutter` | ^0.1.0 | Flutter-specific Drift setup |
| `connectivity_plus` | ^6.0.0 | Network state monitoring |

### Code Generation
| Package | Version | Purpose |
|---|---|---|
| `freezed` | ^3.0.0 | Immutable state classes (sealed) |
| `freezed_annotation` | ^3.0.0 | Freezed annotations |
| `json_annotation` | ^4.9.0 | JSON serialization annotations |
| `json_serializable` | ^6.9.0 | JSON code generation |
| `build_runner` | ^2.13.1 | Code generation runner |
| `drift_dev` | ^2.32.1 | Drift code generation |

### UI & Animations
| Package | Version | Purpose |
|---|---|---|
| `lottie` | ^3.0.0 | Animated illustrations |
| `fl_chart` | ^0.70.0 | Charts (mood trends, sleep, scores) |
| `shimmer` | ^3.0.0 | Loading skeletons |
| `cached_network_image` | ^3.0.0 | Doctor/hospital images |

### Health & Sensors
| Package | Version | Purpose |
|---|---|---|
| `pedometer` | ^4.0.0 | Step counting |
| `local_auth` | ^2.0.0 | Biometric auth |
| `geolocator` | ^13.0.0 | Nearby hospitals |
| `flutter_local_notifications` | ^18.0.0 | Medication reminders |
| `firebase_messaging` | ^15.0.0 | Push notifications |

### Utilities
| Package | Version | Purpose |
|---|---|---|
| `intl` | ^0.20.0 | Date/number formatting |
| `share_plus` | ^10.0.0 | Share health reports |
| `url_launcher` | ^6.0.0 | Emergency calls, links |
| `pdf` | ^3.0.0 | View prescription/lab PDFs |

### Dev & Testing
| Package | Version | Purpose |
|---|---|---|
| `bloc_test` | ^10.0.0 | BLoC testing |
| `bloc_lint` | ^0.3.0 | BLoC linting rules |
| `mocktail` | ^1.0.0 | Mocking for tests |

---

## Testing Strategy

```
test/
├── unit/
│   ├── blocs/                # BLoC state transition tests
│   ├── repositories/         # Repository logic with mocked datasources
│   ├── usecases/             # Business logic tests
│   └── models/               # JSON serialization round-trip tests
│
├── widget/
│   ├── pages/                # Page-level widget tests
│   └── widgets/              # Component widget tests
│
├── integration/
│   ├── auth_flow_test.dart
│   ├── wellness_offline_test.dart
│   └── hospital_booking_test.dart
│
└── helpers/
    ├── mock_api.dart         # Dio mock adapter
    ├── mock_db.dart          # In-memory Drift database
    └── fixtures/             # JSON response fixtures from HMS API
```

- **BLoC tests:** Verify state transitions for every event using `bloc_test`
- **Repository tests:** Mock datasources with `mocktail`, test caching/sync logic
- **Widget tests:** Key UI components (wellness rings, appointment cards)
- **Integration tests:** Critical flows (auth, offline wellness, hospital booking)
- **In-memory Drift DB** for fast tests without file I/O

---

## Backend API Changes Required

A few new endpoints needed on the HMS backend:

1. **`POST /api/v1/wellness/sync`** — Bulk sync wellness data from mobile (mood, water, sleep, exercise, goals)
2. **`GET /api/v1/public/hospitals`** — List hospitals on the platform (public, no auth required) with location, specialties, rating
3. **`GET /api/v1/public/hospitals/:id`** — Hospital profile detail (departments, doctors, photos)
4. **`GET /api/v1/public/health-articles`** — Health tips and wellness content
5. **`POST /api/v1/patients/link-hospital`** — Link user account to a hospital tenant

These are additive — no changes to existing endpoints.

---

## Scope Boundaries

**In scope (v1):**
- All 20 features listed (10 wellness + 10 hospital-connected)
- Hospital discovery with nearby search
- Offline-first wellness, offline-read hospital cache
- Bengali + English localization
- iOS + Android builds
- Gamification (streaks, badges, wellness score)

**Out of scope (future):**
- Ozzyl HMS (staff app) — separate project after Ozzyl Health ships
- Wearable integration (Apple Watch, Fitbit API)
- Telemedicine video calls inside the app
- Payment/billing from mobile
- Social features (community, forums)
- Web version of Ozzyl Health
