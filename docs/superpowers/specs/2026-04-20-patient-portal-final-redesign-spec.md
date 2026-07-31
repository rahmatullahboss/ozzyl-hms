# Patient Portal Final Redesign Spec

Date: 2026-04-20
Workspace: `/Users/rahmatullahzisan/Desktop/Dev/hms`

## Objective

Redesign the patient portal so that:

- patient and hospital portals are cleanly separated
- patient navigation matches backend domain boundaries
- desktop feels like a structured workspace
- mobile feels like a focused health app
- routing is path-based, not a fragile tab-query state machine
- data loading is centered on shared React Query hooks instead of page-local fetch chains

This spec is the implementation target for the full redesign.

## Backend Reality

The backend already supports six distinct product surfaces:

1. Global patient identity
   - `/api/patient-auth/*`
   - `/api/global-portal/dashboard`
   - `/api/global-portal/hospitals`
2. Hospital-scoped care workspace
   - `/api/patient-portal/*`
   - requires `X-Tenant-ID`
3. Records and vault
   - tenant records in `/api/patient-portal/*`
   - global vault and emergency/visit-pack flows in `/api/global-portal/*`
4. Wellness
   - `/api/wellness/*`
5. Family and proxy access
   - `/api/global-portal/family/*`
   - family graph and proxy invite helpers in `src/lib/family-graph.ts`
6. Privacy and sharing
   - consents, access controls, linked hospital sharing

The frontend must reflect these boundaries. The old dashboard mixed them together and hid the fact that some pages are global while others are hospital-specific.

## External Product Signals

Official patient products show a consistent pattern:

- MyChart emphasizes one login across organizations, appointments, records, bills, virtual care, family access, and record sharing.
- NHS App groups the most-used areas on the home screen and separates Home, Messages, and Profile while keeping prescriptions, appointments, test results, and documents easy to reach.
- Mayo and Kaiser patient apps both center the experience on appointments, records, prescriptions, family/caregiver access, and quick task completion.

Design implication:

- top-level navigation should be small
- home should surface the most-used actions, not every feature
- records, care, family, and profile/privacy should be clear mental models
- family/proxy access deserves first-class treatment, not a hidden sub-feature

## Final IA

The patient portal will use **6 primary areas**:

1. `Home`
2. `Care`
3. `Records`
4. `Wellness`
5. `Family`
6. `Profile`

`Profile` replaces the old vague "Me" concept and absorbs privacy/device/account controls.

## Final Routes

- `/patient/home`
- `/patient/care`
- `/patient/care/find`
- `/patient/care/appointments`
- `/patient/care/prescriptions`
- `/patient/care/labs`
- `/patient/care/bills`
- `/patient/records`
- `/patient/records/vault`
- `/patient/records/timeline`
- `/patient/records/self-reported`
- `/patient/records/visit-pass`
- `/patient/records/emergency-pack`
- `/patient/wellness`
- `/patient/wellness/trends`
- `/patient/wellness/journal`
- `/patient/wellness/medications`
- `/patient/wellness/ai-plan`
- `/patient/family`
- `/patient/profile`
- `/patient/profile/privacy`
- `/patient/profile/devices`
- `/patient/profile/account`

Legacy compatibility:

- `/patient/dashboard?tab=*` remains temporarily supported
- legacy links normalize to canonical routes
- old route glue is removed only after all primary surfaces are migrated

## Navigation Model

### Desktop

Left sidebar contains only the 6 primary areas:

- Home
- Care
- Records
- Wellness
- Family
- Profile

Within `Care`, `Records`, `Wellness`, and `Profile`, a contextual secondary rail or segmented header is shown inside the page body.

### Mobile

Bottom nav contains 4 actions:

- Home
- Care
- Records
- Profile

Other sections are accessible from the header menu / drawer:

- Wellness
- Family

Reason:

- mobile bottom nav should prioritize high-frequency utility
- Family and Wellness are important but not as frequently invoked as Home/Care/Records/Profile

## Page Wireframes

## 1. Home

Purpose:

- global front door
- daily summary
- urgent actions
- cross-hospital overview

Modules:

- greeting and patient identity card
- daily check-in / health status summary
- next appointment and live visit card
- quick actions
- patient guidance summary
- linked hospitals snapshot
- recent documents / prescriptions / bills summary

Rules:

- no giant clinical tables
- only summaries and launch points
- every card should answer "what needs attention now?"

## 2. Care

Purpose:

- active hospital workspace
- selected hospital context

Required controls:

- visible hospital switcher
- explicit selected hospital summary

Subsections:

- Overview
- Find Care
- Appointments
- Prescriptions
- Labs
- Bills

Modules:

- selected hospital banner
- linked hospitals list
- appointment list and status
- prescription list
- labs list
- billing summary

Rules:

- all care requests must clearly show hospital context
- hospital switching must not be hidden
- if no hospital is selected, show selection state, not an empty dashboard

## 3. Records

Purpose:

- patient-owned portable health record surface

Subsections:

- Overview
- Vault
- Timeline
- Self-reported
- Visit Pass
- Emergency Pack

Modules:

- record portability banner
- global timeline / recent record feed
- vault document upload + browse
- self-reported health data
- visit pass QR and history
- emergency pack export/share

Rules:

- records are not tied visually to a single hospital unless the item is hospital-originated
- document upload and document browsing should feel like one coherent vault

## 4. Wellness

Purpose:

- wellness scoring, adherence, trends, journaling, coaching

Subsections:

- Overview
- Trends
- Journal
- Medications
- AI Plan

Modules:

- score and trend cards
- nutrition / sleep / activity / vitals
- diary history and food diary
- medication reminders
- AI planner and routines
- challenge / breathing / supportive lifestyle modules

Rules:

- wellness is supportive, not a substitute for care
- the AI section must stay clearly non-diagnostic

## 5. Family

Purpose:

- managed dependents
- proxy invites
- family risk context

Modules:

- managed profiles overview
- proxy invites list
- role/access state
- family risk insights
- household quick actions

Rules:

- make access scope visible
- distinguish "managed by me" vs "shared with me"

## 6. Profile

Purpose:

- account, privacy, devices, session, patient identity maintenance

Subsections:

- Account
- Privacy
- Devices

Modules:

- core identity fields
- phone/NID/profile completion
- privacy lock controls
- hospital sharing/consent controls
- device management
- logout/session actions

Rules:

- this is not a dumping ground
- account and privacy must be explicit, not mixed into care or records

## Component Architecture

Large page logic should be split into top-level section components:

- `PatientHomeSection`
- `PatientCareSection`
- `PatientRecordsSection`
- `PatientWellnessSection`
- `PatientFamilySection`
- `PatientProfileSection`

`PatientDashboardPage.tsx` becomes shell/orchestrator only:

- auth/session gate
- route-to-section resolution
- modal wiring
- shared query prefetch
- shared shell layout

## Data Layer

React Query becomes the standard data access layer.

Shared hook groups:

- `patient-portal/identity`
- `patient-portal/home`
- `patient-portal/care`
- `patient-portal/records`
- `patient-portal/wellness`
- `patient-portal/family`
- `patient-portal/profile`

Rules:

- page components must not own ad hoc fetches for first-class data
- use query keys by domain, not by page name
- mutations invalidate the minimal affected domain keys

## Removal Rules

Remove only after equivalent surface is live:

- old mixed navigation arrays
- old dashboard tab query flow
- duplicate patient route glue
- dead wrapper pages

Keep temporarily:

- legacy `/patient/dashboard?tab=*` compatibility
- old tab-specific feature components until their new section wrappers fully own them

## Visual Direction

Desktop:

- editorial, structured, calm
- sidebar + content canvas
- information grouped into strong cards with real hierarchy

Mobile:

- fewer simultaneous cards
- stronger single-column flow
- bottom nav focused on high-frequency tasks
- large tap targets and app-like spacing

Color:

- keep current cyan/teal/emerald family
- reduce random gradients
- use stronger neutral surfaces and clearer emphasis states

Typography:

- clearer distinction between page title, section title, and meta text
- avoid every card shouting equally loudly

## Success Criteria

- patient and hospital portals never cross-launch incorrectly
- patient entry always lands on canonical patient paths
- users can understand the 6-area model without training
- hospital context is obvious in Care
- records feel portable and patient-owned
- privacy/account are easy to find
- main patient page is no longer a 1500+ line mixed UI file

## Implementation Order

1. canonical patient routing and launch targets
2. shared query foundation
3. shell navigation alignment to 6-area IA
4. extract top-level section components
5. migrate Care
6. migrate Records
7. migrate Wellness
8. migrate Family
9. migrate Profile
10. remove dead legacy tab surfaces
