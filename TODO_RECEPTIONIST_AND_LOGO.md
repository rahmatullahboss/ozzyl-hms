# HMS — Logo Standardization & Receptionist Module TODO

## Phase 1: Logo Standardization

- [x] 1.1 Generate Ozzyl pulse logo as SVG (web/public/ozzyl-logo.svg)
- [x] 1.2 Replace landing favicon.svg with new Ozzyl logo
- [x] 1.3 Replace landing Navbar.astro logo (all 3 landing pages use this)
- [x] 1.4 Replace web app PWA icons (pwa-192x192.png, pwa-512x512.png, apple-touch-icon.png)
- [x] 1.5 Replace Login.tsx logo (Activity icon → Ozzyl logo)
- [x] 1.6 Replace AdminLogin.tsx logo
- [x] 1.7 Update Sidebar.tsx dashboard logo (default Ozzyl, overridable by hospital logo from settings)
- [x] 1.8 Replace PatientLoginPage.tsx logo
- [x] 1.9 Replace HospitalSignup.tsx logo
- [x] 1.10 Update index.html favicon (SVG + PNG fallback)
- [x] 1.11 Update vite.config.ts PWA manifest theme color
- [ ] 1.12 Update mobile app icons (android + ios) — deferred, needs separate build

## Phase 2: Receptionist Module — Wire Existing + Add Missing

### Already exists in backend (need UI wiring only):
- [x] 2.2 Deposit Management — API exists (src/routes/tenant/deposits.ts), needs reception UI page
- [x] 2.3 Bill Returns / Credit Notes — API exists (src/routes/tenant/creditNotes.ts), accessible from billing
- [x] 2.4 Discount Application — bill-level + item-level discounts already work

### Needs implementation:
- [x] 2.1 Walk-in Patient Flow — walk-in visit creation + auto queue token on ReceptionDashboard
- [x] 2.5 Reception sidebar — added deposits, credit notes, billing handover nav links
- [x] 2.6 Deposits Page (UI) — wired into reception routes
- [x] 2.7 Appointment source tracking — source field (scheduled/walk_in/online/phone) + badge
- [x] 2.8 Payment Handover — wired BillingHandoverPage into reception routes + sidebar

## Phase 3: Receptionist Module — Important Gaps

- [x] 3.1 Bed Availability Check — wired BedManagement into reception routes + sidebar
- [x] 3.2 Admission from Reception — wired AdmissionIPD into reception routes + sidebar
- [x] 3.3 Insurance Scheme Linking — wired InsuranceBillingPage into reception routes + sidebar
- [x] 3.4 OPD Token / Sticker Print — print button on QueueManagement with styled token card
- [x] 3.5 Patient Merge — MergeModal on PatientList + expanded backend to cover appointments/deposits/prescriptions/queue
- [x] 3.6 Appointment Rescheduling — RescheduleModal with date/time/doctor change + backend apptDate support
- [x] 3.7 Billing Counter Selection — already exists in BillingMasterPage (billing_counters table + CRUD API)

## Phase 4: Receptionist Module — Nice to Have

- [x] 4.1 Revenue / Due Reports — ReceptionReportsPage with daily collection, payment method breakdown, due bills, transaction details
- [x] 4.2 Patient Health Card — print-sized card with patient info, blood group, emergency contact on PatientDetail
- [x] 4.3 No-show Tracking / Follow-up — no-show count in PatientDetail Quick Stats (shows when > 0)
- [x] 4.4 Online Appointment Approval — OnlineAppointmentApproval page, pending_approval status, patient portal creates with pending status
- [x] 4.5 Appointment Confirmation / Reminders (SMS/email) — "Remind" button on AppointmentScheduler, uses existing /api/notifications/appointment endpoint
