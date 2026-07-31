# Patient Portal Redesign And Production Reconciliation Design

## Scope

This change is split into two coordinated tracks:

1. Production reconciliation for patient vs hospital portal separation, auth entry points, and schema drift visibility.
2. Patient portal redesign that preserves current backend contracts while replacing the current oversized, mixed-responsibility frontend shell with a mobile-first and desktop-strong experience.

## Current Problems

- Public hospital landing pages mixed patient and staff entry points, causing hospital users to land in patient login flows.
- Production D1 schema exists far beyond what `d1_migrations` records, so migration history is not trustworthy.
- `apps/ozzyl-lifestyle/src/pages/PatientDashboardPage.tsx` is too large and mixes shell, navigation, state orchestration, and content rendering.
- Patient portal navigation is duplicated across desktop sidebar, mobile drawer, and bottom navigation.
- The current patient UI has useful features, but they are visually inconsistent and hard to scan on both mobile and desktop.

## Design Direction

### 1. Portal Boundary Rules

- Staff and patient entry points stay explicit and separate:
  - Patient: `/patient/login`
  - Hospital/staff: `/h/:slug/login`
  - Staff direct login remains `/login`
- Public hospital pages must always render both portal choices, never only the patient choice.

### 2. Production Schema Reconciliation

- Treat production D1 as drifted state, not as a clean migration target.
- Do not blindly run `wrangler d1 migrations apply` against production.
- Reconciliation starts with audit artifacts:
  - remote table inventory
  - remote `d1_migrations` ledger contents
  - mapping of migration files to already-existing tables/features
- After audit, create a safe catch-up strategy instead of direct replay.

### 3. Patient Portal UX Architecture

- Keep the existing section components and APIs in place for now.
- Replace the shell first:
  - one navigation model
  - one desktop sidebar style
  - one mobile drawer style
  - one mobile bottom-nav mapping
  - one content frame
- Defer deep per-tab redesign until the shell and nav model are stable.

### 4. Visual Direction

- Desktop should feel like a polished health workspace, not a stretched mobile page.
- Mobile should feel like an app shell with strong hierarchy, safe-area-aware navigation, and cleaner card rhythm.
- Use the repo’s teal/cyan healthcare palette, but reduce ad hoc gradients and one-off button styles.
- Emphasize:
  - clearer panel grouping
  - calmer backgrounds
  - stronger headline hierarchy
  - reusable shell classes

### 5. First Implementation Slice

- Introduce a shared patient portal navigation model.
- Refactor dashboard shell rendering to use shared nav data instead of duplicated mappings.
- Add reusable shell styling tokens/classes in patient app CSS.
- Keep all existing tab content rendering and backend fetch contracts unchanged.

## Validation

- Unit tests for patient portal navigation structure.
- Existing portal/auth regression tests stay green.
- Production verification:
  - `/patient/login` serves patient shell
  - `/login` and `/h/:slug/login` serve hospital shell
  - `/site/:slug` shows distinct hospital and patient login CTAs

## Risks

- The oversized patient dashboard page will still remain large after slice one, though smaller and more structured.
- Production migration ledger drift is not fixed by frontend work; it needs a dedicated reconciliation pass.
- Some tab-level UI inconsistencies will remain until later redesign slices.
