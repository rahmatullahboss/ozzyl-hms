# Ozzyl HMS — Complete Feature List

> **Stack**: Hono + Cloudflare Workers · D1 (SQLite) · React 19 + Vite · TanStack Query · Cloudflare Pages  
> **Live**: https://hms-saas-production.rahmatullahzisan.workers.dev  
> **Tests**: 373 passing across 34 test files  
> **Last Updated**: 2026-03-13

---

## ✅ Customer-Available Features (Hospital Subscribers)
> হাসপাতাল যারা সাবস্ক্রাইব করবে, তারা এই সব ফিচার পাবে:

| Module | Available Features |
|--------|--------------------|
| **Patient** | নিবন্ধন, বিস্তারিত তথ্য, ইতিহাস, সার্চ, ছবি আপলোড, Self-service portal |
| **Reception / OPD** | সিরিয়াল/টোকেন, walk-in visit, অ্যাপয়েন্টমেন্ট, আজকের তালিকা |
| **Doctor** | Queue dashboard, schedule, consultation notes, ডিজিটাল Rx + প্রিন্ট, কমিশন |
| **IPD / Inpatient** | ভর্তি, বেড বরাদ্দ, daily charges, নার্স স্টেশন, discharge summary প্রিন্ট |
| **Laboratory** | Test catalog, অর্ডার, রিপোর্ট এন্ট্রি, PDF প্রিন্ট, dashboard |
| **Pharmacy** | Inventory, ওষুধ বিতরণ, low stock alert, billing |
| **Billing & Payment** | বিল তৈরি, নগদ/bKash/Nagad পেমেন্ট, duplicate protection, বকেয়া, রসিদ প্রিন্ট, ইন্স্যুরেন্স |
| **Accounting** | Income/Expense, double-entry journal, chart of accounts, recurring, P&L, shareholder, commission |
| **Reports** | Revenue (দৈনিক/মাসিক), রোগী পরিসংখ্যান, occupancy, doctor performance |
| **Dashboards** | Hospital Admin, Director/MD executive, Multi-branch analytics |
| **Staff / HR** | Staff CRUD, invitation via email, 7-tier RBAC |
| **Telemedicine** | Video consultation session, CF Realtime SFU + Jitsi fallback, session history |
| **AI Assistant** | Medical chat (OpenRouter), long-term memory (Vectorize), PDF analysis, feedback |
| **Notifications** | In-app, email (Resend), SMS (SSL Wireless ready), PWA push |
| **Settings** | Hospital branding, branch management, tenant config |
| **Language** | English + বাংলা (সম্পূর্ণ, 10+ namespace) |
| **Mobile / PWA** | Install as app, offline support, Android APK, iOS build |
| **Security** | JWT, RBAC, rate limiting, CSP, HSTS, idempotency |
| **Monitoring** | Sentry error tracking, health check, Cloudflare observability |

---

## 🏥 1. Patient Management

| Feature | Backend | Frontend |
|---------|---------|----------|
| Register new patient (OPD/IPD) | [patients.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/patients.ts) → `POST /api/patients` | `PatientForm.tsx` |
| Patient list with search + pagination | `GET /api/patients?search=&page=` | `PatientList.tsx` |
| Patient detail view | `GET /api/patients/:id` | `PatientDetail.tsx` |
| Full patient timeline (visits, labs, bills, Rx) | `GET /api/patients/:id/timeline` | `PatientTimeline.tsx` |
| Patient self-service portal | `GET /api/patients/portal` | `PatientPortal.tsx` |
| Photo upload (R2) | `PATCH /api/patients/:id/photo` | `PatientForm.tsx` (compressImage) |
| Edit patient info | `PUT /api/patients/:id` | `PatientForm.tsx` |
| Delete patient | `DELETE /api/patients/:id` | `PatientList.tsx` |

---

## 🏠 2. Reception & OPD

| Feature | Backend | Frontend |
|---------|---------|----------|
| Serial / token desk | [visits.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/visits.ts) → `POST /api/visits` | `ReceptionDashboard.tsx` |
| Daily visit list by doctor | `GET /api/visits/today` | `ReceptionDashboard.tsx` |
| Walk-in visit creation | `POST /api/visits` | `ReceptionDashboard.tsx` |
| Appointment scheduling | [appointments.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/appointments.ts) → `POST /api/appointments` | `AppointmentScheduler.tsx` |
| Appointment list (doctor / patient view) | `GET /api/appointments` | `AppointmentScheduler.tsx` |
| Appointment update / cancel | `PUT /api/appointments/:id` | `AppointmentScheduler.tsx` |
| Conflict check on scheduling | Backend validation | `AppointmentScheduler.tsx` |

---

## 🩺 3. Doctor Module

| Feature | Backend | Frontend |
|---------|---------|----------|
| Doctor list + CRUD | [doctors.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/doctors.ts) | `StaffPage.tsx` |
| Doctor dashboard (today's queue) | [doctorDashboard.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/src/routes/tenant/doctorDashboard.ts) | `DoctorDashboard.tsx` |
| Availability / schedule management | [doctorSchedule.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/src/routes/tenant/doctorSchedule.ts) | `DoctorSchedule.tsx` |
| Consultation notes | [consultations.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/consultations.ts) | `ConsultationNotes.tsx` |
| Digital prescription writing | [prescriptions.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/prescriptions.ts) → `POST /api/prescriptions` | `DigitalPrescription.tsx` |
| Prescription print (PDF) | `GET /api/prescriptions/:id/print` | `PrescriptionPrint.tsx` |
| Doctor commission structure | [commissions.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/commissions.ts) | `CommissionManagement.tsx` |
| Commission reports | `GET /api/commissions/reports` | `ReportsDashboard.tsx` |

---

## 🛏️ 4. IPD / Inpatient

| Feature | Backend | Frontend |
|---------|---------|----------|
| Patient admission | [admissions.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/admissions.ts) → `POST /api/admissions` | `AdmissionIPD.tsx` |
| Bed assignment | `PUT /api/admissions/:id/bed` | `BedManagement.tsx` |
| Bed management dashboard | `GET /api/admissions/beds` | `BedManagement.tsx` |
| IPD daily charges (ward, O2, food, etc.) | [ipdCharges.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/src/routes/tenant/ipdCharges.ts) | `IPDCharges.tsx` |
| Nurse station (vitals, medication rounds) | [nurseStation.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/nurseStation.ts) | `NurseStation.tsx` |
| Patient discharge process | [discharge.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/discharge.ts) → `POST /api/discharge` | `DischargeSummary.tsx` |
| Discharge summary print (PDF) | `GET /api/discharge/:id/print` | `DischargeSummary.tsx` |

---

## 🧪 5. Laboratory

| Feature | Backend | Frontend |
|---------|---------|----------|
| Lab test catalog (create/update/delete) | [tests.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/tests.ts) | `TestCatalog.tsx` |
| Lab order creation | [lab.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/lab.ts) → `POST /api/lab/orders` | `LabTestOrderForm.tsx` |
| Lab result entry | `PUT /api/lab/:id/result` | `LaboratoryDashboard.tsx` |
| Lab report print (PDF) | `GET /api/lab/:id/print` | `LabReportPrint.tsx` |
| Laboratory dashboard | `GET /api/lab/dashboard` | `LaboratoryDashboard.tsx` |
| Pending orders list | `GET /api/lab/pending` | `LaboratoryDashboard.tsx` |

---

## 💊 6. Pharmacy

| Feature | Backend | Frontend |
|---------|---------|----------|
| Medicine inventory CRUD | [pharmacy.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/pharmacy.ts) | `PharmacyDashboard.tsx` |
| Medicine dispensing against Rx | `POST /api/pharmacy/dispense` | `MedicineDispensing.tsx` |
| Stock alerts (low stock) | `GET /api/pharmacy/stock-alerts` | `PharmacyDashboard.tsx` |
| Pharmacy billing | [pharmacy.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/pharmacy.ts) → `POST /api/pharmacy/billing` | `PharmacyDashboard.tsx` |
| Stock levels & reorder tracking | `GET /api/pharmacy/inventory` | `PharmacyDashboard.tsx` |

---

## 💰 7. Billing & Payments

| Feature | Backend | Frontend |
|---------|---------|----------|
| Bill creation (OPD/IPD/Lab/Pharmacy) | [billing.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/billing.ts) → `POST /api/billing` | `BillingDashboard.tsx` |
| Payment collection (cash/card/bKash/Nagad) | `POST /api/billing/pay` | `BillingDashboard.tsx` |
| **Payment idempotency** (duplicate prevention) | Unique [(idempotency_key, tenant_id)](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/doctors.test.ts#22-30) | `BillingDashboard.tsx` |
| Outstanding dues list | `GET /api/billing/due` | `BillingDashboard.tsx` |
| Bill search & filter | `GET /api/billing?status=&date=` | `BillingDashboard.tsx` |
| Bill print (PDF) | `GET /api/billing/:id/print` | `BillPrint.tsx` |
| Insurance claim management | [insurance.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/insurance.ts) | `InsuranceClaims.tsx` |
| Auto receipt number generation | `sequence_counters` table | — |

---

## 📊 8. Accounting & Finance

| Feature | Backend | Frontend |
|---------|---------|----------|
| Accounting dashboard (income vs expense) | [accounting.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/accounting.ts) | `AccountingDashboard.tsx` |
| Double-entry journal (debit/credit) | [journal.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/journal.ts) | `JournalEntries.tsx` |
| Chart of accounts | [accounts.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/accounts.ts) | `ChartOfAccounts.tsx` |
| Income recording | [income.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/income.ts) | `IncomeList.tsx` |
| Expense recording | [expenses.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/expenses.ts) | `ExpenseList.tsx` |
| Recurring expenses (auto-post) | [recurring.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/recurring.ts) | `RecurringExpenses.tsx` |
| Profit & loss calculation | [profit.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/profit.ts) | `ProfitLoss.tsx` |
| Shareholder management & dividends | [shareholders.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/shareholders.ts) | `ShareholderManagement.tsx` |
| Doctor commission reports | [commissions.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/commissions.ts) | `CommissionManagement.tsx` |
| Financial reports | [reports.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/reports.ts) | `Reports.tsx` |
| Accounting audit log | [audit.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/audit.ts) | `AuditLogs.tsx` |

---

## 📈 9. Reports & Analytics

| Feature | Backend | Frontend |
|---------|---------|----------|
| Revenue reports (daily/monthly) | [reports.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/reports.ts) | `ReportsDashboard.tsx` |
| Patient statistics | [dashboard.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/dashboard.ts) | `HospitalAdminDashboard.tsx` |
| Doctor performance | [commissions.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/commissions.ts) | `ReportsDashboard.tsx` |
| Occupancy rates | [admissions.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/admissions.ts) → `GET /api/admissions/occupancy` | `HospitalAdminDashboard.tsx` |
| Multi-branch analytics | [branches.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/branches.ts) → `GET /api/branches/analytics` | `MultiBranchDashboard.tsx` |
| Director executive dashboard | [dashboard.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/dashboard.ts) + [shareholders.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/shareholders.ts) | `DirectorDashboard.tsx` |
| Medical Director dashboard | [dashboard.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/dashboard.ts) → daily-income/expenses/summary | `MDDashboard.tsx` |

---

## 👥 10. Staff & HR

| Feature | Backend | Frontend |
|---------|---------|----------|
| Staff list (doctors, nurses, admin) | [staff.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/staff.ts) | `StaffPage.tsx` |
| Role-based access control (7 roles) | JWT middleware | `ProtectedRoute.tsx` |
| Staff invitation via email | [invitations.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/invitations.ts) → `POST /api/invitations` | `InviteStaff.tsx` |
| Accept invitation flow | `POST /api/invitations/accept` | `AcceptInvite.tsx` |
| Commission structure | [commissions.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/commissions.ts) | `CommissionManagement.tsx` |
| Staff deactivation | `DELETE /api/staff/:id` | `StaffPage.tsx` |

---

## 📱 11. Telemedicine

| Feature | Backend | Frontend |
|---------|---------|----------|
| Session creation | [telemedicine.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/telemedicine.ts) → `POST /api/telemedicine` | `TelemedicineDashboard.tsx` |
| Video room token (CF Realtime SFU) | `GET /api/telemedicine/:id/token` | `TelemedicineRoom.tsx` |
| Jitsi fallback (when CF not configured) | Auto-fallback logic | `TelemedicineRoom.tsx` |
| Session history | `GET /api/telemedicine` | `TelemedicineDashboard.tsx` |
| Session end & summary | `PUT /api/telemedicine/:id/end` | `TelemedicineRoom.tsx` |

---

## 🤖 12. AI Assistant

| Feature | Backend | Frontend |
|---------|---------|----------|
| AI medical chat | [ai.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/ai.ts) via OpenRouter API | `AIAssistant.tsx` |
| Long-term memory | Cloudflare Vectorize (`hms-ai-memory`) | `AIAssistant.tsx` |
| Feedback system (👍/👎) | `POST /api/ai/feedback` | `AIAssistant.tsx` |
| AI PDF generation & analysis | `ai-pdf.ts` | `AIAssistant.tsx` |
| Rate limiting (per tenant/user) | KV-based token bucket | `AIAssistant.tsx` |
| Input summarization for memory | Auto-summary before store | `AIAssistant.tsx` |

---

## 🔔 13. Notifications

| Feature | Backend | Frontend |
|---------|---------|----------|
| In-app notifications | [notifications.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/notifications.ts) | `NotificationsCenter.tsx` |
| Email (Resend API) | Triggered on key events | — |
| SMS (stub / SSL Wireless) | `SMS_PROVIDER` env | — |
| Push notifications | Service Worker | `PWAUpdatePrompt.tsx` |
| Mark as read | `PUT /api/notifications/:id/read` | `NotificationsCenter.tsx` |

---

## 🏢 14. Multi-Tenancy & SaaS

| Feature | Backend | Frontend |
|---------|---------|----------|
| Hospital self-registration | `superAdmin.ts` | `HospitalSignup.tsx` |
| Complete tenant isolation | `tenant_id` on all queries | — |
| Per-tenant settings | [settings.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/settings.ts) | `SettingsPage.tsx` |
| Branch management | [settings.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/settings.ts) | `SettingsPage.tsx` |
| Custom branding (logo, name, contact) | Settings API | `SettingsPage.tsx` |
| Per-tenant sequence counters (invoice#) | `sequence_counters` table | — |

---

## 🔒 15. Security

| Feature | Implementation |
|---------|---------------|
| JWT authentication | Hono JWT middleware |
| 7-tier RBAC | `ProtectedRoute.tsx` + route middleware |
| Rate limiting | KV-based per IP / tenant |
| Input validation | Zod on all endpoints |
| SQL injection prevention | Parameterized D1 queries `.bind()` |
| **Content-Security-Policy (CSP)** | Full CSP header (scripts, fonts, blobs, WSS) |
| **HSTS** | `Strict-Transport-Security: max-age=31536000; preload` |
| `X-Frame-Options: DENY` | Clickjacking prevention |
| `X-XSS-Protection` | XSS filter header |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, mic, geolocation denied |
| Password hashing | bcryptjs (10 rounds) |
| **Payment idempotency** | Unique index [(idempotency_key, tenant_id)](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/doctors.test.ts#22-30) |
| CORS | Per-environment origin whitelist |

---

## 🌐 16. Internationalization (i18n)

| Feature | Details |
|---------|---------|
| English (EN) | Complete |
| Bengali / বাংলা (BN) | Complete |
| Namespaces | `common`, `patients`, [billing](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/load-tests/k6-load.js#41-50), `lab`, `pharmacy`, `accounting`, `telemedicine`, `appointments`, `settings`, `notifications` |
| Runtime lang switch | i18next |

---

## 📲 17. PWA / Mobile

| Feature | Details |
|---------|---------|
| Progressive Web App | `vite-plugin-pwa` |
| Offline cache | Service Worker |
| Install prompt | `PWAUpdatePrompt.tsx` |
| Android APK | Capacitor v8 + GitHub Actions CI |
| iOS build (unsigned) | Capacitor + GitHub Actions CI |
| Push notification ready | Web Push API |

---

## 🛡️ 18. Monitoring & Reliability

| Feature | Details |
|---------|---------|
| **Sentry error tracking** | `toucan-js` on Workers; DSN on staging + production |
| **React ErrorBoundary** | All rendering errors caught, graceful fallback UI |
| Health check | `GET /api/health` → `{"status":"ok","version":"1.0.0"}` |
| Cloudflare Observability | Worker logs + traces, `head_sampling_rate = 1` |
| Audit log | All sensitive actions logged ([audit.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/src/routes/tenant/audit.ts)) |
| System audit log UI | `SystemAuditLog.tsx` |
| **k6 smoke test** | 5 VUs, 1 min, p95 < 2s — [load-tests/k6-smoke.js](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/load-tests/k6-smoke.js) |
| **k6 load test** | 50 VUs staged (10m), p95 < 3s — [load-tests/k6-load.js](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/load-tests/k6-load.js) |
| **k6 stress test** | 300 VUs (19m), find breaking point — [load-tests/k6-stress.js](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/load-tests/k6-stress.js) |
| **Playwright E2E** | Auth, patient journey, billing — `web/e2e/` |
| **Backup runbook** | Daily D1→R2 export, PITR via CF Time Travel — [docs/backup-recovery-runbook.md](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/docs/backup-recovery-runbook.md) |

---

## ⚙️ 19. Infrastructure

| Resource | Details |
|----------|---------|
| **API** | Cloudflare Workers (Hono) |
| **Database** | Cloudflare D1 (SQLite) — `hms-super-admin-production` + staging |
| **Cache / Sessions** | Cloudflare KV — prod + staging namespaces |
| **File Storage** | Cloudflare R2 — `hms-uploads-production`, `hms-uploads-staging` |
| **AI / ML** | Cloudflare AI + Vectorize index `hms-ai-memory` |
| **Frontend** | Cloudflare Pages (React 19 + Vite) |
| **Email** | Resend API (`RESEND_API_KEY` secret) |
| **SMS** | Stub mode; SSL Wireless / bNotify ready |
| **Mobile payments** | bKash + Nagad secrets ready |
| **Video** | Cloudflare Realtime SFU secrets ready |
| **CI/CD** | GitHub Actions: deploy + Android APK + iOS build |
| **Environments** | `top-level` (dev), `--env staging`, `--env production` |

---

## 🧪 20. Test Coverage (34 files · 373 tests)

| Test File | Coverage |
|-----------|---------|
| [auth.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/auth.test.ts) | Login, JWT, multi-tenant auth |
| [patients.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/patients.test.ts) | CRUD, search, pagination, photo |
| [visits.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/visits.test.ts) | OPD serial, daily list |
| [appointments.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/appointments.test.ts) | Schedule, conflict, cancel |
| [billing.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/billing.test.ts) | Bill creation, payments |
| **[payment-idempotency.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/payment-idempotency.test.ts)** | 6 idempotency scenarios |
| [lab.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/lab.test.ts) | Orders, results, catalog |
| [pharmacy.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/pharmacy.test.ts) | Inventory, dispensing, stock |
| [prescriptions.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/prescriptions.test.ts) | Digital Rx, print |
| [consultations.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/consultations.test.ts) | Consultation notes |
| [doctors.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/doctors.test.ts) | CRUD, specialties |
| [doctor-schedules.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/doctor-schedules.test.ts) | Availability, slots |
| [doctor-dashboard.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/doctor-dashboard.test.ts) | Queue, today's patients |
| [admissions.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/admissions.test.ts) | IPD admit, beds |
| [ipd-charges.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/ipd-charges.test.ts) | Daily charges |
| [discharge.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/discharge.test.ts) | Discharge process |
| [nurse-station.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/nurse-station.test.ts) | Vitals, rounds |
| [accounting.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/accounting.test.ts) | Income, expense, dashboard |
| [accounts-journal.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/accounts-journal.test.ts) | Double-entry journal |
| [expenses.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/expenses.test.ts) | Expense CRUD |
| [income.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/income.test.ts) | Income CRUD |
| [recurring.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/recurring.test.ts) | Recurring auto-post |
| [profit.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/profit.test.ts) | P&L calculation |
| [shareholders.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/shareholders.test.ts) | Shareholder dividends |
| [commissions-reports.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/commissions-reports.test.ts) | Commission reports |
| [staff.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/staff.test.ts) | CRUD, roles |
| [shareholder-invitations-portal.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/shareholder-invitations-portal.test.ts) | Invitations, portal |
| [settings-branches.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/settings-branches.test.ts) | Settings, branches |
| [notifications-audit.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/notifications-audit.test.ts) | Notifications, audit log |
| [dashboard.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/dashboard.test.ts) | KPIs, stats |
| [test-catalog.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/test-catalog.test.ts) | Lab test catalog |
| [tenant-isolation.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/tenant-isolation.test.ts) | Cross-tenant access blocked |
| [edge-cases.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/edge-cases.test.ts) | Boundary & error conditions |
| [ai-pdf.test.ts](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/ai-pdf.test.ts) | AI, Vectorize memory, feedback |

---

## 📋 Role Matrix

| Role | Patients | Billing | Lab | Pharmacy | IPD | Accounting | Staff | AI |
|------|:--------:|:-------:|:---:|:--------:|:---:|:----------:|:-----:|:--:|
| `super_admin` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `hospital_admin` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `doctor` | 👁️ read | — | ✅ order | — | — | — | — | ✅ |
| `nurse` | ✅ | — | ✅ collect | ✅ dispense | ✅ | — | — | — |
| [reception](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/load-tests/k6-load.js#51-66) | ✅ | ✅ collect | — | — | — | — | — | — |
| `accountant` | — | ✅ | — | — | — | ✅ | — | — |
| [director](file:///Users/rahmatullahzisan/Desktop/Dev/hms/hms-saas/apps/api/tests/expenses.test.ts#17-25) | 👁️ | 👁️ | — | — | — | ✅ view | — | — |
