# HMS Project — Folder Structure Guide

## Architecture: Monorepo with Shared Backend

```
hms/
├── src/                          # SHARED BACKEND (Hono + Cloudflare Workers)
│   ├── index.ts                  # Main Hono app — mounts ALL routes
│   ├── routes/                   # API endpoints (serves BOTH apps)
│   │   ├── patient-auth.ts       # Patient login, onboarding
│   │   ├── wellness.ts           # Wellness score, streaks, sleep, activity
│   │   ├── food.ts               # Food search, logging
│   │   ├── patient-phr.ts        # Lifestyle logs, AI buddy, vitals
│   │   ├── notifications.ts      # Push notifications
│   │   └── ...                   # Hospital routes (billing, lab, pharmacy, etc.)
│   ├── lib/                      # Shared business logic
│   │   ├── health-score.ts
│   │   ├── daily-insights.ts
│   │   ├── crisis-detection.ts
│   │   └── ...
│   └── types.ts
│
├── migrations/                   # D1 database migrations (shared by all)
│   └── global/
│
├── apps/
│   └── ozzyl-lifestyle/          # PATIENT PORTAL FRONTEND (OzzyLife app)
│       ├── src/
│       │   ├── App.tsx           # Routes — default / goes to /patient/login
│       │   ├── components/
│       │   │   ├── patient/      # ALL patient/wellness UI components
│       │   │   │   ├── DailyCheckInWidget.tsx
│       │   │   │   ├── FoodLogModal.tsx
│       │   │   │   ├── WellnessScoreCard.tsx
│       │   │   │   ├── SmartCardRenderer.tsx
│       │   │   │   ├── ActivityRings.tsx
│       │   │   │   ├── MentalHealthScreen.tsx
│       │   │   │   ├── CycleTracker.tsx
│       │   │   │   └── ... (~70 files)
│       │   │   ├── dashboard/    # Shared UI components (cards, charts)
│       │   │   ├── clinical/     # Clinical components used in patient view
│       │   │   └── ...
│       │   ├── pages/            # Page-level components
│       │   │   ├── PatientDashboardPage.tsx
│       │   │   ├── PatientLoginPage.tsx
│       │   │   └── ... (also has hospital pages — legacy, ignore)
│       │   ├── hooks/
│       │   └── lib/
│       ├── capacitor.config.ts   # appId: com.ozzyl.lifestyle
│       ├── package.json
│       └── e2e/                  # Playwright E2E tests
│
├── web/                          # HOSPITAL STAFF FRONTEND (HMS portal)
│   ├── src/
│   │   ├── App.tsx               # Routes for hospital staff
│   │   ├── components/
│   │   │   ├── clinical/
│   │   │   ├── dashboard/
│   │   │   ├── nursing/
│   │   │   ├── radiology/
│   │   │   └── shareholders/
│   │   │   # NOTE: NO patient/ folder here
│   │   ├── pages/                # Hospital staff pages
│   │   │   ├── PatientOnboardingPage.tsx  # TODO: move to ozzyl-lifestyle
│   │   │   └── ... (120+ hospital pages)
│   │   ├── hooks/
│   │   └── lib/
│   ├── capacitor.config.ts
│   └── public/
│       └── locales/              # i18n translations (bn/en)
│
├── test/                         # Backend integration tests (Vitest)
├── data/                         # Static data (bd-foods.json, etc.)
├── docs/                         # Project docs, plans, roadmaps
└── landing/                      # Marketing landing page
```

## Rules

### Where to put NEW code:

| What | Where | Example |
|------|-------|---------|
| Patient/wellness UI component | `apps/ozzyl-lifestyle/src/components/patient/` | WeeklyReportCard.tsx |
| Patient page | `apps/ozzyl-lifestyle/src/pages/` | PatientOnboardingPage.tsx |
| Hospital staff UI component | `web/src/components/` | NursingDashboard.tsx |
| Hospital staff page | `web/src/pages/` | DischargeForm.tsx |
| ANY backend route | `src/routes/` | notifications.ts |
| ANY backend lib/logic | `src/lib/` | weekly-report.ts |
| DB migrations | `migrations/` or `migrations/global/` | 0135_push_tokens.sql |
| Backend tests | `test/` | push-notifications.test.ts |
| i18n translations | `web/public/locales/{bn,en}/` | patientPortal.json |
| Capacitor native config | `apps/ozzyl-lifestyle/` | For OzzyLife app |

### Known Issues:

1. **`apps/ozzyl-lifestyle/src/pages/` has ~116 hospital pages** that are duplicates of `web/src/pages/`. These are legacy — the patient app only uses `PatientDashboardPage.tsx`, `PatientLoginPage.tsx`, and a few others. Do NOT edit hospital pages in ozzyl-lifestyle.

2. **`PatientOnboardingPage.tsx` is in `web/src/pages/`** but should be in `apps/ozzyl-lifestyle/src/pages/`. Needs to be moved.

3. **i18n files** (`patientPortal.json`) are in `web/public/locales/` — patient app should reference these or have its own copy.

### Backend is SHARED:

Both `web/` and `apps/ozzyl-lifestyle/` hit the SAME Hono backend (`src/`). The backend does not care which frontend is calling — it uses JWT auth to identify the user/role.
